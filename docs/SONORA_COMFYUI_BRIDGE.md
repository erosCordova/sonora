# Sonora + RTX 4050: conectar ComfyUI sin terminal

Esta carpeta incorpora un **complemento de ComfyUI Desktop** para procesar las canciones solicitadas desde [Sonora](https://sonora-erosss.vercel.app) y devolver el audio a la biblioteca privada del usuario mediante Render. No necesita instalar un servicio independiente en Windows, pero sí **instalar y abrir ComfyUI** y autorizar su conexión.

**Estado de verificación:** el protocolo y el flujo API tienen pruebas automáticas sin GPU; **no se ha realizado una inferencia real en la RTX 4050 del usuario**. La conexión solo estará operativa cuando ComfyUI procese y devuelva un MP3 auténtico.

## Instalación gráfica: crear canciones desde la interfaz de Sonora (Windows 11)

**No hace falta editar los nodos ni pulsar «Ejecutar» en ComfyUI.** Sonora será la interfaz; ComfyUI quedará abierto en segundo plano como motor de audio. Este procedimiento se realiza una sola vez.

### 1. Modelo musical: listo

En la RTX 4050 (6 GB) ya se descargó `ace_step_1.5_turbo_aio.safetensors` y se guardó en:

`C:\Users\erosc\AppData\Local\Comfy-Desktop\ComfyUI-Shared\models\checkpoints\`

La plantilla dejó de indicar «modelo faltante». Esto **solo confirma que ComfyUI encontró el archivo**; todavía no demuestra que el modelo pueda generar audio sin problemas de memoria.

### 2. Instalar el complemento de Sonora sin terminal

La versión nueva de ComfyUI Desktop utiliza **carpetas distintas** para modelos compartidos y complementos de la instancia. **No copies el complemento a `ComfyUI-Shared/models`.**

1. Abre la [página del repositorio Sonora](https://github.com/erosCordova/sonora). Haz clic en **Code → Download ZIP**.
2. En el Explorador de Windows, ve a Descargas y selecciona **Extraer todo**. Obtendrás una carpeta llamada `sonora-main`. Dentro deben verse `__init__.py` y `comfyui_bridge`.
3. Desde el Explorador de archivos, abre `%LOCALAPPDATA%\Comfy-Desktop\ComfyUI-Installs`. Esta es la ubicación habitual de las **instancias** en la versión nueva de ComfyUI Desktop, que puede diferir si elegiste otra ubicación. Entra en tu instancia `ComfyUI` y localiza su carpeta `custom_nodes` (puede existir un segundo subdirectorio `ComfyUI` intermedio).
4. **Copia** la carpeta completa `sonora-main` dentro de `custom_nodes` y **renómbrala `sonora`**. Comprueba que dentro estén `__init__.py` y `comfyui_bridge\worker.py`. No debe quedar un nivel extra `sonora-main` dentro de `sonora`.
5. En **ComfyUI Desktop → Open Dashboard**, detén la instancia y vuelve a pulsar **Start**. En el editor aparecerá un botón flotante **♫ Sonora** abajo a la derecha. El complemento solo carga desde la carpeta correcta tras reiniciar.

*Nota de seguridad:* este complemento contiene código Python que ComfyUI ejecutará al iniciarse. Instálalo solo después de revisar que el repositorio es el esperado. Si Smart App Control bloquea su carga, no desactives sus controles para forzarla.

### 3. Conectar con Sonora

1. En el editor de ComfyUI pulsa el botón **♫ Sonora**.
2. En otra pestaña abre [Render → Sonora → Environment](https://dashboard.render.com/web/srv-dbr7h4l6e07s73apo4ig), busca `WORKER_TOKEN` y cópialo. Es una credencial secreta: **no la compartas por el chat, capturas o GitHub**.
3. Pega el token **solo** en el panel ♫ Sonora de tu ComfyUI local y pulsa **Conectar GPU**. Si aparece un mensaje de error, copia únicamente el mensaje **sin el token**.
4. Comprueba que Sonora muestra **«Motor musical disponible»** en [Crear música](https://sonora-erosss.vercel.app/create).

### 4. Crear tu primera canción desde la página

En **Sonora → Crear música**, usa **Personalizado**. Escribe un estilo, una letra con etiquetas `[Verse]` y `[Chorus]`, elige **30 segundos**, **1 canción**, y pulsa **Crear canción**. ComfyUI procesará la petición en tu RTX 4050 y Sonora recibirá el MP3 en tu biblioteca si la generación termina satisfactoriamente.

**Limitación de esta versión:** canciones nuevas con letra manual o instrumentales; el modo simple sin compositor de letras y las operaciones de edición no están habilitados. Mantén ComfyUI Desktop en ejecución y conectado a Internet durante la generación.

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
