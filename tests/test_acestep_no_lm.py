"""Verifica el perfil sin LM sin descargar pesos ni utilizar GPU en CI."""
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
from engines.acestep_engine import AceStepEngine


class AceStepNoLmTest(unittest.TestCase):
    def test_no_llm_never_requests_cot_metadata(self):
        called = {}

        class Params:
            def __init__(self, **kwargs):
                called.update(kwargs)

        class Config:
            def __init__(self, **_kwargs):
                pass

        class Result:
            success = True
            error = None
            status_message = "ok"
            extra_outputs = {}

            def __init__(self, path):
                self.audios = [{"path": str(path), "sample_rate": 48000}]

        with tempfile.TemporaryDirectory() as d:
            dest = Path(d) / "test.wav"
            dest.write_bytes(b"audio" * 300)

            def generate_music(*_args, **_kwargs):
                return Result(dest)

            fake = types.ModuleType("acestep.inference")
            fake.GenerationConfig = Config
            fake.GenerationParams = Params
            fake.generate_music = generate_music

            engine = AceStepEngine()
            engine.llm = None
            engine.llm_ok = False
            engine.dit = object()
            with patch.dict(sys.modules, {"acestep": types.ModuleType("acestep"), "acestep.inference": fake}), \
                 patch("engines.acestep_engine._probe_duration", return_value=10):
                result = engine.run(
                    {"kind": "generate", "params": {"caption": "Guitarra y voz", "lyrics": "[Verse]\nHola", "instrumental": False, "language": "es", "bpm": None}},
                    Path(d), None, lambda *_: None, lambda: False,
                )
            self.assertFalse(called["thinking"])
            self.assertFalse(called["use_cot_metas"])
            self.assertFalse(called["use_cot_language"])
            self.assertEqual(result.duration_sec, 10)


if __name__ == "__main__":
    unittest.main()
