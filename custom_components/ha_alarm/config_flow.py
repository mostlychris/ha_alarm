from __future__ import annotations

import hashlib
import secrets
from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.selector import (
    BooleanSelector,
    EntitySelector,
    EntitySelectorConfig,
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    ALL_EVENTS,
    ALL_MODES,
    CONF_CODE_ARM_REQUIRED,
    CONF_CODE_IS_ADMIN,
    CONF_CODE_NAME,
    CONF_CODE_SALT,
    CONF_CODE_VALUE,
    CONF_CODES,
    CONF_DELAYS,
    CONF_ENTRY_DELAY,
    CONF_EXIT_DELAY,
    CONF_NOTIFICATIONS,
    CONF_NOTIFY_EVENTS,
    CONF_NOTIFY_TARGETS,
    CONF_DISARM_AFTER_TRIGGER,
    CONF_SENSORS,
    CONF_TRIGGER_TIME,
    DEFAULT_ENTRY_DELAY,
    DEFAULT_EXIT_DELAY,
    DEFAULT_TRIGGER_TIME,
    DOMAIN,
    MODE_AWAY,
    MODE_CUSTOM,
    MODE_HOME,
    MODE_NIGHT,
    MODE_VACATION,
    MODE_SENSOR_CLASSES,
)


def _hash_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}{code}".encode()).hexdigest()


def _default_data(admin_name: str, raw_code: str) -> dict[str, Any]:
    salt = secrets.token_hex(16)
    return {
        CONF_CODES: [
            {
                CONF_CODE_NAME: admin_name,
                CONF_CODE_VALUE: _hash_code(raw_code, salt),
                CONF_CODE_SALT: salt,
                CONF_CODE_IS_ADMIN: True,
            }
        ],
        CONF_SENSORS: {mode: [] for mode in ALL_MODES},
        CONF_DELAYS: {
            mode: {CONF_ENTRY_DELAY: DEFAULT_ENTRY_DELAY, CONF_EXIT_DELAY: DEFAULT_EXIT_DELAY}
            for mode in ALL_MODES
        },
        CONF_NOTIFICATIONS: {
            CONF_NOTIFY_TARGETS: [],
            CONF_NOTIFY_EVENTS: {e: True for e in ALL_EVENTS},
        },
        CONF_CODE_ARM_REQUIRED: True,
        CONF_TRIGGER_TIME: DEFAULT_TRIGGER_TIME,
        CONF_DISARM_AFTER_TRIGGER: False,
    }


# ---------------------------------------------------------------------------
# Config flow
# ---------------------------------------------------------------------------

class HaAlarmConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            code = user_input.get("admin_code", "")
            if len(code) < 4:
                errors["admin_code"] = "code_too_short"
            else:
                data = _default_data(user_input.get("admin_name", "Admin"), code)
                return self.async_create_entry(title=user_input["name"], data=data)

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required("name", default="Home Alarm"): str,
                    vol.Required("admin_name", default="Admin"): str,
                    vol.Required("admin_code"): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )

    @staticmethod
    @config_entries.callback
    def async_get_options_flow(config_entry: config_entries.ConfigEntry) -> HaAlarmOptionsFlow:
        return HaAlarmOptionsFlow(config_entry)


# ---------------------------------------------------------------------------
# Options flow
# ---------------------------------------------------------------------------

_BINARY_SENSOR_SEL = EntitySelector(
    EntitySelectorConfig(domain="binary_sensor", multiple=True)
)
_SECONDS_SEL = NumberSelector(
    NumberSelectorConfig(min=0, max=600, step=5, mode=NumberSelectorMode.BOX, unit_of_measurement="s")
)


