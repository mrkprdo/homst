DEV  := docker compose -f docker-compose.dev.yml
PROD := docker compose -f docker-compose.prod.yml

IMAGE     ?= ghcr.io/mrkprdo/homst
VERSION   ?= dev
PLATFORMS ?= linux/amd64,linux/arm64

.PHONY: install dev dev-build dev-up dev-down dev-e2e web api worker build \
        prod-build prod-up prod-pull prod-down prod-updates cert tokens \
        image image-save release \
        test test-api test-web typecheck \
        db-generate db-migrate db-downgrade \
        lint format clean nuke nuke-prod

# ── Install ──────────────────────────────────────────────
install: tokens
	cd web && bun install
	cd api && pip install -e ".[dev]"

# ── Development ──────────────────────────────────────────
dev: tokens
	$(DEV) up

web: tokens
	cd web && bun run dev

api:
	cd api && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

worker:
	cd api && python -m arq app.workers.settings.WorkerSettings

# ── Build ────────────────────────────────────────────────
build: tokens
	cd web && bun run build

# ── Container image ──────────────────────────────────────
# One image: nginx + API + worker + Redis (see Dockerfile).
image:
	docker build --tag $(IMAGE):$(VERSION) --build-arg HOMST_VERSION=$(VERSION) .

# Tarball of the built image — for offline installs (docker load < file)
image-save: image
	docker save $(IMAGE):$(VERSION) | gzip > homst-image-$(VERSION).tar.gz

# ── Local HTTPS certificate (needed for PWA install + Web Push) ──
cert:
	node nginx/ssl/generate.mjs

# ── Design Tokens ────────────────────────────────────────
# Regenerates web/public/{tokens,shadows}.css. Runs automatically as a
# prerequisite of install / dev / build / test.
tokens:
	cd packages/design-tokens && bun build.ts

# ── Database ─────────────────────────────────────────────
db-generate:
	cd api && alembic revision --autogenerate -m "auto"

db-migrate:
	cd api && alembic upgrade head

db-downgrade:
	cd api && alembic downgrade -1

# ── Testing ──────────────────────────────────────────────
test: tokens test-api test-web
	cd web && bun run e2e

test-api:
	cd api && pytest -v

test-web:
	cd web && bun run test

typecheck:
	cd web && bun run typecheck

dev-e2e: dev-build
	cd web && bun run e2e --headed

# ── Linting ──────────────────────────────────────────────
lint:
	cd api && ruff check app/
	cd web && bun run lint

format:
	cd api && ruff format app/
	cd web && bun run format

# ── Dev stack (Docker) ───────────────────────────────────
# Full rebuild: fresh images, no cache, then start in the background.
dev-build: tokens
	$(DEV) down --rmi local --remove-orphans
	$(DEV) build --no-cache
	$(DEV) up -d

dev-up: tokens
	$(DEV) up -d

dev-down:
	$(DEV) down

# ── Prod stack (Docker) ──────────────────────────────────
# Builds the app image from source, then starts Postgres + HOMST.
# Day-to-day upgrades don't build anything: prod-pull + prod-up.
prod-build:
	$(PROD) down --remove-orphans
	$(PROD) build --no-cache
	$(PROD) up -d

prod-up:
	$(PROD) up -d

prod-pull:
	$(PROD) pull

# Start (or refresh) the optional in-app updater sidecar.
prod-updates:
	$(PROD) --profile updates up -d

prod-down:
	$(PROD) down --remove-orphans

# ── Release ──────────────────────────────────────────────
# Multi-arch build + push to GHCR — the local equivalent of the Release
# GitHub workflow (which runs on v* tags). Needs `docker login ghcr.io`.
release:
	@if [ "$(VERSION)" = "dev" ]; then \
		echo "usage: make release VERSION=1.2.3"; exit 1; \
	fi
	docker buildx build --platform $(PLATFORMS) \
		--tag $(IMAGE):$(VERSION) \
		--build-arg HOMST_VERSION=$(VERSION) \
		--push .
	@echo "Pushed $(IMAGE):$(VERSION) ($(PLATFORMS))"

# ── Clean ────────────────────────────────────────────────
clean:
	rm -rf web/dist
	rm -f web/public/tokens.css web/public/shadows.css
	rm -rf api/__pycache__ api/app/__pycache__ api/app/**/__pycache__
	rm -rf api/.pytest_cache
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name node_modules -not -path "*/node_modules/*" -exec rm -rf {} + 2>/dev/null || true

# ── Nuke (WARNING: destroys DB volumes) ──────────────────────────────────────
nuke:
	$(DEV) down --rmi local --remove-orphans --volumes

nuke-prod:
	$(PROD) down --rmi local --remove-orphans --volumes
