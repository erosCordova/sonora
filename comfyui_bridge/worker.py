"""Puente ComfyUI local -> Sonora Render, sin consola ni GPU en el servidor web.

Solo acepta trabajos de generación de música con letra explícita y modelo ACE-Step
1.5 Turbo AIO. Otros trabajos fallan de forma explícita, sin audios falsos.
Las credenciales nunca se devuelven al navegador.
"""
from __future__ import annotations

import json
import logging
import random
import shutil
import subprocess
import threading
import time
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

log = logging.getLogger("sonora.comfyui")
REMOTE = "https://sonora-api-vdnd.onrender.com"
DEFAULT_CHECKPOINT = "ace_step_1.5_turbo_aio.safetensors"
MAX_AUDIO_BYTES = 50 * 1024 * 1024
MAX_WAIT_SECONDS = 30 * 60


class BridgeError(RuntimeError):
    pass


def _local_endpoint(value: str) -> str:
    parsed = urlsplit(value.strip().rstrip("/"))
    if parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1") or not parsed.port:
        raise BridgeError("ComfyUI debe utilizar http://127.0.0.1:PUERTO o http://localhost:PUERTO")
    if parsed.username or parsed.password or parsed.path not in ("", "/") or parsed.query or parsed.fragment:
        raise BridgeError("URL de ComfyUI inválida")
    return f"http://{parsed.hostname}:{parsed.port}"


def _http(url: str, method="GET", json_data=None, token="", timeout=20, limit=2_000_000):
    headers = {"User-Agent": "Sonora-ComfyUI/1.0"}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if json_data is not None:
        data = json.dumps(json_data, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = Request(url, data=data, method=method, headers=headers)
    try:
        with urlopen(req, timeout=timeout) as r:
            payload = r.read(limit + 1)
            if len(payload) > limit:
                raise BridgeError("La respuesta superó el límite permitido")
            return json.loads(payload) if payload else {}
    except HTTPError as e:
        detail = e.read(400).decode("utf-8", "replace")
        raise BridgeError(f"HTTP {e.code}: {detail}") from e
    except (URLError, TimeoutError, OSError) as e:
        raise BridgeError(f"Sin conexión con el servicio: {e}") from e


def _choose_checkpoint(object_info: dict) -> str:
    """Comprueba tanto los nodos como el checkpoint antes de anunciarse online."""
    for node in ("CheckpointLoaderSimple", "TextEncodeAceStepAudio1.5", "EmptyAceStep1.5LatentAudio",
                 "KSampler", "VAEDecodeAudio", "SaveAudioMP3", "ModelSamplingAuraFlow", "ConditioningZeroOut"):
        if node not in object_info:
            raise BridgeError(f"Falta el nodo {node}: actualiza ComfyUI o carga el flujo ACE-Step 1.5")
    choices = object_info["CheckpointLoaderSimple"].get("input", {}).get("required", {}).get("ckpt_name", [[]])[0]
    found = next((c for c in choices if str(c).replace("\\", "/").split("/")[-1].lower() == DEFAULT_CHECKPOINT), None)
    if not found:
        raise BridgeError(f"Falta el modelo {DEFAULT_CHECKPOINT}. Descárgalo mediante el flujo ACE-Step 1.5 AIO de ComfyUI")
    return found


def build_workflow(params: dict, checkpoint=DEFAULT_CHECKPOINT, seed=None, job_id="") -> dict:
    """Gráfico API del flujo AIO oficial ComfyUI, únicamente para text2music."""
    if params.get("needsCreateSample"):
        raise BridgeError("Esta canción requiere componer la letra; usa modo Personalizado e introduce la letra")
    instrumental = bool(params.get("instrumental"))
    lyrics = "[Instrumental]" if instrumental else str(params.get("lyrics") or "").strip()
    if not lyrics:
        raise BridgeError("Introduce una letra en modo Personalizado para generar con la GPU de 6 GB")
    caption = str(params.get("caption") or params.get("prompt") or "").strip()
    if not caption:
        raise BridgeError("Falta la descripción del estilo musical")
    seconds = int(params.get("duration") or 60)
    if seconds < 10 or seconds > 240:
        raise BridgeError("La duración debe estar entre 10 y 240 segundos")
    bpm = int(params.get("bpm") or 110)
    language = str(params.get("language") or "es")
    if language in ("auto", "unknown", ""):
        language = "es"
    seed = seed if seed is not None else random.SystemRandom().randint(1, 2**31 - 1)
    # El nodo ACE-Step 1.5 acepta solo tonalidades de su lista cerrada.
    # Antes se enviaba una cadena vacía y ComfyUI rechazaba TODO el flujo (HTTP 400).
    keys = ("C", "C#", "Db", "D", "D#", "Eb", "E", "F", "F#", "Gb", "G", "G#", "Ab", "A", "A#", "Bb", "B")
    valid_keys = {f"{root} {quality}" for root in keys for quality in ("major", "minor")}
    requested_key = str(params.get("keyscale") or "").strip()
    keyscale = requested_key if requested_key in valid_keys else "C major"
    prefix = f"audio/sonora_{str(job_id).replace('-', '')[:24]}" if job_id else "audio/sonora"
    return {
      "3": {"class_type": "KSampler", "inputs": {"cfg": 1, "denoise": 1, "latent_image": ["98", 0],
          "model": ["78", 0], "negative": ["47", 0], "positive": ["94", 0],
          "sampler_name": "euler", "scheduler": "simple", "seed": seed, "steps": 8}},
      "18": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["3", 0], "vae": ["97", 2]}},
      "47": {"class_type": "ConditioningZeroOut", "inputs": {"conditioning": ["94", 0]}},
      "78": {"class_type": "ModelSamplingAuraFlow", "inputs": {"model": ["97", 0], "sampling": "flow", "shift": 3}},
      "94": {"class_type": "TextEncodeAceStepAudio1.5", "inputs": {
          "bpm": bpm, "cfg_scale": 2, "clip": ["97", 1], "duration": seconds,
          "generate_audio_codes": True, "keyscale": keyscale, "language": language, "lyrics": lyrics,
          "min_p": 0, "seed": seed, "tags": caption, "temperature": 0.85,
          "timesignature": "4", "top_k": 0, "top_p": 0.9}},
      "97": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": checkpoint}},
      "98": {"class_type": "EmptyAceStep1.5LatentAudio", "inputs": {"batch_size": 1, "seconds": seconds}},
      "104": {"class_type": "SaveAudioMP3", "inputs": {"audio": ["18", 0],
          "filename_prefix": prefix, "quality": "V0"}},
    }


