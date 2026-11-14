# Sonora · Crear videos (primera versión)

La plataforma añade la sección **Crear videos**, con proyectos privados y un motor audiovisual local paralelo al generador de música. El usuario adjunta imágenes JPG/PNG/WEBP o un capítulo manga CBZ/ZIP, selecciona canción propia o pista MP3/WAV/M4A/FLAC, añade opcionalmente un guion para narración con las voces instaladas en Windows, elige 15/30/60 segundos y el aspecto 16:9 o 9:16. El procesador local produce MP4 H.264/MPEG-4 + AAC y lo envía a la biblioteca privada.

**No es todavía un modelo de texto a video ni de video generativo por difusión.** Las imágenes se animan con movimiento de cámara; no se inventan fotogramas nuevos, lipsync ni se detectan automáticamente los diálogos del manga. La importación PDF requiere PyMuPDF en ComfyUI. Las voces se sintetizan localmente por SAPI en Windows (depende de las voces instaladas). Si una voz falla, el proyecto informa del error en lugar de simular el éxito.

## Conectar el motor

1. Descargar los archivos actualizados del repositorio `erosCordova/sonora` en la misma carpeta `ComfyUI/custom_nodes/sonora` donde ya se instaló el conector (mantener el archivo `__init__.py` en la raíz). Sustituir los archivos anteriores y conservar los nuevos `comfyui_bridge/video_worker.py`.
2. Reiniciar **ComfyUI Desktop** por completo (Quit Desktop y volver a abrir).
3. Abrir el botón ♫ Sonora, pulsar «Conectar GPU» con la clave privada existente, o desconectar y conectar de nuevo si ya estaba activo.
4. En Sonora, entrar en `/videos` y adjuntar imágenes, un CBZ, o un PDF (solo si el motor dispone de PyMuPDF).
5. Subir audio o seleccionar una canción; en Windows puede habilitar narración con guion. Pulsar Crear MP4.
6. Esperar a que aparezca el reproductor en «Mis videos». Mantener ComfyUI encendido durante el trabajo.

La parte de video utiliza CPU y memoria RAM; no bloquea el acceso del sitio web. La música y el renderizado comparten los recursos de la computadora y las generaciones grandes pueden tardar o fallar. Por ahora se admiten 12 imágenes individuales, un capítulo ZIP/CBZ o PDF de hasta 80 páginas, paquetes de subida de máximo 24 MB y videos MP4 de máximo 40 MB. No subir archivos personales o con derechos de terceros sin autorización.

## Privacidad, límites y seguridad

Las fuentes y el MP4 se almacenan **temporalmente en PostgreSQL de Render**, que tiene capacidad limitada y fecha de expiración; no usar la versión gratuita como archivo definitivo de videos. Sólo se sirven videos al propietario autenticado. Los trabajos del motor requieren `WORKER_TOKEN`, identificador e intento correctos. Los archivos se validan por firma y extensión, las extracciones de ZIP limitan páginas/tamaño y no escriben rutas arbitrarias.

**Pendiente después de la primera generación real:** migrar video y audio a almacenamiento de objetos persistente, agregar editor de escenas/personajes, análisis semántico de imagen y letra, TTS de voces múltiples y modelos de difusión de video ligeros compatibles con 6 GB de VRAM.

## Videoclips líricos

La opción **Video lírico** del estudio puede crear un MP4 con fondos gráficos animados y letras sin subir imágenes. Selecciona una canción de tu biblioteca (la letra puede cargarse desde el propio registro) o sube un audio y escribe la letra. La duración disponible sigue siendo de 15, 30 o 60 segundos. Esto no equivale a generar escenas cinematográficas por difusión.
