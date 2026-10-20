#!/bin/sh
# Generate a locally-trusted TLS certificate chain for nginx HTTPS (port 8443).
# Creates ca.pem (install on devices) + cert.pem/key.pem (used by nginx).
#
# Run: sh nginx/ssl/generate.sh [extra-ip-or-host ...]
# Requires Node.js and OpenSSL on PATH.
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "$DIR/generate.mjs" "$@"