class HaAlarmOptionsFlow(config_entries.OptionsFlow):
    def __init__(self, entry: config_entries.ConfigEntry) -> None:
        self._entry = entry
        # Start with merged current config so edits are additive
        self._opts: dict[str, Any] = {**entry.data, **entry.options}

    # -------------------------------------------------------------- top menu

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        return self.async_show_menu(
            step_id="init",
            menu_options=["sensors", "delays", "codes", "notifications", "general"],
        )

    # ------------------------------------------------------------ sensors

    def _split_sensors(
        self, entity_ids: list[str], device_classes: list[str]
    ) -> tuple[list[str], list[str]]:
        """Split saved entity IDs into (matching device class, everything else)."""
        suggested, extra = [], []
        for eid in entity_ids:
            state = self.hass.states.get(eid)
            dc = state.attributes.get("device_class") if state else None
            (suggested if dc in device_classes else extra).append(eid)
        return suggested, extra

    async def async_step_sensors(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        if user_input is not None:
            sensors: dict[str, list[str]] = {}
            for mode in ALL_MODES:
                primary = user_input.get(mode, [])
                extra = user_input.get(f"{mode}_extra", [])
                seen: set[str] = set()
                combined: list[str] = []
                for eid in primary + extra:
                    if eid not in seen:
                        seen.add(eid)
                        combined.append(eid)
                sensors[mode] = combined
            self._opts[CONF_SENSORS] = sensors
            return self.async_create_entry(title="", data=self._opts)

        cur = self._opts.get(CONF_SENSORS, {})
        schema_dict: dict = {}

        for mode in ALL_MODES:
            existing: list[str] = cur.get(mode, [])
            classes = MODE_SENSOR_CLASSES.get(mode)

            if classes is not None:
                suggested, extra = self._split_sensors(existing, classes)
                schema_dict[vol.Optional(mode, default=suggested)] = EntitySelector(
                    EntitySelectorConfig(domain="binary_sensor", device_class=classes, multiple=True)
                )
                schema_dict[vol.Optional(f"{mode}_extra", default=extra)] = _BINARY_SENSOR_SEL
            else:
                # Custom mode: no device-class filter
                schema_dict[vol.Optional(mode, default=existing)] = _BINARY_SENSOR_SEL

        return self.async_show_form(
            step_id="sensors", data_schema=vol.Schema(schema_dict)
        )

    # ------------------------------------------------------------- delays

    async def async_step_delays(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        if user_input is not None:
            delays: dict[str, dict[str, int]] = {}
            for mode in ALL_MODES:
                delays[mode] = {
                    CONF_ENTRY_DELAY: int(user_input.get(f"{mode}_entry", DEFAULT_ENTRY_DELAY)),
                    CONF_EXIT_DELAY: int(user_input.get(f"{mode}_exit", DEFAULT_EXIT_DELAY)),
                }
            self._opts[CONF_DELAYS] = delays
            return self.async_create_entry(title="", data=self._opts)

        cur = self._opts.get(CONF_DELAYS, {})
        schema_dict: dict = {}
        for mode in ALL_MODES:
            md = cur.get(mode, {})
            schema_dict[
                vol.Optional(f"{mode}_entry", default=md.get(CONF_ENTRY_DELAY, DEFAULT_ENTRY_DELAY))
            ] = _SECONDS_SEL
            schema_dict[
                vol.Optional(f"{mode}_exit", default=md.get(CONF_EXIT_DELAY, DEFAULT_EXIT_DELAY))
            ] = _SECONDS_SEL

        return self.async_show_form(step_id="delays", data_schema=vol.Schema(schema_dict))

    # -------------------------------------------------------------- codes menu

    async def async_step_codes(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        return self.async_show_menu(
            step_id="codes",
            menu_options=["add_code", "remove_code"],
        )

    async def async_step_add_code(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        errors: dict[str, str] = {}

        if user_input is not None:
            code = user_input.get("code", "")
            name = user_input.get(CONF_CODE_NAME, "").strip()
            if len(code) < 4:
                errors["code"] = "code_too_short"
            elif not name:
                errors[CONF_CODE_NAME] = "name_required"
            elif any(u[CONF_CODE_NAME] == name for u in self._opts.get(CONF_CODES, [])):
                errors[CONF_CODE_NAME] = "name_exists"
            else:
                salt = secrets.token_hex(16)
                codes = list(self._opts.get(CONF_CODES, []))
                codes.append(
                    {
                        CONF_CODE_NAME: name,
                        CONF_CODE_VALUE: _hash_code(code, salt),
                        CONF_CODE_SALT: salt,
                        CONF_CODE_IS_ADMIN: user_input.get(CONF_CODE_IS_ADMIN, False),
                    }
                )
                self._opts[CONF_CODES] = codes
                return self.async_create_entry(title="", data=self._opts)

        return self.async_show_form(
            step_id="add_code",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_CODE_NAME): str,
                    vol.Required("code"): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                    vol.Optional(CONF_CODE_IS_ADMIN, default=False): BooleanSelector(),
                }
            ),
            errors=errors,
        )

    async def async_step_remove_code(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        codes: list[dict] = self._opts.get(CONF_CODES, [])
        errors: dict[str, str] = {}

        if user_input is not None:
            target = user_input.get(CONF_CODE_NAME)
            remaining = [c for c in codes if c[CONF_CODE_NAME] != target]
            if not any(c.get(CONF_CODE_IS_ADMIN) for c in remaining):
                errors[CONF_CODE_NAME] = "last_admin"
            else:
                self._opts[CONF_CODES] = remaining
                return self.async_create_entry(title="", data=self._opts)

        names = [c[CONF_CODE_NAME] for c in codes]
        return self.async_show_form(
            step_id="remove_code",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_CODE_NAME): SelectSelector(
                        SelectSelectorConfig(options=names, mode=SelectSelectorMode.LIST)
                    )
                }
            ),
            errors=errors,
        )

    # -------------------------------------------------------- notifications

    async def async_step_notifications(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        if user_input is not None:
            raw_targets = user_input.get("targets", "")
            targets = [t.strip() for t in raw_targets.split(",") if t.strip()]
            events = {event: bool(user_input.get(f"event_{event}", False)) for event in ALL_EVENTS}
            self._opts[CONF_NOTIFICATIONS] = {
                CONF_NOTIFY_TARGETS: targets,
                CONF_NOTIFY_EVENTS: events,
            }
            return self.async_create_entry(title="", data=self._opts)

        cur = self._opts.get(CONF_NOTIFICATIONS, {})
        cur_targets = ", ".join(cur.get(CONF_NOTIFY_TARGETS, []))
        cur_events: dict[str, bool] = cur.get(CONF_NOTIFY_EVENTS, {e: True for e in ALL_EVENTS})

        schema_dict: dict = {
            vol.Optional("targets", default=cur_targets): TextSelector(
                TextSelectorConfig(
                    type=TextSelectorType.TEXT,
                    multiline=False,
                )
            ),
        }
        for event in ALL_EVENTS:
            schema_dict[
                vol.Optional(f"event_{event}", default=cur_events.get(event, True))
            ] = BooleanSelector()

        return self.async_show_form(
            step_id="notifications",
            data_schema=vol.Schema(schema_dict),
        )

    # ------------------------------------------------------------- general

    async def async_step_general(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        if user_input is not None:
            self._opts[CONF_CODE_ARM_REQUIRED] = user_input[CONF_CODE_ARM_REQUIRED]
            self._opts[CONF_TRIGGER_TIME] = int(user_input[CONF_TRIGGER_TIME])
            self._opts[CONF_DISARM_AFTER_TRIGGER] = user_input[CONF_DISARM_AFTER_TRIGGER]
            return self.async_create_entry(title="", data=self._opts)

        return self.async_show_form(
            step_id="general",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_CODE_ARM_REQUIRED,
                        default=self._opts.get(CONF_CODE_ARM_REQUIRED, True),
                    ): BooleanSelector(),
                    vol.Required(
                        CONF_TRIGGER_TIME,
                        default=self._opts.get(CONF_TRIGGER_TIME, DEFAULT_TRIGGER_TIME),
                    ): NumberSelector(NumberSelectorConfig(
                        min=0, max=3600, step=30, mode=NumberSelectorMode.BOX, unit_of_measurement="s"
                    )),
                    vol.Required(
                        CONF_DISARM_AFTER_TRIGGER,
                        default=self._opts.get(CONF_DISARM_AFTER_TRIGGER, False),
                    ): BooleanSelector(),
                }
            ),
        )
