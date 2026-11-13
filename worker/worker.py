#!/usr/bin/env python3
"""Worker de generación de Sonora.

Proceso SEPARADO del servidor web: pide tareas a la API (cola en PostgreSQL), carga el modelo
una sola vez, genera audio real, lo sube y reporta estados. Puede ejecutarse en tu PC con GPU,
en un servidor remoto o en un contenedor; solo necesita llegar por HTTP(S) a la web.
"""
from __future__ import annotations

import json
import logging
import mimetypes
import os
import platform
import shutil
import signal
import tempfile
import threading
import time
import traceback
import uuid
from pathlib import Path

import requests

from engines import EngineError, JobCancelled, load_engine

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("worker")

API = os.environ.get("SONORA_API_URL", "http://127.0.0.1:3000").rstrip("/")
TOKEN = os.environ.get("WORKER_TOKEN", "")
ENGINE_NAME = os.environ.get("MUSIC_ENGINE", "acestep")
WORKER_ID = os.environ.get("WORKER_ID") or f"{platform.node()}-{uuid.uuid4().hex[:6]}"
POLL = float(os.environ.get("POLL_INTERVAL", "3"))
HEARTBEAT = float(os.environ.get("HEARTBEAT_INTERVAL", "10"))

if not TOKEN:
    raise SystemExit("Define WORKER_TOKEN (el mismo valor que en el servidor web).")

session = requests.Session()
session.headers["Authorization"] = f"Bearer {TOKEN}"

stop = threading.Event()
state = {"job_id": None, "attempt": None, "cancel": False}
engine = None


def post(path: str, **kw):
    kw.setdefault("timeout", 30)
    headers = dict(kw.pop("headers", {}))
    headers["X-Worker-Id"] = WORKER_ID
    if state["attempt"] is not None:
        headers["X-Job-Attempt"] = str(state["attempt"])
    kw["headers"] = headers
    return session.post(f"{API}{path}", **kw)


def heartbeat_loop():
    while not stop.is_set():
        try:
            info = engine.info() if engine else {}
            job_id, attempt = state["job_id"], state["attempt"]
            r = post(
                "/api/worker/heartbeat",
                json={"workerId": WORKER_ID, "name": platform.node(), "engine": ENGINE_NAME, "info": info, "currentJobId": job_id, "currentJobAttempt": attempt},
            )
            if r.ok and r.json().get("cancel") and (job_id, attempt) == (state["job_id"], state["attempt"]):
                state["cancel"] = True
        except Exception as e:  # noqa: BLE001
            log.warning("Heartbeat falló: %s", e)
        stop.wait(HEARTBEAT)


def make_progress(job_id: str):
    last = {"t": 0.0, "stage": "", "frac": None}

    def report(stage: str, frac):
        now = time.time()
        if stage == last["stage"] and frac == last["frac"]:
            return
        if now - last["t"] < 1.0 and frac is not None and frac < 1:
            return
        last.update(t=now, stage=stage, frac=frac)
        try:
            r = post(f"/api/worker/jobs/{job_id}/progress", json={"stage": stage, "progress": frac}, timeout=10)
            if r.status_code == 409:
                state["cancel"] = True
        except Exception as e:  # noqa: BLE001
            log.debug("progress falló: %s", e)

    return report


def fail(job_id: str, message: str, retryable: bool):
    try:
        post(f"/api/worker/jobs/{job_id}/fail", json={"error": message[-3500:], "retryable": retryable})
    except Exception as e:  # noqa: BLE001
        log.error("No se pudo reportar el fallo: %s", e)


