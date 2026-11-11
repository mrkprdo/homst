# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Vue 3 and TypeScript with Vite; FastAPI; PostgreSQL and Redis; Docker Compose with nginx.

## Users

Household members sharing a dashboard. The primary scene is a wall-mounted touchscreen at home; phone use is secondary. Household members have the same permissions.

## Product Purpose

HOMST is a self-hosted dashboard for coordinating and checking the household’s day: schedule, calendar, tasks, weather, indoor temperatures, and optional music and photos. Success means household members can quickly see useful shared status without navigating separate personal accounts.

## Positioning

HOMST combines self-hosted household control with a shared, glanceable home-status view.

## Operating Context

The dashboard is used in a shared home, primarily from a wall-mounted touch display and secondarily from phones. The documented deployment has no login and is intended for a trusted LAN, not direct internet exposure.

## Capabilities and Constraints

- Shared calendar, tasks, daily schedule, weather, indoor temperatures, household profiles, live updates, announcements, and reminders.
- Optional Spotify now-playing, synced lyrics, photo frame, ICS export, and mobile view.
- Existing screens are responsive; the current global UI sets a 48px minimum size for touch controls.

## Evidence on Hand

The existing application and `docs/screenshots/desktop-home.png` show the current dashboard and its sample content. Product capabilities and deployment guidance are documented in `README.md`.

## Product Principles

- Make shared household status quick to understand.
- Keep the household in control through self-hosting.
- Serve the shared wall display first while retaining phone access.
- Keep the shared dashboard equally available to household members.
