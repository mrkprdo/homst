# HOMST

A self-hosted household dashboard for shared living spaces, built for wall-mounted touch displays. See your household's calendar, tasks, and schedule at a glance — without anyone having to ask "what's on today?"

> Calm by default, alive on touch.

![HOMST home screen](docs/screenshots/desktop-home.png)

## Features

- **Shared calendar** — month, week, and day views with event creation, assignees, and recurrence, plus public holidays per country.
- **Task board** — kanban-style To Do / Doing / Done columns with priorities, due dates, and assignees.
- **Today at a glance** — the day's schedule, current weather, and upcoming tasks on one screen.
- **Household members** — colour-coded profiles; everyone is an equal participant.
- **Real-time updates** — server-sent events push every change to all connected screens instantly.
- **Reminders** — Web Push notifications to phones and displays; no third-party push account required.
- **Little extras** — Spotify now playing, a household photo frame, ICS export, dark/light mode, and a companion mobile view.

**Stack:** Vue 3 + Vite (TypeScript) · FastAPI + PostgreSQL + Redis · Docker Compose + Nginx.

## Screenshots

| Calendar                                                      | Task board                                        |
| ------------------------------------------------------------- | ------------------------------------------------- |
| ![Calendar month view](docs/screenshots/desktop-calendar.png) | ![Task board](docs/screenshots/desktop-tasks.png) |

<p align="center">
  <img width="300" alt="Mobile agenda view" src="docs/screenshots/mobile-agenda.png" />
</p>

## Install

HOMST ships as a single container image (nginx + SPA + API + worker + Redis) plus a Postgres sidecar. First boot configures itself — there is no config file to fill in.

### Requirements

- Docker with Compose v2.24+ (any recent Docker Desktop, or Docker Engine with the compose plugin).
- A machine that stays on — a small server, NAS or Raspberry Pi is plenty. Images are published for `linux/amd64` and `linux/arm64`.
- The host's LAN IP for the steps below (e.g. `192.168.1.50`).

### 1. Get the compose file

Download it straight from the latest release:

```bash
mkdir homst && cd homst
curl -fLO https://github.com/mrkprdo/homst/releases/latest/download/docker-compose.prod.yml
# or
wget https://github.com/mrkprdo/homst/releases/latest/download/docker-compose.prod.yml
```

To pin a specific release, replace `latest` with its tag:

```bash
https://github.com/mrkprdo/homst/releases/download/v0.1.1/docker-compose.prod.yml
```

### 2. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

On first boot the stack pulls the image, generates the database password (persisted in the `homst_secrets` volume) and initialises Postgres with it, generates a local CA + HTTPS certificate (persisted in `homst_ssl`), and serves the dashboard on **HTTPS port 8443**. Later starts reuse all of it.

