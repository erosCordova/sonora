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


    def test_manga_panel_detection_and_reading_order(self):
        from PIL import Image, ImageDraw
        from comfyui_bridge.video_worker import split_manga_page
        page = Image.new("RGB",(620,420),"white")
        d = ImageDraw.Draw(page)
        d.rectangle((16,15,283,405),fill=(30,60,130))
        d.rectangle((337,15,603,405),fill=(150,40,60))
        panels_rtl=split_manga_page(page,"rtl")
        panels_ltr=split_manga_page(page,"ltr")
        self.assertEqual(len(panels_rtl),2)
        self.assertEqual(len(panels_ltr),2)
        self.assertEqual(panels_rtl[0].getpixel((50,100)),(150,40,60))
        self.assertEqual(panels_ltr[0].getpixel((50,100)),(30,60,130))
        self.assertEqual(len(split_manga_page(Image.new("RGB",(400,400),"purple"))),1)

    def test_script_roles_and_non_executable_voice_payload(self):
        from comfyui_bridge.video_worker import parse_dialogue, windows_voice
        from unittest.mock import patch
        import base64
        import sys
        lines=parse_dialogue("Narrador: Empieza la aventura.\nLuna: ¡Hola!\nLuna: Ya voy.\nSolo narración")
        self.assertEqual([x["speaker"] for x in lines],["Narrador","Luna","Luna","Narrador"])
        self.assertEqual(lines[1]["text"],"¡Hola!")
        with tempfile.TemporaryDirectory() as folder:
            output=Path(folder)/"voz.wav"
            def fake_run(cmd, **kwargs):
                source=base64.b64decode(cmd[-1]).decode("utf-16le")
                self.assertIn("SelectVoice",source)
                self.assertIn("GetInstalledVoices",source)
                self.assertNotIn("¡Hola!",source)
                output.write_bytes(b"RIFF"+b"\0"*1100)
                return type("Process",(),{"returncode":0})()
            with patch("comfyui_bridge.video_worker.sys.platform","win32"),\
                 patch("comfyui_bridge.video_worker.subprocess.run",side_effect=fake_run):
                windows_voice("Luna: ¡Hola!",output,multi_voice=True)
            self.assertTrue(output.is_file())

    def test_scene_cuts_follow_music_transients(self):
        import numpy as np
        from comfyui_bridge.video_worker import scene_cuts
        fps=12
        song=np.zeros((2,15*44100),dtype=np.float32)
        song[:,5*44100:5*44100+5000]=.9
        baseline=scene_cuts(song,15,fps,3,"uniform")
        rhythmic=scene_cuts(song,15,fps,3,"music")
        self.assertEqual(baseline,[0,60,120,180])
        self.assertEqual(rhythmic[0],0)
        self.assertEqual(rhythmic[-1],180)
        self.assertTrue(all(b>a for a,b in zip(rhythmic,rhythmic[1:])))


    def test_lyric_video_without_images(self):
        import av
        from PIL import Image
        from comfyui_bridge.video_worker import unpack_bundle, lyric_backgrounds, lyric_lines
        source="[Verse]\nBajo el mismo cielo\n[Chorus]\nVolveremos a cantar"
        self.assertEqual(lyric_lines(source),["Bajo el mismo cielo","Volveremos a cantar"])
        frames=lyric_backgrounds(source)
        self.assertEqual(len(frames),2)
        self.assertEqual(frames[0].size,(640,360))
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            self.assertEqual(unpack_bundle(make_bundle([]),root,allow_no_images=True),[])
            with self.assertRaises(BridgeError):
                unpack_bundle(make_bundle([]),root)
            output=root/"letra.mp4"
            render_video(frames,output,seconds=15,aspect="16:9",soundtrack=None,
                         narration=None,script=source,lyrics_mode=True,scene_sync="music")
            with av.open(str(output)) as result:
                self.assertTrue(any(x.type=="audio" for x in result.streams))
                self.assertTrue(any(x.type=="video" for x in result.streams))
            self.assertGreater(output.stat().st_size,1500)

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
