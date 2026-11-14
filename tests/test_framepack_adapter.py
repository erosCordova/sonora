"""Contratos de integración del motor generativo experimental, sin ejecutar GPU ni descargar modelos."""
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
from comfyui_bridge.framepack_adapter import (
    REQUIRED, identify_framepack, make_graph, generate_frames,
)
from comfyui_bridge.worker import BridgeError


def fake_nodes():
    nodes={name:{"input":{"required":{}}} for name in REQUIRED}
    def options(name,field,values):
        nodes[name]["input"]["required"][field]=[values, {}]
    options("LoadFramePackModel","model",["other.safetensors","FramePackI2V_HY_fp8_e4m3fn.safetensors"])
    options("VAELoader","vae_name",["hunyuan_video_vae_bf16_repack.safetensors"])
    options("CLIPVisionLoader","clip_name",["sigclip_vision_patch14_384.safetensors"])
    options("DualCLIPLoader","clip_name1",["clip_l.safetensors"])
    options("DualCLIPLoader","clip_name2",["llava_llama3_fp16.safetensors"])
    options("DualCLIPLoader","type",["hunyuan_video","sdxl"])
    return nodes


class FramePackAdapterTests(unittest.TestCase):
    def test_must_have_all_nodes_and_models(self):
        nodes=fake_nodes()
        self.assertIsNotNone(identify_framepack(nodes))
        nodes.pop("FramePackSampler")
        self.assertIsNone(identify_framepack(nodes))
        nodes=fake_nodes()
        nodes["LoadFramePackModel"]["input"]["required"]["model"][0]=["otro_modelo.safetensors"]
        self.assertIsNone(identify_framepack(nodes))
        nodes=fake_nodes()
        nodes["DualCLIPLoader"]["input"]["required"]["type"][0]=["sdxl"]
        self.assertIsNone(identify_framepack(nodes))

    def test_graph_has_authentic_image_to_video_sampling_and_output(self):
        selected=identify_framepack(fake_nodes())
        graph=make_graph("sonora.png","a person waving slowly",selected,seed=7)
        self.assertEqual(graph["12"]["class_type"],"FramePackSampler")
        self.assertEqual(graph["12"]["inputs"]["latent_window_size"],9)
        self.assertEqual(graph["12"]["inputs"]["seed"],7)
        self.assertEqual(graph["12"]["inputs"]["total_second_length"],1.0)
        self.assertEqual(graph["11"]["inputs"]["load_device"],"offload_device")
        self.assertEqual(graph["14"]["class_type"],"SaveImage")
        self.assertEqual(graph["14"]["inputs"]["images"],["13",0])
        self.assertEqual(graph["1"]["inputs"]["image"],"sonora.png")
        with self.assertRaises(BridgeError): make_graph("../secret.png","a person waving slowly",selected)
        with self.assertRaises(BridgeError): make_graph("ok.png","hi",selected)

    def test_generator_returns_real_frames_from_local_history(self):
        image=Image.new("RGB",(120,90),"red")
        frames=[]
        for color in ("red","blue","purple"):
            buf=io.BytesIO()
            Image.new("RGB",(50,50),color).save(buf,format="PNG")
            frames.append(buf.getvalue())

        class Response:
            def __init__(self,body):self.body=body
            def __enter__(self):return self
            def __exit__(self,*args):return False
            def read(self,limit=None):
                return self.body if limit is None else self.body[:limit]
        count={"file":0}
        def mock_urlopen(req,timeout=0):
            url=req.full_url
            if "/upload/image" in url:
                import re
                match=__import__("re").search(b'filename="([^"]+)"',req.data)
                return Response(json.dumps({"name":match.group(1).decode()}).encode())
            if "/view" in url:
                v=frames[count["file"]]
                count["file"]+=1
                return Response(v)
            raise AssertionError(url)
        def mock_http(url,**kwargs):
            if "/object_info" in url:return fake_nodes()
            if "/prompt" in url:return {"prompt_id":"test-prompt"}
            if "/history/" in url:
                return {"test-prompt":{"outputs":{"14":{"images":[
                    {"filename":f"sonora_{i}.png","subfolder":"","type":"output"}
                    for i in range(3)]}}}}
            raise AssertionError(url)
        with patch("comfyui_bridge.framepack_adapter._http",side_effect=mock_http),\
             patch("comfyui_bridge.framepack_adapter.urlopen",side_effect=mock_urlopen):
            result=generate_frames("http://127.0.0.1:8188",image,
                                    "slow cinematic motion, camera static")
        self.assertEqual(len(result),3)
        self.assertNotEqual(result[0].getpixel((2,2)),result[1].getpixel((2,2)))

    def test_framepack_fail_closed_for_missing_model_or_cancelled(self):
        with patch("comfyui_bridge.framepack_adapter.probe_framepack",return_value=None):
            with self.assertRaisesRegex(BridgeError,"FramePack no está instalado"):
                generate_frames("http://127.0.0.1:8188",Image.new("RGB",(80,80)),
                                "slow subtle camera motion")
        with patch("comfyui_bridge.framepack_adapter.probe_framepack",return_value=identify_framepack(fake_nodes())):
            with self.assertRaisesRegex(BridgeError,"cancelada"):
                generate_frames("http://127.0.0.1:8188",Image.new("RGB",(80,80)),
                                "slow subtle camera motion",cancelled=lambda:True)


if __name__=="__main__":
    unittest.main()
