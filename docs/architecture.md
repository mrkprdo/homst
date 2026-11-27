# HOMST architecture map

One household appliance: an nginx-served Vue SPA, a FastAPI API, a Postgres sidecar,
Redis for fan-out, and an ARQ worker. Everything is single-household today; the
`DEFAULT_HOUSEHOLD_ID` constant is the tenant boundary.

## Runtime topology

```
browser / kiosk / phone
  │  HTTPS 8443
  ▼
nginx (docker/nginx.conf, SPA + /api reverse proxy + /uploads)
  ├─ /              → web/dist (Vite build, PWA service worker)
  ├─ /api/v1/*      → gunicorn → uvicorn workers → FastAPI
  ├─ /api/stream    → SSE (Redis pub/sub, one channel per household)
  └─ /uploads/*     → photo files (7-day immutable cache)

FastAPI
  ├─ SQLAlchemy async → Postgres 16 (docker/compose sidecar)
  ├─ Redis            → SSE fan-out + ARQ queue
  └─ ARQ worker       → reminders, calendar sync, update checks
```

## Repository map

```
api/
  app/
    main.py            app wiring, startup migrations, static uploads
    config.py          env-backed settings
    db.py              async engine/session
    household.py       default household id + get-or-create (shared)
    models/all.py      SQLAlchemy models (single schema file)
    schemas/all.py     Pydantic request/response models
    routers/           one file per feature; all mounted in main.py
      bootstrap.py     one-shot hydration payload
      calendar.py      calendars + events (+ recurrence fields)
      tasks.py         task lists + tasks
      users.py         members
      holidays.py      Nager.Date sync
      photos.py        upload/normalise/list/select/delete
      announcements.py broadcast messages + optional push
      notifications.py in-app reminder feed
      push.py          Web Push subscriptions + VAPID
      nest.py          Nest thermostat integration
      camera.py        HLS camera proxy
      ai.py            Smart import (OpenCode gateway)
      settings.py      household settings, geocoding, camera secrets
      system.py        health/version/update controls
      stream.py        SSE endpoint
    notifications/     reminder scheduling + delivery (HUD, Web Push)
    updater/           in-app Docker updater sidecar
    events/            Redis publisher
    workers/           ARQ worker settings
  tests/               pytest (SQLite in-memory, 100% coverage gate)
  alembic/             migrations (plus safe startup shims in main.py)

web/
  src/
    App.vue            shell, kiosk timers, bootstrap, SSE status
    router/            onboarding vs. shell
    api/               typed fetch clients, one module per feature
    composables/       shared reactive stores (events, tasks, members, …)
    components/        home / calendar / kanban / settings / mobile / ui
    lib/               motion, layout, caches, bootstrap hydration
    __tests__/         vitest unit/component tests
  public/              PWA service worker, theme bootstrap, tokens

packages/design-tokens   generates web/public/{tokens,shadows}.css
docker/                  entrypoint, nginx, supervisord, secret + cert scripts
```

## Boot data path

Before this pass, a display opened ~12 HTTP requests before it was usable:

```
/api/health
/household/settings            (App.vue)
/household/settings            (HomeView.vue, duplicate)
/photos                        (only after settings resolved)
/task-lists  /tasks
/household/members
/calendars   /holidays
/events ×3                     (previous, current, next month)
```

Every reconnect also replayed the same fan-out (`sync.required`), because
`useStream.refreshAllStores()` refreshed each store separately.

Now:

```
GET /api/v1/bootstrap?from=…&to=…
GET /api/stream                (SSE, unchanged)
```

`/bootstrap` returns settings, members, photos, calendars, events for the
three-month window, task lists, tasks, holidays and active announcements in a
single response. The frontend hydrates every store from it (`web/src/lib/hydrate.ts`),
so boot and SSE resync use one round trip. `useEvents.prefetchAround()` now fetches
one three-month range instead of three month requests.

## Database map

| Table | Rows | Read pattern |
|---|---|---|
| `events` | per calendar | household calendars, date range, ordered by start |
| `calendars` | few | by household |
| `members` | few | by household |
| `task_lists` / `tasks` | dozens | by household / list, ordered by position |
| `photos` | ≤200 | by household, ordered by created_at |
| `holidays` | ~2 years | by household, ordered by date |
| `announcements` | ≤50 active | by household, newest first |
| `push_subscriptions` | per device | by household / endpoint |
| `reminder_log` | grows | unique (event, occurrence, channel) |
| `ai_conversations` | per Smart import | by id |
| `server_settings` | key/value | VAPID keys |

Indexes added in `models/all.py` and mirrored in the startup shims
(`main.py::_SAFE_MIGRATIONS`) so existing installs get them without a manual
migration:

- `events (calendar_id, start_at)`
- `tasks (list_id, position)`
- `task_lists (household_id, position)`
- `calendars (household_id)`
- `members (household_id)`
- `photos (household_id, created_at)`
- `holidays (household_id, date)`
- `push_subscriptions (household_id)`

Event and task list queries now join the parent table instead of first loading
the household's ids and passing them back in an `IN (...)`, removing a query
round trip per request.

## API surface

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/v1/bootstrap` | one-shot hydration (settings + all collections) |
| GET | `/api/health` | liveness probe |
| GET | `/api/v1/config` | public client config (Spotify client id) |
| GET | `/api/stream` | SSE household channel |
| CRUD | `/api/v1/calendars`, `/events` | calendar + event data |
| CRUD | `/api/v1/task-lists`, `/tasks` | kanban data |
| CRUD | `/api/v1/household/members` | members |
| GET/PATCH | `/api/v1/household/settings` | household settings |
| POST | `/api/v1/holidays/sync`, GET `/holidays` | holiday cache |
| CRUD | `/api/v1/photos` | photo slideshow |
| CRUD | `/api/v1/announcements` | broadcasts |
| … | `/api/v1/notifications`, `/push`, `/nest`, `/camera`, `/ai`, `/system` | feature endpoints |

## Duplicated / stale code found

- Five copies of `_ensure_household` / `_get_or_create_household` in separate
  routers → replaced by `app/household.py`.
- Every list endpoint repeated its own query; extracted `household_*` helpers so
  the bootstrap endpoint and the normal endpoints share one implementation.
- `HomeView.vue` fetched `/household/settings` again after `App.vue` already had
  it → removed; layout, address, geo and house name now live in `useSettings`.
- `refreshFromServer()` is now only exercised by tests; it remains as a manual
  refresh helper.
- `photos._resize_image()` is only used by tests; left in place as the documented
  re-encode helper for uploads.
- `nginx/nginx.prod.conf` is the legacy host-mount config (the image ships
  `docker/nginx.conf`), but it is still asserted by `test_deploy_config.py` and
  kept for host installs.

## Remaining opportunities

- `SettingsPanel` and `MemberDetailPanel` still fetch `/household/settings` when
  they open; they could read the hydrated store and only refetch on demand.
- `useTasks.ensureLoaded()` issues two requests (`/task-lists` + `/tasks`) when it
  runs outside the bootstrap; a `?include=tasks` query could collapse it.
- The reminders worker loads calendar ids before events; the new
  `(calendar_id, start_at)` index makes that cheap, but it could be a single join.
- `/bootstrap` is not cacheable; an ETag keyed on the household `updated_at`
  would let the browser revalidate with a 304 instead of a full payload.
