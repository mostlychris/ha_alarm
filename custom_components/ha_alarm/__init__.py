from __future__ import annotations

from pathlib import Path

from homeassistant.components import panel_custom
from homeassistant.components.frontend import async_remove_panel
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import API_UPDATE_FLAG, DOMAIN, PLATFORM
from .http_views import (
    HaAlarmBypassAddView,
    HaAlarmBypassRemoveView,
    HaAlarmChimeView,
    HaAlarmCodesAddView,
    HaAlarmCodesRemoveView,
    HaAlarmConfigView,
    HaAlarmDelaysView,
    HaAlarmGeneralView,
    HaAlarmIconView,
    HaAlarmNotificationsView,
    HaAlarmSensorsView,
)

PLATFORMS = [PLATFORM]
_PANEL_URL = "ha-alarm"
_STATIC_URL = "/ha_alarm_static"
_PANEL_KEY = "panel_registered"
_HTTP_KEY = "http_registered"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    hass.data.setdefault(DOMAIN, {})

    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))

    if not hass.data[DOMAIN].get(_HTTP_KEY):
        component_path = Path(__file__).parent
        frontend_path = component_path / "frontend"
        await hass.http.async_register_static_paths([
            StaticPathConfig(_STATIC_URL, str(frontend_path), cache_headers=False),
            StaticPathConfig(f"/{DOMAIN}", str(component_path), cache_headers=False),
        ])
        hass.http.register_view(HaAlarmIconView())
        hass.http.register_view(HaAlarmConfigView())
        hass.http.register_view(HaAlarmSensorsView())
        hass.http.register_view(HaAlarmDelaysView())
        hass.http.register_view(HaAlarmNotificationsView())
        hass.http.register_view(HaAlarmGeneralView())
        hass.http.register_view(HaAlarmChimeView())
        hass.http.register_view(HaAlarmBypassAddView())
        hass.http.register_view(HaAlarmBypassRemoveView())
        hass.http.register_view(HaAlarmCodesAddView())
        hass.http.register_view(HaAlarmCodesRemoveView())
        hass.data[DOMAIN][_HTTP_KEY] = True

    if not hass.data[DOMAIN].get(_PANEL_KEY):
        await panel_custom.async_register_panel(
            hass,
            webcomponent_name="ha-alarm-panel",
            frontend_url_path=_PANEL_URL,
            sidebar_title=entry.title,
            sidebar_icon="mdi:shield-home-outline",
            module_url=f"{_STATIC_URL}/ha_alarm_panel.js",
            embed_iframe=False,
        )
        hass.data[DOMAIN][_PANEL_KEY] = True

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        if hass.data[DOMAIN].pop(_PANEL_KEY, False):
            async_remove_panel(hass, _PANEL_URL)
        hass.data[DOMAIN].pop(entry.entry_id, None)
    return unload_ok


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    if hass.data.get(DOMAIN, {}).pop(API_UPDATE_FLAG, False):
        return
    await hass.config_entries.async_reload(entry.entry_id)
