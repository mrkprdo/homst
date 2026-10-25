# HOMST

HOMST is a self-hosted dashboard for a shared household. It runs on a wall-mounted touch display and shows the calendar, tasks, and daily schedule.

<p align="center">
  <img width="640" alt="HOMST home screen" src="docs/screenshots/desktop-home.png" />
</p>

## Features

- **Shared calendar**: Month, week, and day views. Create events, assign persons, and set recurrence. Includes public holidays.
- **Task board**: To Do, Doing, and Done columns. Tasks have priorities, due dates, and assignees.
- **Today**: Daily schedule, current weather, and upcoming tasks.
- **Household members**: Color-coded profiles. All members have the same permissions.
- **Live updates**: Server-sent events keep every screen in sync.
- **Announcements**: Send a message from a display or phone. It appears on all screens and can arrive as a Web Push notification. Set an expiry time or keep it until removed.
- **Reminders**: Web Push notifications to phones and displays. No third-party push account is needed.
- **Extras**: Spotify now playing with synced lyrics, photo frame, ICS export, dark/light mode with sunrise/sunset switching, and a mobile view.

**Stack:** Vue 3 with Vite (TypeScript), FastAPI with PostgreSQL and Redis, Docker Compose with nginx.

## Screenshots

<table align="center">
  <tr>
    <td align="center">
      <img width="330" alt="Calendar month view" src="docs/screenshots/desktop-calendar.png" />
      <br /><em>Calendar</em>
    </td>
    <td align="center">
      <img width="330" alt="Task board" src="docs/screenshots/desktop-tasks.png" />
      <br /><em>Task board</em>
    </td>
    <td align="center" rowspan="2">
      <img width="180" alt="Mobile agenda view" src="docs/screenshots/mobile-agenda.png" />
      <br /><em>Mobile</em>
    </td>
  </tr>
  <tr>
    <td align="center">
      <img width="330" alt="Reminder heads-up display" src="docs/screenshots/desktop-reminder.png" />
      <br /><em>Reminder</em>
    </td>
    <td align="center">
      <img width="330" alt="Announcement toast" src="docs/screenshots/desktop-announcement.png" />
      <br /><em>Announcement</em>
    </td>
  </tr>
</table>

## Install

HOMST is one container image plus PostgreSQL. The image includes nginx, the web app, API, worker, and Redis. No config file is required.

### Requirements

- Docker Compose v2.24 or later (Docker Desktop or Docker Engine with the Compose plugin).
- A host that stays on. A small server, NAS, or Raspberry Pi is enough. Supports `linux/amd64` and `linux/arm64`.
- The host's LAN IP. Examples use `192.168.1.50`.

Examples use bash. On Windows, use PowerShell or cmd.

### 1. Get the compose file

```bash
mkdir homst && cd homst
curl -fLO https://github.com/mrkprdo/homst/releases/latest/download/docker-compose.prod.yml
# or
wget https://github.com/mrkprdo/homst/releases/latest/download/docker-compose.prod.yml
```

For another release, replace `latest` with the tag:

```bash
curl -fLO https://github.com/mrkprdo/homst/releases/download/v0.2.0/docker-compose.prod.yml
```

### 2. Configure (optional)

To change defaults, copy the template to `.env` next to the compose file:

```bash
curl -fLO https://github.com/mrkprdo/homst/releases/latest/download/env.example
cp env.example .env
```

Docker Compose reads `.env` automatically. The template documents every key.

- **Image tag**: `latest` (default), `dev` (nightly), `dev-<sha>` (specific nightly), or `x.y.z` (pinned). Change `HOMST_VERSION` and redeploy.
- **Environment variables**: These override `.env`. If a tag is wrong, remove `HOMST_VERSION`: `unset HOMST_VERSION` (bash), `Remove-Item Env:\HOMST_VERSION` (PowerShell), or `set HOMST_VERSION=` (cmd).
- **Older installs**: `.env.prod` is read first, but `.env` wins. Move its contents to `.env`.

On Windows, use `Copy-Item env.example .env` (PowerShell) or `copy env.example .env` (cmd).

### 3. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

On first start, HOMST:

