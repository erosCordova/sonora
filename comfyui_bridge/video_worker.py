"""Procesador audiovisual Sonora: montaje real en MP4 en la computadora local.

Sin APIs pagadas ni GPU adicional. Dependencias: PyAV, Pillow y NumPy, que
ComfyUI ya utiliza. La narración usa SAPI de Windows si se solicita.
La separación de viñetas y los cortes al ritmo son análisis locales conservadores.
No se generan fotogramas por difusión ni se extraen diálogos automáticamente.
"""
from __future__ import annotations

import io
import json
import logging
import math
import os
import subprocess
import sys
import tempfile
import threading
import time
import uuid
import zipfile
from fractions import Fraction
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .worker import REMOTE, _http, BridgeError

log = logging.getLogger("sonora.video")
MAX_INPUT = 25 * 1024 * 1024
MAX_VIDEO = 40 * 1024 * 1024


def unpack_bundle(blob: bytes, directory: Path) -> list[tuple[str, Path]]:
    if len(blob) < 11 or len(blob) > MAX_INPUT or blob[:5] != b"SNV01":
        raise BridgeError("Paquete de video inválido o demasiado grande")
    size = int.from_bytes(blob[5:9], "big")
    if size <= 0 or size > 8192 or 9 + size > len(blob):
        raise BridgeError("Manifiesto de video inválido")
    manifest = json.loads(blob[9:9 + size].decode("utf8"))
    if manifest.get("version") != 1 or len(manifest.get("files", [])) > 13:
        raise BridgeError("Versión del paquete no compatible")
    cursor, found = 9 + size, []
    for i, item in enumerate(manifest["files"]):
        length = int(item.get("length", -1))
        kind = item.get("kind")
        name = str(item.get("name", ""))
        if length <= 0 or length > 16 * 1024 * 1024 or cursor + length > len(blob):
            raise BridgeError("Tamaño de archivo inválido dentro del paquete")
        if kind not in {"image", "archive", "pdf", "audio"} or name != Path(name).name:
            raise BridgeError("Tipo o ruta inválida en el paquete de video")
        p = directory / f"input_{i}{Path(name).suffix.lower()}"
        p.write_bytes(blob[cursor:cursor + length])
        found.append((kind, p))
        cursor += length
    if cursor != len(blob) or not any(kind != "audio" for kind, _ in found):
        raise BridgeError("Paquete incompleto o sin imágenes")
    return found


def load_images(files: list[tuple[str, Path]]):
    from PIL import Image, ImageOps
    result = []
    def fit_memory(image):
        # ComfyUI y el video comparten 16 GB de RAM: nunca conservar
        # páginas de manga originales de decenas de megapíxeles.
        if image.width * image.height > 25_000_000:
            raise BridgeError("Una imagen supera 25 megapíxeles; redúcela antes de subirla")
        image.thumbnail((1280, 1280), Image.Resampling.LANCZOS)
        return image.copy()

    for kind, path in files:
        if kind == "audio":
            continue
        if kind == "image":
            with Image.open(path) as img:
                img.load()
                result.append(fit_memory(ImageOps.exif_transpose(img).convert("RGB")))
        elif kind == "archive":
            try:
                with zipfile.ZipFile(path) as z:
                    members = [i for i in z.infolist() if not i.is_dir() and
                               i.filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))]
                    # Orden de lectura del archivo original; se permite ajustar en versiones futuras.
                    members.sort(key=lambda m: m.filename.casefold())
                    if len(members) > 120 or sum(i.file_size for i in members) > 100 * 1024 * 1024:
                        raise BridgeError("El capítulo contiene demasiadas páginas o ocupa más de 100 MB descomprimido")
                    for m in members[:80]:
                        if m.file_size > 12 * 1024 * 1024:
                            raise BridgeError("Una página del manga supera 12 MB")
                        with Image.open(io.BytesIO(z.read(m))) as img:
                            img.load()
                            result.append(fit_memory(ImageOps.exif_transpose(img).convert("RGB")))
            except zipfile.BadZipFile as e:
                raise BridgeError("El archivo ZIP/CBZ está dañado") from e
        elif kind == "pdf":
            try:
                import fitz
            except ImportError as e:
                raise BridgeError("Para leer PDF se requiere PyMuPDF en ComfyUI. Por ahora exporta el capítulo como imágenes o CBZ") from e
            with fitz.open(str(path)) as doc:
                if len(doc) > 80: raise BridgeError("Por ahora se admiten hasta 80 páginas por capítulo")
                for page in doc:
                    pix = page.get_pixmap(matrix=fitz.Matrix(1.25, 1.25), alpha=False)
                    result.append(fit_memory(Image.frombytes("RGB", [pix.width, pix.height], pix.samples)))
    if not result:
        raise BridgeError("No se encontraron imágenes válidas en el capítulo")
    return result[:80]



