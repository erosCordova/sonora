# Sonora — plataforma de generación musical con IA (ACE-Step 1.5)

Aplicación web para describir una canción y generarla como **audio real** con modelos abiertos.
Sin audios de demostración, sin porcentajes inventados y sin resultados simulados: si no hay un motor
de IA conectado, las tareas esperan en cola y la interfaz lo dice claramente.

## Arquitectura

```
Navegador ──► Web (Next.js 16 + API REST + SSE) ──► PostgreSQL (usuarios, canciones, cola de tareas)
                     │                                  ▲
                     │ audio persistente (STORAGE_DIR)  │ claim / progress / complete (HTTP + token)
                     ▼                                  │
              Volumen / almacenamiento              Worker Python  ──► ACE-Step 1.5 (GPU)
                                                    (proceso separado)
Opcional: LLM abierto (Ollama) ◄── la web, para letras y para interpretar el modo simple
```

* **Servidor web y proceso de inferencia están separados.** El worker (`worker/`) puede correr en tu PC con GPU, en un
  servidor remoto o en Docker; solo necesita alcanzar la web por HTTP(S) con `WORKER_TOKEN`.
* **Cola en PostgreSQL** (`FOR UPDATE SKIP LOCKED`): estados `pending → running → completed | failed | cancelled`,
  reintentos controlados (`max_attempts = 2`), recuperación de tareas si el worker deja de enviar latidos (120 s) y
  cancelación desde la interfaz.
* **Motor intercambiable:** `worker/engines/base.py` define la interfaz `MusicEngine`. Añadir otro modelo = una clase nueva
  registrada en `engines/__init__.py`; la web no cambia (la tarea lleva el nombre del motor, `MUSIC_ENGINE`).
* **Progreso real:** el worker reenvía el callback `progress` de ACE-Step. Si el motor no informa una fracción, la UI muestra
  la **etapa** real (descargando fuente, generando, subiendo…) con barra indeterminada, nunca un porcentaje ficticio.
* **Estados en vivo por SSE** (`/api/jobs/stream`) con respaldo automático por sondeo.
* **Almacenamiento:** audio en disco persistente (`STORAGE_DIR`, volumen Docker `audio`) detrás de una pequeña interfaz
  (`src/lib/storage.ts`) reemplazable por S3/Supabase Storage. Acceso por **URL temporal firmada (HMAC, 1 h)** o sesión; los
  archivos validados por firma binaria antes de guardarse; eliminación borra fila y archivo.
* **Seguridad:** contraseñas con scrypt, sesiones en cookie `httpOnly` (hash en BD), `SameSite=Lax`, validación con Zod,
  limitadores de tasa (login, registro, letras, tareas), cuota por usuario (4 tareas activas, 40 al día, configurable),
  límites de tamaño de subida, control de propiedad en cada ruta, token de worker comparado en tiempo constante.
  Tokens de recuperación de contraseña de un solo uso (hash en BD, 1 h) que invalidan todas las sesiones.

## Motor de IA: qué se verificó

| Dato | Fuente |
|---|---|
| ACE-Step 1.5, licencia **MIT** (código y pesos); entrenado con datos licenciados/libres/sintéticos | modelo `ACE-Step/Ace-Step1.5` en Hugging Face |
| Tareas: `text2music`, `cover`, `repaint` (+ `lego`, `extract`, `complete` solo con modelo *base*) | `docs/en/INFERENCE.md` del repo |
| Voz cantada en 50+ idiomas guiada por letra con etiquetas `[Verse]`, `[Chorus]`… | ficha del modelo / docs |
| Python 3.11–3.12; CUDA, ROCm, Intel XPU, Apple (MPS) y CPU | README del repo |
| Hardware: ≤6 GB VRAM con DiT *turbo* + cuantización INT8 + offload y sin LM; 8–16 GB con LM 0.6B/1.7B; XL 4B: 12 GB con offload / 20 GB sin él | README / guía de GPU del repo |
| "Extender" = *repaint* desde el final del audio hacia delante (documentado en el tutorial) | `docs/en/Tutorial.md` |

