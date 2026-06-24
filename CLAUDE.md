# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Home Assistant custom integration (`domain: ha_alarm`) that provides a fully local alarm control panel with a built-in sidebar configuration UI. Distributed via HACS. No external dependencies — all state lives in HA config entries.

## Installation / development loop

There is no build step. Development workflow:

1. Copy `custom_components/ha_alarm/` into your HA instance's `config/custom_components/` directory (or symlink it).
2. Restart Home Assistant to pick up Python changes.
3. For frontend-only changes to `ha_alarm_panel.js`, a browser hard-refresh is enough (the static path is registered with `cache_headers=False`).

To bump the version, edit `manifest.json` → `"version"`.

## Architecture

The integration has two configuration paths that must stay in sync:

- **`config_flow.py`** — HA's built-in options flow UI (Settings → Devices & Services). Used during initial setup and as a fallback options editor. Writes to `entry.data` (initial) or `entry.options` (subsequent).
- **`http_views.py`** — REST API consumed by the sidebar panel. Each view writes directly to `entry.options` via `hass.config_entries.async_update_entry`. Sets `API_UPDATE_FLAG` before every write so the `_async_update_listener` in `__init__.py` skips the reload that would normally fire on options change.

**Config is always read as `{**entry.data, **entry.options}`** — options overlay data so API saves are non-destructive and don't require a reload.

### Python layer

| File | Role |
|---|---|
| `__init__.py` | Integration setup: registers static paths, HTTP views, and the sidebar panel once per HA instance. Forwards to the `alarm_control_panel` platform. |
| `alarm_control_panel.py` | `HaAlarmPanel` — the core entity. Implements the HA `AlarmControlPanelEntity` + `RestoreEntity`. Owns the state machine, sensor subscriptions, timers, siren calls, and notification dispatch. |
| `http_views.py` | One `HomeAssistantView` subclass per config section. All views call `_update()` which sets `API_UPDATE_FLAG` then `async_update_entry`. |
| `config_flow.py` | Standard HA config/options flow. `HaAlarmConfigFlow` for initial setup; `HaAlarmOptionsFlow` for re-configuration via the HA UI. |
| `const.py` | All string keys, mode constants, event names, defaults, and `MODE_SENSOR_CLASSES` (device-class hints per arm mode). |

### State machine (`HaAlarmPanel`)

States: `DISARMED → ARMING → ARMED_* → PENDING → TRIGGERED → DISARMED`

- **Timers** (`self._timer`) drive the ARMING exit-delay and PENDING entry-delay countdowns, and the TRIGGERED auto-timeout. There is always at most one active timer; `_cancel_timer()` is called before setting a new one.
- **Siren repeat** uses `async_track_time_interval` (stored in `_siren_repeat_unsub` / `_pending_repeat_unsub`). Both are cancelled via `_cancel_repeats()` before any state transition that changes the sound.
- **Sensor subscriptions** are set up in `_subscribe_sensors(mode)` after the exit delay completes and torn down in `_unsubscribe_sensors()` on any arm exit. `_sensor_changed` fires the pending/trigger path.
- **Chime subscriptions** (`_subscribe_chime`) are separate from alarm sensors and refreshed on every config update via `_async_config_updated`.
- On HA restart, `async_added_to_hass` restores state via `RestoreEntity`. Transient states (ARMING, PENDING, TRIGGERED) are not restored — the panel wakes disarmed if it was mid-cycle.

### Frontend

`frontend/ha_alarm_panel.js` — a single-file vanilla JS custom element (`<ha-alarm-panel>`). Registered as a sidebar panel pointing at `/ha_alarm_static/ha_alarm_panel.js`. It:

- Calls `GET /api/ha_alarm/config` on load to populate all sections.
- Calls the appropriate `POST /api/ha_alarm/*` endpoint when each section is saved.
- Uses the HA WebSocket connection (`window.hassConnection`) to subscribe to state changes for the alarm entity and live-update the status display.

### REST API endpoints

| Method | URL | Purpose |
|---|---|---|
| GET | `/api/ha_alarm/config` | Full config snapshot (no secrets — codes are name+is_admin only) |
| POST | `/api/ha_alarm/sensors` | Replace sensor lists for all modes |
| POST | `/api/ha_alarm/delays` | Replace entry/exit delays for all modes |
| POST | `/api/ha_alarm/notifications` | Replace notification config |
| POST | `/api/ha_alarm/general` | Replace general/siren settings |
| POST | `/api/ha_alarm/chime` | Replace chime settings |
| POST | `/api/ha_alarm/bypass/add` | Add a sensor bypass (`sensor_id`, `duration`) |
| POST | `/api/ha_alarm/bypass/remove` | Remove a sensor bypass |
| POST | `/api/ha_alarm/codes/add` | Add a user code (hashed server-side with random salt) |
| POST | `/api/ha_alarm/codes/remove` | Remove a user code (refuses to remove last admin) |

### Security

PIN codes are never stored in plaintext. `_hash_code(code, salt)` is SHA-256(`salt + code`); each user gets a unique `secrets.token_hex(16)` salt. The config API returns names and `is_admin` only.

## Key invariants

- **`API_UPDATE_FLAG`** must be set before every `async_update_entry` call from `http_views.py`. Without it, the update listener in `__init__.py` will reload the integration, resetting in-memory state.
- The config-entry options flow (`config_flow.py`) does NOT set `API_UPDATE_FLAG`, so saving via that path triggers a reload. This is intentional — the flow is for infrequent changes.
- At least one admin code must always exist. Both `HaAlarmCodesRemoveView` and `async_step_remove_code` enforce this.
- Bypass `until` values: `0` = one cycle (cleared on next disarm), `-1` = indefinite, positive int = Unix timestamp expiry.
