"""Motor ACE-Step 1.5 (MIT). https://github.com/ace-step/ACE-Step-1.5

API usada (documentada en docs/en/INFERENCE.md del repositorio):
  AceStepHandler.initialize_service, LLMHandler.initialize,
  generate_music(GenerationParams, GenerationConfig), create_sample.
Tareas: text2music, cover, repaint (la extensión es un repaint más allá del final).
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Callable, Optional

from .base import EngineError, EngineResult, JobCancelled, MusicEngine, ProgressFn

log = logging.getLogger("engine.acestep")


def _bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class _Progress:
    """Adaptador del callback de progreso de ACE-Step (estilo gradio: progress(value, desc=...))."""

    def __init__(self, report: ProgressFn, cancelled: Callable[[], bool]):
        self.report = report
        self.cancelled = cancelled
        self.last = -1.0

    def __call__(self, value=None, desc=None, **_kw):
        if self.cancelled():
            raise JobCancelled()
        try:
            frac = float(value) if value is not None else None
        except (TypeError, ValueError):
            frac = None
        if frac is not None:
            frac = max(0.0, min(1.0, frac))
        if frac is None or abs(frac - self.last) >= 0.02:
            self.last = frac if frac is not None else self.last
            self.report(str(desc) if desc else "Generando audio", frac)


class AceStepEngine(MusicEngine):
    name = "acestep"

    def __init__(self) -> None:
        self.root = Path(os.getenv("ACESTEP_DIR", "./ACE-Step-1.5")).resolve()
        self.dit_name = os.getenv("ACESTEP_DIT", "acestep-v15-turbo")
        self.lm_name = os.getenv("ACESTEP_LM_MODEL", "acestep-5Hz-lm-1.7B")
        self.lm_backend = os.getenv("ACESTEP_LM_BACKEND", "pt")
        self.device = os.getenv("ACESTEP_DEVICE", "auto")
        self.audio_format = os.getenv("WORKER_AUDIO_FORMAT", "mp3")
        self.steps = int(os.getenv("ACESTEP_STEPS", "0")) or None  # None = valor por defecto del modelo
        self.dit = None
        self.llm = None
        self.llm_ok = False

    # ---------------------------------------------------------------- carga
    def load(self) -> None:
        if not self.root.exists():
            raise SystemExit(
                f"No se encontró ACE-Step en {self.root}. Clona https://github.com/ace-step/ACE-Step-1.5 "
                "y define ACESTEP_DIR (o usa el Dockerfile del worker)."
            )
        sys.path.insert(0, str(self.root))
        os.chdir(self.root)
        from acestep.handler import AceStepHandler  # type: ignore
        # En RTX 4050 de 6 GB no se carga el LM (reduce uso de VRAM).

        self._ensure_weights()
        offload = _bool("ACESTEP_OFFLOAD", False)
        quant = os.getenv("ACESTEP_QUANTIZATION", "none")
        log.info("Cargando DiT %s (device=%s, offload=%s, quantization=%s)…", self.dit_name, self.device, offload, quant)
        self.dit = AceStepHandler()
        status, ok = self.dit.initialize_service(
            project_root=str(self.root),
            config_path=self.dit_name,
            device=self.device,
            offload_to_cpu=offload,
            offload_dit_to_cpu=_bool("ACESTEP_OFFLOAD_DIT", offload),
            quantization=None if quant == "none" else quant,
        )
        if not ok:
            raise SystemExit(f"No se pudo inicializar el DiT de ACE-Step: {status}")

        self.llm = None
        if self.lm_name.lower() != "none":
            from acestep.llm_inference import LLMHandler  # type: ignore
            self.llm = LLMHandler()
            log.info("Cargando LM %s (backend=%s)…", self.lm_name, self.lm_backend)
            status, ok = self.llm.initialize(
                checkpoint_dir=str(self.root / "checkpoints"),
                lm_model_path=self.lm_name,
                backend=self.lm_backend,
                device=self.device,
                offload_to_cpu=offload,
            )
            self.llm_ok = bool(ok)
            if not ok:
                log.warning("LM no disponible (%s). Se podrán usar tareas con letra explícita, cover y repaint.", status)
        else:
            log.info("LM desactivado (ACESTEP_LM_MODEL=none): ahorra VRAM, pero no compone letras por sí mismo.")

    def _ensure_weights(self) -> None:
        """Descarga los pesos que falten con el descargador oficial de ACE-Step (acestep.model_downloader)."""
        from acestep import model_downloader as md  # type: ignore

        ckpt = self.root / "checkpoints"
        steps = [("modelo principal (VAE + embeddings)", lambda: md.ensure_main_model(checkpoints_dir=ckpt))]
        if self.dit_name != "acestep-v15-turbo":
            steps.append((f"DiT {self.dit_name}", lambda: md.ensure_dit_model(self.dit_name, checkpoints_dir=ckpt)))
        if self.lm_name.lower() != "none":
            steps.append((f"LM {self.lm_name}", lambda: md.ensure_lm_model(self.lm_name, checkpoints_dir=ckpt)))
        for label, fn in steps:
            ok, msg = fn()
            if not ok:
                raise SystemExit(f"No se pudo obtener {label}: {msg}")
            log.info("Pesos listos: %s", label)

    def info(self) -> dict:
        info: dict = {"model": self.dit_name, "lm": self.lm_name if self.llm_ok else None, "format": self.audio_format}
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                free, total = torch.cuda.mem_get_info()
                info.update(
                    device="cuda",
                    gpu=torch.cuda.get_device_name(0),
                    vramTotalGb=round(total / 1e9, 1),
                    vramFreeGb=round(free / 1e9, 1),
                )
            elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                info["device"] = "mps"
            else:
                info["device"] = "cpu"
        except Exception:  # noqa: BLE001
            pass
        try:
            import psutil  # type: ignore

            info["ramUsedGb"] = round(psutil.Process().memory_info().rss / 1e9, 2)
        except Exception:  # noqa: BLE001
            pass
        return info

    def release(self) -> None:
        import gc

        gc.collect()
        try:
            import torch  # type: ignore

            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:  # noqa: BLE001
            pass

    # ------------------------------------------------------------ ejecución
    def run(self, job: dict, workdir: Path, source: Optional[Path], progress: ProgressFn, cancelled: Callable[[], bool]) -> EngineResult:
        from acestep.inference import GenerationConfig, GenerationParams, generate_music  # type: ignore

        p = job["params"]
        kind = job["kind"]
        lang = p.get("language") or ""
        lang = "unknown" if lang in ("", "auto") else lang
        meta: dict = {}
        kwargs: dict = {}

        if kind == "generate":
            caption, lyrics = p.get("caption", ""), p.get("lyrics", "")
            bpm, duration, key = p.get("bpm"), p.get("duration"), ""
            if p.get("needsCreateSample"):
                if not self.llm_ok:
                    raise EngineError(
                        "Esta solicitud necesita que el LM de ACE-Step componga la letra, pero el worker no tiene el LM cargado "
                        "(ACESTEP_LM_MODEL=none o fallo de carga). Escribe la letra manualmente o configura LLM_BASE_URL en el servidor."
                    )
                from acestep.inference import create_sample  # type: ignore

                progress("Componiendo letra y estilo", None)
                s = create_sample(
                    llm_handler=self.llm,
                    query=caption or p.get("prompt", ""),
                    instrumental=bool(p.get("instrumental")),
                    vocal_language=None if lang == "unknown" else lang,
                )
                if not s.success:
                    raise EngineError(f"El LM de ACE-Step no pudo componer la canción: {s.error}")
                caption, lyrics = s.caption or caption, s.lyrics or lyrics
                bpm = bpm or s.bpm
                duration = duration or (int(s.duration) if s.duration else None)
                key = s.keyscale or ""
                lang = s.language or lang
                meta.update(caption=caption, lyrics=lyrics, language=lang if lang != "unknown" else None)
            if p.get("instrumental"):
                lyrics = "[Instrumental]"
            kwargs = dict(
                task_type="text2music",
                caption=caption,
                lyrics=lyrics,
                instrumental=bool(p.get("instrumental")),
                vocal_language=lang,
                bpm=int(bpm) if bpm else None,
                keyscale=key,
                duration=float(duration) if duration else -1.0,
                thinking=self.llm_ok,
                use_cot_caption=False,
                use_cot_lyrics=False,
                use_cot_metas=self.llm_ok and not bpm,
                use_cot_language=self.llm_ok and lang == "unknown",
            )
        elif kind == "cover":
            if source is None:
                raise EngineError("La tarea de reestilizado no recibió audio fuente")
            kwargs = dict(
                task_type="cover",
                src_audio=str(source),
                caption=p.get("caption", ""),
                lyrics=p.get("lyrics", ""),
                vocal_language=lang,
                audio_cover_strength=float(p.get("strength", 0.7)),
                duration=float(p.get("sourceDuration") or -1),
                thinking=False,
            )
        elif kind == "repaint":
            if source is None:
                raise EngineError("La tarea de repaint no recibió audio fuente")
            end = float(p["end"])
            kwargs = dict(
                task_type="repaint",
                src_audio=str(source),
                caption=p.get("caption", ""),
                lyrics=p.get("lyrics", ""),
                vocal_language=lang,
                repainting_start=float(p["start"]),
                repainting_end=end,
                chunk_mask_mode="explicit",
                audio_cover_strength=1.0,
                duration=max(end, float(p.get("sourceDuration") or 0)) if p.get("operation") == "extend" else -1.0,
                thinking=False,
            )
        else:
            raise EngineError(f"Tipo de tarea no soportado por ACE-Step: {kind}")

        if self.steps:
            kwargs["inference_steps"] = self.steps

        params = GenerationParams(**kwargs)
        config = GenerationConfig(batch_size=1, audio_format=self.audio_format, use_random_seed=True)
        progress("Generando audio", None)
        try:
            result = generate_music(self.dit, self.llm, params, config, save_dir=str(workdir), progress=_Progress(progress, cancelled))
        except JobCancelled:
            raise
        except Exception as e:  # noqa: BLE001
            if e.__class__.__name__ == "OutOfMemoryError":
                self.release()
                raise EngineError(f"Sin memoria de GPU durante la generación: {e}", retryable=True) from e
            raise
        if cancelled():
            raise JobCancelled()
        if not result.success or not result.audios:
            raise EngineError(f"ACE-Step devolvió un error: {result.error or result.status_message}")

        audio = result.audios[0]
        path = Path(audio["path"])
        if not path.exists() or path.stat().st_size < 1024:
            raise EngineError("ACE-Step no produjo un archivo de audio válido")
        tensor = audio.get("tensor")
        sr = audio.get("sample_rate") or 48000
        duration_sec = float(tensor.shape[-1]) / sr if tensor is not None else _probe_duration(path)
        lm = (result.extra_outputs or {}).get("lm_metadata") or {}
        return EngineResult(
            path=path,
            duration_sec=duration_sec,
            model=f"ACE-Step 1.5 ({self.dit_name})",
            model_version="1.5",
            caption=meta.get("caption"),
            lyrics=meta.get("lyrics"),
            bpm=lm.get("bpm") or kwargs.get("bpm"),
            keyscale=lm.get("keyscale") or kwargs.get("keyscale") or None,
            language=meta.get("language"),
            seed=(audio.get("params") or {}).get("seed"),
        )


def _probe_duration(path: Path) -> float:
    import soundfile as sf  # type: ignore

    info = sf.info(str(path))
    return float(info.frames) / info.samplerate
