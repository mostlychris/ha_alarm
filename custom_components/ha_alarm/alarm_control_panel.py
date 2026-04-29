from __future__ import annotations

import asyncio
import hashlib
import logging
import time
from typing import Any

from homeassistant.exceptions import HomeAssistantError
from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity,
    AlarmControlPanelEntityFeature,
    AlarmControlPanelState,
    CodeFormat,
)
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_state_change_event
from homeassistant.helpers.restore_state import RestoreEntity

from .const import (
    API_UPDATE_FLAG,
    BYPASS_INDEFINITE,
    BYPASS_ONE_CYCLE,
    CONF_BYPASSED_SENSORS,
    CONF_CHIME_MODE,
    CONF_CHIME_SENSORS,
    CONF_CODE_ARM_REQUIRED,
    CONF_CODE_IS_ADMIN,
    CONF_CODE_NAME,
    CONF_CODE_SALT,
    CONF_CODE_VALUE,
    CONF_CODES,
    CONF_DELAYS,
    CONF_DISARM_AFTER_TRIGGER,
    CONF_ENTRY_DELAY,
    CONF_EXIT_DELAY,
    CONF_NOTIFICATIONS,
    CONF_NOTIFY_EVENTS,
    CONF_NOTIFY_HIGH_PRIORITY,
    CONF_NOTIFY_MESSAGES,
    CONF_NOTIFY_TARGETS,
    CONF_SENSORS,
    CONF_CHIME_TONE,
    CONF_CHIME_VOLUME,
    CONF_PENDING_TONE,
    CONF_PENDING_VOLUME,
    CONF_SIREN_ENTITY,
    CONF_SIREN_TONE,
    CONF_SIREN_VOLUME,
    CONF_TRIGGER_TIME,
    DEFAULT_ENTRY_DELAY,
    DEFAULT_EXIT_DELAY,
    DEFAULT_TRIGGER_TIME,
    DOMAIN,
    EVENT_ARMED,
    EVENT_ARMING,
    EVENT_DISARMED,
    EVENT_DISARMING,
    EVENT_FAILED,
    EVENT_PENDING,
    EVENT_TRIGGERED,
    MODE_AWAY,
    MODE_CUSTOM,
    MODE_HOME,
    MODE_NIGHT,
    MODE_VACATION,
)

_LOGGER = logging.getLogger(__name__)

MODE_TO_STATE: dict[str, AlarmControlPanelState] = {
    MODE_AWAY: AlarmControlPanelState.ARMED_AWAY,
    MODE_HOME: AlarmControlPanelState.ARMED_HOME,
    MODE_NIGHT: AlarmControlPanelState.ARMED_NIGHT,
    MODE_VACATION: AlarmControlPanelState.ARMED_VACATION,
    MODE_CUSTOM: AlarmControlPanelState.ARMED_CUSTOM_BYPASS,
}

ARMED_STATES = frozenset(MODE_TO_STATE.values())

_TRANSIENT_STATES = {
    AlarmControlPanelState.ARMING,
    AlarmControlPanelState.PENDING,
    AlarmControlPanelState.TRIGGERED,
}


def _hash_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}{code}".encode()).hexdigest()


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    async_add_entities([HaAlarmPanel(hass, entry)])


