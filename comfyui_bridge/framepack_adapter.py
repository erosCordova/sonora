"""Adaptador experimental FramePack para ComfyUI, sin credenciales externas.

Solo activa la función cuando TODOS los nodos y los modelos existen localmente.
El modelo es grande; 6 GB de VRAM no garantizan generación sin falta de memoria.
No descarga modelos automáticamente ni simula fotogramas generados.
"""
from __future__ import annotations

import io
import json
import random
import time
import uuid
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .worker import BridgeError, _http, _local_endpoint

MAX_FRAME_BYTES = 3_000_000
REQUIRED = (
    "FramePackSampler", "LoadFramePackModel", "FramePackFindNearestBucket",
    "VAELoader", "DualCLIPLoader", "CLIPVisionLoader", "CLIPVisionEncode",
    "LoadImage", "ImageScale", "VAEEncode", "ConditioningZeroOut",
    "CLIPTextEncode", "VAEDecodeTiled", "SaveImage",
)


def _options(nodes, node: str, item: str) -> list[str]:
    inputs = nodes.get(node, {}).get("input", {}).get("required", {})
    choice = inputs.get(item, [[]])
    if not isinstance(choice, (list, tuple)) or not choice:
        return []
    values = choice[0]
    return [str(x) for x in values] if isinstance(values, (list, tuple)) else []


def _select(items: list[str], *keywords: str) -> str:
    for keyword in keywords:
        for entry in items:
            if keyword.lower() in entry.replace("\\", "/").lower():
                return entry
    return ""


def identify_framepack(nodes: dict) -> dict | None:
    """No se anuncia capacidad de IA sin todos los pesos instalados."""
    if not all(name in nodes for name in REQUIRED):
        return None
    model = _select(_options(nodes,"LoadFramePackModel","model"), "FramePackI2V_HY_fp8", "FramePackI2V_HY")
    vae = _select(_options(nodes,"VAELoader","vae_name"),"hunyuan_video_vae","hunyuan")
    clipvision = _select(_options(nodes,"CLIPVisionLoader","clip_name"), "sigclip")
    clip1 = _select(_options(nodes,"DualCLIPLoader","clip_name1"),"clip_l.")
    clip2 = _select(_options(nodes,"DualCLIPLoader","clip_name2"),"llava_llama3")
    model_type = _options(nodes,"DualCLIPLoader","type")
    if not (model and vae and clipvision and clip1 and clip2 and "hunyuan_video" in model_type):
        return None
    return {"model":model,"vae":vae,"clipvision":clipvision,
            "clip1":clip1,"clip2":clip2}


def probe_framepack(local_url: str) -> dict | None:
    endpoint = _local_endpoint(local_url)
    try:
        info = _http(endpoint+"/object_info",limit=30_000_000,timeout=12)
        return identify_framepack(info)
    except (OSError, BridgeError, ValueError):
        return None


def make_graph(image_name: str, prompt: str, weights: dict, seed: int | None = None) -> dict:
    if not image_name or "/" in image_name or "\\" in image_name:
        raise BridgeError("Nombre de imagen inseguro")
    prompt = prompt.strip()[:500]
    if len(prompt) < 4:
        raise BridgeError("Describe el movimiento deseado en al menos cuatro caracteres")
    if not all(weights.get(k) for k in ("model","vae","clipvision","clip1","clip2")):
        raise BridgeError("Los modelos de FramePack están incompletos")
    if seed is None:
        seed = random.SystemRandom().randint(1,2**31-1)
    # Resolución conservadora de 384 px y 1 segundo para la primera prueba.
    return {
        "1":{"class_type":"LoadImage","inputs":{"image":image_name}},
        "2":{"class_type":"FramePackFindNearestBucket",
             "inputs":{"image":["1",0],"base_resolution":384}},
        "3":{"class_type":"ImageScale","inputs":{"image":["1",0],
             "upscale_method":"lanczos","width":["2",0],"height":["2",1],"crop":"center"}},
        "4":{"class_type":"VAELoader","inputs":{"vae_name":weights["vae"]}},
        "5":{"class_type":"VAEEncode","inputs":{"pixels":["3",0],"vae":["4",0]}},
        "6":{"class_type":"CLIPVisionLoader","inputs":{"clip_name":weights["clipvision"]}},
        "7":{"class_type":"CLIPVisionEncode","inputs":{"clip_vision":["6",0],
             "image":["3",0],"crop":"center"}},
        "8":{"class_type":"DualCLIPLoader","inputs":{"clip_name1":weights["clip1"],
             "clip_name2":weights["clip2"],"type":"hunyuan_video","device":"default"}},
        "9":{"class_type":"CLIPTextEncode","inputs":{"text":prompt,"clip":["8",0]}},
        "10":{"class_type":"ConditioningZeroOut","inputs":{"conditioning":["9",0]}},
        "11":{"class_type":"LoadFramePackModel","inputs":{"model":weights["model"],
             "base_precision":"bf16","quantization":"fp8_e4m3fn",
             "load_device":"offload_device","attention_mode":"sdpa"}},
        "12":{"class_type":"FramePackSampler","inputs":{"model":["11",0],
             "positive":["9",0],"negative":["10",0],"start_latent":["5",0],
             "image_embeds":["7",0],"steps":8,"use_teacache":True,
             "teacache_rel_l1_thresh":0.15,"cfg":1.0,"guidance_scale":10.0,
             "shift":0.0,"seed":seed,"latent_window_size":9,
             "total_second_length":1.0,"gpu_memory_preservation":1.8,
             "sampler":"unipc_bh1"}},
        "13":{"class_type":"VAEDecodeTiled","inputs":{"samples":["12",0],
             "vae":["4",0],"tile_size":128,"overlap":32,
             "temporal_size":32,"temporal_overlap":8}},
        "14":{"class_type":"SaveImage","inputs":{"images":["13",0],
             "filename_prefix":"sonora_motion"}},
    }


