const MODES = [
  { key: "armed_away",          label: "Away"     },
  { key: "armed_home",          label: "Home"     },
  { key: "armed_night",         label: "Night"    },
  { key: "armed_vacation",      label: "Vacation" },
  { key: "armed_custom_bypass", label: "Custom"   },
];

const MODE_CLASSES = {
  armed_away:          ["door","window","garage_door","opening","lock","motion","occupancy","presence","vibration","tamper"],
  armed_home:          ["door","window","garage_door","opening","lock"],
  armed_night:         ["door","window","garage_door","opening","lock","motion"],
  armed_vacation:      ["door","window","garage_door","opening","lock","motion","occupancy","presence","vibration","tamper","smoke","carbon_monoxide","moisture"],
  armed_custom_bypass: null,
};

const ALL_EVENTS = ["arming","armed","triggered","disarmed","disarming","pending","failed"];
const EVENT_LABELS = {
  arming:    "Arming",
  armed:     "Armed",
  triggered: "Triggered",
  disarmed:  "Disarmed",
  disarming: "Disarming",
  pending:   "Entry detected",
  failed:    "Invalid code",
};
const DEFAULT_MESSAGES = {
  arming:    "Alarm arming in {mode} mode — exit now.",
  armed:     "Alarm armed in {mode} mode.",
  triggered: "ALARM TRIGGERED — sensor: {sensor}.",
  disarmed:  "Alarm disarmed by {user}.",
  disarming: "Alarm disarming — initiated by {user}.",
  pending:   "Entry detected — disarm now. Sensor: {sensor}.",
  failed:    "Alarm action failed: invalid code.",
};

const BYPASS_ONE_CYCLE = 0;
const BYPASS_INDEFINITE = -1;

const TABS = [
  { id: "sensors",       label: "Sensors"       },
  { id: "delays",        label: "Delays"        },
  { id: "users",         label: "Users"         },
  { id: "notifications", label: "Notifications" },
  { id: "siren",         label: "Siren & Chime" },
  { id: "settings",      label: "Settings"      },
];

class HaAlarmPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass           = null;
    this._config         = null;
    this._activeTab      = "sensors";
    this._activeMode     = "armed_away";
    this._showOthers     = {};
    this._pendingSensors = {};
    this._bypassOpen     = null;
    this._ready          = false;
  }

  set hass(hass) {
    this._hass = hass;
    const menuBtn = this.shadowRoot.querySelector("#ha-menu-btn");
    if (menuBtn) menuBtn.hass = hass;
    if (!this._ready) {
      this._ready = true;
      this._build();
      this._load();
    } else {
      this._refreshBadge();
      if (this._config && this._activeTab === "sensors") {
        this._renderSensors();
        this._renderSelectedChips();
        this._refreshOpenWarning();
      }
    }
  }

  // ── API ──────────────────────────────────────────────────────────────────

  async _api(method, path, body) {
    try {
      return await this._hass.callApi(method, `ha_alarm/${path}`, body);
    } catch (e) {
      this._toast(e?.body?.message || e?.message || "Request failed", true);
      throw e;
    }
  }

  async _load() {
    this._config = await this._api("GET", "config");
    this._populate();
  }

  // ── Build shell ───────────────────────────────────────────────────────────

  _build() {
    this.shadowRoot.innerHTML = `<style>${CSS}</style>
<div class="app-header">
  <ha-menu-button id="ha-menu-btn"></ha-menu-button>
  <span class="header-title">Alarm Configuration</span>
  <span class="badge disarmed" id="badge">Loading…</span>
</div>
<nav class="tab-bar">
  ${TABS.map((t, i) => `<button class="tab-btn${i === 0 ? " active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
</nav>
<div class="panel">

  <div id="open-warning" class="open-warning gone"></div>

  <!-- SENSORS -->
  <div id="tab-sensors" class="tab-pane">
    <div class="mode-bar" id="mode-tabs">
      ${MODES.map((m, i) => `<button class="mode-btn${i === 0 ? " active" : ""}" data-mode="${m.key}">${m.label}</button>`).join("")}
    </div>
    <div id="selected-chips" class="selected-chips"></div>
    <p class="sensor-picker-hdr">Add sensors</p>
    <div id="sensor-list"></div>
    <div class="pane-footer">
      <button class="btn" id="save-sensors">Save sensors for this mode</button>
    </div>
  </div>

  <!-- DELAYS -->
  <div id="tab-delays" class="tab-pane gone">
    <div id="delays-grid" class="delays-grid"></div>
    <div class="pane-footer">
      <button class="btn" id="save-delays">Save delays</button>
    </div>
  </div>

  <!-- USERS -->
  <div id="tab-users" class="tab-pane gone">
    <div id="users-list"></div>
    <div class="ruled-divider"><span>Add user</span></div>
    <div class="form-card">
      <div class="form-row">
        <label>Name</label>
        <input type="text" id="new-name" placeholder="Display name">
      </div>
      <div class="form-row">
        <label>PIN</label>
        <input type="password" id="new-code" placeholder="Min. 4 digits">
      </div>
      <div class="form-row">
        <label>Admin</label>
        <label class="sw"><input type="checkbox" id="new-admin"><span class="sw-track"></span></label>
      </div>
    </div>
    <div class="pane-footer">
      <button class="btn" id="add-user">Add user</button>
    </div>
  </div>

  <!-- NOTIFICATIONS -->
  <div id="tab-notifications" class="tab-pane gone">
    <p class="sec-label">Notification targets</p>
    <div id="notif-services" class="svc-grid"><p class="muted">Loading…</p></div>
    <div class="setting-row" style="margin-top:16px">
      <div class="setting-text">
        <div class="setting-title">High priority</div>
        <div class="setting-sub">Android: ttl=0 / priority=high · iOS: time-sensitive</div>
      </div>
      <label class="sw"><input type="checkbox" id="notif-high-priority"><span class="sw-track"></span></label>
    </div>
    <div class="ruled-divider" style="margin-top:20px"><span>Events &amp; messages</span></div>
    <p class="hint" style="margin-bottom:10px">Placeholders: <code>{mode}</code> <code>{sensor}</code> <code>{user}</code> — leave message blank for the default.</p>
    <div id="event-rows" class="event-table"></div>
    <div class="pane-footer">
      <button class="btn outline" id="test-notif">Send test</button>
      <button class="btn" id="save-notif">Save notifications</button>
    </div>
  </div>

  <!-- SIREN & CHIME -->
  <div id="tab-siren" class="tab-pane gone">
    <p class="sec-label">Alarm siren</p>
    <div class="form-card">
      <div class="form-row">
        <label>Siren entity</label>
        <select id="siren-entity" class="sel"></select>
      </div>
      <div class="form-row">
        <label>Alarm tone</label>
        <input type="text" id="siren-tone" placeholder="Tone ID (blank = generic on/off)">
      </div>
      <div class="form-row">
        <label>Volume</label>
        <div class="vol-wrap">
          <input type="range" id="siren-volume" min="0" max="1" step="0.05">
          <input type="number" id="siren-volume-num" min="0" max="1" step="0.05" class="vol-num" placeholder="0–1">
        </div>
      </div>
      <div class="form-row">
        <label>Repeat</label>
        <div class="inline-wrap">
          <input type="number" id="siren-repeat" min="0" max="300" class="short-num">
          <span class="hint-inline">s between triggers (0 = play once)</span>
        </div>
      </div>
    </div>
    <p class="sec-label" style="margin-top:24px">Entry warning tone</p>
    <div class="form-card">
      <div class="form-row">
        <label>Pending tone</label>
        <input type="text" id="pending-tone" placeholder="Tone ID (blank = silent during entry delay)">
      </div>
      <div class="form-row">
        <label>Volume</label>
        <div class="vol-wrap">
          <input type="range" id="pending-volume" min="0" max="1" step="0.05">
          <input type="number" id="pending-volume-num" min="0" max="1" step="0.05" class="vol-num" placeholder="0–1">
        </div>
      </div>
      <div class="form-row">
        <label>Repeat</label>
        <div class="inline-wrap">
          <input type="number" id="pending-repeat" min="0" max="300" class="short-num">
          <span class="hint-inline">s between triggers (0 = play once)</span>
        </div>
      </div>
    </div>
    <p class="sec-label" style="margin-top:24px">Chime mode</p>
    <div class="form-card">
      <div class="setting-row">
        <div class="setting-text">
          <div class="setting-title">Enable chime</div>
          <div class="setting-sub">Plays a tone when a chime sensor opens while the alarm is disarmed</div>
        </div>
        <label class="sw"><input type="checkbox" id="chime-mode"><span class="sw-track"></span></label>
      </div>
      <div style="margin-top:14px">
        <p class="field-label">Chime sensors</p>
        <div id="chime-sensor-list" class="chime-sensor-list"><p class="muted">Loading…</p></div>
      </div>
      <div class="form-row" style="margin-top:12px">
        <label>Chime tone</label>
        <input type="text" id="chime-tone" placeholder="Tone ID">
      </div>
      <div class="form-row">
        <label>Volume</label>
        <div class="vol-wrap">
          <input type="range" id="chime-volume" min="0" max="1" step="0.05">
          <input type="number" id="chime-volume-num" min="0" max="1" step="0.05" class="vol-num" placeholder="0–1">
        </div>
      </div>
    </div>
    <div class="pane-footer">
      <button class="btn" id="save-siren">Save siren &amp; chime</button>
    </div>
  </div>

  <!-- SETTINGS -->
  <div id="tab-settings" class="tab-pane gone">
    <div class="settings-stack">
      <div class="setting-row">
        <div class="setting-text">
          <div class="setting-title">Require code to arm</div>
          <div class="setting-sub">When off, arm buttons work without a PIN. Disarm always requires a code.</div>
        </div>
        <label class="sw"><input type="checkbox" id="arm-req" checked><span class="sw-track"></span></label>
      </div>
      <div class="setting-row">
        <div class="setting-text">
          <div class="setting-title">Disarm after trigger</div>
          <div class="setting-sub">When on, the alarm disarms automatically after the trigger duration. When off, it re-arms.</div>
        </div>
        <label class="sw"><input type="checkbox" id="disarm-after-trigger"><span class="sw-track"></span></label>
      </div>
      <div class="setting-row">
        <div class="setting-text">
          <div class="setting-title">Trigger duration</div>
          <div class="setting-sub">How long the alarm stays triggered before auto-resolving. 0 = indefinite.</div>
        </div>
        <div class="inline-wrap">
          <input type="number" id="trigger-time" min="0" max="3600" step="30" class="short-num">
          <span class="hint-inline">seconds</span>
        </div>
      </div>
    </div>
    <div class="pane-footer">
      <button class="btn" id="save-settings">Save settings</button>
    </div>
  </div>

</div>
<div id="toast" class="toast gone"></div>`;

    this._wire();
    this._refreshBadge();
  }

  // ── Wire events ───────────────────────────────────────────────────────────

  _wire() {
    const sr = this.shadowRoot;

    // Tab switching
    sr.querySelectorAll(".tab-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        sr.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
        sr.querySelectorAll(".tab-pane").forEach(p => p.classList.add("gone"));
        btn.classList.add("active");
        this._activeTab = btn.dataset.tab;
        sr.querySelector(`#tab-${this._activeTab}`)?.classList.remove("gone");
        if (this._config) this._renderTab(this._activeTab);
      });
    });

    // Mode tabs
    sr.querySelector("#mode-tabs")?.addEventListener("click", e => {
      const btn = e.target.closest(".mode-btn");
      if (!btn) return;
      sr.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      this._activeMode = btn.dataset.mode;
      this._bypassOpen = null;
      if (this._config) {
        this._renderSensors();
        this._renderSelectedChips();
      }
    });

    // Volume slider ↔ number sync
    for (const [sid, nid] of [["siren-volume","siren-volume-num"],["pending-volume","pending-volume-num"],["chime-volume","chime-volume-num"]]) {
      const s = sr.querySelector(`#${sid}`), n = sr.querySelector(`#${nid}`);
      if (s && n) {
        s.addEventListener("input", () => { n.value = parseFloat(s.value).toFixed(2); });
        n.addEventListener("input", () => { s.value = Math.min(1, Math.max(0, parseFloat(n.value) || 0)); });
      }
    }

    sr.querySelector("#save-sensors") ?.addEventListener("click", () => this._saveSensors());
    sr.querySelector("#save-delays")  ?.addEventListener("click", () => this._saveDelays());
    sr.querySelector("#add-user")     ?.addEventListener("click", () => this._addUser());
    sr.querySelector("#save-notif")   ?.addEventListener("click", () => this._saveNotif());
    sr.querySelector("#test-notif")   ?.addEventListener("click", () => this._testNotif());
    sr.querySelector("#save-siren")   ?.addEventListener("click", () => this._saveSiren());
    sr.querySelector("#save-settings")?.addEventListener("click", () => this._saveSettings());
  }

  // ── Populate ──────────────────────────────────────────────────────────────

  _populate() {
    this._refreshBadge();
    this._refreshOpenWarning();
    this._renderTab(this._activeTab);
  }

  _renderTab(tab) {
    switch (tab) {
      case "sensors":       this._renderSensors(); this._renderSelectedChips(); break;
      case "delays":        this._renderDelays(); break;
      case "users":         this._renderUsers(); break;
      case "notifications": this._renderNotifications(); break;
      case "siren":         this._renderSiren(); break;
      case "settings":      this._renderSettings(); break;
    }
  }

  _refreshBadge() {
    const badge = this.shadowRoot.querySelector("#badge");
    if (!badge || !this._hass) return;
    const entity = Object.values(this._hass.states).find(s => s.entity_id.startsWith("alarm_control_panel."));
    if (!entity) { badge.textContent = "No entity"; return; }
    const state = entity.state;
    badge.textContent = state.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    badge.className = "badge " + (
      state === "disarmed"  ? "disarmed"  :
      state === "triggered" ? "triggered" :
      state === "arming" || state === "pending" ? "pending" : "armed"
    );
  }

  _refreshOpenWarning() {
    const banner = this.shadowRoot.querySelector("#open-warning");
    if (!banner || !this._config) return;
    const bypassed = new Set(Object.keys(this._config.bypassed_sensors || {}));
    const affected = [];
    MODES.forEach(m => {
      const open = (this._config.sensors?.[m.key] || []).filter(id =>
        !bypassed.has(id) && this._hass.states[id]?.state === "on"
      );
      if (open.length) {
        const names = open.map(id => this._hass.states[id]?.attributes?.friendly_name || id).join(", ");
        affected.push(`<strong>${m.label}:</strong> ${names}`);
      }
    });
    if (!affected.length) { banner.className = "open-warning gone"; return; }
    banner.className = "open-warning";
    banner.innerHTML = `<span class="warn-icon">⚠</span><div><div class="warn-title">Open sensors — arming blocked</div><div class="warn-detail">${affected.join("<br>")}</div></div>`;
  }

  // ── Sensors tab ───────────────────────────────────────────────────────────

  _binarySensors() {
    return Object.values(this._hass.states)
      .filter(s => s.entity_id.startsWith("binary_sensor."))
      .sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id));
  }

  _renderSelectedChips() {
    const el = this.shadowRoot.querySelector("#selected-chips");
    if (!el) return;
    const selected = this._pendingSensors[this._activeMode] ?? new Set(this._config?.sensors?.[this._activeMode] || []);
    const bypassed = this._config?.bypassed_sensors || {};
    if (!selected.size) {
      el.innerHTML = `<span class="chips-empty">No sensors selected for this mode</span>`;
      return;
    }
    el.innerHTML = [...selected].map(id => {
      const state = this._hass.states[id];
      const name  = state?.attributes?.friendly_name || id;
      const open  = state?.state === "on";
      const byp   = bypassed[id] !== undefined;
      return `<span class="sel-chip${open ? " open" : byp ? " bypassed" : ""}" title="${id}">
        ${name}
        <button class="chip-x" data-id="${id}">×</button>
      </span>`;
    }).join("");
    el.querySelectorAll(".chip-x").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const pending = new Set(this._pendingSensors[this._activeMode] ?? (this._config?.sensors?.[this._activeMode] || []));
        pending.delete(btn.dataset.id);
        this._pendingSensors[this._activeMode] = pending;
        this._renderSensors();
        this._renderSelectedChips();
      });
    });
  }

  _renderSensors() {
    const sr        = this.shadowRoot;
    const container = sr.querySelector("#sensor-list");
    if (!container) return;

    const selected = this._pendingSensors[this._activeMode] ?? new Set(this._config?.sensors?.[this._activeMode] || []);
    const bypasses = this._config?.bypassed_sensors || {};
    const classes  = MODE_CLASSES[this._activeMode];
    const all      = this._binarySensors();
    const suggested = classes ? all.filter(s => classes.includes(s.attributes.device_class)) : all;
    const others    = classes ? all.filter(s => !classes.includes(s.attributes.device_class)) : [];

    // Only show sensors not yet selected — selected ones are displayed as chips above
    const suggestedUnselected = suggested.filter(s => !selected.has(s.entity_id));
    const othersUnselected    = others.filter(s => !selected.has(s.entity_id));

    const isOpen = s => this._hass.states[s.entity_id]?.state === "on";
    const sortGroup = arr => arr.slice().sort((a, b) => {
      const aopn = isOpen(a), bopn = isOpen(b);
      if (aopn !== bopn) return aopn ? -1 : 1;
      return (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id);
    });

    const bypassLabel = until => {
      if (until === BYPASS_ONE_CYCLE) return "bypass: one cycle";
      if (until === BYPASS_INDEFINITE) return "bypass: indefinite";
      const rem = until - Math.floor(Date.now() / 1000);
      if (rem < 3600)  return `bypass: ${Math.ceil(rem/60)}m left`;
      if (rem < 86400) return `bypass: ${Math.ceil(rem/3600)}h left`;
      return `bypass: ${Math.ceil(rem/86400)}d left`;
    };

    const row = s => {
      const name    = s.attributes.friendly_name || s.entity_id;
      const dc      = s.attributes.device_class || "sensor";
      const open    = isOpen(s);
      const byp     = bypasses[s.entity_id];
      const hasByp  = byp !== undefined;
      const bpOpen  = this._bypassOpen === s.entity_id;

      const stateChip = hasByp
        ? `<span class="chip warn">${bypassLabel(byp)}</span>`
        : open
          ? `<span class="chip danger">open</span>`
          : `<span class="chip dc">${dc}</span>`;

      const bypassCtrl = hasByp
        ? `<button class="bypass-clear" data-id="${s.entity_id}">Clear bypass</button>`
        : `<button class="bypass-add${bpOpen ? " active" : ""}" data-id="${s.entity_id}">Bypass</button>`;

      const picker = bpOpen ? `
        <div class="bypass-picker">
          <button class="byp-dur" data-dur="0">One cycle</button>
          <button class="byp-dur" data-dur="86400">24 hours</button>
          <button class="byp-dur" data-dur="604800">7 days</button>
          <button class="byp-dur" data-dur="-1">Indefinite</button>
          <button class="byp-cancel">✕</button>
        </div>` : "";

      return `<div class="sensor-row${open && !hasByp ? " s-open" : ""}${hasByp ? " s-bypassed" : ""}">
        <label class="sensor-label">
          <input type="checkbox" class="s-cb" value="${s.entity_id}" ${selected.has(s.entity_id) ? "checked" : ""}>
          <span class="sensor-name">${name}</span>
        </label>
        ${stateChip}
        ${bypassCtrl}
        ${picker}
      </div>`;
    };

    let html = "";
    const sortedMain = sortGroup(suggestedUnselected);
    if (sortedMain.length) {
      html += `<p class="group-hdr">${classes ? "Suggested for this mode" : "All sensors"}</p>`;
      html += sortedMain.map(row).join("");
    }
    const sortedOthers = sortGroup(othersUnselected);
    if (sortedOthers.length) {
      const show = this._showOthers[this._activeMode];
      html += `<button class="group-hdr toggle-others" data-mode="${this._activeMode}">
        Other sensors (${sortedOthers.length}) <span>${show ? "▾" : "▸"}</span>
      </button>`;
      if (show) html += sortedOthers.map(row).join("");
    }
    if (!html) {
      html = all.length
        ? `<p class="muted" style="padding:10px 0">All sensors for this mode are already selected.</p>`
        : `<p class="muted" style="padding:10px 0">No binary sensors found in Home Assistant.</p>`;
    }

    container.innerHTML = html;

    container.querySelectorAll(".toggle-others").forEach(btn =>
      btn.addEventListener("click", () => {
        this._showOthers[btn.dataset.mode] = !this._showOthers[btn.dataset.mode];
        this._renderSensors();
      })
    );
    container.querySelectorAll(".s-cb").forEach(cb =>
      cb.addEventListener("change", () => {
        const pending = new Set(this._pendingSensors[this._activeMode] ?? (this._config?.sensors?.[this._activeMode] || []));
        if (cb.checked) pending.add(cb.value);
        else pending.delete(cb.value);
        this._pendingSensors[this._activeMode] = pending;
        this._renderSensors();
        this._renderSelectedChips();
      })
    );
    container.querySelectorAll(".bypass-add").forEach(btn =>
      btn.addEventListener("click", e => {
        e.stopPropagation();
        this._bypassOpen = this._bypassOpen === btn.dataset.id ? null : btn.dataset.id;
        this._renderSensors();
      })
    );
    container.querySelectorAll(".byp-dur").forEach(btn =>
      btn.addEventListener("click", async () => {
        const sid = btn.closest(".sensor-row").querySelector(".bypass-add, .bypass-clear")?.dataset.id
          || this._bypassOpen;
        const dur = parseInt(btn.dataset.dur, 10);
        await this._api("POST", "bypass/add", { sensor_id: sid, duration: dur });
        this._bypassOpen = null;
        this._config = await this._api("GET", "config");
        this._renderSensors();
        this._renderSelectedChips();
        this._toast("Bypass set ✓");
      })
    );
    container.querySelectorAll(".byp-cancel").forEach(btn =>
      btn.addEventListener("click", () => { this._bypassOpen = null; this._renderSensors(); })
    );
    container.querySelectorAll(".bypass-clear").forEach(btn =>
      btn.addEventListener("click", async () => {
        await this._api("POST", "bypass/remove", { sensor_id: btn.dataset.id });
        this._config = await this._api("GET", "config");
        this._renderSensors();
        this._renderSelectedChips();
        this._toast("Bypass cleared ✓");
      })
    );
  }

  async _saveSensors() {
    const sensors = { ...(this._config?.sensors || {}) };
    const sel = this._pendingSensors[this._activeMode] ?? new Set(this._config?.sensors?.[this._activeMode] || []);
    sensors[this._activeMode] = [...sel];
    await this._api("POST", "sensors", sensors);
    if (this._config) this._config.sensors = sensors;
    delete this._pendingSensors[this._activeMode];
    this._renderSensors();
    this._renderSelectedChips();
    this._toast("Sensors saved ✓");
  }

  // ── Delays tab ────────────────────────────────────────────────────────────

  _renderDelays() {
    const el = this.shadowRoot.querySelector("#delays-grid");
    if (!el) return;
    const delays = this._config?.delays || {};
    el.innerHTML = MODES.map(m => {
      const d = delays[m.key] || {};
      return `<div class="delay-card">
        <div class="delay-mode">${m.label}</div>
        <div class="delay-fields">
          <div class="delay-field">
            <label>Entry delay</label>
            <div class="inline-wrap">
              <input type="number" class="short-num delay-inp" min="0" max="600" step="5"
                data-mode="${m.key}" data-t="entry_delay" value="${d.entry_delay ?? 30}">
              <span class="hint-inline">sec</span>
            </div>
          </div>
          <div class="delay-field">
            <label>Exit delay</label>
            <div class="inline-wrap">
              <input type="number" class="short-num delay-inp" min="0" max="600" step="5"
                data-mode="${m.key}" data-t="exit_delay" value="${d.exit_delay ?? 60}">
              <span class="hint-inline">sec</span>
            </div>
          </div>
        </div>
      </div>`;
    }).join("");
  }

  async _saveDelays() {
    const delays = {};
    MODES.forEach(m => { delays[m.key] = {}; });
    this.shadowRoot.querySelectorAll(".delay-inp").forEach(inp => {
      delays[inp.dataset.mode][inp.dataset.t] = parseInt(inp.value, 10) || 0;
    });
    await this._api("POST", "delays", delays);
    if (this._config) this._config.delays = delays;
    this._toast("Delays saved ✓");
  }

  // ── Users tab ─────────────────────────────────────────────────────────────

  _renderUsers() {
    const el = this.shadowRoot.querySelector("#users-list");
    if (!el) return;
    const codes = this._config?.codes || [];
    if (!codes.length) { el.innerHTML = `<p class="muted">No users configured.</p>`; return; }
    el.innerHTML = `<div class="user-cards">${codes.map(c => `
      <div class="user-card">
        <div class="user-meta">
          <span class="user-name">${c.name}</span>
          <span class="role-chip${c.is_admin ? "" : " user"}">${c.is_admin ? "Admin" : "User"}</span>
        </div>
        <button class="icon-btn danger rm-user" data-name="${c.name}" title="Remove ${c.name}">✕</button>
      </div>`).join("")}</div>`;
    el.querySelectorAll(".rm-user").forEach(btn =>
      btn.addEventListener("click", () => this._removeUser(btn.dataset.name))
    );
  }

  async _addUser() {
    const sr      = this.shadowRoot;
    const name    = sr.querySelector("#new-name")?.value.trim();
    const code    = sr.querySelector("#new-code")?.value || "";
    const isAdmin = sr.querySelector("#new-admin")?.checked || false;
    if (!name)           return this._toast("Name is required", true);
    if (code.length < 4) return this._toast("Code must be at least 4 digits", true);
    await this._api("POST", "codes/add", { name, code, is_admin: isAdmin });
    sr.querySelector("#new-name").value    = "";
    sr.querySelector("#new-code").value    = "";
    sr.querySelector("#new-admin").checked = false;
    this._config = await this._api("GET", "config");
    this._renderUsers();
    this._toast("User added ✓");
  }

  async _removeUser(name) {
    if (!confirm(`Remove user "${name}"?`)) return;
    await this._api("POST", "codes/remove", { name });
    this._config = await this._api("GET", "config");
    this._renderUsers();
    this._toast("User removed ✓");
  }

  // ── Notifications tab ─────────────────────────────────────────────────────

  _renderNotifications() {
    const sr = this.shadowRoot;
    const n  = this._config?.notifications || {};
    const enabledTargets = new Set(n.notify_targets || []);

    const container = sr.querySelector("#notif-services");
    if (container) {
      const svcs      = this._hass?.services?.notify || {};
      const available = Object.keys(svcs).sort((a, b) => {
        const ao = enabledTargets.has(`notify.${a}`), bo = enabledTargets.has(`notify.${b}`);
        return ao !== bo ? (ao ? -1 : 1) : a.localeCompare(b);
      });
      if (!available.length) {
        container.innerHTML = `<p class="muted">No notify services found. Add a Mobile App integration first.</p>`;
      } else {
        container.innerHTML = available.map(s => {
          const id      = `notify.${s}`;
          const label   = s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
          const checked = enabledTargets.has(id) ? "checked" : "";
          return `<label class="svc-card${enabledTargets.has(id) ? " on" : ""}">
            <input type="checkbox" class="svc-cb" value="${id}" ${checked}>
            <span class="svc-name">${label}</span>
            <code class="svc-id">${id}</code>
          </label>`;
        }).join("");
        // Update styling on toggle
        container.querySelectorAll(".svc-cb").forEach(cb =>
          cb.addEventListener("change", () => cb.closest(".svc-card").classList.toggle("on", cb.checked))
        );
      }
    }

    const hp = sr.querySelector("#notif-high-priority");
    if (hp) hp.checked = n.high_priority === true;

    const evts = n.notify_events || {};
    const msgs = n.messages      || {};
    const evtEl = sr.querySelector("#event-rows");
    if (evtEl) {
      evtEl.innerHTML = ALL_EVENTS.map(e => `
        <div class="event-row">
          <label class="event-check">
            <input type="checkbox" class="ev-cb" data-event="${e}" ${evts[e] !== false ? "checked" : ""}>
            <span class="event-lbl">${EVENT_LABELS[e]}</span>
          </label>
          <input type="text" class="ev-msg" data-event="${e}" value="${msgs[e] || ""}" placeholder="${DEFAULT_MESSAGES[e]}">
        </div>`).join("");
    }
  }

  async _saveNotif() {
    const sr      = this.shadowRoot;
    const targets = [...sr.querySelectorAll(".svc-cb:checked")].map(cb => cb.value);
    const events  = {};
    ALL_EVENTS.forEach(e => { events[e] = false; });
    sr.querySelectorAll(".ev-cb").forEach(cb => { events[cb.dataset.event] = cb.checked; });
    const messages = {};
    sr.querySelectorAll(".ev-msg").forEach(inp => {
      const v = inp.value.trim();
      if (v) messages[inp.dataset.event] = v;
    });
    const high_priority = sr.querySelector("#notif-high-priority")?.checked ?? false;
    const payload = { notify_targets: targets, notify_events: events, high_priority, messages };
    await this._api("POST", "notifications", payload);
    if (this._config) this._config.notifications = payload;
    this._toast("Notifications saved ✓");
  }

  async _testNotif() {
    const n = this._config?.notifications || {};
    const targets = n.notify_targets || [];
    if (!targets.length) return this._toast("No notification targets configured", true);
    const data = { title: "HA Alarm — Test", message: "Test notification from HA Alarm. Delivery confirmed." };
    if (n.high_priority) data.data = { ttl: 0, priority: "high", push: { "interruption-level": "time-sensitive" } };
    try {
      for (const t of targets) {
        const dot = t.indexOf(".");
        await this._hass.callService(t.slice(0, dot), t.slice(dot + 1), data);
      }
      this._toast(`Test sent to ${targets.length} target${targets.length > 1 ? "s" : ""} ✓`);
    } catch (e) {
      this._toast(e?.message || "Failed to send test", true);
    }
  }

  // ── Siren & Chime tab ─────────────────────────────────────────────────────

  _renderSiren() {
    const sr = this.shadowRoot;

    // Siren entity select
    const sirenSel = sr.querySelector("#siren-entity");
    const cur      = this._config?.siren_entity || "";
    if (sirenSel) {
      const entities = Object.values(this._hass.states)
        .filter(s => s.entity_id.startsWith("siren."))
        .sort((a, b) => (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id));
      let opts = `<option value="">— None —</option>`;
      entities.forEach(e => {
        const name = e.attributes.friendly_name || e.entity_id;
        opts += `<option value="${e.entity_id}"${e.entity_id === cur ? " selected" : ""}>${name}</option>`;
      });
      if (cur && !entities.find(e => e.entity_id === cur))
        opts += `<option value="${cur}" selected>${cur}</option>`;
      sirenSel.innerHTML = opts;
    }

    const set = (id, v) => { const el = sr.querySelector(`#${id}`); if (el) el.value = v ?? ""; };
    set("siren-tone",        this._config?.siren_tone    || "");
    set("siren-volume",      this._config?.siren_volume  ?? 0);
    set("siren-volume-num",  this._config?.siren_volume  ?? 0);
    set("siren-repeat",      this._config?.siren_repeat  ?? 0);
    set("pending-tone",      this._config?.pending_tone  || "");
    set("pending-volume",    this._config?.pending_volume ?? 0);
    set("pending-volume-num",this._config?.pending_volume ?? 0);
    set("pending-repeat",    this._config?.pending_repeat ?? 0);

    const cm = sr.querySelector("#chime-mode");
    if (cm) cm.checked = this._config?.chime_mode === true;
    set("chime-tone",       this._config?.chime_tone   || "");
    set("chime-volume",     this._config?.chime_volume ?? 0);
    set("chime-volume-num", this._config?.chime_volume ?? 0);

    // Chime sensor list
    const csl = sr.querySelector("#chime-sensor-list");
    if (csl) {
      const chimeSel = new Set(this._config?.chime_sensors || []);
      const all = this._binarySensors().sort((a, b) => {
        const ao = chimeSel.has(a.entity_id), bo = chimeSel.has(b.entity_id);
        return ao !== bo ? (ao ? -1 : 1) : (a.attributes.friendly_name || a.entity_id).localeCompare(b.attributes.friendly_name || b.entity_id);
      });
      if (!all.length) {
        csl.innerHTML = `<p class="muted">No binary sensors found.</p>`;
      } else {
        csl.innerHTML = all.map(s => {
          const name = s.attributes.friendly_name || s.entity_id;
          const dc   = s.attributes.device_class || "—";
          return `<div class="sensor-row">
            <label class="sensor-label">
              <input type="checkbox" class="chime-cb" value="${s.entity_id}" ${chimeSel.has(s.entity_id) ? "checked" : ""}>
              <span class="sensor-name">${name}</span>
            </label>
            <span class="chip dc">${dc}</span>
          </div>`;
        }).join("");
      }
    }
  }

  async _saveSiren() {
    const sr = this.shadowRoot;
    const general = {
      code_arm_required:    this._config?.code_arm_required    ?? true,
      trigger_time:         this._config?.trigger_time         ?? 600,
      disarm_after_trigger: this._config?.disarm_after_trigger ?? false,
      siren_entity:  sr.querySelector("#siren-entity")?.value || "",
      siren_tone:    sr.querySelector("#siren-tone")?.value.trim()    || "",
      siren_volume:  parseFloat(sr.querySelector("#siren-volume-num")?.value  || "0"),
      siren_repeat:  parseInt(sr.querySelector("#siren-repeat")?.value        || "0", 10),
      pending_tone:  sr.querySelector("#pending-tone")?.value.trim()  || "",
      pending_volume:parseFloat(sr.querySelector("#pending-volume-num")?.value|| "0"),
      pending_repeat:parseInt(sr.querySelector("#pending-repeat")?.value      || "0", 10),
    };
    const chime = {
      chime_mode:    sr.querySelector("#chime-mode")?.checked ?? false,
      chime_sensors: [...sr.querySelectorAll(".chime-cb:checked")].map(cb => cb.value),
      chime_tone:    sr.querySelector("#chime-tone")?.value.trim() || "",
      chime_volume:  parseFloat(sr.querySelector("#chime-volume-num")?.value || "0"),
    };
    await Promise.all([
      this._api("POST", "general", general),
      this._api("POST", "chime",   chime),
    ]);
    if (this._config) Object.assign(this._config, general, chime);
    this._toast("Siren & chime saved ✓");
  }

  // ── Settings tab ──────────────────────────────────────────────────────────

  _renderSettings() {
    const sr = this.shadowRoot;
    const set = (id, v) => { const el = sr.querySelector(`#${id}`); if (el) el.checked = v; };
    set("arm-req",              this._config?.code_arm_required    !== false);
    set("disarm-after-trigger", this._config?.disarm_after_trigger === true);
    const tt = sr.querySelector("#trigger-time");
    if (tt) tt.value = this._config?.trigger_time ?? 600;
  }

  async _saveSettings() {
    const sr = this.shadowRoot;
    const payload = {
      code_arm_required:    sr.querySelector("#arm-req")?.checked             ?? true,
      trigger_time:         parseInt(sr.querySelector("#trigger-time")?.value || "600", 10),
      disarm_after_trigger: sr.querySelector("#disarm-after-trigger")?.checked ?? false,
      siren_entity:         this._config?.siren_entity   ?? "",
      siren_tone:           this._config?.siren_tone     ?? "",
      siren_volume:         this._config?.siren_volume   ?? 0,
      siren_repeat:         this._config?.siren_repeat   ?? 0,
      pending_tone:         this._config?.pending_tone   ?? "",
      pending_volume:       this._config?.pending_volume ?? 0,
      pending_repeat:       this._config?.pending_repeat ?? 0,
    };
    await this._api("POST", "general", payload);
    if (this._config) Object.assign(this._config, payload);
    this._toast("Settings saved ✓");
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  _toast(msg, err = false) {
    const el = this.shadowRoot.querySelector("#toast");
    if (!el) return;
    el.textContent = msg;
    el.className   = `toast${err ? " err" : ""}`;
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => { el.className = "toast gone"; }, 3000);
  }
}