def _duration(path: Path) -> float:
    """Obtiene duración REAL mediante ffprobe o el decoder de soundfile."""
    tool = shutil.which("ffprobe")
    if tool:
        try:
            proc = subprocess.run([tool, "-v", "error", "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
                capture_output=True, text=True, timeout=20, check=True)
            value = float(proc.stdout.strip())
            if value > 1:
                return value
        except (OSError, ValueError, subprocess.SubprocessError):
            pass
    try:
        import soundfile as sf
        info = sf.info(str(path))
        value = float(info.frames) / info.samplerate
        if value > 1:
            return value
    except (ImportError, ValueError, OSError, RuntimeError):
        pass
    raise BridgeError("No se pudo medir la duración real del audio. Instala ffmpeg o soundfile en ComfyUI")


def _upload_audio(url: str, token: str, worker_id: str, job: dict, audio: bytes, duration: float,
                  caption: str, lyrics: str, seed: int) -> dict:
    if not audio or len(audio) > MAX_AUDIO_BYTES:
        raise BridgeError("Audio vacío o superior al límite de 50 MiB")
    # Una cabecera MP3 o ID3 válida evita enviar un archivo arbitrario.
    if not (audio.startswith(b"ID3") or (audio[0] == 0xff and (audio[1] & 0xe0) == 0xe0)):
        raise BridgeError("ComfyUI no devolvió un archivo MP3 válido")
    boundary = f"sonora-{uuid.uuid4().hex}"
    meta = {"durationSec": duration, "model": "ACE-Step 1.5 AIO (ComfyUI local)",
            "modelVersion": "1.5", "caption": caption[:2000], "lyrics": lyrics[:8000], "seed": seed}
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"meta\"\r\n\r\n"+
            json.dumps(meta, ensure_ascii=False)+"\r\n"+
            f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"song.mp3\"\r\n"+
            "Content-Type: audio/mpeg\r\n\r\n").encode("utf-8") + audio + f"\r\n--{boundary}--\r\n".encode()
    req = Request(url, data=body, method="POST", headers={
        "Authorization": f"Bearer {token}", "Content-Type": f"multipart/form-data; boundary={boundary}",
        "X-Worker-Id": worker_id, "X-Job-Attempt": str(job["attempts"]), "User-Agent": "Sonora-ComfyUI/1.0"})
    try:
        with urlopen(req, timeout=300) as resp:
            return json.loads(resp.read(20000))
    except HTTPError as e:
        raise BridgeError(f"Subida rechazada (HTTP {e.code}): {e.read(400).decode('utf-8','replace')}") from e