**No integrados (decisión técnica):** *MusicGen* no canta con letra (y sus pesos suelen distribuirse con licencia
CC-BY-NC, no válida para uso comercial: verificar antes de usarlo); *YuE* y *DiffRhythm* son candidatos a segundo motor, pero
exigen revisar licencia y VRAM antes de integrarlos y no aportan hoy una mejora comprobada frente a ACE-Step 1.5.
**Separación de voces/instrumentos y combinar fragmentos no están implementados** y por tanto no aparecen en la interfaz
(ACE-Step ofrece `extract` solo con el modelo *base*; queda como mejora futura).

## Funciones disponibles en la interfaz (todas conectadas a lógica real)

* **Inicio, Crear música, Explorar, Mi biblioteca, Favoritos, Configuración**, claro/oscuro, responsive, reproductor persistente.
* **Modo simple:** descripción libre → (si hay LLM) estilo + letra estructurada; si no, el LM interno de ACE-Step
  (`create_sample`) compone la letra. 1 o 2 variaciones independientes (2 tareas con semillas distintas).
* **Modo personalizado:** título, letra, género/subgénero, idioma, voz (masculina, femenina, dueto, coros; suave, enérgica,
  emocional; instrumental), instrumentos, emoción, intensidad, tempo (BPM), duración y estructura. Todo se traduce a
  `caption`, `bpm`, `duration`, `vocal_language` y etiquetas de letra que ACE-Step consume. Los controles de voz/letra/idioma/
  estructura desaparecen en modo instrumental.
* **Letras con LLM abierto** (cualquier endpoint compatible con OpenAI, p. ej. Ollama): generar, editar, regenerar una sección,
  elegir idioma, temática y extensión. Sin `LLM_BASE_URL` el botón se desactiva con una explicación.
* **Reproductor:** play/pausa, ±10 s, barra de progreso, volumen, duración real, cola, repetición (off/toda/una), aleatorio,
  forma de onda (wavesurfer.js), carátula, letra, Media Session. Sigue sonando al navegar.
* **Biblioteca:** búsqueda, filtros (género, voz), orden, favoritos, renombrar, eliminar, publicar en Explorar, descargar,
  detalles (prompt, caption, modelo/versión, duración, tamaño) e **historial de versiones**.
* **Edición (nuevas versiones vinculadas; el original nunca se modifica):** variación (cover, fuerza 0.85), nuevo estilo /
  nueva letra (cover), extender (repaint), regenerar fragmento (repaint) y recortar (en el navegador → WAV).
* **Usuarios:** registro, login, logout, recuperación de contraseña, perfil editable, cambio de contraseña, borrado de cuenta
  (elimina canciones y archivos), rutas protegidas, bibliotecas aisladas.

Las portadas son **arte generativo determinista** a partir del id de la canción (no una imagen generada por IA).

## Puesta en marcha local

Requisitos: Node 22+, PostgreSQL 16 y, para generar audio, una máquina con GPU (ver abajo).

Desde la carpeta principal del proyecto, en Git Bash o una terminal compatible:

```bash
npm ci
npm run setup                    # crea .env con claves seguras; respeta uno existente
# Revisa DATABASE_URL en .env si PostgreSQL usa otro usuario, clave, puerto o nombre de BD
npx drizzle-kit push              # crea las tablas en la base indicada por DATABASE_URL
npm run dev                      # http://localhost:3000
```

PostgreSQL debe estar instalado, en ejecución y contener la base de datos indicada en `DATABASE_URL`.
`setup` no modifica un `.env` existente. Copia el `WORKER_TOKEN` creado en `.env` a `worker/.env`.
Para una instalación nueva puedes usar Docker, como se explica más abajo.

### Worker de IA (en la máquina con GPU)

```bash
git clone https://github.com/ace-step/ACE-Step-1.5 && cd ACE-Step-1.5 && uv sync && cd ..
cp worker/.env.example worker/.env     # SONORA_API_URL, WORKER_TOKEN, ACESTEP_DIR…
cd ACE-Step-1.5 && set -a && source ../worker/.env && set +a
uv pip install requests psutil
uv run python ../worker/worker.py
```

La primera ejecución descarga los pesos con el descargador oficial de ACE-Step (varios GB). En la web, el panel «Motor de IA»
pasa a *Worker conectado* en cuanto llega el primer latido y se muestra GPU, VRAM libre y RAM del proceso.

