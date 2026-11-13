#!/usr/bin/env bash
# Arranca el motor real de Sonora en Windows 11 con RTX 4050. Mantener abierta la terminal.
set -Eeuo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
MODEL="$ROOT/../ACE-Step-1.5"
PYTHON_EXE="$MODEL/.venv/Scripts/python.exe"
[[ -f "$PYTHON_EXE" ]] || { echo 'Falta ACE-Step: ejecuta primero bash scripts/install-worker-rtx4050.sh' >&2; exit 1; }
[[ -f "$ROOT/worker/.env" ]] || { echo 'Falta WORKER_TOKEN: ejecuta primero el instalador.' >&2; exit 1; }
[[ -f "$ROOT/worker/.rtx4050.env" ]] || { echo 'Falta perfil RTX 4050: ejecuta el instalador.' >&2; exit 1; }
set -a
# Estas rutas contienen únicamente configuración creada localmente por el instalador.
# shellcheck disable=SC1091
source "$ROOT/worker/.rtx4050.env"
# shellcheck disable=SC1091
source "$ROOT/worker/.env"
set +a
# Python de Windows necesita una ruta Windows, no /c/Users/... de Git Bash.
if command -v cygpath >/dev/null; then
  export ACESTEP_DIR="$(cygpath -w "$MODEL")"
  WORKER_SCRIPT="$(cygpath -w "$ROOT/worker/worker.py")"
else
  export ACESTEP_DIR="$MODEL"
  WORKER_SCRIPT="$ROOT/worker/worker.py"
fi
[[ "$SONORA_API_URL" == https://* ]] || { echo 'Por seguridad, SONORA_API_URL debe usar HTTPS.' >&2; exit 1; }
[[ -n "${WORKER_TOKEN:-}" ]] || { echo 'El token de worker está vacío.' >&2; exit 1; }
cd "$MODEL"
printf '\n[Sonora] Iniciando ACE-Step con %s\n' "$($PYTHON_EXE -c 'import torch; print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else "SIN GPU CUDA")')"
exec "$PYTHON_EXE" "$WORKER_SCRIPT"