- Upgrade: `docker compose -f docker-compose.prod.yml pull && docker compose -f docker-compose.prod.yml up -d`
- In-app updates (optional): start the updater profile once — `docker compose -f docker-compose.prod.yml --profile updates up -d` — then use **Settings → Software update** to check, install, roll back, or configure automatic stable updates. See [In-app updates](#in-app-updates-optional) below.
- Image tag: `latest` (stable releases) by default. Pin with `HOMST_VERSION=1.2.3 docker compose -f docker-compose.prod.yml up -d`, or edit the single `x-image:` line in the compose file. Compose resolves the tag before `.env.prod` is read, so the tag cannot live there.
- Settings: copy `.env.example` to `.env.prod` (next to the compose file) — the single app config file (database password, external Postgres/Redis, TLS hostnames, CORS, Spotify, Google Calendar, VAPID keys, in-app update overrides). Without it, all defaults apply.
- Building from source instead: `make prod-build` from the repository root.

### 3. Trust the HTTPS certificate

Browsers only allow [PWA install](#5-install-it-as-an-app) and push notifications on a trusted certificate, so this is a one-time step per device. HOMST generates and serves its own CA.

First put the address you will use into the certificate, otherwise the padlock complains about a name mismatch even after you trust the CA:

```bash
docker compose -f docker-compose.prod.yml exec homst homst-cert 192.168.1.50
```

Comma-separate several addresses (`homst-cert 192.168.1.50,192.168.1.51`). Re-issuing keeps the same CA, so devices never need to re-trust it. Alternatively set `HOMST_TLS_HOSTS=192.168.1.50` in `.env.prod` before the first start.

Then install the CA on each device:

1. Open `https://192.168.1.50:8443` and accept the browser warning once.
2. Open **Settings → Add to your devices → HTTPS certificate → Download** (or visit `https://192.168.1.50:8443/ca.pem` directly) — this saves `homst-ca.pem`.
3. Install it as a trusted CA:

| Device        | Install                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android       | Settings → Security & privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate → pick `homst-ca.pem`                                                                    |
| iPhone / iPad | Open the file → install the profile (Settings → General → VPN & Device Management) → Settings → General → About → Certificate Trust Settings → enable full trust                                                    |
| Windows       | Double-click the file → Install Certificate → Local Machine → Trusted Root Certification Authorities                                                                                                                |
| macOS         | Keychain Access → System → drag the file in → open it → Always Trust                                                                                                                                                |
| Linux         | `sudo cp homst-ca.pem /usr/local/share/ca-certificates/homst.crt && sudo update-ca-certificates` — Chrome/Chromium additionally: `certutil -d sql:$HOME/.pki/nssdb -A -t 'C,,' -n 'HOMST Local CA' -i homst-ca.pem` |

Reload the dashboard — the padlock is now valid.

### 4. Onboarding

The first visit opens a four-step setup wizard:

1. **Welcome** — household name (+ optional address).
2. **Household members** — who lives here; everyone gets a colour used across calendars, tasks and profiles.
3. **Holiday calendar** — country (+ optional state/province); public holidays are added automatically.
4. **All set!** — review and confirm.

The home screen ("Today at a glance") opens afterwards. Screens are reachable from the navigation; settings are behind the gear icon.

### 5. Install it as an app

HOMST is a PWA — install it on each display or phone, then turn on notifications:

- **Android / Chrome**: menu → _Install app_ (or _Add to Home screen_).
- **iPhone / iPad (Safari)**: _Share → Add to Home Screen_ — required before Web Push works (iOS 16.4+); open the installed app afterwards.
- **Desktop Chrome / Edge**: install icon in the address bar.

Then in HOMST: **Settings → Reminders → Phone & browser** → allow notifications, and use **Send test to all clients** to verify. HOMST generates its own VAPID keys (stored in the database) — no third-party push account needed.

### In-app updates (optional)

HOMST can check the official stable release feed, install the exact release image, keep the previous image for rollback, and restore the last working build automatically if a new version fails its health check.

Start the updater sidecar once:

```bash
docker compose -f docker-compose.prod.yml --profile updates up -d
```

The sidecar is the only container with access to the Docker socket, is not exposed to the LAN, and is skipped entirely unless the `updates` profile is enabled. With the profile running, **Settings → Software update** shows the current version, available stable releases, version history with rollback, and automatic update settings.

To keep it enabled across later `docker compose` commands, put `COMPOSE_PROFILES=updates` in the project's `.env` (or use `make prod-updates`).

- Only official stable releases are installed by the UI. Dev/nightly and pinned images are read-only there and use the manual commands shown in the card.
- Automatic updates are on by default when the updater is available, install only during the 03:00–05:00 household-time window, and hold major versions for manual approval. Both can be changed in Settings.
- A failed update is automatically rolled back. The failed version is held so auto-update does not retry it in a loop; a newer stable release resumes automatic updates.
- The previous stable image is kept. Nothing prunes it automatically; if disk space matters, prune unused images manually with `docker image prune` when no rollback is needed.
- HOMST has no login: anyone who can open the dashboard can trigger an update. Keep it on a trusted LAN and do not expose port 8443 directly to the internet.

The first release containing this feature must be installed manually (older images do not have the updater):

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

**Nightly builds** are intentionally not managed from the UI. Set the tag on the host and update manually:

```bash
# .env next to the compose file (not .env.prod)
HOMST_VERSION=dev

docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Use a specific nightly build with `HOMST_VERSION=dev-<sha>`. Remove `HOMST_VERSION` (or set it to `latest`) to return to the stable channel. Nightly may contain database changes that stable does not; back up before switching back.

The updater pulls images anonymously. The GitHub repository and the GHCR package must both be public — no registry token or GitHub key is stored in HOMST. If you are publishing the project, set the package visibility to public once in the GitHub package settings (Package settings → Change visibility → Public).

Rootless Docker or Podman users can point the sidecar at a different socket with `HOMST_DOCKER_SOCKET=/path/to/docker.sock` in the project's `.env` (not `.env.prod`).

### Upgrades, data & reset

- Data lives in four volumes: `pg_data` (database), `photo_uploads` (photos), `homst_ssl` (certificates), `homst_secrets` (database password). The optional updater adds `homst_updater_state` (job history and held-version state); it contains no household data.
- Back up with the stack stopped (`docker compose -f docker-compose.prod.yml down`), e.g. `docker run --rm -v homst-prod_pg_data:/from -v "$PWD":/to alpine tar czf /to/pg_data.tgz -C /from .`
- Start over completely: `docker compose -f docker-compose.prod.yml down -v` (deletes database, photos, certificates and password).
- Troubleshooting: `docker compose -f docker-compose.prod.yml logs -f homst` and, when the updater profile is enabled, `docker compose -f docker-compose.prod.yml logs -f updater`.

### Migrating from the old multi-container stack

Earlier versions ran five containers and served `web/dist` from the host. Stop them (`make prod-down` — it removes the old `api`/`worker`/`nginx`/`redis` containers as orphans), then start the new stack; `pg_data` and `photo_uploads` are reused, so household data is kept — devices just need to trust the new `ca.pem` once.

Keep your existing `.env.prod` if you have one: its `DATABASE_URL` overrides the generated password and keeps the existing database working. (If you ran the old stack with an unedited `.env.example`, your database password is literally `yourpassword` — put `DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@postgres:5432/homst` in `.env.prod` to keep it.)

## Develop

Requires [Bun](https://bun.sh) ≥ 1.0, Python 3.12+, Docker with Compose v2, and Node.js + OpenSSL for certificate generation.

```bash
cp .env.dev .env
make cert   # generates nginx/ssl/{ca,cert,key}.pem for the dev HTTPS proxy
make dev    # docker compose dev stack
```

| Service  | URL                        |
| -------- | -------------------------- |
| Frontend | http://localhost:5173      |
| API      | http://localhost:8000      |
| API docs | http://localhost:8000/docs |

Or run the services directly (needs a reachable Postgres + Redis):

```bash
make web      # Vue dev server
make api      # FastAPI with hot reload
make worker   # ARQ background worker
```

Tests and checks:

```bash
make test-web     # Vitest unit tests
make test-api     # pytest backend tests
make typecheck    # vue-tsc + TypeScript
make test         # unit tests + Playwright e2e
```

To try the production image built from source: `make prod-build`.

## Releasing

Releases are cut from the Actions tab:

1. **Actions → Release → Run workflow** — pick the branch to release (usually `dev`) and enter the version (`0.2.0`, leading `v` optional).
2. The workflow runs the test suite, builds the image for `linux/amd64` and `linux/arm64`, pushes `:0.2.0`, `:0.2` and `:latest` to GHCR, tags the commit `v0.2.0`, and opens the GitHub Release with the compose file and env template attached.

Prerelease versions like `0.2.0-rc.1` are marked as such and don't move `:latest`.

A nightly job builds the `dev` branch (~03:00 UTC) and publishes `:dev` + `:dev-<sha>` — the bleeding-edge image. Try it with `HOMST_VERSION=dev docker compose -f docker-compose.prod.yml up -d`.

The local equivalents (same Dockerfile):

```bash
docker login ghcr.io             # PAT with write:packages
make image VERSION=0.2.0         # build for this machine only
make release VERSION=0.2.0       # multi-arch buildx push (PLATFORMS=…)
make image-save VERSION=0.2.0    # homst-image-0.2.0.tar.gz for offline installs
```

## Contributing

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`
2. Make your changes and keep the tests green: `make test-web` and `make test-api`
3. Open a pull request against `dev`

Bug reports, feature ideas, and feedback are welcome via [GitHub Issues](https://github.com/mrkprdo/homst/issues).

## License

HOMST is licensed under the [GNU Affero General Public License v3.0](LICENSE). Copyright (c) 2026 HOMST Contributors.