Ajustes de memoria (`worker/.env`): `ACESTEP_LM_MODEL=none` (sin LM, menos VRAM), `ACESTEP_OFFLOAD=true`,
`ACESTEP_QUANTIZATION=int8_weight_only`, `ACESTEP_DIT=acestep-v15-turbo|sft|base`, `ACESTEP_STEPS`.
El modelo se carga una sola vez y se reutiliza; tras cada tarea se borran los temporales y se libera la caché de GPU.
Un worker procesa **una tarea a la vez** (concurrencia = nº de workers).
Al actualizar desde una versión anterior, actualiza la web y el worker a la vez: ahora cada petición del worker
identifica el intento concreto de la tarea para descartar procesos antiguos o reasignados.

### Letras (opcional)

```bash
ollama pull qwen2.5:7b-instruct
# .env del servidor web:
LLM_BASE_URL=http://127.0.0.1:11434/v1
LLM_MODEL=qwen2.5:7b-instruct
```

### Correo de recuperación (opcional)

Define `APP_URL=https://tu-dominio` en producción y configura `SMTP_URL=smtp://usuario:clave@host:587`.
Los enlaces de restablecimiento de contraseña se construyen solamente desde `APP_URL`, nunca desde cabeceras HTTP.
Sin SMTP, **no se envía correo**: solo en desarrollo local se imprime el enlace en los logs para probar el flujo; en producción no se registra el token.

## Docker y despliegue

```bash
node scripts/setup.mjs                       # crea .env si todavía no existe
docker compose up -d --build                 # web + PostgreSQL (aplica el esquema al arrancar)
docker compose --profile gpu up -d           # añade el worker (requiere NVIDIA Container Toolkit)
docker compose --profile llm up -d ollama    # LLM opcional para letras
```

Docker Compose toma las claves del archivo `.env`. El arranque aplica el esquema sin la opción `--force`;
si un cambio futuro requiere eliminar o transformar datos, revísalo manualmente y prepara una copia de seguridad.

Despliegue público recomendado:

1. **Web + PostgreSQL** en cualquier PaaS/VPS con Docker y un **volumen persistente** para `STORAGE_DIR` (o sustituir
   `src/lib/storage.ts` por S3/Supabase Storage; Supabase Postgres sirve como `DATABASE_URL`). Usa HTTPS y `COOKIE_SECURE=true`.
   Las rutas SSE y de subida necesitan un runtime Node de larga duración (no funciones serverless con timeouts cortos).
2. **Worker** en una máquina con GPU (la tuya, un servidor dedicado o GPU en la nube) apuntando a `SONORA_API_URL`.
3. Si despliegas el frontend en Vercel, la API y las rutas con ficheros deben seguir en un servidor persistente.
4. El limitador de tasa es en memoria (por proceso); con varias réplicas web, cámbialo por Redis.

### Despliegue gratuito de comprobación: Render + Vercel

La aplicación **no se divide en dos servidores Next.js**: el backend, las páginas protegidas,
los audios y las rutas de eventos necesitan compartir sesiones y almacenamiento. Por ello,
Render aloja la aplicación completa y Vercel proporciona la URL pública como proxy HTTPS
mediante `vercel-proxy/vercel.json`. El worker GPU apunta directamente al servicio Render
para evitar límites de subida del proxy. El almacenamiento usa `STORAGE_BACKEND=postgres`
para que reiniciar Render Free **no borre las canciones**. En local, `filesystem` sigue siendo el predeterminado.

- `render.yaml`: web Docker plan Free, esquema de PostgreSQL al iniciar, claves aleatorias gestionadas
  por Render, y `DATABASE_URL` referenciada a la base existente `sonora-db` (no se almacena contraseña en Git).
- `vercel-proxy/`: proyecto Vercel sin framework ni dependencias, con rewrite hacia la aplicación en Render.
- El Render Free Postgres **es temporal** (30 días, 1 GB, sin copias de seguridad).
  No es almacenamiento duradero de producción. **Exporta datos y migra a una BD estable antes de que caduque.**
  La web Free tampoco tiene disco persistente; no uses `filesystem` en Render Free.
- En modo PostgreSQL cada audio se limita inicialmente a **50 MiB** (`POSTGRES_AUDIO_MAX_BYTES`).
  Almacenar canciones largas o muchas canciones puede llenar la base. Para producción,
  cambia a un proveedor de almacenamiento de objetos y una base de datos duradera.
- **Render y Vercel no incluyen GPU gratuita para inferencia ACE-Step**: sin worker
  compatible no habrá canciones generadas, aunque la web y su API estén en línea.
  La cola y el panel indican el estado real; no se crean canciones de demostración.