def _separator_runs(flags, min_width: int, edge: int, size: int):
    """Cortes solo en calles blancas continuas, lejos de los bordes."""
    runs = []
    start = None
    for i, blank in enumerate(list(flags) + [False]):
        if blank and start is None:
            start = i
        if not blank and start is not None:
            if i - start >= min_width and start >= edge and i <= size-edge:
                runs.append((start+i)//2)
            start = None
    return runs


def split_manga_page(image, reading_order: str = "rtl", max_panels: int = 12):
    """Segmentación conservadora de viñetas separadas por calles blancas.

    No intenta identificar texto ni personajes: el usuario debe revisar el orden.
    Nunca recorta un panel si no encuentra separadores suficientemente claros.
    """
    import numpy as np
    if reading_order not in ("rtl", "ltr"):
        raise BridgeError("Orden de lectura de manga inválido")
    if max_panels < 1 or max_panels > 24:
        raise BridgeError("Límite de viñetas inválido")

    def recurse(img, depth=0):
        width, height = img.size
        if depth >= 4 or width < 160 or height < 160:
            return [img]
        grey = np.asarray(img.convert("L"), dtype=np.uint8)
        # Blanco casi puro y umbral elevado para no partir por viñetas claras.
        rows = (grey > 246).mean(axis=1) > .985
        cols = (grey > 246).mean(axis=0) > .985
        candidates = [
            ("row", index) for index in _separator_runs(rows, max(7, height//110), height//6, height)
        ] + [
            ("col", index) for index in _separator_runs(cols, max(7, width//110), width//6, width)
        ]
        # Preferir separaciones horizontales de manga sobre huecos verticales,
        # salvo cuando hay una división vertical claramente más centrada.
        for axis, index in candidates:
            if axis == "row":
                parts = [img.crop((0,0,width,index)), img.crop((0,index,width,height))]
            else:
                left = img.crop((0,0,index,height))
                right = img.crop((index,0,width,height))
                parts = [right,left] if reading_order == "rtl" else [left,right]
            if min(p.width*p.height for p in parts) < width*height*.16:
                continue
            output = []
            for part in parts:
                output.extend(recurse(part,depth+1))
            if 2 <= len(output) <= max_panels:
                return output
        return [img]
    return recurse(image)


def parse_dialogue(script: str):
    """Separa nombres de personaje sin leer las etiquetas en voz alta."""
    import re
    result = []
    for line in script.splitlines():
        line = line.strip()
        if not line:
            continue
        match = re.match(r"^([^:\n]{1,32}):\s*(.+)$", line)
        if match:
            speaker, message = match.group(1).strip(), match.group(2).strip()
        else:
            speaker, message = "Narrador", line
        if message:
            result.append({"speaker":speaker,"text":message})
    return result[:64]


def scene_cuts(music, seconds: int, fps: int, scenes: int, sync: str = "uniform"):
    """Escoge fronteras de escenas cercanas a transitorios de audio, sin ML pesado."""
    import numpy as np
    total = max(1,int(seconds*fps))
    scenes = max(1,min(int(scenes),total//6 or 1))
    cuts = [0]
    onset = None
    if sync == "music" and music is not None:
        signal = np.asarray(music,dtype=np.float32)
        if signal.ndim == 2:
            signal = signal.mean(axis=0)
        hop = max(1,len(signal)//total)
        trimmed = signal[:hop*total]
        if len(trimmed) == hop*total and hop*total:
            rms = np.sqrt(np.mean(trimmed.reshape(total,hop)**2,axis=1))
            onset = np.maximum(0,np.diff(rms,prepend=rms[0]))
    for i in range(1,scenes):
        expected = round(total*i/scenes)
        choice = expected
        if onset is not None and np.max(onset) > 0.003:
            radius = min(max(2,round(total/scenes*.25)),int(fps*.75))
            lo = max(cuts[-1]+6,expected-radius)
            hi = min(total-(scenes-i)*6,expected+radius)
            if hi >= lo:
                values = onset[lo:hi+1]
                if values.size and values.max() > max(.004,float(np.max(onset))*.12):
                    choice = lo+int(values.argmax())
        cuts.append(choice)
    return cuts+[total]



def windows_voice(text: str, output: Path, multi_voice: bool = False):
    """Narración local con Microsoft SAPI; no comparte texto con servicios externos."""
    if sys.platform != "win32":
        raise BridgeError("La narración local requiere Windows con voces instaladas")
    # Los datos (nombres/textos) viajan en Base64, nunca se interpolan
    # como código PowerShell ejecutable, ni siquiera si contienen comillas.
    import base64
    dialogue = parse_dialogue(text)
    if not dialogue:
        raise BridgeError("El guion está vacío")
    payload = base64.b64encode(json.dumps(dialogue,ensure_ascii=False).encode("utf8")).decode("ascii")
    script = (
        "Add-Type -AssemblyName System.Speech; "
        "$speaker=New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "$voices=@($speaker.GetInstalledVoices() | ForEach-Object {$_.VoiceInfo.Name}); "
        "if($voices.Length -lt 1){throw 'No hay voces instaladas'}; "
        "$speaker.SetOutputToWaveFile('" + str(output).replace("'", "''") + "'); "
        "$entries=([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" + payload + "'))|ConvertFrom-Json); "
        "$assigned=@{}; $next=0; "
        "foreach($entry in $entries){ "
        "$key=([string]$entry.speaker).ToLowerInvariant(); "
        "if(-not $assigned.ContainsKey($key)){ $assigned[$key]=$next; $next++ }; "
        + (
            "$which=[int]($assigned[$key] % $voices.Length); "
            "$speaker.SelectVoice($voices[$which]); "
            "$speaker.Rate=[int]((($assigned[$key] % 5)-2)); "
            if multi_voice else "$speaker.SelectVoice($voices[0]); $speaker.Rate=0; "
        ) +
        "$speaker.Speak([string]$entry.text); "
        "}; $speaker.Dispose()"
    )
    cmd = base64.b64encode(script.encode("utf-16le")).decode("ascii")
    try:
        result = subprocess.run(["powershell.exe", "-NoProfile", "-NonInteractive", "-EncodedCommand", cmd],
                                capture_output=True, timeout=180)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise BridgeError("No se pudo iniciar la voz de Windows") from e
    if result.returncode != 0 or not output.is_file() or output.stat().st_size < 1024:
        raise BridgeError("Windows no pudo generar la narración. Comprueba las voces instaladas en Configuración > Voz")


def decode_audio(path: Path, seconds: int):
    """Decodifica a estéreo PCM usando librerías ya incluidas en ComfyUI."""
    import av
    import numpy as np
    target = np.zeros((2, seconds * 44100), dtype=np.float32)
    try:
        with av.open(str(path)) as source:
            stream = next((x for x in source.streams if x.type == "audio"), None)
            if stream is None: raise BridgeError("El archivo no contiene audio")
            resampler = av.AudioResampler(format="fltp", layout="stereo", rate=44100)
            offset = 0
            for frame in source.decode(audio=stream.index):
                for converted in resampler.resample(frame):
                    array = converted.to_ndarray()
                    n = min(array.shape[1], target.shape[1] - offset)
                    if n > 0: target[:, offset:offset+n] = array[:, :n]
                    offset += max(0,n)
                    if offset >= target.shape[1]: return target
            for converted in resampler.resample(None):
                array = converted.to_ndarray()
                n = min(array.shape[1], target.shape[1]-offset)
                if n > 0: target[:,offset:offset+n]=array[:,:n]
                offset += max(0,n)
    except BridgeError:
        raise
    except Exception as e:
        raise BridgeError(f"No se pudo decodificar la pista de audio: {type(e).__name__}") from e
    return target


def render_video(images, output: Path, *, seconds: int, aspect: str, soundtrack: Path | None,
                 narration: Path | None, script: str = "", cancelled=lambda: False, progress=lambda _: None,
                 scene_sync: str = "uniform", subtitles: bool = True):
    """Produce MP4 real con paneo/zoom y audio AAC. No requiere FFmpeg.exe."""
    import av
    import numpy as np
    from bisect import bisect_right
    from PIL import Image, ImageDraw, ImageFont, ImageOps

    if not images: raise BridgeError("No hay imágenes para crear el video")
    if seconds not in (15, 30, 60): raise BridgeError("Duración de video no compatible")
    fps = 12
    width, height = (360, 640) if aspect == "9:16" else (640, 360)
    total = fps * seconds
    if scene_sync not in ("uniform", "music"):
        raise BridgeError("Sincronización audiovisual inválida")
    lines = [f"{entry['speaker']}: {entry['text']}" for entry in parse_dialogue(script)] if subtitles else []
    try: font = ImageFont.truetype("arial.ttf", 20)
    except OSError: font = ImageFont.load_default()
    music = decode_audio(soundtrack, seconds) if soundtrack else np.zeros((2, seconds * 44100), dtype=np.float32)
    spoken = decode_audio(narration, seconds) if narration else np.zeros_like(music)
    # Para muchas páginas, conservar una cantidad legible de escenas.
    scenes = min(len(images), max(1, seconds))
    if len(images) > scenes:
        indices = [round(i*(len(images)-1)/max(1,scenes-1)) for i in range(scenes)]
        images = [images[index] for index in indices]
    boundaries = scene_cuts(music if soundtrack else None, seconds, fps, len(images), scene_sync)
    pcm = music * (0.45 if narration else 0.9) + spoken * 0.95
    peak = float(np.max(np.abs(pcm)))
    if peak > 0.97: pcm *= 0.97 / peak
    with av.open(str(output), mode="w", format="mp4") as mux:
        try:
            vs = mux.add_stream("libx264", rate=fps)
            vs.options = {"preset":"ultrafast","crf":"31"}
        except (av.AVError, ValueError, AttributeError):
            vs = mux.add_stream("mpeg4", rate=fps)
            vs.bit_rate = 480000
        vs.width, vs.height = width, height
        vs.pix_fmt = "yuv420p"
        audio = mux.add_stream("aac", rate=44100)
        audio.layout = "stereo"
        audio.bit_rate = 96000
        cache = {}
        for index in range(total):
            if cancelled(): raise BridgeError("La generación fue cancelada")
            src_idx = min(len(images)-1, bisect_right(boundaries,index)-1)
            if src_idx not in cache:
                cache[src_idx] = ImageOps.fit(images[src_idx], (int(width * 1.12), int(height * 1.12)), method=Image.Resampling.LANCZOS)
            img = cache[src_idx]
            segment = (index-boundaries[src_idx]) / max(1, boundaries[src_idx+1]-boundaries[src_idx])
            # Paneo y zoom Ken Burns con desenfoque visual cero.
            zoom = 1 + 0.07 * segment
            crop_w = int(img.width / zoom)
            crop_h = int(img.height / zoom)
            dx = max(0, img.width - crop_w)
            dy = max(0, img.height - crop_h)
            left = int(dx * segment) if src_idx % 2 == 0 else int(dx * (1-segment))
            top = int(dy * segment)
            canvas = img.crop((left, top, left+crop_w, top+crop_h)).resize((width,height),Image.Resampling.BILINEAR)
            if lines:
                subtitle = lines[src_idx % len(lines)][:90]
                d = ImageDraw.Draw(canvas)
                d.rectangle((0,height-64,width,height),fill=(16,14,31))
                d.text((15,height-48),subtitle,fill=(255,255,255),font=font)
            frame = av.VideoFrame.from_ndarray(np.asarray(canvas),format="rgb24")
            frame.pts = index
            frame.time_base = Fraction(1, fps)
            for packet in vs.encode(frame): mux.mux(packet)
            if index % max(1,fps*3) == 0: progress(index / total)
        for packet in vs.encode(): mux.mux(packet)
        # Codificación AAC en bloques pequeños; memoria acotada.
        apts = 0
        for offset in range(0, pcm.shape[1], 1024):
            samples = np.ascontiguousarray(pcm[:, offset:offset+1024])
            if not samples.shape[1]: break
            frame = av.AudioFrame.from_ndarray(samples,format="fltp",layout="stereo")
            frame.sample_rate = 44100
            frame.pts = apts
            frame.time_base = Fraction(1,44100)
            apts += frame.samples
            for packet in audio.encode(frame): mux.mux(packet)
        for packet in audio.encode(): mux.mux(packet)
    if not output.exists() or output.stat().st_size < 1200 or output.stat().st_size > MAX_VIDEO:
        raise BridgeError("El MP4 producido está vacío o supera el límite de 40 MB")


class VideoWorker:
    """Worker paralelo de tareas audiovisuales, independiente de ACE-Step."""
    def __init__(self, bridge):
        self.bridge = bridge
        self.worker_id = "video-" + uuid.uuid4().hex[:16]
        self.current = None
        self.cancelled = False
        self.last_error = ""
        self.thread = threading.Thread(target=self._run,daemon=True,name="sonora-video")
        self.heartbeat_thread = threading.Thread(target=self._heartbeat,daemon=True,name="sonora-video-heartbeat")

    def start(self):
        self.heartbeat_thread.start()
        self.thread.start()

    def _post(self, path: str, data: dict, attempt=None):
        headers = {"Authorization":f"Bearer {self.bridge.token}","Content-Type":"application/json"}
        if attempt:
            headers.update({"X-Worker-Id":self.worker_id,"X-Job-Attempt":str(attempt)})
        req=Request(REMOTE+path,data=json.dumps(data,ensure_ascii=False).encode("utf8"),method="POST",headers=headers)
        try:
            with urlopen(req, timeout=35) as resp: return json.loads(resp.read(50000))
        except HTTPError as e:
            raise BridgeError(f"Error del servidor {e.code}: {e.read(300).decode('utf8','replace')}") from e
        except (OSError, URLError) as e:
            raise BridgeError(f"Error de red: {e}") from e

    def _get(self, path: str, attempt: int) -> bytes:
        req=Request(REMOTE+path,headers={"Authorization":f"Bearer {self.bridge.token}",
            "X-Worker-Id":self.worker_id,"X-Job-Attempt":str(attempt)})
        try:
            with urlopen(req,timeout=120) as response:
                data=response.read(MAX_INPUT+1)
                if len(data)>MAX_INPUT: raise BridgeError("Entrada demasiado grande")
                return data
        except HTTPError as e: raise BridgeError(f"No se pudo descargar la entrada: HTTP {e.code}") from e

    def _heartbeat(self):
        while not self.bridge.stop.is_set():
            current=self.current
            try:
                payload={"workerId":self.worker_id,"name":"Editor de video local",
                    "engine":"sonora-video","info":{"backend":"Montaje local","capabilities":["images","manga","speech","mp4","panels","character-voices","music-sync"]},
                    "currentJobId":current["id"] if current else None,
                    "currentJobAttempt":current["attempts"] if current else None}
                response=self._post("/api/worker/heartbeat",payload)
                if response.get("cancel") and current: self.cancelled=True
            except Exception as e:
                self.last_error=str(e)[:240]
            self.bridge.stop.wait(10)

    def _run(self):
        while not self.bridge.stop.is_set():
            try:
                result=self._post("/api/worker/claim",{"workerId":self.worker_id,"engine":"sonora-video"})
                job=result.get("job")
                if job: self._process(job)
                else: self.bridge.stop.wait(3)
            except Exception as e:
                log.exception("Error en motor de video")
                self.last_error=str(e)[:240]
                self.bridge.stop.wait(8)

    def _process(self, job):
        self.current=job
        self.cancelled=False
        attempt=int(job["attempts"])
        job_id=job["id"]
        try:
            if job.get("kind")!="video": raise BridgeError("Se recibió una tarea incompatible")
            params=job.get("params") or {}
            seconds=int(params.get("duration",30))
            def progress(percentage):
                if self.cancelled or self.bridge.stop.is_set(): raise BridgeError("La tarea fue cancelada")
                self._post(f"/api/worker/jobs/{job_id}/progress",
                           {"stage":"Montando escenas y sonido","progress":min(0.98,0.05+percentage*0.9)},attempt)
            with tempfile.TemporaryDirectory(prefix="sonora-video-") as folder:
                root=Path(folder)
                data=self._get(f"/api/worker/jobs/{job_id}/video-input",attempt)
                assets=unpack_bundle(data,root)
                images=load_images(assets)
                if params.get("mode") == "manga" and params.get("splitPanels"):
                    reading = str(params.get("readingOrder") or "rtl")
                    panels = []
                    for page in images:
                        panels.extend(split_manga_page(page,reading))
                        if len(panels) >= 80:
                            break
                    images = panels[:80]
                upload_audio=next((p for kind,p in assets if kind=="audio"),None)
                if upload_audio and job.get("sourcePath"):
                    raise BridgeError("No puedes mezclar una canción y un audio subido como pista principal")
                soundtrack=upload_audio
                if job.get("sourcePath"):
                    data=self._get(job["sourcePath"],attempt)
                    soundtrack=root/("musica.mp3" if job.get("parent",{}).get("mime")=="audio/mpeg" else "musica.flac")
                    soundtrack.write_bytes(data)
                voice=None
                if params.get("narration"):
                    voice=root/"voz.wav"
                    windows_voice(str(params.get("script") or ""),voice,multi_voice=bool(params.get("multiVoice")))
                output=root/"sonora.mp4"
                render_video(images,output,seconds=seconds,aspect=params.get("aspect","16:9"),
                             soundtrack=soundtrack,narration=voice,script=params.get("script", ""),
                             scene_sync=params.get("sceneSync","uniform"),
                             subtitles=bool(params.get("subtitles",True)),
                             cancelled=lambda:self.cancelled or self.bridge.stop.is_set(),progress=progress)
                progress(0.99)
                raw=output.read_bytes()
                from .worker import _http
                # Envío multipart con la misma identificación de intento que los trabajos musicales.
                boundary="sonora-"+uuid.uuid4().hex
                meta=json.dumps({"durationSec":seconds,"model":"Montaje local Sonora","modelVersion":"1.0"})
                body=(f"--{boundary}\r\nContent-Disposition: form-data; name=\"meta\"\r\n\r\n{meta}\r\n"
                      f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"video.mp4\"\r\n"
                      "Content-Type: video/mp4\r\n\r\n").encode()+raw+f"\r\n--{boundary}--\r\n".encode()
                req=Request(f"{REMOTE}/api/worker/jobs/{job_id}/complete",data=body,method="POST",headers={
                    "Authorization":f"Bearer {self.bridge.token}","X-Worker-Id":self.worker_id,
                    "X-Job-Attempt":str(attempt),"Content-Type":f"multipart/form-data; boundary={boundary}"})
                with urlopen(req,timeout=300) as resp:
                    result=json.loads(resp.read(20000))
                    if not result.get("videoId"):raise BridgeError("El servidor no confirmó el MP4")
                self.last_error=""
        except Exception as e:
            self.last_error=str(e)[:250]
            log.exception("Falló el video %s",job_id)
            try:
                self._post(f"/api/worker/jobs/{job_id}/fail",
                           {"error":str(e)[:1500],"retryable":False},attempt)
            except Exception: log.exception("No se pudo notificar el error del video")
        finally:
            self.current=None
            self.cancelled=False
