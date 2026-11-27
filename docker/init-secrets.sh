#!/bin/sh
set -eu

SECRET_FILE="${HOMST_SECRETS_DIR:-/secrets}/db_password"

mkdir -p "$(dirname "$SECRET_FILE")"

if [ -s "$SECRET_FILE" ]; then
    echo "[homst-init] $SECRET_FILE already exists - keeping it"
    exit 0
fi

umask 077
if [ -n "${POSTGRES_PASSWORD:-}" ]; then
    printf '%s' "$POSTGRES_PASSWORD" > "$SECRET_FILE"
    echo "[homst-init] using POSTGRES_PASSWORD from the environment"
else
    head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"
    echo "[homst-init] generated database password in $SECRET_FILE"
fi
chmod 600 "$SECRET_FILE"
