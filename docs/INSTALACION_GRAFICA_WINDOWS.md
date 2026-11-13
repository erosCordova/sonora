# Sonora: pruebas locales con RTX 4050 sin terminal

**Estado:** procedimiento gráfico opcional para **probar ACE-Step 1.5 en tu laptop**, todavía **no integrado automáticamente con Sonora**.

## Por qué se retiró el lanzador CMD

Windows 11 con **Control Inteligente de Aplicaciones** puede impedir la ejecución de software y scripts sin una firma confiable. Microsoft no ofrece excepciones por archivo para Smart App Control. El antiguo lanzador de Sonora no estaba firmado y Windows lo bloqueó. No se recomienda desactivar la protección, ejecutar comandos para eludirla ni descargar instaladores desconocidos.

Documentación Microsoft: https://support.microsoft.com/es-es/windows/security/threat-malware-protection/smart-app-control-frequently-asked-questions

## Prueba gráfica con una aplicación de terceros

La aplicación oficial [ComfyUI Desktop](https://comfy.org/download/) permite instalar una interfaz de IA en Windows y administrar modelos desde ventanas. **No es el instalador de Sonora.**

1. Descarga ComfyUI Desktop de su web oficial; verifica el editor al abrir el instalador.
2. Si Windows lo permite, crea una instalación local para **NVIDIA CUDA** desde el asistente.
3. Abre **Template Library → Audio → ACE-Step 1.5**.
4. Descarga los pesos de los modelos mediante la interfaz. Habrá descargas grandes y el consumo de disco puede superar 10 GB.
5. Introduce un prompt y una letra con etiquetas `[Verse]` y `[Chorus]`, por ejemplo la letra de **«Bajo el mismo cielo»**. Comienza con una duración corta y un lote de una canción.
6. Solo declara éxito si el modelo devuelve un **archivo reproducible**. Guardar el audio desde ComfyUI no añade automáticamente la canción a la biblioteca Sonora.

Documentación ACE-Step en ComfyUI: https://blog.comfy.org/p/ace-step-15-is-now-available-in-comfyui

### Restricciones reales

- RTX 4050 Laptop: 6141 MiB de VRAM según `nvidia-smi` observado; una GPU compatible no asegura que todos los modelos o flujos funcionen sin falta de memoria. Empieza con una configuración ligera; ComfyUI administra el uso de GPU según su propia implementación.
- ComfyUI Desktop y módulos nativos (p. ej. PyTorch) **también** pueden ser bloqueados por Smart App Control. Si sucede, detén la instalación; no cambies las políticas de seguridad para forzarla.
- Esta alternativa exige instalar el programa mediante su asistente: una página web no puede instalar drivers ni acceder automáticamente a la GPU del usuario.
- El flujo de Sonora **todavía necesita un puente de conexión autorizado** entre ComfyUI y la API de Sonora, con autenticación, cola y subida segura de audio. No hay puente validado en esta versión.
- Si no puedes instalar ningún entorno local confiable, la opción práctica de prueba es ejecutar la música en un servicio de GPU externo sujeto a sus cuotas (por ejemplo, el [Space oficial de ACE-Step](https://huggingface.co/spaces/ACE-Step/Ace-Step-v1.5)).

**La tarea termina cuando Sonora reciba el latido de un motor real, se habilite «Crear canción» y una generación produzca y guarde audio verificado.**
