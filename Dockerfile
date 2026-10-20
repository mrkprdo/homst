# syntax=docker/dockerfile:1
#
# HOMST — the whole app in one image:
#   nginx (HTTPS + built SPA)  ·  FastAPI (gunicorn)  ·  ARQ worker  ·  Redis
#
# Postgres stays a sidecar — see docker-compose.prod.yml.
# Processes + TLS bootstrap live in docker/.

ARG HOMST_VERSION=dev

# ── SPA build ────────────────────────────────────────────────────────
FROM oven/bun:1-alpine AS web

WORKDIR /src
COPY packages/design-tokens packages/design-tokens
COPY web/package.json web/bun.lock* web/
RUN cd web && bun install --frozen-lockfile
COPY web/ web/

# Design tokens are generated (gitignored) — produce them before the build
RUN cd packages/design-tokens && bun build.ts \
 && cd /src/web && bun run build

# ── Python dependencies ──────────────────────────────────────────────
FROM python:3.12-slim AS python-deps

RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv \
 && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
 && /opt/venv/bin/pip install --no-cache-dir supervisor

WORKDIR /src
COPY api/pyproject.toml api/
COPY api/app/ api/app/
RUN /opt/venv/bin/pip install --no-cache-dir ./api

# ── Runtime ──────────────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

ARG HOMST_VERSION
ARG HOMST_COMMIT=dev
ENV HOMST_VERSION=${HOMST_VERSION} \
    HOMST_COMMIT=${HOMST_COMMIT} \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:$PATH" \
    HOME=/app

RUN apt-get update && apt-get install -y --no-install-recommends \
      nginx \
      redis-server \
      openssl \
      tini \
      ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=python-deps /opt/venv /opt/venv
COPY --from=web /src/web/dist /usr/share/nginx/html

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/entrypoint.sh /docker/entrypoint.sh
COPY docker/init-secrets.sh /docker/init-secrets.sh
COPY docker/homst-cert /usr/local/bin/homst-cert
RUN chmod +x /docker/entrypoint.sh /docker/init-secrets.sh /usr/local/bin/homst-cert

# Unprivileged user for the API + worker; nginx master stays root and drops
# workers to www-data.
RUN groupadd --system homst \
 && useradd --system --gid homst --home-dir /app --shell /usr/sbin/nologin homst \
 && mkdir -p /app/uploads/photos /etc/ssl/homst \
 && printf '%s\n' "$HOMST_VERSION" > /app/VERSION \
 && printf '%s\n' "$HOMST_COMMIT" > /app/COMMIT \
 && chown -R homst:homst /app

WORKDIR /app
EXPOSE 8443

LABEL org.opencontainers.image.title="HOMST" \
      org.opencontainers.image.description="Self-hosted household dashboard for shared living spaces" \
      org.opencontainers.image.source="https://github.com/mrkprdo/homst" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${HOMST_VERSION}"

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c "import ssl, urllib.request; urllib.request.urlopen('https://127.0.0.1:8443/api/health', context=ssl._create_unverified_context(), timeout=4)" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/docker/entrypoint.sh"]
CMD ["/opt/venv/bin/supervisord", "-c", "/etc/supervisor/supervisord.conf"]