- Si se usa un proxy Vercel, la URL de recuperación de contraseña `APP_URL` debe apuntar
  al dominio realmente público y SMTP debe configurarse para enviar correos.

## Limitaciones reales (léelas antes de abrirlo al público)

* Sin un worker y los pesos descargados no hay generación. Los recursos gratuitos con GPU pueden tener límites de
  disponibilidad o uso; verifica los requisitos vigentes del servicio elegido. La velocidad depende del hardware y del
  modelo. Cada worker atiende una tarea a la vez y la cola acumula las demás.
* La calidad de voz, pronunciación y sincronía depende de ACE-Step 1.5; las opciones de voz/estilo/instrumentos se expresan
  como descripción textual y el modelo puede no cumplirlas al 100 %. Los idiomas con menos datos rinden peor.
* *Extender* y *regenerar fragmento* usan `repaint`; su calidad de empalme depende del modelo y de la duración (3–90 s por tramo).
* Los límites del modelo (duración máxima por canción) se acotan a 30–240 s en la interfaz.
* No hay clonación de voz: solo voces sintéticas a partir de texto. El sistema no acepta audios de referencia de personas.
* **Derechos:** ACE-Step 1.5 declara datos de entrenamiento licenciados/libres y permite uso comercial, pero **no se garantiza**
  que cada canción esté libre de reclamaciones ni que sea protegible por derecho de autor en tu jurisdicción. Las instrucciones
  del LLM prohíben imitar obras o artistas concretos; añade moderación adicional si abres registro público.

## Estado de validación

- Se comprobó la compilación y el análisis de tipos de la web.
- Se probó con PostgreSQL el registro, aislamiento de dos usuarios, creación y cancelación de tareas,
  recuperación de un worker desconectado, rechazo de intentos antiguos, subida simultánea de resultados
  y reproducción parcial del archivo mediante la API.
- La prueba de almacenamiento usa un WAV sintético temporal, no música generada por IA, y elimina sus usuarios y canciones.
- **Pendiente:** ejecutar ACE-Step con sus pesos y un equipo compatible para verificar la generación musical real,
  los modos cover/repaint, la calidad, el consumo y los tiempos. Docker y Ollama tampoco se ejecutaron en esta revisión.

Para repetir la prueba de integración, inicia Sonora con una **base de datos de prueba dedicada** y ejecuta:

```bash
TEST_BASE_URL=http://localhost:3000 \
TEST_DATABASE_URL="postgresql://usuario:clave@localhost:5432/sonora_prueba" \
WORKER_TOKEN="tu-token-de-prueba" npm run test:integration
```

Sustituye `TEST_DATABASE_URL` y `WORKER_TOKEN` por los valores del servidor de prueba.
Para comprobar el protocolo del worker sin cargar el modelo, instala `worker/requirements.txt` y ejecuta
`python -m unittest discover -s tests -p 'test_*.py' -v`.

No se debe considerar completada la generación por IA hasta obtener y escuchar una canción real del motor.

## Pruebas automáticas en GitHub

El workflow `.github/workflows/ci.yml` ejecuta al hacer push a `main` o abrir un pull request:
`npm ci`, ESLint, revisión TypeScript, compilación Next.js, pruebas Python del protocolo del worker y pruebas
integrales de la API sobre PostgreSQL 16 (incluida recuperación simultánea de contraseña).
No requiere GPU para estas comprobaciones. La generación musical real con ACE-Step
se verifica por separado antes de declarar lista una instalación de producción.

### Solicitudes con el motor desconectado (producción)

En producción configura `REQUIRE_ONLINE_WORKER=true` (habilitado en `render.yaml`).
La API rechaza con HTTP 503 nuevas tareas si ningún worker del motor seleccionado
ha enviado un latido en los últimos 30 segundos. Así no se consume cuota ni
se acumulan solicitudes que no podrán generar audio. Las tareas antiguas en cola
no se borran automáticamente; cada usuario puede cancelarlas.

Esto **no instala una GPU**: para generar canciones originales con Sonora debes
arrancar `worker/worker.py` en una máquina con GPU, con `SONORA_API_URL` y
`WORKER_TOKEN` configurados. El demo oficial de ACE-Step en Hugging Face ZeroGPU
permite probar el modelo por separado con cuotas y sin conexión a la biblioteca
de Sonora. No se ofrece música de demostración como si fuera un resultado.
