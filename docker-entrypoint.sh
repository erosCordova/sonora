#!/bin/sh
set -e
# Aplica cambios no destructivos al esquema. Los cambios que requieren
# confirmación deben revisarse y aplicarse manualmente con una copia de seguridad.
npx drizzle-kit push
exec "$@"