def process(job: dict):
    job_id = job["id"]
    state.update(job_id=job_id, attempt=job["attempts"], cancel=False)
    workdir = Path(tempfile.mkdtemp(prefix=f"sonora-{job_id[:8]}-"))
    report = make_progress(job_id)
    try:
        source = None
        if job.get("sourcePath"):
            report("Descargando audio fuente", None)
            r = session.get(
                f"{API}{job['sourcePath']}", stream=True, timeout=120,
                headers={"X-Worker-Id": WORKER_ID, "X-Job-Attempt": str(job["attempts"])},
            )
            if r.status_code == 409:
                raise JobCancelled()
            r.raise_for_status()
            ext = mimetypes.guess_extension(job["parent"]["mime"]) or ".audio"
            source = workdir / f"source{ext}"
            with open(source, "wb") as fh:
                shutil.copyfileobj(r.raw, fh)
        log.info("Tarea %s (%s) — %s", job_id, job["kind"], job.get("title"))
        result = engine.run(job, workdir, source, report, lambda: state["cancel"])
        if state["cancel"]:
            raise JobCancelled()
        report("Subiendo audio", None)
        meta = {
            "durationSec": result.duration_sec,
            "model": result.model,
            "modelVersion": result.model_version,
            "caption": result.caption,
            "lyrics": result.lyrics,
            "bpm": result.bpm,
            "keyscale": result.keyscale,
            "language": result.language,
            "seed": result.seed,
        }
        meta = {k: v for k, v in meta.items() if v is not None}
        mime = mimetypes.guess_type(result.path.name)[0] or "application/octet-stream"
        with open(result.path, "rb") as fh:
            r = post(
                f"/api/worker/jobs/{job_id}/complete",
                data={"meta": json.dumps(meta)},
                files={"file": (result.path.name, fh, mime)},
                timeout=300,
            )
        if r.status_code == 409:
            log.info("Tarea %s cancelada o reasignada; resultado descartado", job_id)
        elif not r.ok:
            raise EngineError(f"El servidor rechazó el audio: {r.status_code} {r.text[:300]}", retryable=r.status_code >= 500)
        else:
            log.info("Tarea %s completada (%.1fs de audio)", job_id, result.duration_sec)
    except JobCancelled:
        log.info("Tarea %s cancelada por el usuario", job_id)
    except EngineError as e:
        log.error("Error del motor en %s: %s", job_id, e)
        fail(job_id, str(e), e.retryable)
    except requests.RequestException as e:
        log.error("Error de red en %s: %s", job_id, e)
        fail(job_id, f"Error de red del worker: {e}", True)
    except Exception as e:  # noqa: BLE001
        log.error("Error inesperado en %s\n%s", job_id, traceback.format_exc())
        fail(job_id, f"{e.__class__.__name__}: {e}\n{traceback.format_exc()}", False)
    finally:
        # Los fallos durante la limpieza no deben detener el worker ni bloquear
        # las siguientes tareas. El estado de la tarea siempre se reinicia.
        shutil.rmtree(workdir, ignore_errors=True)
        try:
            if engine is not None:
                engine.release()
        except Exception:  # noqa: BLE001
            log.exception("No se pudo liberar la memoria tras %s; el worker seguirá operativo", job_id)
        finally:
            state.update(job_id=None, attempt=None, cancel=False)


def main():
    global engine
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    log.info("Cargando motor '%s'… (puede tardar la primera vez)", ENGINE_NAME)
    engine = load_engine(ENGINE_NAME)
    log.info("Motor listo: %s", engine.info())
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    while not stop.is_set():
        try:
            r = post("/api/worker/claim", json={"workerId": WORKER_ID, "engine": ENGINE_NAME})
            if r.status_code in (401, 503):
                log.error("API rechazó al worker (%s): %s", r.status_code, r.text[:200])
                stop.wait(15)
                continue
            r.raise_for_status()
            job = r.json().get("job")
        except Exception as e:  # noqa: BLE001
            log.warning("No se pudo contactar con %s: %s", API, e)
            stop.wait(POLL * 2)
            continue
        if not job:
            stop.wait(POLL)
            continue
        process(job)
    log.info("Worker detenido")


if __name__ == "__main__":
    main()
