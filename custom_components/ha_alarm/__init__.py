from __future__ import annotations

import re

from homeassistant.components.frontend import async_register_built_in_panel, async_remove_panel
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .const import DOMAIN, PLATFORM

PLATFORMS = [PLATFORM]
_PANEL_URL = "ha-alarm"
_PANEL_REGISTERED_KEY = "panel_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    # Register sidebar panel (guard against duplicate registration)
    if not hass.data[DOMAIN].get(_PANEL_REGISTERED_KEY):
        async_register_built_in_panel(
            hass,
            component_name="lovelace",
            sidebar_title=entry.title,
            sidebar_icon="mdi:shield-home-outline",
            frontend_url_path=_PANEL_URL,
            config={"mode": "storage", "id": _PANEL_URL},
            require_admin=False,
        )
        hass.data[DOMAIN][_PANEL_REGISTERED_KEY] = True

    # Write a default Lovelace dashboard only on first install
    store = Store(hass, 1, f"lovelace.{_PANEL_URL}")
    if await store.async_load() is None:
        safe_name = re.sub(r"[^a-z0-9_]", "_", entry.title.lower())
        entity_id = f"alarm_control_panel.{safe_name}"
        await store.async_save(
            {
                "views": [
                    {
                        "title": entry.title,
                        "icon": "mdi:shield-home",
                        "cards": [
                            {
                                "type": "alarm-panel",
                                "entity": entity_id,
                                "name": entry.title,
                                "states": [
                                    "armed_away",
                                    "armed_home",
                                    "armed_night",
                                    "armed_vacation",
                                    "armed_custom_bypass",
                                ],
                            }
                        ],
                    }
                ]
            }
        )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)
        if hass.data[DOMAIN].pop(_PANEL_REGISTERED_KEY, False):
            async_remove_panel(hass, _PANEL_URL)
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
