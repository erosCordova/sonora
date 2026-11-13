"""Sonora para ComfyUI: puente local opcional de música, sin ejecutar scripts CMD.

Para instalarlo, añade el repositorio Sonora como extensión ComfyUI y reinicia.
La integración se activa solo desde el panel «Sonora» en la interfaz local.
"""
from __future__ import annotations

import ipaddress
import logging
from pathlib import Path
from urllib.parse import urlsplit

from aiohttp import web
from server import PromptServer

from .comfyui_bridge.worker import Bridge, BridgeError

logger = logging.getLogger("sonora.comfyui")

try:
    import folder_paths
    USER_DIR = Path(folder_paths.get_user_directory())
except (ImportError, AttributeError):
    USER_DIR = Path.home() / ".comfyui"

BRIDGE = Bridge(USER_DIR / "sonora" / "bridge_credentials.json")
NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}
WEB_DIRECTORY = "./comfyui_bridge/web"


def _from_local_app(request):
    """Impide que sitios web remotos activen un conector con privilegios locales."""
    try:
        address = ipaddress.ip_address(request.remote or "")
        if not address.is_loopback:
            return False
        host = urlsplit(f"http://{request.host}").hostname
        if host not in ("localhost", "127.0.0.1", "::1"):
            return False
        origin = request.headers.get("Origin")
        if origin:
            p = urlsplit(origin)
            if p.scheme != request.scheme or p.netloc != request.host:
                return False
        return True
    except (ValueError, TypeError):
        return False


@PromptServer.instance.routes.get("/sonora-bridge/status")
async def sonora_status(request):
    if not _from_local_app(request):
        raise web.HTTPForbidden()
    return web.json_response(BRIDGE.status(), headers={"Cache-Control": "no-store"})


@PromptServer.instance.routes.post("/sonora-bridge/connect")
async def sonora_connect(request):
    if not _from_local_app(request):
        raise web.HTTPForbidden()
    if request.content_type != "application/json" or (request.content_length or 0) > 2048:
        raise web.HTTPBadRequest(text="Se requiere un JSON pequeño")
    try:
        data = await request.json()
        token = data.get("token", "")
        url = data.get("local_url", "")
        if not isinstance(token, str) or not isinstance(url, str):
            raise BridgeError("Datos de conexión inválidos")
        result = await __import__("asyncio").to_thread(BRIDGE.connect, token.strip(), url)
        return web.json_response(result, headers={"Cache-Control": "no-store"})
    except (ValueError, BridgeError) as e:
        return web.json_response({"error": str(e)}, status=422)


@PromptServer.instance.routes.post("/sonora-bridge/disconnect")
async def sonora_disconnect(request):
    if not _from_local_app(request):
        raise web.HTTPForbidden()
    return web.json_response(BRIDGE.disconnect(), headers={"Cache-Control": "no-store"})
