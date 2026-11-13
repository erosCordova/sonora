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


if __name__ == "__main__":
    unittest.main()
