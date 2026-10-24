# Security policy

HOMST is a self-hosted household dashboard. It is designed to run on a trusted
home network and it deliberately has no user accounts or login. This document
describes the threat model, the controls that ship with HOMST, and the steps an
operator must take to keep an installation safe.

## Supported versions

| Version | Supported |
| --- | --- |
| Latest stable release (`latest`) | Yes — security fixes are released here |
| Previous stable release | Best effort, until the next stable is published |
| Nightly builds (`dev`, `dev-<sha>`) | No — development snapshots, use at your own risk |
| Older releases | No |

Only images published from this repository (`ghcr.io/mrkprdo/homst`) are
supported. Reporting a problem in a modified image or a fork is out of scope.

## Reporting a vulnerability

Please report vulnerabilities privately. Do **not** open a public GitHub issue
for a suspected security problem, and do not publish proof-of-concept details
before a fix is available.

- Use GitHub's private vulnerability reporting on this repository:
  **Security → Advisories → Report a vulnerability**. This is the preferred
  channel because it keeps the report, discussion, and fix private.
- If you cannot use GitHub, open a minimal issue asking for a private contact
  channel. Do not include exploit details in that issue.

What to expect:

- Acknowledgement of the report within 7 days.
- An initial assessment (severity, affected versions, whether a fix is
  feasible) within 14 days.
- A coordinated disclosure: a fix and a GitHub Security Advisory with credit
  when the reporter wants it. Timelines depend on severity and complexity;
  you will be kept informed.
- Please include the affected version (`Settings → Software update` or the
  image tag), deployment details (Compose, host OS, reverse proxy), and
  reproduction steps.

Please act in good faith: only test against your own installation, do not
access other people's data, and do not run denial-of-service tests.

## Threat model

**Trusted LAN, no authentication by design.** HOMST assumes that everyone who
can reach the dashboard is a member of the household and is allowed to see and
change everything. There is no login, no roles, and no per-person permissions:
anyone who can open the dashboard can read the calendar and photos, post
announcements, and trigger a software update.

Consequences that are accepted by design:

- The dashboard and `/api` are fully usable by any client that can reach
  port 8443.
- Web Push endpoints registered by a browser are stored and used to send
  notifications; this is how HOMST avoids a third-party push account.
- The dashboard links out to optional third-party widgets (Spotify, Google
  Calendar, weather, holidays). Those integrations see only the requests the
  browser or server makes to them.

Out of scope for this model:

- Multi-tenant hosting, internet-facing deployments, zero-trust networks.
- An attacker who already controls the host, the Docker socket, or the LAN.
- Physical access to the server or to an unlocked display.
- Malicious household members (they are, by definition, fully trusted).

## Controls enforced by HOMST

These are the defaults in the shipped configuration. They reduce the blast
radius of a mistake; they do not replace network isolation.

- **CORS is closed by default.** `CORS_ALLOW_ALL=false` in `.env.example`, so
  the API only answers cross-origin requests from `ALLOWED_ORIGINS`. The
  dashboard is served same-origin and needs no CORS exception at all.
- **Same-origin writes.** State-changing API requests are only accepted from
  the dashboard's own origin, so another site cannot silently drive a HOMST
  instance through the browser.
- **Image-only uploads.** The photo endpoint accepts image payloads (and
  re-encodes/resizes them) instead of storing arbitrary files, and nginx caps
  request bodies at 12 MB (the API applies its own 10 MB image limit).
- **Content-Security-Policy and hardening headers.** Responses carry a CSP
  that restricts scripts, styles, frames, and connections, plus
  `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and
  `Referrer-Policy: strict-origin-when-cross-origin`.
- **Push allow-list.** Only endpoints accepted by the push allow-list are
  stored and used for Web Push, so the API cannot be turned into a generic
  notification relay.
- **Rate limits.** Write endpoints and outbound update checks are rate
  limited to blunt accidental loops and trivial abuse from a compromised
  client.
- **Host-only dev ports.** In `docker-compose.dev.yml`, PostgreSQL, Redis, the
  API, and the Vite dev server are published on `127.0.0.1` only. The nginx
  dev port `8999` stays reachable on the LAN for mobile testing and is
  documented as such.
- **Configurable bind address.** The production port is published as
  `${HOMST_BIND_ADDR:-0.0.0.0}:8443`, so the listener can be narrowed without
  editing the compose file.
- **No secrets in images.** The database password is generated at first boot
  into the `homst_secrets` volume; the TLS key and CA stay in `homst_ssl`.
  `.env` holds configuration only and must not be committed.

## Deployment hardening checklist

1. **Firewall port 8443 to the LAN.** Allow only household devices/subnets,
   for example `sudo ufw allow from 192.168.1.0/24 to any port 8443 proto tcp`
   and deny the rest. Do not rely on the compose file alone.
2. **Never expose HOMST to the WAN.** Do not port-forward 8443, and do not
   put it behind a public reverse proxy or a tunnel. If you need remote
   access, use a VPN (WireGuard, Tailscale, …) and keep the trust boundary at
   the household.
3. **Trust the generated CA only on household devices.** Download `ca.pem`
   from **Settings → Add to your devices → HTTPS certificate** and install it
   on your own phones, tablets, and browsers. Do not distribute the CA or its
   key outside the household; anyone who trusts it can be impersonated by
   whoever holds the key.
4. **Narrow the listeners (optional).** Set `HOMST_BIND_ADDR` to the host's
   LAN IP (or `127.0.0.1` if only the host itself needs access). Set
   `ALLOWED_HOSTS` to a comma-separated list of host names/IPs the dashboard
   is reached at to add a TrustedHost allow-list (include `localhost` and
   `127.0.0.1` so the container health check keeps working). Keep
   `CORS_ALLOW_ALL=false`.
5. **Treat the updater as root-equivalent.** The optional `updates` profile
   is the only container with the Docker socket mounted; whoever can call it
   can replace the HOMST container. Enable it only if you want in-app
   updates, keep the socket path private (`HOMST_DOCKER_SOCKET`), and
   remember that anyone on the LAN can trigger an update because there is no
   login. Prefer `HOMST_SELF_UPDATE_DISABLED=true` if you would rather
   upgrade manually.
6. **Pin what you run.** Prefer a pinned release tag (`HOMST_VERSION=x.y.z`)
   over `latest`/`dev` for reproducible installs, and review upgrades before
   applying them. Image digest pinning and signature verification are a
   planned follow-up: HOMST currently trusts the `ghcr.io/mrkprdo/homst`
   tag it pulls and does not verify an image signature before installing an
   update.
7. **Keep the host current.** Update Docker Engine, the host OS, and HOMST
   itself. Back up `pg_data`, `photo_uploads`, `homst_ssl`, and
   `homst_secrets` before upgrades (see the README) and test restores.
8. **Review what you expose.** `docker compose ps` should show only 8443
   published in production. In development, only `8999` may be LAN-reachable.
9. **Do not commit `.env`.** It may contain the Spotify/Google client secrets
   and a fixed database password. Rotate any value that leaks.

## Residual risk: no authentication is accepted

Running without authentication is a **residual risk that the project accepts
by design**, not a bug. It is what makes HOMST usable as an always-on wall
display and for non-technical household members. The mitigation is
architectural, not cryptographic: keep the dashboard on a trusted LAN, keep
port 8443 firewalled, and never route it from the internet.

If your situation requires authentication (shared building, student housing,
a server outside the home), HOMST is the wrong tool as-is: put it behind an
authenticating reverse proxy or a VPN that only your devices can reach, and
treat the dashboard itself as unauthenticated.
