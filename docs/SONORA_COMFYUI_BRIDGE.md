# Sonora + RTX 4050: conectar ComfyUI sin terminal

Esta carpeta incorpora un **complemento de ComfyUI Desktop** para procesar las canciones solicitadas desde [Sonora](https://sonora-erosss.vercel.app) y devolver el audio a la biblioteca privada del usuario mediante Render. No necesita instalar un servicio independiente en Windows, pero sí **instalar y abrir ComfyUI** y autorizar su conexión.

**Estado de verificación:** el protocolo y el flujo API tienen pruebas automáticas sin GPU; **no se ha realizado una inferencia real en la RTX 4050 del usuario**. La conexión solo estará operativa cuando ComfyUI procese y devuelva un MP3 auténtico.

## Instalación gráfica (Windows 11)

1. Descarga [ComfyUI Desktop oficial](https://comfy.org/download/), revisa el editor y completa su asistente con NVIDIA/CUDA. Si Smart App Control lo bloquea, **no lo desactives ni fuerces la instalación**.
2. Abre el flujo oficial [ACE-Step 1.5 Music Generation AIO](https://comfy.org/hub/workflows/ace-step-1-5-music-generation-aio-afd30ccf8238/) en ComfyUI. Descarga el checkpoint `ace_step_1.5_turbo_aio.safetensors` mediante los avisos de modelos faltantes. Comprueba que aparece el nodo nativo `TextEncodeAceStepAudio1.5`.
3. En **ComfyUI Manager → Install via Git URL**, indica `https://github.com/erosCordova/sonora.git`. Si el administrador no permite instalaciones por URL, no cambies sus opciones de seguridad para eludir el bloqueo. Como alternativa sin terminal, descarga [Sonora desde GitHub como ZIP](https://github.com/erosCordova/sonora), extráelo con el Explorador de archivos y mueve la carpeta de código a la ubicación `custom_nodes/sonora` de ComfyUI. El archivo debe quedar en `custom_nodes/sonora/__init__.py`, **no** en `custom_nodes/sonora/sonora-main/__init__.py`.
4. Reinicia ComfyUI Desktop. Aparecerá el botón flotante **♫ Sonora** en la esquina inferior derecha. Si no aparece, comprueba que ComfyUI ha cargado el complemento y que el directorio es correcto.
5. Abre el botón **♫ Sonora** y pega tu `WORKER_TOKEN` desde [Render → Sonora → Environment](https://dashboard.render.com/web/srv-dbr7h4l6e07s73apo4ig). Pulsa **Conectar GPU**. **Nunca pegues ese token en chats ni lo guardes en un workflow**.
6. El panel solo mostrará **Motor conectado** si están presentes los nodos, el modelo y la conexión autenticada con Render. Vuelve a [Crear canción](https://sonora-erosss.vercel.app/create); el botón se habilitará cuando se reciba el latido del worker.
7. Para la primera prueba, usa **Personalizado**, letra escrita con etiquetas `[Verse]` y `[Chorus]`, y selecciona una duración breve (30 s) con una sola canción. Comprueba que el MP3 aparezca en **Mi biblioteca**.

## Límites conocidos

- La primera versión permite **nuevas canciones con letra explícita o instrumentales**. No admite composición automática de letras, `cover`, `repaint` ni extensión. Estas tareas fallan con una explicación; no generan MP3 de demostración.
- Una RTX 4050 de 6 GB puede quedarse sin VRAM con el modelo AIO; ComfyUI realiza parte de la gestión de memoria, pero la generación real **no está garantizada**. Las descargas de pesos ocupan varios GB.
- El PC tiene que estar encendido, con ComfyUI abierto y conectado a Internet. La cuota diaria no está limitada por un servicio de GPU externo, pero sí por la capacidad y disponibilidad de tu PC.
- El token se guarda en un archivo local de configuración en la carpeta de usuario de ComfyUI, **no se exporta en los workflows ni en GitHub**. Pulsa «Desconectar» para eliminar ese archivo. ComfyUI debe permanecer accesible solo en `localhost`.
- El conector usa el backend fijo `https://sonora-api-vdnd.onrender.com`, un endpoint HTTPS con autenticación y límites de tamaño; no abre un puerto público en la computadora.
- El MP3 debe ocupar menos de 50 MiB para el almacenamiento temporal en PostgreSQL. Esta base gratuita de Render caduca: migra a una solución duradera antes de poner Sonora en producción.
- Microsoft Smart App Control puede bloquear programas, módulos o extensiones desconocidos, incluso si vienen de GitHub. **No cambies la seguridad de Windows para instalar este complemento.**

## Estado técnico

- Sonora acepta la solicitud y la crea en PostgreSQL. El plugin obtiene una tarea de la cola mediante un token de worker y ejecuta un flujo local de ComfyUI.
- El plugin recibe el MP3, mide su duración real y lo envía al endpoint de finalización, que valida la firma y guarda la canción para el usuario.
- Las pruebas `tests/test_comfyui_bridge.py` usan ComfyUI y Render simulados. No prueban PyTorch, modelos, GPU ni calidad de audio.

**Criterio de finalización:** ver el estado «Motor musical disponible» en Sonora, generar un MP3 real con la RTX 4050 y reproducirlo desde la biblioteca.
