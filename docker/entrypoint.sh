#!/bin/sh
set -eu

mkdir -p /app/uploads/photos /app/uploads/chats /etc/ssl/homst
chown -R homst:homst /app/uploads

if [ ! -s /etc/ssl/homst/cert.pem ] || [ ! -s /etc/ssl/homst/key.pem ]; then
    echo "[homst] no TLS certificates in /etc/ssl/homst — generating a local chain"
    homst-cert
else
    echo "[homst] using existing TLS certificates from /etc/ssl/homst"
fi

if [ -z "${DATABASE_URL:-}" ]; then
    password_file="${HOMST_DB_PASSWORD_FILE:-/secrets/db_password}"
    if [ ! -s "$password_file" ]; then
        echo "[homst] DATABASE_URL is not set and $password_file does not exist." >&2
        echo "[homst] Compose creates it via the 'init' service on first boot;" >&2
        echo "[homst] set DATABASE_URL yourself when running the image standalone." >&2
        exit 1
    fi
    export DATABASE_URL="postgresql+asyncpg://postgres:$(cat "$password_file")@postgres:5432/homst"
    echo "[homst] DATABASE_URL derived from $password_file"
fi

exec "$@"
