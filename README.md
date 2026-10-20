# HOMST

HOMST is a self-hosted dashboard for shared households. You can install it on a wall-mounted touch display. The dashboard shows the household calendar, tasks, and schedule. You do not need to ask other persons about the daily schedule.

> The display is inactive by default. It becomes active when you touch it.

![HOMST home screen](docs/screenshots/desktop-home.png)

## Features

- **Shared calendar**: The calendar has month, week, and day views. You can create events, assign persons, and set recurrence. The calendar shows public holidays for each country.
- **Task board**: The task board has To Do, Doing, and Done columns. Tasks have priorities, due dates, and assignees.
- **Today**: The home screen shows the daily schedule, current weather, and tasks that are due soon.
- **Household members**: Household members have color-coded profiles. All members have the same permissions.
- **Real-time updates**: Server-sent events send each change to all connected screens immediately.
- **Reminders**: HOMST sends Web Push notifications to phones and displays. You do not need a third-party push account.
- **Other functions**: HOMST also has Spotify now playing, a household photo frame, ICS export, dark and light mode, and a mobile view.

**Stack:** Vue 3 with Vite (TypeScript), FastAPI with PostgreSQL and Redis, Docker Compose with nginx.

## Screenshots

| Calendar                                                      | Task board                                        |
| ------------------------------------------------------------- | ------------------------------------------------- |
| ![Calendar month view](docs/screenshots/desktop-calendar.png) | ![Task board](docs/screenshots/desktop-tasks.png) |

<p align="center">
  <img width="300" alt="Mobile agenda view" src="docs/screenshots/mobile-agenda.png" />
</p>

## Install

HOMST is one container image and a PostgreSQL sidecar. The image contains nginx, the single-page application, the API (application programming interface), the worker, and Redis. The first start configures the system. You do not need a configuration file.

### Requirements

- You need Docker Compose v2.24 or later. You can use Docker Desktop or Docker Engine with the Compose plugin.
- You need a machine that stays on. A small server, network-attached storage (NAS), or Raspberry Pi is sufficient. HOMST supplies images for `linux/amd64` and `linux/arm64`.
- You need the local area network (LAN) IP address of the host. The examples in this document use `192.168.1.50`.

The command examples use bash. On Windows, use the equivalent PowerShell or cmd commands.

### 1. Get the compose file

Download the compose file from the latest release:

```bash
mkdir homst && cd homst
curl -fLO https://github.com/mrkprdo/homst/releases/latest/download/docker-compose.prod.yml
# or
wget https://github.com/mrkprdo/homst/releases/latest/download/docker-compose.prod.yml
```

To use a different release, replace `latest` with the release tag. This example uses release `v0.2.0`:

```bash
https://github.com/mrkprdo/homst/releases/download/v0.2.0/docker-compose.prod.yml
```

### 2. Configure (optional)

Configuration is optional. To change the default values, download the template and copy it to `.env` next to the compose file:

```bash
curl -fLO https://github.com/mrkprdo/homst/releases/latest/download/env.example
cp env.example .env
```

Docker Compose reads `.env` automatically. The file sets the image tag (`HOMST_VERSION`) and the environment of the HOMST container. The environment includes the database, Redis, and Transport Layer Security (TLS) host names. It also includes cross-origin resource sharing (CORS), Spotify, Google Calendar, VAPID, and in-app update settings. The template describes each key.

- **Image tag**: `latest` is the stable release and the default. `dev` is the nightly build. `dev-<sha>` is a specified nightly build. `x.y.z` is a pinned release. Change `HOMST_VERSION`. Then run `docker compose -f docker-compose.prod.yml pull` and `docker compose -f docker-compose.prod.yml up -d`.
- **Environment variables**: Environment variables have priority over `.env`. If Docker Compose uses an incorrect tag, remove `HOMST_VERSION` from the environment. Use `unset HOMST_VERSION` in bash, `Remove-Item Env:\HOMST_VERSION` in PowerShell, or `set HOMST_VERSION=` in cmd.
- **Older installations**: An older installation can contain a `.env.prod` file. Docker Compose reads this file first, but `.env` has priority. Move the contents to `.env`. Then delete `.env.prod`.

On Windows, use `Copy-Item env.example .env` in PowerShell or `copy env.example .env` in cmd.

### 3. Start the stack

```bash
docker compose -f docker-compose.prod.yml up -d
```

At the first start, the stack does these steps:

1. It pulls the image.
2. It generates the database password and writes the password to the `homst_secrets` volume.
3. It initializes PostgreSQL with the password.
4. It generates a local certificate authority (CA) and an HTTPS certificate. It writes them to the `homst_ssl` volume.
5. It starts the dashboard on HTTPS port 8443.

Later starts use the same data.

