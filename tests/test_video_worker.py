"""Validación audiovisual completa: un MP4 auténtico y sus pistas, sin GPU."""
import io
import json
import math
import struct
import tempfile
import unittest
import wave
import zipfile
from pathlib import Path

from comfyui_bridge.video_worker import unpack_bundle, load_images, render_video, BridgeError


def make_bundle(files):
    import json
    listing = [{"name": f"asset_{i:02d}{suffix}", "kind": kind, "length": len(data)}
               for i, (suffix, kind, data) in enumerate(files)]
    head = json.dumps({"version": 1, "files": listing}).encode()
    return b"SNV01" + len(head).to_bytes(4, "big") + head + b"".join(f[2] for f in files)


class VideoWorkerTests(unittest.TestCase):
    def test_image_manga_archive_bundle(self):
        from PIL import Image
        scene = Image.new("RGB", (100, 100), "purple")
        buf = io.BytesIO()
        scene.save(buf, format="PNG")
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("001.png", buf.getvalue())
            z.writestr("002.png", buf.getvalue())
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            files = unpack_bundle(make_bundle([(".cbz", "archive", archive.getvalue())]), root)
            images = load_images(files)
            self.assertEqual(len(images), 2)
            self.assertEqual(images[0].size, (100,100))

    def test_bundle_does_not_accept_unbounded_input(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(BridgeError): unpack_bundle(b"NOT-A-VALID-BUNDLE", Path(d))

    def test_renders_real_mp4_with_audio(self):
        import av
        from PIL import Image
        from math import sin, pi
        from array import array
        with tempfile.TemporaryDirectory() as d:
            path = Path(d)
            wav = path / "fondo.wav"
            sample_rate=44100
            with wave.open(str(wav), "wb") as f:
                f.setnchannels(1); f.setsampwidth(2); f.setframerate(sample_rate)
                samples=array("h",(int(4000*sin(2*pi*440*i/sample_rate)) for i in range(2*sample_rate)))
                f.writeframes(samples.tobytes())
            target = path / "video.mp4"
            images=[Image.new("RGB",(400,300),(70,45,120)), Image.new("RGB",(400,300),(32,74,100))]
            calls=[]
            render_video(images,target,seconds=15,aspect="16:9",soundtrack=wav,narration=None,
                         script="Narrador: Una aventura inicia",progress=calls.append)
            self.assertGreater(target.stat().st_size, 2000)
            with av.open(str(target)) as mp4:
                self.assertTrue(any(s.type == "video" for s in mp4.streams))
                self.assertTrue(any(s.type == "audio" for s in mp4.streams))
                video_frames = sum(1 for f in mp4.decode(video=0))
                self.assertGreaterEqual(video_frames, 170)
            self.assertTrue(calls)


if __name__ == "__main__": unittest.main()
