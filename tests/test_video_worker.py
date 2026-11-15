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
        import re
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
                payload = re.search(r"FromBase64String\('([^']+)'\)", source).group(1)
                entries = json.loads(base64.b64decode(payload).decode("utf8"))
                for entry in entries:
                    with wave.open(entry["path"], "wb") as track:
                        track.setnchannels(1); track.setsampwidth(2); track.setframerate(8000)
                        track.writeframes(b"\0\0" * 4000)
                return type("Process",(),{"returncode":0})()
            with patch("comfyui_bridge.video_worker.sys.platform","win32"),\
                 patch("comfyui_bridge.video_worker.subprocess.run",side_effect=fake_run):
                timing=windows_voice("Luna: ¡Hola!\nSol: ¡Voy!",output,multi_voice=True,max_seconds=2)
            self.assertTrue(output.is_file())
            self.assertEqual([entry["speaker"] for entry in timing],["Luna","Sol"])
            self.assertAlmostEqual(timing[0]["end"], .5)
            self.assertAlmostEqual(timing[1]["start"], .75)
            self.assertAlmostEqual(timing[1]["end"], 1.25)
            with wave.open(str(output), "rb") as result:
                self.assertEqual(result.getnframes(),10000)
            with patch("comfyui_bridge.video_worker.sys.platform","win32"),\
                 patch("comfyui_bridge.video_worker.subprocess.run",side_effect=fake_run):
                with self.assertRaisesRegex(BridgeError,"supera"):
                    windows_voice("Luna: ¡Hola!\nSol: ¡Voy!",output,multi_voice=True,max_seconds=1)

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

    def test_subtitles_follow_actual_voice_times_and_pauses(self):
        from comfyui_bridge.video_worker import dialogue_caption
        lines=[{"start":0.0,"end":1.0,"speaker":"Luna","text":"¡Hola!"},
               {"start":1.25,"end":2.5,"speaker":"Sol","text":"¡Hola, Luna!"}]
        self.assertEqual(dialogue_caption(lines,0.5),"Luna: ¡Hola!")
        self.assertEqual(dialogue_caption(lines,1.1),"")
        self.assertEqual(dialogue_caption(lines,1.5),"Sol: ¡Hola, Luna!")
        self.assertEqual(dialogue_caption(lines,2.5),"")


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

    def test_join_motion_clips_reduces_repeated_boundaries(self):
        from PIL import Image
        from comfyui_bridge.video_worker import join_motion_clips
        clips=[[Image.new("RGB",(64,64),c) for c in ("red","red","orange","yellow","yellow","yellow","yellow","yellow")],
               [Image.new("RGB",(64,64),c) for c in ("yellow","blue","blue","blue","blue","blue","blue","blue")]]
        out=join_motion_clips(clips,fade_frames=2)
        self.assertEqual(len(out),14)
        self.assertNotEqual(out[6].getpixel((2,2)),out[7].getpixel((2,2)))

    def test_full_motion_generates_until_coverage_without_reusing_frames(self):
        from PIL import Image
        from comfyui_bridge.video_worker import generate_full_motion
        with tempfile.TemporaryDirectory() as folder:
            scenes=[Image.new("RGB",(16,16),"red"),Image.new("RGB",(16,16),"blue")]
            calls=[]
            progress=[]
            def generate(source, number, completed, scene):
                calls.append((number, completed, source.getpixel((0,0)), scene))
                return [Image.new("RGB",(16,16),(number * 20, i, 0)) for i in range(60)]
            frames=generate_full_motion(scenes,Path(folder),15,generate,progress=progress.append)
            self.assertEqual(len(frames),450)
            self.assertGreater(len(calls),3)
            self.assertEqual(calls[0][2],(255,0,0))
            self.assertTrue(any(color == (0,0,255) and scene == 1 for _,_,color,scene in calls))
            self.assertTrue(all(p.is_file() for p in frames))
            with Image.open(frames[0]) as first, Image.open(frames[-1]) as last:
                self.assertNotEqual(first.getpixel((0,0)),last.getpixel((0,0)))
            self.assertIn("15.0/15",progress[-1])

    def test_full_motion_rejects_short_clips_and_cancellation(self):
        from PIL import Image
        from comfyui_bridge.video_worker import generate_full_motion
        scene=Image.new("RGB",(16,16),"red")
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaisesRegex(BridgeError,"demasiado corto"):
                generate_full_motion([scene],Path(folder),15,lambda *_:[scene]*2)
            with self.assertRaisesRegex(BridgeError,"cancelada"):
                generate_full_motion([scene],Path(folder),15,lambda *_:[scene]*60,cancelled=lambda:True)

    def test_invalid_dialogue_fails_before_starting_the_gpu(self):
        import threading
        from unittest.mock import Mock, patch
        from PIL import Image
        from comfyui_bridge.video_worker import VideoWorker
        bridge=Mock()
        bridge.stop=threading.Event()
        bridge.local_url="http://127.0.0.1:8188"
        bridge.job=None
        worker=VideoWorker(bridge)
        worker.framepack_ready=True
        worker._get=Mock(return_value=b"bundle")
        worker._post=Mock(return_value={})
        job={"id":"video-test","attempts":1,"kind":"video","params":{"duration":60,
             "quality":"alta","narration":True,"script":"Luna: Una línea",
             "animationMode":"framepack","fullMotion":True,"motionPrompt":"Move naturally"}}
        with patch("comfyui_bridge.video_worker.unpack_bundle",return_value=[("image",Path("scene.png"))]),\
             patch("comfyui_bridge.video_worker.load_images",return_value=[Image.new("RGB",(16,16),"red")]),\
             patch("comfyui_bridge.video_worker.windows_voice",side_effect=BridgeError("El diálogo supera la duración")),\
             patch("comfyui_bridge.framepack_adapter.generate_frames") as gpu,\
             patch("comfyui_bridge.video_worker.log.exception"):
            worker._process(job)
        gpu.assert_not_called()
        self.assertTrue(any(call.args[0].endswith("/fail") for call in worker._post.call_args_list))
        self.assertIn("supera",worker.last_error)

    def test_full_video_worker_flow_with_simulated_framepack(self):
        import threading
        from unittest.mock import Mock, patch
        import av
        from PIL import Image
        from comfyui_bridge.video_worker import VideoWorker
        bridge=Mock()
        bridge.stop=threading.Event()
        bridge.local_url="http://127.0.0.1:8188"
        bridge.job=None
        worker=VideoWorker(bridge)
        worker.framepack_ready=True
        worker._get=Mock(return_value=b"bundle")
        worker._post=Mock(return_value={})
        prompts=[]
        uploads=[]
        job={"id":"video-test","attempts":1,"kind":"video","params":{"duration":15,
             "quality":"equilibrada","narration":True,"script":"Luna: Hola.\nSol: Vamos.",
             "multiVoice":True,"animationMode":"framepack","fullMotion":True,
             "motionPrompt":"The dogs talk", "scenePrompts":["The dogs wave","The dogs walk"]}}
        def voice(text, output, **kwargs):
            with wave.open(str(output),"wb") as track:
                track.setnchannels(1); track.setsampwidth(2); track.setframerate(8000)
                track.writeframes(b"\0\0" * 8000)
            return [{"start":0,"end":.5,"speaker":"Luna","text":"Hola."},
                    {"start":.5,"end":1,"speaker":"Sol","text":"Vamos."}]
        def generate(_url, _image, prompt, **kwargs):
            prompts.append(prompt)
            return [Image.new("RGB",(16,16),(len(prompts)*20,i,0)) for i in range(60)]
        class Response:
            def __enter__(self): return self
            def __exit__(self,*_): pass
            def read(self,_limit): return b'{"videoId":"video-test"}'
        def upload(request, **kwargs):
            uploads.append(request.data)
            return Response()
        with patch("comfyui_bridge.video_worker.unpack_bundle",return_value=[("image",Path("scene.png"))]),\
             patch("comfyui_bridge.video_worker.load_images",return_value=[Image.new("RGB",(16,16),"red"),Image.new("RGB",(16,16),"blue")]),\
             patch("comfyui_bridge.video_worker.windows_voice",side_effect=voice),\
             patch("comfyui_bridge.framepack_adapter.generate_frames",side_effect=generate),\
             patch("comfyui_bridge.video_worker.urlopen",side_effect=upload):
            worker._process(job)
        self.assertEqual(worker.last_error,"")
        self.assertGreater(len(prompts),3)
        self.assertIn("The dogs wave",prompts)
        self.assertIn("The dogs walk",prompts)
        self.assertEqual(len(uploads),1)
        marker=b"Content-Type: video/mp4\r\n\r\n"
        start=uploads[0].index(marker)+len(marker)
        end=uploads[0].rindex(b"\r\n--sonora-")
        with av.open(io.BytesIO(uploads[0][start:end])) as result:
            video=next(stream for stream in result.streams if stream.type=="video")
            self.assertAlmostEqual(float(video.duration*video.time_base),15,places=1)
            self.assertTrue(any(stream.type=="audio" for stream in result.streams))

    def test_full_motion_video_keeps_frames_in_order(self):
        import av
        from PIL import Image
        # Los fotogramas cambian gradualmente; un bucle o un descarte rompería el orden.
        frames=[Image.new("RGB",(16,16),(i//2,0,0)) for i in range(450)]
        with tempfile.TemporaryDirectory() as folder:
            target=Path(folder)/"completo.mp4"
            render_video(frames,target,seconds=15,aspect="16:9",soundtrack=None,narration=None,
                         generated_motion=True,full_motion=True,quality="equilibrada",subtitles=False)
            samples=[]
            with av.open(str(target)) as video:
                for i, frame in enumerate(video.decode(video=0)):
                    if i in (0,168,336):
                        samples.append(int(frame.to_ndarray(format="rgb24")[100,100,0]))
            self.assertEqual(len(samples),3)
            self.assertGreater(samples[1],samples[0]+30)
            self.assertGreater(samples[2],samples[1]+30)
            with self.assertRaisesRegex(BridgeError,"suficientes"):
                render_video(frames[:50],Path(folder)/"corto.mp4",seconds=15,aspect="16:9",
                             soundtrack=None,narration=None,generated_motion=True,full_motion=True)

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
                video_stream=next(s for s in mp4.streams if s.type == "video")
                self.assertEqual((video_stream.width,video_stream.height),(1280,720))
                self.assertEqual(round(float(video_stream.average_rate)),24)
                video_frames = sum(1 for f in mp4.decode(video=0))
                self.assertGreaterEqual(video_frames, 170)
            self.assertTrue(calls)


if __name__ == "__main__": unittest.main()