1. Pulls the image.
2. Creates the database password in `homst_secrets` and initializes PostgreSQL.
3. Creates a local CA and HTTPS certificate in `homst_ssl`.
4. Starts the dashboard on HTTPS port 8443.

Later starts reuse the same data.

- To upgrade: `docker compose -f docker-compose.prod.yml pull`, then `docker compose -f docker-compose.prod.yml up -d`.
- For in-app updates, start the updater once: `docker compose -f docker-compose.prod.yml --profile updates up -d`. See [In-app updates](#in-app-updates-optional).
- To build from source: `make prod-build`.

### 4. Trust the HTTPS certificate

PWA installation and Web Push need a trusted certificate. Do this once per device.

Add your dashboard address to the certificate:

```bash
docker compose -f docker-compose.prod.yml exec homst homst-cert 192.168.1.50
```

For more addresses, separate them with commas: `homst-cert 192.168.1.50,192.168.1.51`. You can also set `HOMST_TLS_HOSTS=192.168.1.50` in `.env` before first start.

Then install the CA on each device:

1. Open `https://192.168.1.50:8443` and accept the warning once.
2. Open **Settings > Add to your devices > HTTPS certificate > Download** to save `homst-ca.pem` (or open `https://192.168.1.50:8443/ca.pem`).
3. Install the file as a trusted CA.

| Device        | Procedure                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android       | Open **Settings > Security & privacy > More security settings > Encryption & credentials > Install a certificate > CA certificate**. Select `homst-ca.pem`.                                                             |
| iPhone or iPad | Open the file. Install the profile: **Settings > General > VPN & Device Management**. Then open **Settings > General > About > Certificate Trust Settings** and enable full trust.                                    |
| Windows       | Double-click the file. Select **Install Certificate > Local Machine > Trusted Root Certification Authorities**.                                                                                                        |
| macOS         | Open **Keychain Access**. Select **System**. Move the file into the window. Open the file. Select **Always Trust**.                                                                                                    |
| Linux         | `sudo cp homst-ca.pem /usr/local/share/ca-certificates/homst.crt && sudo update-ca-certificates`<br>For Chrome or Chromium, also run: `certutil -d sql:$HOME/.pki/nssdb -A -t 'C,,' -n 'HOMST Local CA' -i homst-ca.pem` |

Reload the dashboard. The padlock should be valid.

### 5. Initial setup

The first visit starts a four-step wizard:

1. **Welcome**: Household name and address.
2. **Household members**: Add each person and assign a color.
3. **Holiday calendar**: Select a country (and optional state or province).
4. **All set**: Review and confirm.

### 6. Install the app

HOMST is a PWA. Install it on each display or phone, then enable notifications.

- **Android or Chrome**: Menu > **Install app** or **Add to Home screen**.
- **iPhone or iPad (Safari)**: **Share > Add to Home Screen**. Do this before Web Push (iOS 16.4 or later).
- **Desktop Chrome or Edge**: Select the install icon in the address bar.

Then open **Settings > Reminders > Phone & browser**, allow notifications, and use **Send test to all clients**. HOMST creates its own VAPID keys; no third-party push account is needed.

Web Push is one-way. Remote phones still receive notifications, but sending announcements or tests requires a LAN or VPN connection.

### In-app updates (optional)

The updater installs stable releases, keeps the previous image for rollback, and restores the last good build if a new version fails its health check.

Start it once:

```bash
docker compose -f docker-compose.prod.yml --profile updates up -d
```

The updater is the only container with Docker socket access and exposes no LAN port. **Settings > Software update** shows the current version, stable releases, history, and rollback controls.

To keep the profile enabled, remove the `#` from `COMPOSE_PROFILES=updates` in `.env`.

- Stable releases only. Dev, nightly, and pinned images need manual updates.
- Checks run every 5 minutes. Stable releases are offered one day after publication. Displays prompt before installing.
- Failed updates roll back and are not offered again.
- The previous image is kept. Run `docker image prune` when you no longer need rollback.

**Security:** HOMST has no login. Keep it on a trusted LAN, limit port 8443 to household devices, and never expose it to the internet. Defaults reject cross-origin writes and non-image uploads. The production port is `${HOMST_BIND_ADDR:-0.0.0.0}:8443`; set `HOMST_BIND_ADDR` to narrow it. See [SECURITY.md](SECURITY.md) for the threat model and hardening checklist.

The first release with the updater must be installed manually. Older images do not have it.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

For nightly builds, set the tag in `.env` and update manually:

```bash
HOMST_VERSION=dev
```

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Use `dev-<sha>` for a specific nightly. Make a backup before switching back to stable.

The updater pulls anonymously, so the GitHub repo and GHCR package must be public. Rootless Docker or Podman users can set `HOMST_DOCKER_SOCKET=/path/to/docker.sock`.

### Upgrade, data, and reset

Data lives in four volumes:

- `pg_data`: database
- `photo_uploads`: photos
- `homst_ssl`: certificates
- `homst_secrets`: database password

The updater adds `homst_updater_state` for job history; it contains no household data.

To back up, stop the stack and archive the database volume:

```bash
docker compose -f docker-compose.prod.yml down
```

```bash
docker run --rm -v homst-prod_pg_data:/from -v "$PWD":/to alpine tar czf /to/pg_data.tgz -C /from .
```

To reset everything, run `docker compose -f docker-compose.prod.yml down -v`. This deletes the database, photos, certificates, and password.

Logs: `docker compose -f docker-compose.prod.yml logs -f homst`. With the updater active, also run `docker compose -f docker-compose.prod.yml logs -f updater`.

### Migration from the old multi-container stack

Earlier versions used five containers. Stop them with `make prod-down`, then start the new stack. `pg_data` and `photo_uploads` are reused; trust the new `ca.pem` once per device.

If `.env.prod` exists, move its contents to `.env`; `.env` wins. Keep an existing `DATABASE_URL`. If you used the old template unchanged, set `DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@postgres:5432/homst`.

## Develop

You need Bun 1.0+, Python 3.12+, Docker Compose v2, and Node.js with OpenSSL.

Do not run `cp .env.dev .env` in a checkout with a production `.env`; use a separate checkout.

```bash
cp .env.dev .env
make cert   # nginx/ssl certificates for the dev HTTPS proxy
make dev    # dev stack
```

| Service  | URL                        |
| -------- | -------------------------- |
| Frontend | http://localhost:5173      |
| API      | http://localhost:8000      |
| API docs | http://localhost:8000/docs |

To run services directly, provide PostgreSQL and Redis:

```bash
make web
make api
make worker
```

Tests:

```bash
make test-web     # Vitest (100% line coverage)
make test-api     # pytest (100% line coverage)
make typecheck    # vue-tsc + TypeScript
make test         # unit + Playwright e2e
```

To test the production image, run `make prod-build`.

## Release

Open **Actions > Release > Run workflow**.

1. Choose **bump** (`patch`, `minor`, or `major`) or enter a **version**. A version overrides **bump**.
2. To release another branch, change **ref** from `dev`.

Or use the CLI:

```bash
gh workflow run release.yml -f bump=minor
gh workflow run release.yml -f version=0.3.0-rc.1
```

Build behavior:

- `dev` creates nightly `:dev` and `:dev-<sha>` images.
- A stable tag creates `:x.y.z`, `:x.y`, and `:latest`, runs tests, builds multi-arch images, and publishes a GitHub Release.

Pushing a release tag does the same:

```bash
git checkout dev
git tag 0.3.0
git push origin 0.3.0
```

Prerelease tags do not move `:latest`. If a run fails, delete the tag and rerun Release.

The nightly schedule builds `dev` at 03:00 UTC.

Local commands:

```bash
docker login ghcr.io             # PAT with write:packages
make image VERSION=0.2.0         # local build
make release VERSION=0.2.0       # multi-arch buildx push (PLATFORMS=…)
make image-save VERSION=0.2.0    # offline image archive
```

## Contribute

1. Fork the repo and create a branch: `git checkout -b feat/your-feature`.
2. Make changes and keep tests passing: `make test-web` and `make test-api`.
3. Open a pull request against `dev`.

Use GitHub Issues for bugs, ideas, and feedback.

## License

HOMST uses the [GNU Affero General Public License v3.0](LICENSE). Copyright (c) 2026 HOMST Contributors.
