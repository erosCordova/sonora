"""Interfaz común de motores de generación musical.

Para añadir otro modelo (YuE, DiffRhythm, ...) crea `engines/<nombre>_engine.py`
con una clase que herede de MusicEngine y regístrala en `engines/__init__.py`.
El servidor web no cambia: solo reparte tareas por el nombre del motor.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional


class EngineError(Exception):
    """Error real del motor; se muestra tal cual al usuario."""

    def __init__(self, message: str, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


class JobCancelled(Exception):
    pass


@dataclass
class EngineResult:
    path: Path
    duration_sec: float
    model: str
    model_version: str = ""
    caption: Optional[str] = None
    lyrics: Optional[str] = None
    bpm: Optional[float] = None
    keyscale: Optional[str] = None
    language: Optional[str] = None
    seed: Optional[int] = None
    extra: dict = field(default_factory=dict)


# progress(stage, fraction | None)  — fraction None = el motor no reporta porcentaje
ProgressFn = Callable[[str, Optional[float]], None]


class MusicEngine(ABC):
    name: str = "base"

    @abstractmethod
    def load(self) -> None:
        """Carga los modelos en memoria una sola vez (se reutilizan entre tareas)."""

    @abstractmethod
    def run(
        self,
        job: dict,
        workdir: Path,
        source: Optional[Path],
        progress: ProgressFn,
        cancelled: Callable[[], bool],
    ) -> EngineResult:
        """Ejecuta una tarea (generate | cover | repaint) y devuelve el audio resultante."""

    def info(self) -> dict:
        return {}

    def release(self) -> None:
        """Libera memoria temporal tras cada tarea."""
