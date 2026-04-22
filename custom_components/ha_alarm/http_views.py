from __future__ import annotations

import hashlib
import secrets
from pathlib import Path
from typing import Any

from aiohttp import web
from homeassistant.components.http import HomeAssistantView
from homeassistant.core import HomeAssistant

from .const import (
    CONF_CODE_ARM_REQUIRED,
    CONF_CODE_IS_ADMIN,
    CONF_CODE_NAME,
    CONF_CODE_SALT,
    CONF_CODE_VALUE,
    CONF_CODES,
    CONF_DELAYS,
    CONF_DISARM_AFTER_TRIGGER,
    CONF_NOTIFICATIONS,
    CONF_SENSORS,
    CONF_TRIGGER_TIME,
    DEFAULT_TRIGGER_TIME,
    DOMAIN,
)

_API_UPDATE_FLAG = "api_update"
_ICON_PATH = Path(__file__).parent / "icon.png"


class HaAlarmIconView(HomeAssistantView):
    """Serve icon.png at /{domain}/icon.png so HA's integrations card can find it."""

    url = "/ha_alarm/icon.png"
    name = "api:ha_alarm:icon"
    requires_auth = False

    async def get(self, request: web.Request) -> web.Response:
        if not _ICON_PATH.exists():
            raise web.HTTPNotFound()
        return web.FileResponse(_ICON_PATH, headers={"Content-Type": "image/png"})


def _get_entry(hass: HomeAssistant):
    entries = hass.config_entries.async_entries(DOMAIN)
    return entries[0] if entries else None


def _hash_code(code: str, salt: str) -> str:
    return hashlib.sha256(f"{salt}{code}".encode()).hexdigest()


def _merged(entry) -> dict[str, Any]:
    return {**entry.data, **entry.options}


def _update(hass: HomeAssistant, entry, opts: dict) -> None:
    """Update options without triggering an integration reload."""
    hass.data.setdefault(DOMAIN, {})[_API_UPDATE_FLAG] = True
    hass.config_entries.async_update_entry(entry, options=opts)


class HaAlarmConfigView(HomeAssistantView):
    url = "/api/ha_alarm/config"
    name = "api:ha_alarm:config"

    async def get(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        cfg = _merged(entry)
        return self.json({
            "entry_title": entry.title,
            "codes": [
                {"name": c[CONF_CODE_NAME], "is_admin": c.get(CONF_CODE_IS_ADMIN, False)}
                for c in cfg.get(CONF_CODES, [])
            ],
            "sensors": cfg.get(CONF_SENSORS, {}),
            "delays": cfg.get(CONF_DELAYS, {}),
            "notifications": cfg.get(CONF_NOTIFICATIONS, {}),
            "code_arm_required": cfg.get(CONF_CODE_ARM_REQUIRED, True),
            "trigger_time": cfg.get(CONF_TRIGGER_TIME, DEFAULT_TRIGGER_TIME),
            "disarm_after_trigger": cfg.get(CONF_DISARM_AFTER_TRIGGER, False),
        })


class HaAlarmSensorsView(HomeAssistantView):
    url = "/api/ha_alarm/sensors"
    name = "api:ha_alarm:sensors"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        opts = _merged(entry)
        opts[CONF_SENSORS] = await request.json()
        _update(hass, entry, opts)
        return self.json({"ok": True})


class HaAlarmDelaysView(HomeAssistantView):
    url = "/api/ha_alarm/delays"
    name = "api:ha_alarm:delays"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        opts = _merged(entry)
        opts[CONF_DELAYS] = await request.json()
        _update(hass, entry, opts)
        return self.json({"ok": True})


class HaAlarmNotificationsView(HomeAssistantView):
    url = "/api/ha_alarm/notifications"
    name = "api:ha_alarm:notifications"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        opts = _merged(entry)
        opts[CONF_NOTIFICATIONS] = await request.json()
        _update(hass, entry, opts)
        return self.json({"ok": True})


class HaAlarmGeneralView(HomeAssistantView):
    url = "/api/ha_alarm/general"
    name = "api:ha_alarm:general"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        data = await request.json()
        opts = _merged(entry)
        opts[CONF_CODE_ARM_REQUIRED] = bool(data.get("code_arm_required", True))
        opts[CONF_TRIGGER_TIME] = int(data.get("trigger_time", DEFAULT_TRIGGER_TIME))
        opts[CONF_DISARM_AFTER_TRIGGER] = bool(data.get("disarm_after_trigger", False))
        _update(hass, entry, opts)
        return self.json({"ok": True})


class HaAlarmCodesAddView(HomeAssistantView):
    url = "/api/ha_alarm/codes/add"
    name = "api:ha_alarm:codes:add"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        data = await request.json()
        name = data.get("name", "").strip()
        code = str(data.get("code", ""))
        is_admin = bool(data.get("is_admin", False))
        if not name:
            return self.json_message("Name is required", 400)
        if len(code) < 4:
            return self.json_message("Code must be at least 4 digits", 400)
        opts = _merged(entry)
        codes = list(opts.get(CONF_CODES, []))
        if any(c[CONF_CODE_NAME] == name for c in codes):
            return self.json_message("User already exists", 409)
        salt = secrets.token_hex(16)
        codes.append({
            CONF_CODE_NAME: name,
            CONF_CODE_VALUE: _hash_code(code, salt),
            CONF_CODE_SALT: salt,
            CONF_CODE_IS_ADMIN: is_admin,
        })
        opts[CONF_CODES] = codes
        _update(hass, entry, opts)
        return self.json({"ok": True})


class HaAlarmCodesRemoveView(HomeAssistantView):
    url = "/api/ha_alarm/codes/remove"
    name = "api:ha_alarm:codes:remove"

    async def post(self, request: web.Request) -> web.Response:
        hass = request.app["hass"]
        entry = _get_entry(hass)
        if not entry:
            return self.json_message("No alarm configured", 404)
        data = await request.json()
        name = data.get("name", "").strip()
        opts = _merged(entry)
        codes = list(opts.get(CONF_CODES, []))
        remaining = [c for c in codes if c[CONF_CODE_NAME] != name]
        if not any(c.get(CONF_CODE_IS_ADMIN) for c in remaining):
            return self.json_message("Cannot remove the last admin", 400)
        opts[CONF_CODES] = remaining
        _update(hass, entry, opts)
        return self.json({"ok": True})