class HaAlarmPanel(AlarmControlPanelEntity, RestoreEntity):
    _attr_has_entity_name = True
    _attr_should_poll = False
    _attr_code_format = CodeFormat.NUMBER
    _attr_supported_features = (
        AlarmControlPanelEntityFeature.ARM_HOME
        | AlarmControlPanelEntityFeature.ARM_AWAY
        | AlarmControlPanelEntityFeature.ARM_NIGHT
        | AlarmControlPanelEntityFeature.ARM_VACATION
        | AlarmControlPanelEntityFeature.ARM_CUSTOM_BYPASS
        | AlarmControlPanelEntityFeature.TRIGGER
    )

    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self._entry = entry
        self._attr_unique_id = entry.entry_id
        self._attr_name = entry.title
        self._alarm_state: AlarmControlPanelState = AlarmControlPanelState.DISARMED
        self._armed_mode: str | None = None
        self._timer: asyncio.TimerHandle | None = None
        self._unsub_sensors: list = []
        self._unsub_chime: list = []

    # ------------------------------------------------------------------ state

    @property
    def alarm_state(self) -> AlarmControlPanelState:
        return self._alarm_state

    @property
    def code_arm_required(self) -> bool:
        return self._cfg().get(CONF_CODE_ARM_REQUIRED, True)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "armed_mode": self._armed_mode,
            "bypassed_sensors": list(self._active_bypasses()),
        }

    # ---------------------------------------------------------------- helpers

    def _cfg(self) -> dict[str, Any]:
        return {**self._entry.data, **self._entry.options}

    def _sensors_for_mode(self, mode: str) -> list[str]:
        all_sensors = self._cfg().get(CONF_SENSORS, {}).get(mode, [])
        bypassed = self._active_bypasses()
        return [s for s in all_sensors if s not in bypassed]

    def _active_bypasses(self) -> set[str]:
        now = time.time()
        result: set[str] = set()
        for sid, until in self._cfg().get(CONF_BYPASSED_SENSORS, {}).items():
            if until == BYPASS_ONE_CYCLE or until == BYPASS_INDEFINITE or until > now:
                result.add(sid)
        return result

    def _clear_cycle_bypasses(self) -> None:
        """Remove one-cycle and expired bypasses after disarm."""
        now = time.time()
        bypasses = dict(self._cfg().get(CONF_BYPASSED_SENSORS, {}))
        to_del = [
            sid for sid, until in bypasses.items()
            if until == BYPASS_ONE_CYCLE or (until != BYPASS_INDEFINITE and until < now)
        ]
        if not to_del:
            return
        for sid in to_del:
            del bypasses[sid]
        new_opts = {**self._entry.options, CONF_BYPASSED_SENSORS: bypasses}
        self.hass.data.setdefault(DOMAIN, {})[API_UPDATE_FLAG] = True
        self.hass.config_entries.async_update_entry(self._entry, options=new_opts)

    def _delay(self, mode: str, delay_key: str) -> int:
        default = DEFAULT_ENTRY_DELAY if delay_key == CONF_ENTRY_DELAY else DEFAULT_EXIT_DELAY
        return self._cfg().get(CONF_DELAYS, {}).get(mode, {}).get(delay_key, default)

    def _validate_code(self, code: str) -> tuple[bool, bool, str]:
        for user in self._cfg().get(CONF_CODES, []):
            salt = user.get(CONF_CODE_SALT, "")
            if _hash_code(code, salt) == user.get(CONF_CODE_VALUE, ""):
                return True, user.get(CONF_CODE_IS_ADMIN, False), user.get(CONF_CODE_NAME, "")
        return False, False, ""

    # ------------------------------------------------------- sensor tracking

    def _subscribe_sensors(self, mode: str) -> None:
        self._unsubscribe_sensors()
        sensors = self._sensors_for_mode(mode)
        if sensors:
            self._unsub_sensors.append(
                async_track_state_change_event(
                    self.hass, sensors, self._sensor_changed
                )
            )

    def _unsubscribe_sensors(self) -> None:
        for unsub in self._unsub_sensors:
            unsub()
        self._unsub_sensors.clear()

    # ------------------------------------------------------------ chime mode

    def _subscribe_chime(self) -> None:
        self._unsubscribe_chime()
        if not self._cfg().get(CONF_CHIME_MODE, False):
            return
        sensors = self._cfg().get(CONF_CHIME_SENSORS, [])
        if sensors:
            self._unsub_chime.append(
                async_track_state_change_event(
                    self.hass, sensors, self._chime_sensor_changed
                )
            )

    def _unsubscribe_chime(self) -> None:
        for unsub in self._unsub_chime:
            unsub()
        self._unsub_chime.clear()

    @callback
    def _chime_sensor_changed(self, event: Any) -> None:
        if self._alarm_state != AlarmControlPanelState.DISARMED:
            return
        new_state = event.data.get("new_state")
        if new_state and new_state.state == "on":
            self._notify_chime(new_state.entity_id)

    def _notify_chime(self, sensor_id: str) -> None:
        """Play the chime tone on the siren entity only — no push notifications."""
        cfg        = self._cfg()
        entity     = cfg.get(CONF_SIREN_ENTITY, "")
        chime_tone = cfg.get(CONF_CHIME_TONE, "")
        if entity and chime_tone:
            data: dict = {"entity_id": entity, "tone": chime_tone}
            vol = float(cfg.get(CONF_CHIME_VOLUME, 0.0))
            if vol > 0.0:
                data["volume_level"] = round(min(1.0, max(0.0, vol)), 2)
            self.hass.async_create_task(
                self.hass.services.async_call("siren", "turn_on", data)
            )

    # ----------------------------------------------------------------- siren

    def _dismiss_arm_blocked(self) -> None:
        self.hass.async_create_task(
            self.hass.services.async_call(
                "persistent_notification", "dismiss",
                {"notification_id": "ha_alarm_arm_blocked"},
            )
        )

    def _siren_on(self) -> None:
        cfg    = self._cfg()
        entity = cfg.get(CONF_SIREN_ENTITY, "")
        tone   = cfg.get(CONF_SIREN_TONE, "")
        if not entity:
            return
        if tone:
            data: dict = {"entity_id": entity, "tone": tone}
            vol = float(cfg.get(CONF_SIREN_VOLUME, 0.0))
            if vol > 0.0:
                data["volume_level"] = round(min(1.0, max(0.0, vol)), 2)
            self.hass.async_create_task(
                self.hass.services.async_call("siren", "turn_on", data)
            )
        else:
            self.hass.async_create_task(
                self.hass.services.async_call(
                    "homeassistant", "turn_on", {"entity_id": entity}
                )
            )

    def _pending_siren_on(self) -> None:
        cfg    = self._cfg()
        entity = cfg.get(CONF_SIREN_ENTITY, "")
        tone   = cfg.get(CONF_PENDING_TONE, "")
        if not entity or not tone:
            return
        data: dict = {"entity_id": entity, "tone": tone}
        vol = float(cfg.get(CONF_PENDING_VOLUME, 0.0))
        if vol > 0.0:
            data["volume_level"] = round(min(1.0, max(0.0, vol)), 2)
        self.hass.async_create_task(
            self.hass.services.async_call("siren", "turn_on", data)
        )

    def _siren_off(self) -> None:
        entity = self._cfg().get(CONF_SIREN_ENTITY, "")
        if entity:
            self.hass.async_create_task(
                self.hass.services.async_call(
                    "homeassistant", "turn_off", {"entity_id": entity}
                )
            )

    # ----------------------------------------------------------------- timers

    def _cancel_timer(self) -> None:
        if self._timer:
            self._timer.cancel()
            self._timer = None

    # --------------------------------------------------------- state machine

    def _set_state(self, state: AlarmControlPanelState) -> None:
        self._alarm_state = state
        self.async_write_ha_state()

    @callback
    def _sensor_changed(self, event: Any) -> None:
        new_state = event.data.get("new_state")
        if new_state is None or new_state.state != "on":
            return
        if self._alarm_state not in ARMED_STATES:
            return

        entry_delay = self._delay(self._armed_mode, CONF_ENTRY_DELAY)
        if entry_delay > 0:
            self._set_state(AlarmControlPanelState.PENDING)
            self._notify(EVENT_PENDING, new_state.entity_id)
            self._pending_siren_on()
            self._cancel_timer()
            self._timer = self.hass.loop.call_later(
                entry_delay, self._timer_trigger_alarm
            )
        else:
            self._do_trigger(new_state.entity_id)

    def _timer_trigger_alarm(self) -> None:
        self._timer = None
        self._do_trigger(None)

    def _do_trigger(self, sensor_id: str | None) -> None:
        self._unsubscribe_sensors()
        self._siren_off()
        self._set_state(AlarmControlPanelState.TRIGGERED)
        self._notify(EVENT_TRIGGERED, sensor_id)
        self._siren_on()
        trigger_time = self._cfg().get(CONF_TRIGGER_TIME, DEFAULT_TRIGGER_TIME)
        if trigger_time > 0:
            self._cancel_timer()
            self._timer = self.hass.loop.call_later(
                trigger_time, self._timer_trigger_timeout
            )

    def _timer_trigger_timeout(self) -> None:
        self._timer = None
        self._siren_off()
        if self._cfg().get(CONF_DISARM_AFTER_TRIGGER, False):
            self._armed_mode = None
            self._set_state(AlarmControlPanelState.DISARMED)
            self._notify(EVENT_DISARMED)
            self._clear_cycle_bypasses()
        elif self._armed_mode:
            armed_state = MODE_TO_STATE.get(self._armed_mode)
            if armed_state:
                self._subscribe_sensors(self._armed_mode)
                self._set_state(armed_state)
                self._notify(EVENT_ARMED)

    def _timer_finish_arming(self) -> None:
        self._timer = None
        armed_state = MODE_TO_STATE.get(self._armed_mode)
        if armed_state:
            self._subscribe_sensors(self._armed_mode)
            self._set_state(armed_state)
            self._notify(EVENT_ARMED)

    # --------------------------------------------------- HA lifecycle hooks

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        if last is not None:
            try:
                restored = AlarmControlPanelState(last.state)
            except ValueError:
                pass
            else:
                if restored not in _TRANSIENT_STATES:
                    self._alarm_state = restored
                    self._armed_mode = last.attributes.get("armed_mode")
                    if self._armed_mode:
                        self._subscribe_sensors(self._armed_mode)
        self._subscribe_chime()
        # Refresh chime subscription whenever options change via API (no reload)
        self.async_on_remove(
            self._entry.add_update_listener(self._async_config_updated)
        )

    async def _async_config_updated(
        self, hass: HomeAssistant, entry: ConfigEntry
    ) -> None:
        self._subscribe_chime()

    async def async_will_remove_from_hass(self) -> None:
        self._cancel_timer()
        self._unsubscribe_sensors()
        self._unsubscribe_chime()

    # ---------------------------------------------------------- notifications

    def _sensor_label(self, sensor_id: str | None) -> str:
        if not sensor_id:
            return "unknown"
        state = self.hass.states.get(sensor_id)
        if state:
            return state.attributes.get("friendly_name") or sensor_id
        return sensor_id

    def _notify(self, event: str, sensor_id: str | None = None, user: str | None = None) -> None:
        cfg = self._cfg().get(CONF_NOTIFICATIONS, {})
        if not cfg.get(CONF_NOTIFY_EVENTS, {}).get(event, False):
            return
        targets: list[str] = cfg.get(CONF_NOTIFY_TARGETS, [])
        if not targets:
            return

        mode_label   = (self._armed_mode or "").replace("_", " ").title()
        sensor_label = self._sensor_label(sensor_id)
        user_label   = user or ""

        disarmed_default = (
            f"Alarm disarmed by {user_label}." if user_label else "Alarm disarmed."
        )
        defaults = {
            EVENT_ARMING:    f"Alarm arming in {mode_label} mode — exit now.",
            EVENT_ARMED:     f"Alarm armed in {mode_label} mode.",
            EVENT_TRIGGERED: f"ALARM TRIGGERED — sensor: {sensor_label}.",
            EVENT_DISARMED:  disarmed_default,
            EVENT_DISARMING: f"Alarm disarming{f' — initiated by {user_label}' if user_label else ''}.",
            EVENT_PENDING:   f"Entry detected — disarm now. Sensor: {sensor_label}.",
            EVENT_FAILED:    "Alarm action failed: invalid code.",
        }
        raw = cfg.get(CONF_NOTIFY_MESSAGES, {}).get(event, "").strip()
        if raw:
            message = (
                raw
                .replace("{mode}", mode_label)
                .replace("{sensor}", sensor_label)
                .replace("{user}", user_label)
            )
        else:
            message = defaults.get(event, f"Alarm event: {event}")

        service_data: dict = {"message": message, "title": "HA Alarm"}
        if cfg.get(CONF_NOTIFY_HIGH_PRIORITY, False):
            service_data["data"] = {
                "ttl": 0,
                "priority": "high",
                "push": {"interruption-level": "time-sensitive"},
            }

        for target in targets:
            parts = target.split(".", 1)
            if len(parts) == 2:
                self.hass.async_create_task(
                    self.hass.services.async_call(parts[0], parts[1], service_data)
                )

    # -------------------------------------------------- alarm control panel

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        valid, _, user_name = self._validate_code(code or "")
        if not valid:
            _LOGGER.warning("Invalid code supplied for disarm")
            self._notify(EVENT_FAILED)
            return
        self._notify(EVENT_DISARMING, user=user_name)
        self._cancel_timer()
        self._unsubscribe_sensors()
        self._siren_off()
        self._dismiss_arm_blocked()
        self._armed_mode = None
        self._set_state(AlarmControlPanelState.DISARMED)
        self._notify(EVENT_DISARMED, user=user_name)
        self._clear_cycle_bypasses()

    async def _arm(self, mode: str, code: str | None) -> None:
        if self._cfg().get(CONF_CODE_ARM_REQUIRED, True):
            valid, _, _ = self._validate_code(code or "")
            if not valid:
                _LOGGER.warning("Invalid code supplied for arm")
                self._notify(EVENT_FAILED)
                return

        open_sensors = [
            self._sensor_label(sid)
            for sid in self._sensors_for_mode(mode)
            if (s := self.hass.states.get(sid)) and s.state == "on"
        ]
        if open_sensors:
            await self.hass.services.async_call(
                "persistent_notification", "create",
                {
                    "title": "Alarm — Cannot Arm",
                    "message": (
                        "The following sensor(s) are open and must be closed or "
                        "bypassed before arming:\n\n"
                        + "\n".join(f"- {s}" for s in open_sensors)
                    ),
                    "notification_id": "ha_alarm_arm_blocked",
                },
            )
            raise HomeAssistantError(
                f"Cannot arm — open sensor(s): {', '.join(open_sensors)}"
            )

        # All checks passed — clear any prior arm-blocked notification
        self._dismiss_arm_blocked()
        self._armed_mode = mode
        exit_delay = self._delay(mode, CONF_EXIT_DELAY)
        if exit_delay > 0:
            self._set_state(AlarmControlPanelState.ARMING)
            self._notify(EVENT_ARMING)
            self._cancel_timer()
            self._timer = self.hass.loop.call_later(exit_delay, self._timer_finish_arming)
        else:
            self._subscribe_sensors(mode)
            self._set_state(MODE_TO_STATE[mode])
            self._notify(EVENT_ARMED)

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        await self._arm(MODE_AWAY, code)

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        await self._arm(MODE_HOME, code)

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        await self._arm(MODE_NIGHT, code)

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        await self._arm(MODE_VACATION, code)

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        await self._arm(MODE_CUSTOM, code)

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        self._do_trigger(None)