// ── Styles ─────────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:host{display:block}

/* ── Header ── */
.app-header{
  position:sticky;top:0;z-index:5;
  display:flex;align-items:center;gap:4px;
  padding:0 16px 0 4px;height:56px;
  background:var(--app-header-background-color,var(--primary-color,#03a9f4));
  color:var(--app-header-text-color,#fff);
  box-shadow:0 2px 4px rgba(0,0,0,.14),0 1px 10px rgba(0,0,0,.12);
}
.header-title{flex:1;font-size:20px;font-weight:400}
.badge{padding:3px 12px;border-radius:12px;font-size:12px;font-weight:500;flex-shrink:0}
.badge.disarmed {background:#4caf5022;color:#4caf50}
.badge.armed    {background:#2196f322;color:#2196f3}
.badge.triggered{background:#f4433622;color:#f44336}
.badge.pending  {background:#ff980022;color:#ff9800}

/* ── Tab bar ── */
.tab-bar{
  position:sticky;top:56px;z-index:4;
  display:flex;overflow-x:auto;scrollbar-width:none;
  background:var(--card-background-color,#1c1e26);
  border-bottom:2px solid var(--divider-color,#383c4a);
  padding:0 8px;
}
.tab-bar::-webkit-scrollbar{display:none}
.tab-btn{
  flex-shrink:0;
  padding:0 18px;height:48px;
  background:transparent;border:none;border-bottom:2px solid transparent;margin-bottom:-2px;
  color:var(--secondary-text-color,#9095a5);
  font-size:14px;font-family:inherit;cursor:pointer;
  transition:color .15s;
}
.tab-btn:hover{color:var(--primary-text-color,#e8e8e8)}
.tab-btn.active{
  color:var(--primary-color,#03a9f4);
  border-bottom-color:var(--primary-color,#03a9f4);
  font-weight:500;
}

/* ── Panel ── */
.panel{
  max-width:740px;margin:0 auto;
  padding:24px 16px 80px;
  font-family:var(--paper-font-body1_-_font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  color:var(--primary-text-color,#e8e8e8);
  font-size:14px;
}
.tab-pane{}
.gone{display:none!important}

/* ── Open-sensor warning ── */
.open-warning{
  display:flex;align-items:flex-start;gap:10px;
  background:#f4433612;border:1px solid #f4433640;
  border-radius:10px;padding:12px 16px;margin-bottom:18px;
  font-size:13px;line-height:1.5;
}
.warn-icon{font-size:18px;flex-shrink:0;margin-top:1px}
.warn-title{font-weight:600;color:#f44336;margin-bottom:2px}
.warn-detail{color:var(--primary-text-color,#e8e8e8)}

/* ── Mode bar ── */
.mode-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px}
.mode-btn{
  padding:6px 18px;border-radius:20px;
  border:1px solid var(--divider-color,#383c4a);
  background:transparent;color:var(--secondary-text-color,#9095a5);
  cursor:pointer;font-size:13px;font-family:inherit;transition:all .15s;
}
.mode-btn:hover{border-color:var(--primary-color,#03a9f4);color:var(--primary-text-color,#e8e8e8)}
.mode-btn.active{background:var(--primary-color,#03a9f4);color:#fff;border-color:transparent}

/* ── Selected chips strip ── */
.selected-chips{
  display:flex;flex-wrap:wrap;gap:6px;
  min-height:30px;margin-bottom:16px;align-items:center;
}
.chips-empty{font-size:12px;color:var(--secondary-text-color,#9095a5)}
.sel-chip{
  display:inline-flex;align-items:center;gap:4px;
  background:var(--primary-color,#03a9f4)18;
  border:1px solid var(--primary-color,#03a9f4)44;
  color:var(--primary-text-color,#e8e8e8);
  padding:3px 6px 3px 10px;border-radius:20px;font-size:12px;white-space:nowrap;
}
.sel-chip.open    {background:#f4433618;border-color:#f4433640}
.sel-chip.bypassed{background:#ff980018;border-color:#ff980040}
.chip-x{
  background:none;border:none;color:var(--secondary-text-color,#9095a5);
  cursor:pointer;font-size:15px;padding:0 2px;line-height:1;
}
.chip-x:hover{color:#f44336}

/* ── Sensor picker section ── */
.sensor-picker-hdr{
  font-size:11px;text-transform:uppercase;letter-spacing:.6px;
  color:var(--secondary-text-color,#9095a5);
  margin:0 0 6px;padding:0;
}
#sensor-list{
  border:1px solid var(--divider-color,#383c4a);
  border-radius:8px;padding:0 12px;margin-bottom:16px;
}

/* ── Sensor rows ── */
.group-hdr{
  font-size:11px;text-transform:uppercase;letter-spacing:.6px;
  color:var(--secondary-text-color,#9095a5);padding:10px 0 6px;
  background:none;border:none;width:100%;text-align:left;font-family:inherit;
  display:flex;justify-content:space-between;cursor:pointer;
}
.sensor-row{
  display:flex;align-items:center;flex-wrap:wrap;gap:8px;
  padding:9px 0;
  border-bottom:1px solid var(--divider-color,#383c4a18);
}
.sensor-row.s-open    {background:#f4433608;border-radius:6px;padding:9px 8px;margin:0 -8px}
.sensor-row.s-bypassed{background:#ff980008;border-radius:6px;padding:9px 8px;margin:0 -8px}
.sensor-label{display:flex;align-items:center;gap:8px;flex:1;min-width:0;cursor:pointer}
.sensor-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip{font-size:11px;padding:2px 9px;border-radius:10px;white-space:nowrap;flex-shrink:0}
.chip.dc     {background:var(--secondary-background-color,#1e2028);color:var(--secondary-text-color,#9095a5)}
.chip.danger {background:#f4433622;color:#f44336}
.chip.warn   {background:#ff980022;color:#ff9800}

/* ── Bypass controls ── */
.bypass-add{
  padding:3px 10px;border-radius:12px;
  border:1px solid var(--divider-color,#383c4a);
  background:transparent;color:var(--secondary-text-color,#9095a5);
  cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;flex-shrink:0;
}
.bypass-add:hover,.bypass-add.active{border-color:#ff9800;color:#ff9800;background:#ff980010}
.bypass-clear{
  padding:3px 10px;border-radius:12px;
  border:1px solid #ff980040;background:#ff980018;color:#ff9800;
  cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap;flex-shrink:0;
}
.bypass-clear:hover{background:#ff980030}
.bypass-picker{
  flex-basis:100%;display:flex;flex-wrap:wrap;gap:6px;padding:8px 0 4px;
  animation:slideDown .12s ease;
}
@keyframes slideDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.byp-dur{
  padding:5px 14px;border-radius:14px;
  border:1px solid #ff980050;background:transparent;color:#ff9800;
  cursor:pointer;font-size:12px;font-family:inherit;
}
.byp-dur:hover{background:#ff980020}
.byp-cancel{
  background:none;border:none;color:var(--secondary-text-color,#9095a5);
  cursor:pointer;font-size:18px;padding:0 4px;line-height:1;
}

/* ── Delays grid ── */
.delays-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.delay-card{
  background:var(--card-background-color,#1c1e26);
  border:1px solid var(--divider-color,#383c4a);
  border-radius:12px;padding:16px;
}
.delay-mode{font-weight:600;font-size:15px;margin-bottom:14px}
.delay-fields{display:flex;flex-direction:column;gap:10px}
.delay-field{display:flex;align-items:center;justify-content:space-between;gap:8px}
.delay-field label{color:var(--secondary-text-color,#9095a5);font-size:13px}

/* ── Users ── */
.user-cards{display:flex;flex-direction:column;gap:8px;margin-bottom:4px}
.user-card{
  display:flex;align-items:center;justify-content:space-between;
  background:var(--card-background-color,#1c1e26);
  border:1px solid var(--divider-color,#383c4a);
  border-radius:10px;padding:12px 16px;
}
.user-meta{display:flex;align-items:center;gap:10px}
.user-name{font-size:14px;font-weight:500}
.role-chip{
  font-size:11px;padding:2px 9px;border-radius:10px;
  background:var(--primary-color,#03a9f4)22;color:var(--primary-color,#03a9f4);
}
.role-chip.user{background:var(--secondary-background-color,#1e2028);color:var(--secondary-text-color,#9095a5)}

/* ── Notifications ── */
.svc-grid{display:flex;flex-direction:column;gap:6px;margin-top:8px}
.svc-card{
  display:flex;align-items:center;gap:10px;
  background:var(--card-background-color,#1c1e26);
  border:1px solid var(--divider-color,#383c4a);
  border-radius:10px;padding:11px 14px;cursor:pointer;
  transition:border-color .15s,background .15s;
}
.svc-card.on{border-color:var(--primary-color,#03a9f4)66;background:var(--primary-color,#03a9f4)0c}
.svc-name{flex:1;font-size:14px}
.svc-id{font-size:11px;color:var(--secondary-text-color,#9095a5);font-family:monospace}

.event-table{display:flex;flex-direction:column;gap:6px}
.event-row{
  display:flex;align-items:center;gap:10px;
  background:var(--card-background-color,#1c1e26);
  border:1px solid var(--divider-color,#383c4a);
  border-radius:10px;padding:10px 14px;
}
.event-check{display:flex;align-items:center;gap:8px;cursor:pointer;flex-shrink:0}
.event-lbl{font-size:13px;min-width:130px}
.ev-msg{
  flex:1;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:6px 10px;border-radius:6px;font-size:12px;font-family:inherit;
}
.ev-msg::placeholder{color:var(--secondary-text-color,#9095a5);font-style:italic}

/* ── Form cards (Siren, Settings, Users add form) ── */
.form-card{
  background:var(--card-background-color,#1c1e26);
  border:1px solid var(--divider-color,#383c4a);
  border-radius:12px;padding:18px;
  display:flex;flex-direction:column;gap:14px;
}
.form-row{display:flex;align-items:center;gap:12px}
.form-row>label:first-child{
  width:120px;flex-shrink:0;
  color:var(--secondary-text-color,#9095a5);font-size:13px;
}
.form-row input[type=text],
.form-row input[type=password]{
  flex:1;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:7px 10px;border-radius:7px;font-size:13px;font-family:inherit;
}
.sel{
  flex:1;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:7px 10px;border-radius:7px;font-size:13px;font-family:inherit;
}

/* ── Settings rows ── */
.settings-stack{display:flex;flex-direction:column}
.setting-row{
  display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:16px 0;border-bottom:1px solid var(--divider-color,#383c4a22);
}
.setting-row:last-child{border-bottom:none}
.setting-text{flex:1}
.setting-title{font-size:14px;font-weight:500;margin-bottom:3px}
.setting-sub{font-size:12px;color:var(--secondary-text-color,#9095a5)}

/* ── Toggle switch ── */
.sw{position:relative;display:inline-block;width:44px;height:24px;flex-shrink:0;cursor:pointer}
.sw input{opacity:0;width:0;height:0;position:absolute}
.sw-track{
  position:absolute;inset:0;background:var(--divider-color,#383c4a);
  border-radius:12px;transition:background .2s;
}
.sw-track::after{
  content:"";position:absolute;left:3px;top:3px;width:18px;height:18px;
  background:#fff;border-radius:50%;transition:transform .2s;
  box-shadow:0 1px 3px rgba(0,0,0,.3);
}
.sw input:checked+.sw-track{background:var(--primary-color,#03a9f4)}
.sw input:checked+.sw-track::after{transform:translateX(20px)}

/* ── Volume ── */
.vol-wrap{display:flex;align-items:center;gap:10px;flex:1}
.vol-wrap input[type=range]{flex:1;accent-color:var(--primary-color,#03a9f4);cursor:pointer}
.vol-num{
  width:64px;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:5px 8px;border-radius:6px;font-size:13px;font-family:inherit;text-align:right;
}

/* ── Misc inputs ── */
.inline-wrap{display:flex;align-items:center;gap:8px}
.short-num{
  width:80px;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:6px 8px;border-radius:6px;font-size:13px;font-family:inherit;
}
.hint-inline{font-size:12px;color:var(--secondary-text-color,#9095a5)}
.field-label{font-size:12px;color:var(--secondary-text-color,#9095a5);margin-bottom:8px}

.chime-sensor-list{max-height:220px;overflow-y:auto;padding-right:4px}

/* ── Section labels & dividers ── */
.sec-label{
  font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;
  color:var(--secondary-text-color,#9095a5);margin-bottom:10px;
}
.ruled-divider{
  display:flex;align-items:center;gap:12px;
  margin:20px 0 16px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;
  color:var(--secondary-text-color,#9095a5);
}
.ruled-divider::before,.ruled-divider::after{content:"";flex:1;border-top:1px solid var(--divider-color,#383c4a)}

/* ── Buttons ── */
.pane-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:24px}
.btn{
  background:var(--primary-color,#03a9f4);color:#fff;
  border:none;padding:9px 22px;border-radius:8px;
  cursor:pointer;font-size:13px;font-family:inherit;font-weight:500;
}
.btn:hover{opacity:.88}
.btn.outline{
  background:transparent;
  border:1px solid var(--primary-color,#03a9f4);
  color:var(--primary-color,#03a9f4);
}
.btn.outline:hover{background:var(--primary-color,#03a9f4)14}
.icon-btn{
  width:32px;height:32px;border-radius:8px;
  background:none;border:none;cursor:pointer;font-size:15px;
  display:flex;align-items:center;justify-content:center;
}
.icon-btn.danger{color:var(--error-color,#f44336)}
.icon-btn.danger:hover{background:#f4433614}

/* ── Utility ── */
.muted{color:var(--secondary-text-color,#9095a5)}
.hint{font-size:12px;color:var(--secondary-text-color,#9095a5)}
code{background:var(--secondary-background-color,#1e2028);padding:1px 5px;border-radius:4px;font-size:11px}

/* ── Toast ── */
.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:#323232;color:#fff;
  padding:10px 24px;border-radius:8px;font-size:13px;
  z-index:9999;box-shadow:0 4px 16px rgba(0,0,0,.3);
  pointer-events:none;
}
.toast.err{background:var(--error-color,#f44336)}
`;

customElements.define("ha-alarm-panel", HaAlarmPanel);