class Bridge:
    def __init__(self, config_path: Path):
        self.config_path = Path(config_path)
        self.lock = threading.RLock()
        self.stop = threading.Event()
        self.thread = None
        self.beat_thread = None
        self.last_error = ""
        self.token = ""
        self.local_url = ""
        self.checkpoint = ""
        self.worker_id = "comfy-" + uuid.uuid4().hex[:16]
        self.job = None
        self.cancelled = False
        self.connected = False
        self._read_config()

    def _read_config(self):
        if not self.config_path.exists():
            return
        try:
            saved = json.loads(self.config_path.read_text(encoding="utf-8"))
            self.token = str(saved.get("token", ""))
            self.local_url = _local_endpoint(saved.get("local_url", "")) if saved.get("local_url") else ""
        except (ValueError, OSError):
            self.last_error = "No se pudo cargar la configuración local"

    def status(self) -> dict:
        with self.lock:
            return {"running": self.connected and self.thread is not None and self.thread.is_alive(),
                    "configured": bool(self.token), "modelReady": bool(self.checkpoint),
                    "checkpoint": self.checkpoint, "currentJob": self.job.get("title") if self.job else None,
                    "lastError": self.last_error, "server": REMOTE}

    def connect(self, token: str, local_url: str):
        local_url = _local_endpoint(local_url)
        if not token and not self.token:
            raise BridgeError("Introduce el WORKER_TOKEN de Render una sola vez")
        token = token or self.token
        if not (32 <= len(token) <= 512) or any(ord(c) < 33 or ord(c) > 126 for c in token):
            raise BridgeError("El token no tiene un formato válido")
        info = _http(f"{local_url}/object_info", limit=30_000_000)
        checkpoint = _choose_checkpoint(info)
        _http(f"{REMOTE}/api/worker/heartbeat", method="POST", token=token,
              json_data={"workerId": self.worker_id, "engine": "acestep", "name": "ComfyUI local",
                         "info": {"model": checkpoint, "backend": "ComfyUI"},
                         "currentJobId": None, "currentJobAttempt": None})
        with self.lock:
            if self.thread and self.thread.is_alive():
                raise BridgeError("El motor ya está conectado; desconéctalo antes de cambiar la configuración")
            self.token, self.local_url, self.checkpoint = token, local_url, checkpoint
            self.config_path.parent.mkdir(parents=True, exist_ok=True)
            self.config_path.write_text(json.dumps({"token": token, "local_url": local_url}), encoding="utf-8")
            try:
                self.config_path.chmod(0o600)
            except OSError:
                pass
            self.last_error = ""
            self.stop.clear()
            self.cancelled = False
            self.connected = True
            self.thread = threading.Thread(target=self._run, daemon=True, name="sonora-bridge")
            self.beat_thread = threading.Thread(target=self._heartbeat, daemon=True, name="sonora-heartbeat")
            self.beat_thread.start()
            self.thread.start()
        return self.status()

    def disconnect(self):
        self.stop.set()
        with self.lock:
            self.connected = False
            self.token = ""
            self.checkpoint = ""
            self.last_error = "Motor desconectado por el usuario"
            self.config_path.unlink(missing_ok=True)
        return self.status()

    def _heartbeat(self):
        while not self.stop.is_set():
            with self.lock:
                job = self.job
                token = self.token
                checkpoint = self.checkpoint
            try:
                body = {"workerId": self.worker_id, "name": "ComfyUI local", "engine": "acestep",
                    "info": {"model": checkpoint, "backend": "ComfyUI", "device": "local"},
                    "currentJobId": job["id"] if job else None,
                    "currentJobAttempt": job["attempts"] if job else None}
                r = _http(f"{REMOTE}/api/worker/heartbeat", method="POST", json_data=body, token=token)
                if r.get("cancel") and job:
                    with self.lock:
                        if self.job is job:
                            self.cancelled = True
            except BridgeError as e:
                with self.lock:
                    self.last_error = str(e)[:260]
            self.stop.wait(10)

    def _post(self, path, data, attempt=None):
        if attempt is None:
            return _http(f"{REMOTE}{path}", method="POST", json_data=data, token=self.token)
        # progress/fail requieren X-Worker-Id y X-Job-Attempt
        req = Request(f"{REMOTE}{path}", data=json.dumps(data).encode(), method="POST", headers={
            "Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
            "X-Worker-Id": self.worker_id, "X-Job-Attempt": str(attempt)})
        try:
            with urlopen(req, timeout=25) as r:
                return json.loads(r.read(20000))
        except HTTPError as e:
            raise BridgeError(f"HTTP {e.code} en {path}: {e.read(300).decode('utf-8','replace')}") from e
        except (URLError, OSError) as e:
            raise BridgeError(str(e)) from e

    def _run(self):
        while not self.stop.is_set():
            try:
                r = self._post("/api/worker/claim", {"workerId": self.worker_id, "engine": "acestep"})
                job = r.get("job")
                if job:
                    self._process(job)
                else:
                    self.stop.wait(3)
            except BridgeError as e:
                with self.lock:
                    self.last_error = str(e)[:260]
                self.stop.wait(8)
            except Exception:
                log.exception("Fallo inesperado del puente")
                with self.lock:
                    self.last_error = "Fallo interno del puente; revisa el registro de ComfyUI"
                self.stop.wait(8)
        self.connected = False

    def _process(self, job: dict):
        with self.lock:
            self.job, self.cancelled = job, False
        attempt = int(job["attempts"])
        try:
            if job.get("kind") != "generate":
                raise BridgeError("Este puente admite creación de canciones nuevas, no cover/repaint")
            params = job.get("params") or {}
            graph = build_workflow(params, checkpoint=self.checkpoint, job_id=job["id"])
            self._post(f"/api/worker/jobs/{job['id']}/progress",
                       {"stage": "Enviando a la GPU local", "progress": None}, attempt)
            prompt = _http(f"{self.local_url}/prompt", method="POST", json_data={"prompt": graph, "client_id": self.worker_id})
            prompt_id = prompt.get("prompt_id")
            if not prompt_id:
                raise BridgeError("ComfyUI rechazó el flujo: " + json.dumps(prompt, ensure_ascii=False)[:450])
            deadline = time.monotonic() + MAX_WAIT_SECONDS
            history = None
            while time.monotonic() < deadline and not self.stop.is_set():
                if self.cancelled:
                    return  # ComfyUI puede seguir ejecutando: no interrumpir otras tareas del usuario
                r = _http(f"{self.local_url}/history/{prompt_id}")
                history = r.get(prompt_id)
                if history:
                    break
                self.stop.wait(4)
            if self.stop.is_set() or self.cancelled:
                return
            if not history:
                raise BridgeError("Tiempo de espera agotado: ComfyUI no devolvió un resultado")
            status = (history.get("status") or {})
            if status.get("status_str") == "error":
                raise BridgeError("ComfyUI reportó un error de ejecución; comprueba que cabe en 6 GB de VRAM")
            outputs = (history.get("outputs") or {}).get("104") or {}
            audio_list = outputs.get("audio") or outputs.get("audios") or []
            if not audio_list:
                raise BridgeError("ComfyUI terminó sin producir un archivo MP3")
            item = audio_list[0]
            if item.get("type") not in ("output", None):
                raise BridgeError("ComfyUI devolvió un archivo temporal, no un resultado de salida")
            uri = f"{self.local_url}/view?" + urlencode({"filename": item["filename"],
                                    "subfolder": item.get("subfolder", ""), "type": "output"})
            req = Request(uri, headers={"User-Agent": "Sonora-ComfyUI/1.0"})
            with urlopen(req, timeout=90) as response:
                content = response.read(MAX_AUDIO_BYTES + 1)
            if not content or len(content) > MAX_AUDIO_BYTES:
                raise BridgeError("El archivo de audio está vacío o supera 50 MiB")
            import tempfile
            with tempfile.TemporaryDirectory(prefix="sonora-audio-") as path:
                p = Path(path) / "output.mp3"
                p.write_bytes(content)
                duration = _duration(p)
            if self.cancelled:
                return
            self._post(f"/api/worker/jobs/{job['id']}/progress",
                       {"stage": "Guardando en biblioteca", "progress": None}, attempt)
            seed = graph["3"]["inputs"]["seed"]
            _upload_audio(f"{REMOTE}/api/worker/jobs/{job['id']}/complete", self.token, self.worker_id, job,
                           content, duration, params.get("caption") or "", params.get("lyrics") or "", seed)
            with self.lock:
                self.last_error = ""
        except BridgeError as e:
            with self.lock:
                self.last_error = str(e)[:260]
            try:
                self._post(f"/api/worker/jobs/{job['id']}/fail",
                           {"error": str(e)[:1500], "retryable": False}, attempt)
            except BridgeError:
                log.exception("No se pudo reportar el error de la tarea")
        except Exception as e:
            log.exception("Error de generación")
            with self.lock:
                self.last_error = f"Error local de generación: {type(e).__name__}"
            try:
                self._post(f"/api/worker/jobs/{job['id']}/fail",
                           {"error": f"ComfyUI: {type(e).__name__}: {str(e)[:300]}", "retryable": False}, attempt)
            except BridgeError:
                pass
        finally:
            with self.lock:
                self.job = None
                self.cancelled = False