- To upgrade, run `docker compose -f docker-compose.prod.yml pull`. Then run `docker compose -f docker-compose.prod.yml up -d`.
- In-app updates are optional. Start the updater profile one time: `docker compose -f docker-compose.prod.yml --profile updates up -d`. Then use **Settings > Software update** to examine available releases, install a release, or roll back a release. Refer to [In-app updates](#in-app-updates-optional).
- To build from source, run `make prod-build` from the repository root.

### 4. Trust the HTTPS certificate

Browsers permit Progressive Web App (PWA) installation and push notifications only with a trusted certificate. Do this step one time for each device. HOMST generates and serves its own CA.

First, add the address that you use for the dashboard to the certificate. If you do not add the address, the browser shows a name mismatch after you trust the CA.

```bash
docker compose -f docker-compose.prod.yml exec homst homst-cert 192.168.1.50
```

To add more addresses, separate them with commas: `homst-cert 192.168.1.50,192.168.1.51`. If you issue the certificate again, the CA stays the same. Devices do not need to trust the CA again. You can also set `HOMST_TLS_HOSTS=192.168.1.50` in `.env` before the first start.

Then install the CA on each device:

1. Open `https://192.168.1.50:8443`. Accept the browser warning one time.
2. Open **Settings > Add to your devices > HTTPS certificate > Download**. The browser saves `homst-ca.pem`. You can also open `https://192.168.1.50:8443/ca.pem`.
3. Install the file as a trusted CA. Refer to the table.

| Device        | Procedure                                                                                                                                                                                                              |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Android       | Open **Settings > Security & privacy > More security settings > Encryption & credentials > Install a certificate > CA certificate**. Select `homst-ca.pem`.                                                             |
| iPhone or iPad | Open the file. Install the profile: **Settings > General > VPN & Device Management**. Then open **Settings > General > About > Certificate Trust Settings** and enable full trust.                                    |
| Windows       | Double-click the file. Select **Install Certificate > Local Machine > Trusted Root Certification Authorities**.                                                                                                        |
| macOS         | Open **Keychain Access**. Select **System**. Move the file into the window. Open the file. Select **Always Trust**.                                                                                                    |
| Linux         | `sudo cp homst-ca.pem /usr/local/share/ca-certificates/homst.crt && sudo update-ca-certificates`<br>For Chrome or Chromium, also run: `certutil -d sql:$HOME/.pki/nssdb -A -t 'C,,' -n 'HOMST Local CA' -i homst-ca.pem` |

Reload the dashboard. The padlock is now valid.

### 5. Initial setup

The first visit opens a four-step setup wizard:

1. **Welcome**: Enter the household name. You can also enter the address.
2. **Household members**: Add each person who lives in the household. Each person gets a color for calendars, tasks, and profiles.
3. **Holiday calendar**: Select the country. You can also select a state or province. HOMST adds public holidays automatically.
4. **All set**: Examine the data and confirm.

The home screen opens after the wizard. Use the navigation to open the other screens. Use the gear icon to open Settings.

### 6. Install it as an app

HOMST is a PWA. Install it on each display or phone. Then enable notifications.

- **Android or Chrome**: Open the menu. Select **Install app** or **Add to Home screen**.
- **iPhone or iPad (Safari)**: Select **Share > Add to Home Screen**. You must do this before Web Push can operate (iOS 16.4 or later). Open the installed app.
- **Desktop Chrome or Edge**: Select the install icon in the address bar.

Then open **Settings > Reminders > Phone & browser**. Permit notifications. Use **Send test to all clients** to test the configuration. HOMST generates its own VAPID keys and stores them in the database. You do not need a third-party push account.

### In-app updates (optional)

The updater does these operations:

- It checks the official stable release feed.
- It installs the exact release image.
- It keeps the previous image for rollback.
- It restores the last known good build if a new version fails the health check.

Start the updater sidecar one time:

```bash
docker compose -f docker-compose.prod.yml --profile updates up -d
```

The sidecar is the only container with access to the Docker socket. It does not expose a port to the LAN. Docker Compose skips the sidecar when you disable the `updates` profile. When the profile operates, **Settings > Software update** shows the current version and available stable releases. It also shows the version history, rollback controls, and update-check settings.

To keep the profile enabled for later Docker Compose commands, uncomment `COMPOSE_PROFILES=updates` in `.env`. You can also run `make prod-updates`.

- The updater installs only official stable releases. You cannot install dev builds, nightly builds, or pinned images from the Software update screen. Use the manual commands in the update card.
- Update checks operate by default when the updater is available. The default interval is 5 minutes. You can change the interval in Settings. A stable release is offered one day after it is published, which leaves time to publish a hotfix first. When a new stable release is available, connected display clients show a **New version available** message with Yes and No options.
- If you select Yes, HOMST installs the release immediately. If you select No, HOMST hides the message for that version. The update stays visible in **Settings > Software update**. A later release shows a new message. HOMST does not install an update without your agreement.
- If an update fails, HOMST automatically rolls back. HOMST holds the failed version and does not offer it again. A later stable release starts the prompts again.
- HOMST keeps the previous stable image. It does not delete the image automatically. If you need disk space, delete unused images with `docker image prune`. Do this when you do not need a rollback.
- HOMST has no login. All persons who can open the dashboard can start an update. Keep the dashboard on a trusted LAN. Do not expose port 8443 to the internet.

The first release with this function must be installed manually. Older images do not have the updater.

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Nightly builds are not managed with the updater. Set the tag in `.env`. Then update manually:

```bash
# .env next to the compose file
HOMST_VERSION=dev

# then
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Use `HOMST_VERSION=dev-<sha>` for a specified nightly build. Set the value to `latest` or delete the line to use the stable channel. Nightly builds can contain database changes that stable releases do not contain. Make a backup before you change to the stable channel.

The updater pulls images anonymously. The GitHub repository and the GitHub Container Registry (GHCR) package must be public. HOMST does not store a registry token or a GitHub key. If you publish the project, set the package visibility to public one time. Use **Package settings > Change visibility > Public** in GitHub.

Rootless Docker or Podman users can set a different socket with `HOMST_DOCKER_SOCKET=/path/to/docker.sock` in `.env`.

### Upgrade, data, and reset

Data is in four volumes:

- `pg_data`: database.
- `photo_uploads`: photos.
- `homst_ssl`: certificates.
- `homst_secrets`: database password.

The optional updater adds `homst_updater_state` for job history and held-version data. This volume does not contain household data.

To make a backup, stop the stack:

```bash
docker compose -f docker-compose.prod.yml down
```

Then run this command:

```bash
docker run --rm -v homst-prod_pg_data:/from -v "$PWD":/to alpine tar czf /to/pg_data.tgz -C /from .
```

To start again from an empty state, run `docker compose -f docker-compose.prod.yml down -v`. This command deletes the database, photos, certificates, and password.

To examine the logs, run `docker compose -f docker-compose.prod.yml logs -f homst`. When the updater profile operates, also run `docker compose -f docker-compose.prod.yml logs -f updater`.

### Migration from the old multi-container stack

Earlier versions used five containers and served `web/dist` from the host. Stop the old containers with `make prod-down`. This command removes the old `api`, `worker`, `nginx`, and `redis` containers as orphans. Start the new stack. The system reuses `pg_data` and `photo_uploads`, so it keeps the household data. You must trust the new `ca.pem` one time on each device.

An installation that still has `.env.prod` continues to operate. Docker Compose reads `.env.prod` first, but `.env` has priority when both files exist. Move the contents to `.env`. Then delete `.env.prod`. If the old stack used a `DATABASE_URL`, keep it to continue with the current database. If you used the old stack with a template that you did not change, the password is `yourpassword`. Set `DATABASE_URL=postgresql+asyncpg://postgres:yourpassword@postgres:5432/homst` in `.env`.

## Develop

To develop HOMST, you need these tools:

- Bun 1.0 or later.
- Python 3.12 or later.
- Docker with Compose v2.
- Node.js with OpenSSL for certificate generation.

Do not run `cp .env.dev .env` in a checkout that has a production `.env`. The command replaces the file. Use a separate checkout.

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

To run the services directly, you need a PostgreSQL server and a Redis server. The services must be able to connect to them.

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

To test the production image that you build from source, run `make prod-build`.

## Release

The Build workflow does all release operations:

- **`dev`** produces nightly images `:dev` and `:dev-<sha>`.
- **A tag** produces release images `:x.y.z`, `:x.y`, and `:latest` for stable tags.

1. Open **Actions > Build > Run workflow**. Select `dev` or the release branch in the **Use workflow from** list.
2. For a release, create a version branch and run Build on the branch. You do not need a version input:
   ```bash
   git checkout dev
   git checkout -b 0.2.0
   git push origin 0.2.0
   ```
   Select `0.2.0` in the Build workflow. The workflow creates and pushes the `v0.2.0` tag, builds the release image, and publishes the GitHub Release. You can also use a branch with a different name. The HEAD of the branch must have a semantic-version tag such as `v0.2.0`.
3. The workflow runs the test suite. It builds images for `linux/amd64` and `linux/arm64`. It pushes the image tags. It creates or updates the GitHub Release for the tag. It attaches the compose file and the environment template.

Prerelease tags such as `v0.2.0-rc.1` are prereleases. They do not move the `:latest` tag.

The nightly schedule builds `dev` at 03:00 UTC. It publishes `:dev` and `:dev-<sha>`. To use a nightly build, set `HOMST_VERSION=dev` in `.env`. Then run `docker compose -f docker-compose.prod.yml pull` and `docker compose -f docker-compose.prod.yml up -d`.

The local commands use the same Dockerfile:

```bash
docker login ghcr.io             # PAT with write:packages
make image VERSION=0.2.0         # build for this machine only
make release VERSION=0.2.0       # multi-arch buildx push (PLATFORMS=…)
make image-save VERSION=0.2.0    # homst-image-0.2.0.tar.gz for offline installs
```

`docker login ghcr.io` needs a personal access token (PAT) with `write:packages`.

## Contribute

1. Fork the repository and create a branch: `git checkout -b feat/your-feature`.
2. Make your changes. Keep the tests green. Run `make test-web` and `make test-api`.
3. Open a pull request against `dev`.

Use GitHub Issues for bug reports, feature ideas, and feedback.

## License

HOMST uses the [GNU Affero General Public License v3.0](LICENSE). Copyright (c) 2026 HOMST Contributors.
