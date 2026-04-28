# HA Alarm

A fully local, custom alarm control panel for Home Assistant with a built-in sidebar configuration UI. No cloud, no external dependencies — everything runs inside your HA instance.

---

## Features

- **Five arm modes** — Away, Home, Night, Vacation, and Custom, each with independently configured sensors and entry/exit delays
- **Sensor management** — assign any binary sensor to any mode directly from the config panel
- **Sensor bypass** — bypass individual sensors for one arm cycle, a set duration, or indefinitely
- **User codes** — multiple PIN codes with admin/standard roles
- **Siren integration** — trigger a `siren` entity on alarm with configurable tone and volume
- **Chime mode** — play a tone on a siren entity when a chime sensor opens while the alarm is disarmed
- **Mobile notifications** — send alerts to any HA notify service on arm, disarm, trigger, and more
- **High-priority notifications** — Android (`ttl=0` / `priority=high`) and iOS (`time-sensitive` interruption level)
- **Custom notification messages** — override the default text per event with `{mode}`, `{sensor}`, and `{user}` placeholders
- **Sensor summary** — see all configured sensors grouped by mode at a glance; click any sensor to remove it
- **Fully local** — no external API calls; all state and config stored in HA config entries

---

## Installation

### Via HACS (recommended)

1. In Home Assistant, open **HACS → Integrations**
2. Click the three-dot menu (⋮) → **Custom repositories**
3. Add `https://github.com/mostlychris/ha_alarm` with category **Integration**
4. Search for **HA Alarm** and click **Download**
5. Restart Home Assistant

### Manual

1. Copy the `custom_components/ha_alarm` folder into your HA `config/custom_components/` directory
2. Restart Home Assistant

---

## Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **HA Alarm** and follow the prompts to give the alarm a name
3. A new **HA Alarm** entry appears in the sidebar — click it to open the config panel

---

## Configuration Panel

The sidebar panel has collapsible sections for every aspect of the alarm. All changes are saved immediately to HA config entries with no restart required.

### Sensors

Select which binary sensors are active for each arm mode using the mode tabs (Away / Home / Night / Vacation / Custom). Suggested sensors are pre-filtered by device class for each mode; other sensors are available under "Other sensors."

**Sensor Bypass** — temporarily disable a sensor without removing it from a mode:
| Duration | Behaviour |
|---|---|
| One arm cycle | Bypassed for the next arm → disarm cycle only |
| 24 hours / 7 days | Bypassed until the time expires |
| Indefinite | Bypassed until manually cleared |

### Sensor Summary

Shows every configured sensor grouped by mode. Sensors currently open are highlighted in red. Click any sensor chip to immediately remove it from that mode.

### Entry & Exit Delays

Set entry and exit delay times (in seconds) independently per arm mode. Entry delay gives you time to disarm after a sensor triggers. Exit delay gives you time to leave after arming.

### User Codes

Add numeric PIN codes (minimum 4 digits). Each user can be marked as admin. At least one admin must always remain.

### Notifications

**Targets** — select which HA notify services receive alarm notifications (e.g. `notify.mobile_app_your_phone`).

**High priority** — when enabled, adds platform-specific priority data to every notification:
- Android: `ttl: 0`, `priority: high`
- iOS: `push.interruption-level: time-sensitive`

> Note: high-priority notifications respect DND settings but bypass normal delivery delays.

**Events & Messages** — enable or disable notifications per event and optionally override the default message text. Leave the message field blank to use the built-in default.

Available placeholders:

| Placeholder | Replaced with |
|---|---|
| `{mode}` | Current arm mode (e.g. "Armed Away") |
| `{sensor}` | Friendly name of the triggering sensor |
| `{user}` | Name of the user whose code disarmed the alarm |

Default messages:

| Event | Default |
|---|---|
| Arming | Alarm arming in {mode} mode — exit now. |
| Armed | Alarm armed in {mode} mode. |
| Triggered | ALARM TRIGGERED — sensor: {sensor}. |
| Entry detected | Entry detected — disarm now. Sensor: {sensor}. |
| Disarming | Alarm disarming — initiated by {user}. |
| Disarmed | Alarm disarmed by {user}. |
| Invalid code | Alarm action failed: invalid code. |

### Chime Mode

When enabled, opens a chime sensor trigger plays a tone on the siren entity while the alarm is disarmed — useful as a door chime without activating the alarm.

### General Settings

| Setting | Description |
|---|---|
| Require code to arm | When off, arm buttons work without a PIN (disarm always requires a code) |
| Trigger duration | How long the alarm stays triggered before auto-resolving (0 = indefinite) |
| Disarm after trigger | When on, the alarm disarms after the trigger duration; when off, it re-arms |
| Siren entity | The `siren` domain entity to activate on alarm |
| Alarm tone | Tone ID passed to `siren.turn_on` (leave blank for generic on/off) |
| Alarm volume | Volume 0–1 passed to `siren.turn_on` (0 = device default) |

---

## Alarm States

| State | Meaning |
|---|---|
| Disarmed | Alarm is off; sensors are not monitored |
| Arming | Exit delay countdown in progress |
| Armed | Alarm is active and monitoring sensors |
| Pending | Entry delay countdown — disarm before it expires |
| Triggered | Alarm triggered; siren active |
| Disarming | Disarm accepted; returning to disarmed |
