import { app } from "../../scripts/app.js";

// Interfaz local: el token se envía una única vez al plugin de ComfyUI.
// No se guarda en localStorage, cookies ni en el JSON del workflow.
app.registerExtension({
  name: "sonora.bridge",
  async setup() {
    const button = document.createElement("button");
    button.textContent = "♫ Sonora";
    button.setAttribute("aria-label", "Conectar Sonora con GPU local");
    button.style.cssText = "position:fixed;right:14px;bottom:18px;z-index:100000;padding:10px 15px;border-radius:14px;background:#673fcb;color:#fff;cursor:pointer;box-shadow:0 5px 25px #1117;font-weight:700;";
    document.body.appendChild(button);

    const panel = document.createElement("section");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Conexión de Sonora");
    panel.style.cssText = "display:none;position:fixed;right:14px;bottom:68px;z-index:100001;width:min(370px,calc(100vw - 28px));border-radius:16px;padding:18px;background:#191724;border:1px solid #555;color:#fff;box-shadow:0 12px 36px #0009;font:14px system-ui;";
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px">
        <strong style="font-size:18px">Conectar Sonora</strong>
        <button id="sonora-close" aria-label="Cerrar" style="background:transparent;color:#ddd;border:0;font-size:21px;cursor:pointer">×</button>
      </div>
      <p style="color:#d4cde7;line-height:1.4">Conecta la música con ACE-Step y el montaje de videos con el motor local Sonora. La generación de video utiliza CPU, RAM y las voces de Windows.</p>
      <label for="sonora-token" style="display:block;margin:12px 0 5px">WORKER_TOKEN privado (Render)</label>
      <input id="sonora-token" type="password" autocomplete="off" placeholder="Pegar una sola vez" style="box-sizing:border-box;width:100%;border:1px solid #625976;background:#0d0a13;border-radius:8px;color:#fff;padding:10px" />
      <p style="color:#bdb5cc;font-size:12px">El token se guarda solo en la carpeta local de usuario de ComfyUI. Nunca se añade al workflow ni a GitHub.</p>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button id="sonora-connect" style="border:0;background:#9c70ff;color:#fff;border-radius:8px;padding:10px;font-weight:700;cursor:pointer;flex:1">Conectar GPU</button>
        <button id="sonora-disconnect" style="border:1px solid #777;background:transparent;color:#ddd;border-radius:8px;padding:10px;cursor:pointer">Desconectar</button>
      </div>
      <p id="sonora-state" aria-live="polite" style="white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.4;margin:12px 0 0;color:#e0c5f4">Comprobando motor…</p>
    `;
    document.body.appendChild(panel);
    const $ = (id) => panel.querySelector(`#${id}`);
    const state = $("sonora-state");
    const token = $("sonora-token");
    const connect = $("sonora-connect");
    const disconnect = $("sonora-disconnect");
    const apiCall = async (path, options = {}) => {
      const res = await fetch(`/sonora-bridge/${path}`, {cache:"no-store", ...options});
      const result = await res.json();
      if (!res.ok) throw Error(result.error || `Error HTTP ${res.status}`);
      return result;
    };
    const present = (s) => {
      state.textContent = s.running
        ? `● Motor conectado (${s.checkpoint})${s.currentJob ? `\nGenerando: ${s.currentJob}` : ""}`
        : `○ Desconectado${s.configured ? " (token guardado)" : ""}`;
      if (s.lastError) state.textContent += `\nAviso: ${s.lastError}`;
      state.textContent += `\n${s.videoRunning ? "● Motor de video iniciado" : "○ Motor de video no iniciado"}`;
      if (s.videoError) state.textContent += `\nVideo: ${s.videoError}`;
    };
    const refresh = async () => { try { present(await apiCall("status")); } catch(e) {state.textContent=e.message;} };
    button.addEventListener("click", () => {
      panel.style.display = panel.style.display === "none" ? "block" : "none";
      if (panel.style.display === "block") void refresh();
    });
    $("sonora-close").addEventListener("click", () => { panel.style.display="none"; });
    connect.addEventListener("click", async () => {
      connect.disabled = true;
      state.textContent = "Comprobando conexión y modelo…";
      try {
        const result = await apiCall("connect", {method:"POST",headers:{"Content-Type":"application/json"},
          body: JSON.stringify({token:token.value, local_url:window.location.origin})});
        token.value = "";
        present(result);
      } catch(e) { state.textContent = `No conectado: ${e.message}`; }
      finally {connect.disabled = false;}
    });
    disconnect.addEventListener("click", async () => {
      disconnect.disabled = true;
      try { present(await apiCall("disconnect", {method:"POST"})); } catch(e) {state.textContent=e.message;}
      finally {disconnect.disabled = false;}
    });
    // El estado se actualiza solo cuando el panel está abierto, sin guardar secretos.
    window.setInterval(() => { if (panel.style.display === "block") void refresh(); }, 12000);
  },
});
