@echo off
REM Generate a locally-trusted TLS certificate chain for nginx HTTPS (port 8443).
REM Creates ca.pem (install on devices) + cert.pem/key.pem (used by nginx).
REM Run this on the host, NOT inside the container.
REM Requires Node.js and OpenSSL on PATH.
node "%~dp0generate.mjs" %*
