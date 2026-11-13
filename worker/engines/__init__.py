from .base import EngineError, EngineResult, JobCancelled, MusicEngine

REGISTRY = {
    "acestep": ("engines.acestep_engine", "AceStepEngine"),
}


def load_engine(name: str) -> MusicEngine:
    if name not in REGISTRY:
        raise SystemExit(f"Motor desconocido '{name}'. Disponibles: {', '.join(REGISTRY)}")
    import importlib

    module, cls = REGISTRY[name]
    engine = getattr(importlib.import_module(module), cls)()
    engine.load()
    return engine


__all__ = ["EngineError", "EngineResult", "JobCancelled", "MusicEngine", "load_engine"]
