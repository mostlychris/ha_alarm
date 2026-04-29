# 🔐 HA Alarm

A fully local, custom alarm control panel for Home Assistant with a built-in sidebar configuration UI. No cloud, no external dependencies — everything runs inside your HA instance.

---

## ✨ Features

- **Five arm modes** — Away, Home, Night, Vacation, and Custom, each with independently configured sensors and entry/exit delays
- **Sensor management** — assign any binary sensor to any mode directly from the config panel
- **Sensor bypass** — bypass individual sensors for one arm cycle, a set duration, or indefinitely; open sensors float to the top of the bypass picker for quick access
- **User codes** — multiple PIN codes with admin/standard roles
- **Siren integration** — trigger a `siren` entity on alarm with configurable tone and volume
- **Siren repeat** — re-trigger the alarm tone every N seconds to keep devices looping that stop after a single clip
- **Pending siren** — play a distinct warning tone during the entry delay so users know to disarm before the alarm fires
- **Pending repeat** — re-trigger the pending warning tone on the same interval logic as the alarm siren
- **Chime mode** — play a tone on a siren entity when a chime sensor opens while the alarm is disarmed
- **Mobile notifications** — send alerts to any HA notify service on arm, disarm, trigger, and more; includes a **Send Test** button to verify delivery without triggering the alarm
- **High-priority notifications** — Android (`ttl=0` / `priority=high`) and iOS (`time-sensitive` interruption level)
- **Custom notification messages** — override the default text per event with `{mode}`, `{sensor}`, and `{user}` placeholders
- **Sensor summary** — see all configured sensors grouped by mode at a glance; click any sensor chip to remove it
- **Open sensor detection** — sensors currently open are highlighted in the summary and block arming with a persistent notification
- **Fully local** — no external API calls; all state and config stored in HA config entries

---

## 📦 Installation

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

## 🚀 Setup

1. Go to **Settings → Devices & Services → Add Integration**
2. Search for **HA Alarm** and follow the prompts to give the alarm a name
3. A new **HA Alarm** entry appears in the sidebar — click it to open the config panel

---

## ⚙️ Configuration Panel

The sidebar panel has collapsible sections for every aspect of the alarm. All changes are saved immediately to HA config entries with no restart required.

---

### 🚪 Sensors

Select which binary sensors are active for each arm mode using the mode tabs (Away / Home / Night / Vacation / Custom). Suggested sensors are pre-filtered by device class for each mode; other sensors are available under "Other sensors."

**🔓 Sensor Bypass** — temporarily disable a sensor without removing it from a mode. The sensor picker automatically sorts any currently open sensors to the top (marked with ⚠) so they're easy to find before arming:

| Duration | Behaviour |
|---|---|
| One arm cycle | Bypassed for the next arm → disarm cycle only |
| 24 hours / 7 days | Bypassed until the time expires |
| Indefinite | Bypassed until manually cleared |

---

### 📋 Sensor Summary

Shows every configured sensor grouped by mode. Sensors that are currently open are highlighted in red. Click any sensor chip to immediately remove it from that mode.

---

### ⏱️ Entry & Exit Delays

Set entry and exit delay times (in seconds) independently per arm mode.

| Delay | Description |
|---|---|
| Exit delay | Time to leave after arming before sensors are monitored |
| Entry delay | Time to disarm after a sensor triggers before the alarm fires |

---

### 👤 User Codes

Add numeric PIN codes (minimum 4 digits). Each user can be marked as admin. At least one admin must always remain. The name of the user who disarmed the alarm is available as `{user}` in notification message templates.

---

### 📱 Notifications

**Targets** — select which HA notify services receive alarm notifications (e.g. `notify.mobile_app_your_phone`).

**🧪 Send Test** — fires an immediate test notification to all configured targets using the current high-priority setting, without needing to trigger the alarm. Useful for confirming delivery after initial setup or after changing targets.

**⚡ High priority** — when enabled, adds platform-specific priority data to every notification for faster, more reliable delivery:

| Platform | Data added | Effect |
|---|---|---|
| Android | `ttl: 0`, `priority: high` | Delivers immediately without batching or delay; does **not** bypass DND |
| iOS | `push.interruption-level: time-sensitive` | Can break through Focus modes if the user has allowed time-sensitive notifications |

**Events & Messages** — enable or disable notifications per event and optionally override the default message text. Leave the message field blank to use the built-in default.

Available placeholders:

| Placeholder | Replaced with |
|---|---|
| `{mode}` | Current arm mode (e.g. "Armed Away") |
| `{sensor}` | Friendly name of the triggering sensor |
| `{user}` | Name of the user whose code disarmed the alarm |

Default messages:

| Event | Default message |
|---|---|
| Arming | Alarm arming in {mode} mode — exit now. |
| Armed | Alarm armed in {mode} mode. |
| Triggered | ALARM TRIGGERED — sensor: {sensor}. |
| Entry detected | Entry detected — disarm now. Sensor: {sensor}. |
| Disarming | Alarm disarming — initiated by {user}. |
| Disarmed | Alarm disarmed by {user}. |
| Invalid code | Alarm action failed: invalid code. |

---

### 🔔 Chime Mode

When enabled, a chime sensor opening plays a tone on the siren entity while the alarm is disarmed — useful as a door chime without activating the alarm. Configure the chime tone ID and volume independently from the alarm siren.

---

### 🔊 General Settings

| Setting | Description |
|---|---|
| Require code to arm | When off, arm buttons work without a PIN (disarm always requires a code) |
| Trigger duration | How long the alarm stays triggered before auto-resolving (0 = indefinite) |
| Disarm after trigger | When on, the alarm disarms after the trigger duration; when off, it re-arms |
| Siren entity | The `siren` domain entity to activate on alarm |
| **Alarm tone** | Tone ID passed to `siren.turn_on` on trigger (leave blank for generic on/off) |
| **Alarm volume** | Volume 0–1 passed to `siren.turn_on` (0 = device default) |
| **Alarm repeat (s)** | Re-trigger the alarm tone every N seconds while triggered (0 = play once) |
| **Pending tone** | Tone ID played during the entry delay countdown — leave blank to disable |
| **Pending volume** | Volume 0–1 for the pending warning tone (0 = device default) |
| **Pending repeat (s)** | Re-trigger the pending tone every N seconds while in entry delay (0 = play once) |

#### 🔁 About Repeat

Some siren devices play a tone clip once and go silent rather than looping indefinitely. The repeat settings work around this by re-calling `siren.turn_on` on a configurable interval:

- Set **Alarm repeat** to `10` to re-trigger the alarm siren every 10 seconds while the alarm is active
- Set **Pending repeat** to `10` to re-trigger the warning tone every 10 seconds during the entry delay countdown
- Set either to `0` to play only once (original behaviour)

When the alarm changes state (e.g. pending → triggered, or triggered → disarmed), the repeat loop is cancelled immediately and the new state's sound starts without a gap.

---

## 🚨 Alarm States

| State | Meaning |
|---|---|
| 😴 Disarmed | Alarm is off; sensors are not monitored |
| ⏳ Arming | Exit delay countdown — leave before sensors activate |
| 🔒 Armed | Alarm is active and monitoring sensors |
| ⚠️ Pending | Entry delay countdown — disarm before it expires or the alarm fires |
| 🚨 Triggered | Alarm triggered; siren active |
| 🔓 Disarming | Disarm accepted; returning to disarmed |