def upload_frame(local_url: str, image) -> str:
    from PIL import ImageOps
    target = ImageOps.fit(image.convert("RGB"),(384,384))
    out=io.BytesIO()
    target.save(out,format="PNG",optimize=True)
    body=out.getvalue()
    boundary="sonora-"+uuid.uuid4().hex
    name="sonora_motion_"+uuid.uuid4().hex[:14]+".png"
    multipart=(f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; "
               f"filename=\"{name}\"\r\nContent-Type: image/png\r\n\r\n").encode()+body+(
               f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"overwrite\"\r\n\r\nfalse\r\n"
               f"--{boundary}--\r\n").encode()
    req=Request(_local_endpoint(local_url)+"/upload/image",data=multipart,method="POST",
                headers={"Content-Type":f"multipart/form-data; boundary={boundary}"})
    with urlopen(req,timeout=60) as response:
        result=json.loads(response.read(10000))
    actual=result.get("name")
    if not isinstance(actual,str) or actual!=name:
        raise BridgeError("ComfyUI no confirmó la imagen de entrada")
    return actual


def generate_frames(local_url: str, image, prompt: str, cancelled=lambda:False,
                    progress=lambda _:None, deadline: int = 2400):
    """Devuelve imágenes reales generadas, nunca los fotogramas originales repetidos."""
    from PIL import Image
    endpoint=_local_endpoint(local_url)
    weights=probe_framepack(endpoint)
    if not weights:
        raise BridgeError("FramePack no está instalado o faltan los modelos de Hunyuan/SigCLIP")
    if cancelled():
        raise BridgeError("Generación cancelada antes de enviar el trabajo")
    name=upload_frame(endpoint,image)
    workflow=make_graph(name,prompt,weights)
    queued=_http(endpoint+"/prompt",method="POST",json_data={"prompt":workflow,"client_id":uuid.uuid4().hex},
                 limit=10000,timeout=30)
    prompt_id=queued.get("prompt_id")
    if not isinstance(prompt_id,str) or len(prompt_id)>100:
        raise BridgeError("ComfyUI rechazó el flujo experimental de FramePack")
    start=time.monotonic()
    history=None
    while time.monotonic()-start < deadline:
        if cancelled():
            raise BridgeError("El trabajo local fue cancelado. ComfyUI podría seguir procesando el flujo.")
        result=_http(endpoint+"/history/"+prompt_id,limit=400_000,timeout=20)
        history=result.get(prompt_id)
        if history:
            status=history.get("status",{})
            if status.get("status_str") == "error":
                raise BridgeError("ComfyUI informó un error de FramePack; revisa el registro local")
            if "outputs" in history:
                break
        progress(min(.4,(time.monotonic()-start)/deadline*.4))
        time.sleep(5)
    else:
        raise BridgeError("FramePack superó el límite de procesamiento; revisa GPU y memoria RAM")
    files=history.get("outputs",{}).get("14",{}).get("images",[])
    if not 2 <= len(files) <= 120:
        raise BridgeError("FramePack no produjo una secuencia válida de fotogramas")
    frames=[]
    for file in files:
        if cancelled():
            raise BridgeError("Generación cancelada")
        filename=file.get("filename","")
        if not isinstance(filename,str) or "/" in filename or "\\" in filename:
            raise BridgeError("ComfyUI devolvió una ruta de fotograma inválida")
        query=urlencode({"filename":filename,"subfolder":file.get("subfolder",""),"type":"output"})
        req=Request(endpoint+"/view?"+query)
        with urlopen(req,timeout=30) as response:
            buf=response.read(MAX_FRAME_BYTES+1)
        if len(buf)>MAX_FRAME_BYTES:
            raise BridgeError("Un fotograma generado supera 3 MB")
        with Image.open(io.BytesIO(buf)) as item:
            item.load()
            frames.append(item.convert("RGB"))
    progress(.45)
    return frames
