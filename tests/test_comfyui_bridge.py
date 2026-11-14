"""Pruebas puras del conector de ComfyUI, sin GPU ni ComfyUI instalado."""
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from comfyui_bridge.worker import Bridge, BridgeError, _choose_checkpoint, _local_endpoint, build_workflow, _duration


class ComfyUIBridgeTest(unittest.TestCase):
    def test_build_prompt(self):
        p = {"duration": 45, "bpm": 95, "language": "es", "lyrics": "[Verse]\nHola mundo",
             "caption": "pop rock romántico", "needsCreateSample": False}
        graph = build_workflow(p, checkpoint="ace_step_1.5_turbo_aio.safetensors", seed=2026, job_id="abc-123")
        self.assertEqual(graph["94"]["inputs"]["language"], "es")
        self.assertEqual(graph["94"]["inputs"]["bpm"], 95)
        self.assertEqual(graph["94"]["inputs"]["keyscale"], "C major")
        self.assertEqual(graph["94"]["inputs"]["tags"], "pop rock romántico")
        self.assertEqual(graph["3"]["inputs"]["seed"], 2026)
        self.assertEqual(graph["98"]["inputs"]["seconds"], 45)
        self.assertEqual(graph["97"]["class_type"], "CheckpointLoaderSimple")
        self.assertEqual(graph["104"]["class_type"], "SaveAudioMP3")
        self.assertEqual(graph["18"]["inputs"]["vae"], ["97", 2])
        self.assertEqual(graph["104"]["inputs"]["filename_prefix"], "audio/sonora_abc123")

    def test_missing_lyrics_is_not_fake_generated(self):
        with self.assertRaisesRegex(BridgeError, "letra"):
            build_workflow({"caption": "Rock", "needsCreateSample": True})
        with self.assertRaisesRegex(BridgeError, "letra"):
            build_workflow({"caption": "Rock", "lyrics": ""})

    def test_keyscale_always_uses_valid_comfyui_option(self):
        base = {"caption": "pop latino", "lyrics": "[Verse]\\nHola"}
        self.assertEqual(build_workflow(base)["94"]["inputs"]["keyscale"], "C major")
        self.assertEqual(build_workflow({**base, "keyscale": ""})["94"]["inputs"]["keyscale"], "C major")
        self.assertEqual(build_workflow({**base, "keyscale": "E minor"})["94"]["inputs"]["keyscale"], "E minor")
        self.assertEqual(build_workflow({**base, "keyscale": "no-valida"})["94"]["inputs"]["keyscale"], "C major")

    def test_instrumental(self):
        g=build_workflow({"caption": "ambient", "lyrics": "", "instrumental": True, "duration": 30},seed=123)
        self.assertEqual(g["94"]["inputs"]["lyrics"], "[Instrumental]")

    def test_required_model_and_nodes(self):
        names = ["CheckpointLoaderSimple", "TextEncodeAceStepAudio1.5", "EmptyAceStep1.5LatentAudio",
                 "KSampler", "VAEDecodeAudio", "SaveAudioMP3", "ModelSamplingAuraFlow", "ConditioningZeroOut"]
        info = {k:{} for k in names}
        info["CheckpointLoaderSimple"]={"input":{"required":{"ckpt_name":[["ace_step_1.5_turbo_aio.safetensors"]]}}}
        self.assertEqual(_choose_checkpoint(info), "ace_step_1.5_turbo_aio.safetensors")
        info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"]=[["unrelated.safetensors"]]
        with self.assertRaisesRegex(BridgeError, "Falta el modelo"):
            _choose_checkpoint(info)

    def test_only_loopback_server(self):
        self.assertEqual(_local_endpoint("http://127.0.0.1:8188/"), "http://127.0.0.1:8188")
        self.assertEqual(_local_endpoint("http://localhost:8188/"), "http://localhost:8188")
        for bad in ["https://example.org:8188", "http://192.168.1.2:8188", "file:///c:/", "http://localhost:8188/admin"]:
            with self.assertRaises(BridgeError, msg=bad):
                _local_endpoint(bad)

    def test_token_is_not_leaked_in_status(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/"secrets.json"
            p.write_text('{"token": "secreto-super-privado", "local_url": "http://localhost:8188"}',encoding="utf-8")
            b=Bridge(p)
            self.assertTrue(b.status()["configured"])
            self.assertNotIn("secreto-super-privado", str(b.status()))

    def test_length_rejects_invalid_audio(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/"audio.mp3"
            p.write_bytes(b"invalido")
            with patch("comfyui_bridge.worker.shutil.which", return_value=None):
                with patch.dict("sys.modules", {"soundfile": None}):
                    with self.assertRaises(BridgeError):
                        _duration(p)


if __name__ == "__main__":
    unittest.main()

class BridgeFlowTest(unittest.TestCase):
    def test_job_completes_with_measured_audio(self):
        from types import SimpleNamespace
        from unittest.mock import MagicMock, patch
        from comfyui_bridge import worker as mod
        with tempfile.TemporaryDirectory() as d:
            bridge = Bridge(Path(d) / "token.json")
            bridge.token = "valid-token-for-mock"
            bridge.local_url = "http://localhost:8188"
            bridge.checkpoint = "ace_step_1.5_turbo_aio.safetensors"
            job = {"id": "22cbd911-af39-42c4-bd16-f71c325b7f2d", "attempts": 1,
                   "kind": "generate", "title": "Bajo el mismo cielo",
                   "params": {"caption": "pop romántico", "lyrics": "[Verse]\nCielo azul", "duration": 30}}
            calls = []
            def fake_http(url, **_):
                if url.endswith("/prompt"):
                    return {"prompt_id": "test-prompt"}
                if "/history/" in url:
                    return {"test-prompt": {"outputs": {"104": {"audio": [
                        {"filename": "song.mp3", "subfolder": "audio", "type": "output"}]}}}}
                raise AssertionError(f"unexpected URL {url}")
            class Response:
                def __enter__(self): return self
                def __exit__(self, *_): pass
                def read(self, *_): return b"ID3" + b"audio-real-para-prueba"
            with patch.object(mod,"_http",side_effect=fake_http),\
                 patch.object(mod,"_duration",return_value=30.75),\
                 patch.object(mod,"_upload_audio",return_value={"ok":True}) as upload,\
                 patch.object(mod,"urlopen",return_value=Response()),\
                 patch.object(bridge,"_post",side_effect=lambda path, payload, attempt=None: calls.append((path,payload)) or {"ok":True}):
                bridge._process(job)
            self.assertEqual(upload.call_args.args[5], 30.75)
            self.assertTrue(any(path.endswith("/progress") for path,_ in calls))
            self.assertIsNone(bridge.job)
            self.assertEqual(bridge.last_error, "")

    def test_unsupported_cover_fails_without_audio(self):
        from unittest.mock import patch
        from comfyui_bridge import worker as mod
        with tempfile.TemporaryDirectory() as d:
            bridge=Bridge(Path(d)/"secret.json")
            bridge.token="token"
            calls=[]
            with patch.object(bridge,"_post",side_effect=lambda path, data, attempt=None: calls.append((path,data)) or {}):
                bridge._process({"id":"test", "attempts":1, "kind":"cover", "title":"", "params":{}})
            self.assertTrue(any(path.endswith("/fail") for path,_ in calls))
            self.assertFalse(any(path.endswith("/complete") for path,_ in calls))
