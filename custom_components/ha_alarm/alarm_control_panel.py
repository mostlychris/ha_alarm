from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

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
    CONF_CODE_ARM_REQUIRED,
    CONF_CODE_IS_ADMIN,
    CONF_CODE_SALT,
    CONF_CODE_VALUE,
    CONF_CODES,
    CONF_DELAYS,
    CONF_ENTRY_DELAY,
    CONF_EXIT_DELAY,
    CONF_NOTIFICATIONS,
    CONF_NOTIFY_EVENTS,
    CONF_NOTIFY_TARGETS,
    CONF_SENSORS,
    DEFAULT_ENTRY_DELAY,
    DEFAULT_EXIT_DELAY,
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

# Transient states lost on restart — reset to disarmed
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

    # ------------------------------------------------------------------ state

    @property
    def alarm_state(self) -> AlarmControlPanelState:
        return self._alarm_state

    @property
    def code_arm_required(self) -> bool:
        return self._cfg().get(CONF_CODE_ARM_REQUIRED, True)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {"armed_mode": self._armed_mode}

    # ---------------------------------------------------------------- helpers

    def _cfg(self) -> dict[str, Any]:
        """Merged config: options override initial data."""
        return {**self._entry.data, **self._entry.options}

    def _sensors_for_mode(self, mode: str) -> list[str]:
        return self._cfg().get(CONF_SENSORS, {}).get(mode, [])

    def _delay(self, mode: str, delay_key: str) -> int:
        default = DEFAULT_ENTRY_DELAY if delay_key == CONF_ENTRY_DELAY else DEFAULT_EXIT_DELAY
        return self._cfg().get(CONF_DELAYS, {}).get(mode, {}).get(delay_key, default)

    def _validate_code(self, code: str) -> tuple[bool, bool]:
        """Return (valid, is_admin)."""
        for user in self._cfg().get(CONF_CODES, []):
            salt = user.get(CONF_CODE_SALT, "")
            if _hash_code(code, salt) == user.get(CONF_CODE_VALUE, ""):
                return True, user.get(CONF_CODE_IS_ADMIN, False)
        return False, False

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
        self._set_state(AlarmControlPanelState.TRIGGERED)
        self._notify(EVENT_TRIGGERED, sensor_id)

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
        if last is None:
            return
        # AlarmControlPanelState is a StrEnum so comparing with last.state string works
        try:
            restored = AlarmControlPanelState(last.state)
        except ValueError:
            return
        if restored not in _TRANSIENT_STATES:
            self._alarm_state = restored
            self._armed_mode = last.attributes.get("armed_mode")
            if self._armed_mode:
                self._subscribe_sensors(self._armed_mode)

    async def async_will_remove_from_hass(self) -> None:
        self._cancel_timer()
        self._unsubscribe_sensors()

    # ---------------------------------------------------------- notifications

    def _notify(self, event: str, sensor_id: str | None = None) -> None:
        cfg = self._cfg().get(CONF_NOTIFICATIONS, {})
        if not cfg.get(CONF_NOTIFY_EVENTS, {}).get(event, False):
            return
        targets: list[str] = cfg.get(CONF_NOTIFY_TARGETS, [])
        if not targets:
            return

        mode_label = (self._armed_mode or "").replace("_", " ").title()
        messages = {
            EVENT_ARMING: f"Alarm arming in {mode_label} mode — exit now.",
            EVENT_ARMED: f"Alarm armed in {mode_label} mode.",
            EVENT_TRIGGERED: f"ALARM TRIGGERED — sensor: {sensor_id or 'unknown'}.",
            EVENT_DISARMED: "Alarm disarmed.",
            EVENT_DISARMING: "Alarm disarming.",
            EVENT_PENDING: f"Entry detected — disarm now. Sensor: {sensor_id or 'unknown'}.",
            EVENT_FAILED: "Alarm action failed: invalid code.",
        }
        message = messages.get(event, f"Alarm event: {event}")

        for target in targets:
            parts = target.split(".", 1)
            if len(parts) == 2:
                self.hass.async_create_task(
                    self.hass.services.async_call(
                        parts[0], parts[1], {"message": message, "title": "HA Alarm"}
                    )
                )

    # -------------------------------------------------- alarm control panel

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        valid, _ = self._validate_code(code or "")
        if not valid:
            _LOGGER.warning("Invalid code supplied for disarm")
            self._notify(EVENT_FAILED)
            return
        self._notify(EVENT_DISARMING)
        self._cancel_timer()
        self._unsubscribe_sensors()
        self._armed_mode = None
        self._set_state(AlarmControlPanelState.DISARMED)
        self._notify(EVENT_DISARMED)

    async def _arm(self, mode: str, code: str | None) -> None:
        if self._cfg().get(CONF_CODE_ARM_REQUIRED, True):
            valid, _ = self._validate_code(code or "")
            if not valid:
                _LOGGER.warning("Invalid code supplied for arm")
                self._notify(EVENT_FAILED)
                return

        for sensor_id in self._sensors_for_mode(mode):
            state = self.hass.states.get(sensor_id)
            if state and state.state == "on":
                _LOGGER.warning("Cannot arm — sensor %s is open", sensor_id)
                self._notify(EVENT_FAILED)
                return

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
