"""Comprueba el contrato entre el worker y la API sin cargar modelos de IA."""
import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

os.environ.setdefault("WORKER_TOKEN", "token-exclusivo-de-prueba")
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "worker"))
import worker  # noqa: E402


class WorkerProtocolTest(unittest.TestCase):
    def setUp(self):
        worker.state.update(job_id=None, attempt=None, cancel=False)

    def tearDown(self):
        worker.state.update(job_id=None, attempt=None, cancel=False)

    def test_post_includes_current_lease(self):
        worker.state.update(job_id="test", attempt=2)
        with patch.object(worker.session, "post") as post:
            worker.post("/api/worker/jobs/test/progress", json={"stage": "Generando"})
        headers = post.call_args.kwargs["headers"]
        self.assertEqual(headers["X-Worker-Id"], worker.WORKER_ID)
        self.assertEqual(headers["X-Job-Attempt"], "2")

    def test_process_reports_and_uploads_with_same_lease(self):
        calls = []

        class TestEngine:
            released = False

            def run(self, job, workdir, source, progress, cancelled):
                progress("Generando", 0.5)
                path = workdir / "audio.wav"
                path.write_bytes(b"archivo-sintetico-de-prueba")
                return SimpleNamespace(path=path, duration_sec=2, model="test", model_version="test", caption=None,
                                       lyrics=None, bpm=None, keyscale=None, language=None, seed=None)

            def release(self):
                self.released = True

        def send(url, **kwargs):
            calls.append((url, kwargs["headers"]))
            if url.endswith("/complete"):
                self.assertEqual(kwargs["files"]["file"][1].read(), b"archivo-sintetico-de-prueba")
            return SimpleNamespace(status_code=200, ok=True, text="")

        engine = TestEngine()
        with patch.object(worker, "engine", engine), patch.object(worker.session, "post", side_effect=send):
            worker.process({"id": "job-test", "kind": "generate", "title": "Prueba", "params": {}, "attempts": 3})
        self.assertTrue(any(url.endswith("/complete") for url, _ in calls))
        self.assertTrue(all(headers["X-Job-Attempt"] == "3" for _, headers in calls))
        self.assertTrue(engine.released)
        self.assertIsNone(worker.state["job_id"])
        self.assertIsNone(worker.state["attempt"])

    def test_cleanup_error_does_not_kill_worker(self):
        class CleanupFailsEngine:
            def run(self, job, workdir, source, progress, cancelled):
                output = workdir / "audio.wav"
                output.write_bytes(b"audio-sintetico")
                return SimpleNamespace(path=output, duration_sec=2, model="test", model_version="test",
                                       caption=None, lyrics=None, bpm=None, keyscale=None, language=None, seed=None)

            def release(self):
                raise RuntimeError("Fallo simulado al liberar memoria")

        with patch.object(worker, "engine", CleanupFailsEngine()), \
             patch.object(worker.session, "post", return_value=SimpleNamespace(status_code=200, ok=True, text="")), \
             self.assertLogs(worker.log, level="ERROR") as logged:
            # Debe completar la limpieza aunque el motor lance una excepción.
            worker.process({"id": "job-cleanup", "kind": "generate", "title": "Limpieza",
                            "params": {}, "attempts": 1})
        self.assertIn("No se pudo liberar la memoria", logged.output[0])
        self.assertIsNone(worker.state["job_id"])
        self.assertIsNone(worker.state["attempt"])
        self.assertFalse(worker.state["cancel"])

    def test_cancelled_job_does_not_upload_audio(self):
        class CancelEngine:
            def run(self, job, workdir, source, progress, cancelled):
                raise worker.JobCancelled()

            def release(self):
                pass

        with patch.object(worker, "engine", CancelEngine()), patch.object(worker.session, "post") as post:
            worker.process({"id": "job-cancelled", "kind": "generate", "title": "Cancelada",
                            "params": {}, "attempts": 1})
        self.assertFalse(any(call.args[0].endswith("/complete") for call in post.call_args_list))
        self.assertIsNone(worker.state["job_id"])


if __name__ == "__main__":
    unittest.main()
