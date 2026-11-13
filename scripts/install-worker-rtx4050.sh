#!/usr/bin/env bash
# Instalador de ACE-Step 1.5 para la RTX 4050 6 GB en Windows 11 (Git Bash).
# Nunca imprime ni sube WORKER_TOKEN. No requiere PowerShell ni Docker.
set -Eeuo pipefail

say() { printf '\n[Sonora] %s\n' "$*"; }
fail() { printf '\n[ERROR] %s\n' "$*" >&2; exit 1; }
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MODEL_DIR="$PROJECT_ROOT/../ACE-Step-1.5"
ENV_FILE="$PROJECT_ROOT/worker/.env"

case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ;;
  *) fail "Este instalador está diseñado para Windows con Git Bash. Sistema actual: $(uname -s)" ;;
esac
command -v git >/dev/null || fail "Instala Git for Windows y abre Git Bash."
command -v nvidia-smi >/dev/null || fail "No se encontró nvidia-smi. Comprueba el controlador de NVIDIA."

say "Comprobando GPU NVIDIA"
GPU_NAME="$(nvidia-smi --query-gpu=name --format=csv,noheader | head -n 1 | tr -d '\r')"
VRAM="$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -n 1 | tr -d '[:space:]')"
[[ "$VRAM" =~ ^[0-9]+$ ]] || fail "No se pudo leer la memoria de la GPU."
(( VRAM >= 4096 )) || fail "Este perfil necesita al menos 4 GB VRAM; detectados ${VRAM} MiB."
printf '  GPU: %s\n  VRAM: %s MiB\n' "$GPU_NAME" "$VRAM"
if (( VRAM < 8000 )); then
  say "Perfil conservador de 6 GB: DiT Turbo, INT8, CPU offload, sin LM."
fi

# ACE-Step, PyTorch y los checkpoints requieren varios GB de espacio.
FREE_KB="$(df -Pk "$PROJECT_ROOT" | awk 'NR==2 { print $4 }')"
if [[ "$FREE_KB" =~ ^[0-9]+$ ]] && (( FREE_KB < 25 * 1024 * 1024 )); then
  printf '[AVISO] Quedan menos de 25 GiB libres. La descarga puede quedarse sin espacio.\n' >&2
fi

if ! command -v uv >/dev/null; then
  say "Instalando uv mediante WinGet (gestor oficial de paquetes de Windows)."
  command -v winget.exe >/dev/null || fail "Instala uv desde https://docs.astral.sh/uv/getting-started/installation/ y ejecuta de nuevo el script."
  winget.exe install --id astral-sh.uv --exact --accept-package-agreements --accept-source-agreements || fail "No se pudo instalar uv con WinGet."
  export PATH="$HOME/AppData/Local/Microsoft/WinGet/Links:$HOME/.local/bin:$PATH"
  if ! command -v uv >/dev/null; then
    fail "uv se instaló, pero Git Bash todavía no lo detecta. Cierra y abre Git Bash, luego vuelve a ejecutar el script."
  fi
fi
say "uv: $(uv --version)"

if [[ ! -d "$MODEL_DIR/.git" ]]; then
  [[ ! -e "$MODEL_DIR" ]] || fail "La ruta $MODEL_DIR existe, pero no es un repositorio Git."
  say "Descargando el código oficial ACE-Step 1.5"
  git clone --depth=1 https://github.com/ACE-Step/ACE-Step-1.5.git "$MODEL_DIR"
else
  say "Utilizando la instalación existente de ACE-Step: $MODEL_DIR (sin sobrescribir archivos)."
fi

say "Instalando dependencias CUDA de ACE-Step con Python 3.12 aislado"
(
  cd "$MODEL_DIR"
  uv sync --python 3.12
)
PYTHON_EXE="$MODEL_DIR/.venv/Scripts/python.exe"
[[ -f "$PYTHON_EXE" ]] || fail "uv no creó Python en $PYTHON_EXE"
say "Instalando comunicación con Sonora"
uv pip install --python "$PYTHON_EXE" -r "$PROJECT_ROOT/worker/requirements.txt"

say "Comprobando PyTorch y CUDA dentro del entorno del modelo"
"$PYTHON_EXE" -c 'import torch; print("PyTorch", torch.__version__, "CUDA disponible:", torch.cuda.is_available(), "GPU:", torch.cuda.get_device_name(0) if torch.cuda.is_available() else "ninguna"); assert torch.cuda.is_available(), "PyTorch no detecta CUDA"' || fail "No se puede utilizar la GPU desde PyTorch. Revisa la versión de PyTorch y el controlador NVIDIA."

# Guardamos solo variables simples controladas por el instalador. El token no se agrega a Git.
if [[ -f "$ENV_FILE" ]] && grep -q '^WORKER_TOKEN=' "$ENV_FILE"; then
  say "Ya existe configuración privada; no se sobrescribirá WORKER_TOKEN."
else
  printf '\nNecesitas el valor WORKER_TOKEN de Render > sonora-api-vdnd > Environment.\n'
  printf 'No compartas ese valor en un chat ni lo subas a GitHub.\n'
  read -r -s -p 'Pega WORKER_TOKEN (entrada oculta): ' WORKER_SECRET
  printf '\n'
  [[ "$WORKER_SECRET" =~ ^[A-Za-z0-9._~-]{32,256}$ ]] || fail "WORKER_TOKEN inválido. Debe tener al menos 32 caracteres seguros."
  mkdir -p "$(dirname "$ENV_FILE")"
  umask 077
  printf 'WORKER_TOKEN=%s\n' "$WORKER_SECRET" > "$ENV_FILE"
  unset WORKER_SECRET
fi

# Creamos un fichero de perfil sin secretos. Siempre se lee después del archivo privado.
cat > "$PROJECT_ROOT/worker/.rtx4050.env" <<'CONFIG'
SONORA_API_URL=https://sonora-api-vdnd.onrender.com
MUSIC_ENGINE=acestep
ACESTEP_DIT=acestep-v15-turbo
ACESTEP_LM_MODEL=none
ACESTEP_LM_BACKEND=pt
ACESTEP_DEVICE=cuda
ACESTEP_OFFLOAD=true
ACESTEP_OFFLOAD_DIT=true
ACESTEP_QUANTIZATION=int8_weight_only
ACESTEP_STEPS=8
WORKER_AUDIO_FORMAT=mp3
CONFIG

say "Instalación base preparada. La primera ejecución descargará los modelos de IA."
say "Para volver a iniciarlo: bash scripts/start-worker-rtx4050.sh"
say "Mantén Git Bash abierto mientras Sonora genere canciones."
if [[ "${SONORA_INSTALL_ONLY:-0}" != "1" ]]; then
  say "Iniciando el motor ahora. La primera ejecución descargará los pesos necesarios."
  exec bash "$PROJECT_ROOT/scripts/start-worker-rtx4050.sh"
fi
