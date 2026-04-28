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
  arming:    "Arming — exit delay countdown",
  armed:     "Alarm armed",
  triggered: "Alarm triggered",
  disarmed:  "Alarm disarmed",
  disarming: "Disarming",
  pending:   "Entry detected (pending)",
  failed:    "Invalid code attempt",
};

const DEFAULT_MESSAGES = {
  arming:    "Alarm arming in {mode} mode — exit now.",
  armed:     "Alarm armed in {mode} mode.",
  triggered: "ALARM TRIGGERED — sensor: {sensor}.",
  disarmed:  "Alarm disarmed.",
  disarming: "Alarm disarming.",
  pending:   "Entry detected — disarm now. Sensor: {sensor}.",
  failed:    "Alarm action failed: invalid code.",
};

const BYPASS_ONE_CYCLE = 0;
const BYPASS_INDEFINITE = -1;

const SIREN_DOMAINS = ["siren"];

class HaAlarmPanel extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._hass           = null;
    this._config         = null;
    this._activeMode     = "armed_away";
    this._showOthers     = {};
    this._pendingSensors = {};  // mode -> Set; tracks unsaved checkbox state across re-renders
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
      if (this._config) {
        this._renderSensors();
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
  <span class="header-title">Alarm Settings</span>
  <span class="badge disarmed" id="badge">Loading…</span>
</div>
<div class="panel">
  <div id="open-warning" class="open-warning gone">
    <span class="warn-icon">⚠</span>
    <div>
      <div class="warn-title">Open sensors — arming will be blocked</div>
      <div id="open-warning-detail" class="warn-detail"></div>
    </div>
  </div>

  ${this._card("sensors", "Sensors", `
    <div class="tabs" id="mode-tabs">
      ${MODES.map((m, i) => `<button class="tab${i === 0 ? " active" : ""}" data-mode="${m.key}">${m.label}</button>`).join("")}
    </div>
    <div id="sensor-list" class="sensor-list"><p class="muted">Loading sensors…</p></div>
    <div class="row-end"><button class="btn" id="save-sensors">Save Sensors</button></div>
    <div class="divider" style="margin:20px 0 16px"></div>
    <p class="sub-heading">Sensor Bypass</p>
    <div id="bypass-list"></div>
    <div class="bypass-form" style="margin-top:12px">
      <div class="field-row">
        <label>Sensor</label>
        <select id="bypass-sensor-sel" class="sel-input"></select>
      </div>
      <div class="field-row">
        <label>Duration</label>
        <select id="bypass-duration-sel" class="sel-input">
          <option value="0">One arm cycle</option>
          <option value="86400">24 hours</option>
          <option value="604800">7 days</option>
          <option value="-1">Indefinite</option>
        </select>
      </div>
      <div class="row-end"><button class="btn" id="add-bypass">Bypass Sensor</button></div>
    </div>
  `)}

  ${this._card("summary", "Sensor Summary", `
    <div id="sensor-summary"><p class="muted">Loading…</p></div>
  `)}

  ${this._card("delays", "Entry & Exit Delays", `
    <table class="dtable">
      <thead><tr><th>Mode</th><th>Entry (s)</th><th>Exit (s)</th></tr></thead>
      <tbody>
        ${MODES.map(m => `
        <tr>
          <td class="mode-cell">${m.label}</td>
          <td><input class="num" type="number" min="0" max="600" step="5" data-mode="${m.key}" data-t="entry_delay" value="30"></td>
          <td><input class="num" type="number" min="0" max="600" step="5" data-mode="${m.key}" data-t="exit_delay"  value="60"></td>
        </tr>`).join("")}
      </tbody>
    </table>
    <div class="row-end"><button class="btn" id="save-delays">Save Delays</button></div>
  `)}

  ${this._card("codes", "User Codes", `
    <div id="codes-list"></div>
    <div class="divider"></div>
    <p class="sub-heading">Add User</p>
    <div class="field-row"><label>Name</label><input type="text"      id="new-name" placeholder="Display name"></div>
    <div class="field-row"><label>Code</label><input type="password"  id="new-code" placeholder="Min. 4 digits"></div>
    <div class="field-row"><label>Admin</label><input type="checkbox" id="new-admin"></div>
    <div class="row-end"><button class="btn" id="add-user">Add User</button></div>
  `)}

  ${this._card("notifications", "Notifications", `
    <p class="sub-heading">Notification Targets</p>
    <div class="svc-list" id="notif-services">
      <p class="muted">Loading available notify services…</p>
    </div>
    <p class="muted small" style="margin-top:6px">Select which Home Assistant notify services receive alarm notifications.</p>
    <div class="divider" style="margin:16px 0"></div>
    <label class="toggle-row">
      <div>
        <div class="toggle-label">High priority</div>
        <div class="muted small">Android: ttl=0 / priority=high &nbsp;·&nbsp; iOS: time-sensitive interruption level</div>
      </div>
      <input type="checkbox" id="notif-high-priority">
    </label>
    <div class="divider" style="margin:16px 0"></div>
    <p class="sub-heading">Events &amp; Messages</p>
    <p class="muted small" style="margin-bottom:10px">Leave message blank to use the default. Use <code>{mode}</code> and <code>{sensor}</code> as placeholders.</p>
    <div class="event-blocks">
      ${ALL_EVENTS.map(e => `
      <div class="event-block">
        <label class="event-block-header">
          <input type="checkbox" class="ev-cb" data-event="${e}">
          <span class="event-label">${EVENT_LABELS[e]}</span>
        </label>
        <div class="event-msg-row">
          <input type="text" class="ev-msg" data-event="${e}" placeholder="${DEFAULT_MESSAGES[e]}">
        </div>
      </div>`).join("")}
    </div>
    <div class="row-end"><button class="btn" id="save-notif">Save Notifications</button></div>
  `)}

  ${this._card("chime", "Chime Mode", `
    <label class="toggle-row">
      <div>
        <div class="toggle-label">Enable chime mode</div>
        <div class="muted small">Plays a tone on the siren entity when a chime sensor opens while the alarm is disarmed.</div>
      </div>
      <input type="checkbox" id="chime-mode">
    </label>
    <div class="divider"></div>
    <p class="sub-heading">Chime Sensors</p>
    <div id="chime-sensor-list" class="sensor-list"><p class="muted">Loading…</p></div>
    <div class="divider"></div>
    <div class="field-row">
      <label>Chime tone</label>
      <input type="text" id="chime-tone" placeholder='e.g. 5 (tone ID on siren entity)'>
    </div>
    <div class="field-row vol-row">
      <label>Chime volume</label>
      <input type="range"  id="chime-volume"     min="0" max="1" step="0.05" value="0">
      <input type="number" id="chime-volume-num" min="0" max="1" step="0.05" value="0" class="vol-num" placeholder="0–1">
    </div>
    <p class="muted small" style="margin-bottom:12px">Volume 0 = use device default. Enter 0–1 (e.g. 0.75). Requires a tone ID to be set.</p>
    <div class="row-end"><button class="btn" id="save-chime">Save Chime Settings</button></div>
  `)}

  ${this._card("general", "General Settings", `
    <label class="toggle-row">
      <div>
        <div class="toggle-label">Require a code to arm</div>
        <div class="muted small">When off, arm buttons work immediately. Disarm always requires a code.</div>
      </div>
      <input type="checkbox" id="arm-req" checked>
    </label>
    <div class="divider"></div>
    <div class="field-row">
      <label>Trigger duration</label>
      <input type="number" class="num" id="trigger-time" min="0" max="3600" step="30" value="600">
      <span class="muted">seconds (0 = indefinite)</span>
    </div>
    <label class="toggle-row">
      <div>
        <div class="toggle-label">Disarm after trigger</div>
        <div class="muted small">When on, alarm automatically disarms after the trigger duration. When off, it returns to armed.</div>
      </div>
      <input type="checkbox" id="disarm-after-trigger">
    </label>
    <div class="divider"></div>
    <div class="field-row">
      <label>Siren entity</label>
      <select id="siren-entity" class="sel-input"></select>
    </div>
    <div class="field-row">
      <label>Alarm tone</label>
      <input type="text" id="siren-tone" placeholder='e.g. 23 (leave blank for generic on/off)'>
    </div>
    <div class="field-row vol-row">
      <label>Alarm volume</label>
      <input type="range"  id="siren-volume"     min="0" max="1" step="0.05" value="0">
      <input type="number" id="siren-volume-num" min="0" max="1" step="0.05" value="0" class="vol-num" placeholder="0–1">
    </div>
    <p class="muted small" style="margin-bottom:12px">Tone and volume are passed to siren.turn_on. Without a tone, homeassistant.turn_on is used (works for switches too). Volume 0 = device default.</p>
    <div class="row-end"><button class="btn" id="save-general">Save</button></div>
  `)}
</div>
<div id="toast" class="toast gone"></div>`;

    this._wire();
    this._refreshBadge();
  }

  _card(id, title, body) {
    return `
<div class="card">
  <div class="card-header" data-id="${id}">
    <span>${title}</span><span class="chevron" id="chev-${id}">▸</span>
  </div>
  <div class="card-body closed" id="body-${id}">${body}</div>
</div>`;
  }

  // ── Wire events ───────────────────────────────────────────────────────────

  _wire() {
    const sr = this.shadowRoot;

    sr.querySelectorAll(".card-header").forEach(h => {
      h.addEventListener("click", () => {
        const body = sr.querySelector(`#body-${h.dataset.id}`);
        const chev = sr.querySelector(`#chev-${h.dataset.id}`);
        const open = !body.classList.contains("closed");
        body.classList.toggle("closed", open);
        chev.textContent = open ? "▸" : "▾";
      });
    });

    sr.querySelector("#mode-tabs").addEventListener("click", e => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      sr.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      this._activeMode = tab.dataset.mode;
      this._renderSensors();
    });

    // Volume sliders — keep range and number inputs in sync
    const bindVolume = (sliderId, numId) => {
      const slider = sr.querySelector(`#${sliderId}`);
      const num    = sr.querySelector(`#${numId}`);
      if (!slider || !num) return;
      slider.addEventListener("input", () => { num.value = slider.value; });
      num.addEventListener("input", () => {
        const v = Math.min(1, Math.max(0, parseFloat(num.value) || 0));
        slider.value = v;
      });
    };
    bindVolume("siren-volume", "siren-volume-num");
    bindVolume("chime-volume", "chime-volume-num");

    sr.querySelector("#save-sensors") .addEventListener("click", () => this._saveSensors());
    sr.querySelector("#add-bypass")   .addEventListener("click", () => this._addBypass());
    sr.querySelector("#save-delays")  .addEventListener("click", () => this._saveDelays());
    sr.querySelector("#add-user")     .addEventListener("click", () => this._addUser());
    sr.querySelector("#save-notif")   .addEventListener("click", () => this._saveNotif());
    sr.querySelector("#save-chime")   .addEventListener("click", () => this._saveChime());
    sr.querySelector("#save-general") .addEventListener("click", () => this._saveGeneral());
  }

  // ── Populate ──────────────────────────────────────────────────────────────

  _populate() {
    this._refreshBadge();
    this._refreshOpenWarning();
    this._renderSensors();
    this._populateSensorSummary();
    this._populateBypasses();
    this._populateDelays();
    this._populateCodes();
    this._populateNotif();
    this._populateChime();
    this._populateGeneral();
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
    const detail = this.shadowRoot.querySelector("#open-warning-detail");
    if (!banner || !detail || !this._config) return;

    const bypassed = new Set(Object.keys(this._config.bypassed_sensors || {}));
    const affected = [];

    MODES.forEach(m => {
      const assigned = this._config.sensors?.[m.key] || [];
      const open = assigned.filter(id =>
        !bypassed.has(id) && this._hass.states[id]?.state === "on"
      );
      if (open.length) {
        const names = open.map(id =>
          this._hass.states[id]?.attributes?.friendly_name || id
        ).join(", ");
        affected.push(`<span class="warn-mode">${m.label}:</span> ${names}`);
      }
    });

    if (!affected.length) {
      banner.classList.add("gone");
      return;
    }
    banner.classList.remove("gone");
    detail.innerHTML = affected.join("<br>");
  }

  // ── Sensors ───────────────────────────────────────────────────────────────

  _binarySensors() {
    return Object.values(this._hass.states)
      .filter(s => s.entity_id.startsWith("binary_sensor."))
      .sort((a, b) => (a.attributes.friendly_name || a.entity_id)
        .localeCompare(b.attributes.friendly_name || b.entity_id));
  }

  _renderSensors() {
    const sr        = this.shadowRoot;
    const container = sr.querySelector("#sensor-list");
    if (!container) return;
    // Use pending (unsaved) selections if the user has touched checkboxes since last save
    const selected  = this._pendingSensors[this._activeMode]
      ?? new Set(this._config?.sensors?.[this._activeMode] || []);
    const bypassed  = new Set(Object.keys(this._config?.bypassed_sensors || {}));
    const classes   = MODE_CLASSES[this._activeMode];
    const all       = this._binarySensors();
    const suggested = classes ? all.filter(s => classes.includes(s.attributes.device_class)) : all;
    const others    = classes ? all.filter(s => !classes.includes(s.attributes.device_class)) : [];

    // Sort: selected+open → selected+closed → unselected+open → unselected+closed
    const isOpen = s => this._hass.states[s.entity_id]?.state === "on";
    const sortSensors = arr => arr.slice().sort((a, b) => {
      const asel = selected.has(a.entity_id), bsel = selected.has(b.entity_id);
      const aopn = isOpen(a),                 bopn = isOpen(b);
      const arank = asel && aopn ? 0 : asel ? 1 : aopn ? 2 : 3;
      const brank = bsel && bopn ? 0 : bsel ? 1 : bopn ? 2 : 3;
      if (arank !== brank) return arank - brank;
      return (a.attributes.friendly_name || a.entity_id)
        .localeCompare(b.attributes.friendly_name || b.entity_id);
    });

    const row = s => {
      const name       = s.attributes.friendly_name || s.entity_id;
      const dc         = s.attributes.device_class   || "—";
      const isBypassed = bypassed.has(s.entity_id);
      const open       = isOpen(s);
      let chipHtml;
      if (isBypassed)  chipHtml = `<span class="chip warn">bypassed</span>`;
      else if (open)   chipHtml = `<span class="chip danger">open</span>`;
      else             chipHtml = `<span class="chip">${dc}</span>`;
      return `<label class="sensor-row${open ? " sensor-open" : ""}">
        <input type="checkbox" class="s-cb" value="${s.entity_id}" ${selected.has(s.entity_id) ? "checked" : ""}>
        <span class="s-name">${name}</span>
        ${chipHtml}
      </label>`;
    };

    let html = "";
    const sortedSuggested = sortSensors(suggested);
    if (sortedSuggested.length) {
      html += `<div class="group-label">${classes ? "Suggested for this mode" : "All sensors"}</div>`;
      html += sortedSuggested.map(row).join("");
    }
    const sortedOthers = sortSensors(others);
    if (sortedOthers.length) {
      const show = this._showOthers[this._activeMode];
      html += `<div class="group-label toggle-others" data-mode="${this._activeMode}">
        Other sensors (${sortedOthers.length}) ${show ? "▾" : "▸"}
      </div>
      <div class="${show ? "" : "gone"}" id="others-${this._activeMode}">
        ${sortedOthers.map(row).join("")}
      </div>`;
    }
    if (!html) html = `<p class="muted">No binary sensors found in Home Assistant.</p>`;

    container.innerHTML = html;
    container.querySelectorAll(".toggle-others").forEach(el =>
      el.addEventListener("click", () => {
        this._showOthers[el.dataset.mode] = !this._showOthers[el.dataset.mode];
        this._renderSensors();
      })
    );

    // Record checkbox changes into pending state so hass re-renders don't reset them
    container.querySelectorAll(".s-cb").forEach(cb => {
      cb.addEventListener("change", () => {
        this._pendingSensors[this._activeMode] = new Set(
          [...container.querySelectorAll(".s-cb:checked")].map(c => c.value)
        );
      });
    });
  }

  async _saveSensors() {
    const sensors = { ...(this._config?.sensors || {}) };
    sensors[this._activeMode] = [...this.shadowRoot.querySelectorAll(".s-cb:checked")].map(cb => cb.value);
    await this._api("POST", "sensors", sensors);
    if (this._config) this._config.sensors = sensors;
    delete this._pendingSensors[this._activeMode];
    this._populateSensorSummary();
    this._toast("Sensors saved ✓");
  }

  _populateSensorSummary() {
    const el = this.shadowRoot.querySelector("#sensor-summary");
    if (!el || !this._config) return;
    const sensors = this._config.sensors || {};
    let html = "";
    let any = false;
    MODES.forEach(m => {
      const ids = sensors[m.key] || [];
      if (!ids.length) return;
      any = true;
      const chips = ids.map(id => {
        const state = this._hass.states[id];
        const name  = state?.attributes?.friendly_name || id;
        const open  = state?.state === "on";
        return `<button class="summary-chip${open ? " danger" : ""}" data-mode="${m.key}" data-id="${id}" title="Remove from ${m.label}">${name} <span class="chip-x">×</span></button>`;
      }).join("");
      html += `<div class="summary-group">
        <div class="sub-heading">${m.label} <span class="muted">(${ids.length})</span></div>
        <div class="summary-chips">${chips}</div>
      </div>`;
    });
    el.innerHTML = any ? html : `<p class="muted">No sensors configured yet.</p>`;
    el.querySelectorAll(".summary-chip").forEach(btn =>
      btn.addEventListener("click", () => this._removeSensorFromMode(btn.dataset.mode, btn.dataset.id))
    );
  }

  async _removeSensorFromMode(mode, sensorId) {
    const sensors = { ...(this._config?.sensors || {}) };
    sensors[mode] = (sensors[mode] || []).filter(id => id !== sensorId);
    await this._api("POST", "sensors", sensors);
    if (this._config) this._config.sensors = sensors;
    delete this._pendingSensors[mode];
    this._populateSensorSummary();
    if (this._activeMode === mode) this._renderSensors();
    this._toast("Sensor removed ✓");
  }

  // ── Bypass ────────────────────────────────────────────────────────────────

  _modeSensors() {
    const sensors = this._config?.sensors || {};
    const seen    = new Set();
    const result  = [];
    Object.values(sensors).forEach(list => {
      (list || []).forEach(id => {
        if (!seen.has(id)) {
          seen.add(id);
          const state = this._hass.states[id];
          result.push({ entity_id: id, attributes: state?.attributes || {} });
        }
      });
    });
    return result.sort((a, b) =>
      (a.attributes.friendly_name || a.entity_id)
        .localeCompare(b.attributes.friendly_name || b.entity_id)
    );
  }

  _populateBypasses() {
    const sr = this.shadowRoot;

    const sel = sr.querySelector("#bypass-sensor-sel");
    if (sel) {
      const sensors = this._modeSensors();
      sel.innerHTML = sensors.length
        ? sensors.map(s => {
            const name = s.attributes.friendly_name || s.entity_id;
            return `<option value="${s.entity_id}">${name}</option>`;
          }).join("")
        : `<option value="">No mode sensors configured yet</option>`;
    }

    const list = sr.querySelector("#bypass-list");
    if (!list) return;
    const bypasses = this._config?.bypassed_sensors || {};
    const entries  = Object.entries(bypasses);
    if (!entries.length) {
      list.innerHTML = `<p class="muted">No sensors currently bypassed.</p>`;
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    list.innerHTML = entries.map(([sid, until]) => {
      const state = this._hass.states[sid];
      const name  = state?.attributes?.friendly_name || sid;
      let expiry;
      if (until === BYPASS_ONE_CYCLE)       expiry = "One arm cycle";
      else if (until === BYPASS_INDEFINITE) expiry = "Indefinite";
      else {
        const rem = until - now;
        if (rem < 3600)       expiry = `${Math.ceil(rem / 60)}m remaining`;
        else if (rem < 86400) expiry = `${Math.ceil(rem / 3600)}h remaining`;
        else                  expiry = `${Math.ceil(rem / 86400)}d remaining`;
      }
      return `<div class="user-row">
        <span class="user-name">${name}</span>
        <span class="chip warn">${expiry}</span>
        <button class="btn-ghost danger rm-bypass" data-sid="${sid}">Clear</button>
      </div>`;
    }).join("");
    list.querySelectorAll(".rm-bypass").forEach(btn =>
      btn.addEventListener("click", () => this._removeBypass(btn.dataset.sid))
    );
  }

  async _addBypass() {
    const sr  = this.shadowRoot;
    const sid = sr.querySelector("#bypass-sensor-sel")?.value;
    const dur = parseInt(sr.querySelector("#bypass-duration-sel")?.value ?? "0", 10);
    if (!sid) return this._toast("Select a sensor", true);
    await this._api("POST", "bypass/add", { sensor_id: sid, duration: dur });
    this._config = await this._api("GET", "config");
    this._populateBypasses();
    this._renderSensors();
    this._toast("Bypass added ✓");
  }

  async _removeBypass(sid) {
    await this._api("POST", "bypass/remove", { sensor_id: sid });
    this._config = await this._api("GET", "config");
    this._populateBypasses();
    this._renderSensors();
    this._toast("Bypass cleared ✓");
  }

  // ── Delays ────────────────────────────────────────────────────────────────

  _populateDelays() {
    this.shadowRoot.querySelectorAll(".num[data-mode]").forEach(inp => {
      const v = this._config?.delays?.[inp.dataset.mode]?.[inp.dataset.t];
      if (v !== undefined) inp.value = v;
    });
  }

  async _saveDelays() {
    const delays = {};
    MODES.forEach(m => { delays[m.key] = { entry_delay: 0, exit_delay: 0 }; });
    this.shadowRoot.querySelectorAll(".num[data-mode]").forEach(inp => {
      delays[inp.dataset.mode][inp.dataset.t] = parseInt(inp.value, 10) || 0;
    });
    await this._api("POST", "delays", delays);
    if (this._config) this._config.delays = delays;
    this._toast("Delays saved ✓");
  }

  // ── Codes ─────────────────────────────────────────────────────────────────

  _populateCodes() {
    const el = this.shadowRoot.querySelector("#codes-list");
    if (!el) return;
    const codes = this._config?.codes || [];
    if (!codes.length) { el.innerHTML = `<p class="muted">No users configured.</p>`; return; }
    el.innerHTML = codes.map(c => `
      <div class="user-row">
        <span class="user-name">${c.name}</span>
        ${c.is_admin ? `<span class="chip primary">Admin</span>` : ""}
        <button class="btn-ghost danger rm-user" data-name="${c.name}">Remove</button>
      </div>`).join("");
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
    this._populateCodes();
    this._toast("User added ✓");
  }

  async _removeUser(name) {
    if (!confirm(`Remove user "${name}"?`)) return;
    await this._api("POST", "codes/remove", { name });
    this._config = await this._api("GET", "config");
    this._populateCodes();
    this._toast("User removed ✓");
  }

  // ── Notifications ─────────────────────────────────────────────────────────

  _populateNotif() {
    const n              = this._config?.notifications || {};
    const enabledTargets = new Set(n.notify_targets || []);

    const container = this.shadowRoot.querySelector("#notif-services");
    if (container) {
      const notifySvcs = this._hass?.services?.notify || {};
      const available  = Object.keys(notifySvcs).sort((a, b) => {
        const aOn = enabledTargets.has(`notify.${a}`);
        const bOn = enabledTargets.has(`notify.${b}`);
        if (aOn !== bOn) return aOn ? -1 : 1;
        return a.localeCompare(b);
      });
      if (!available.length) {
        container.innerHTML = `<p class="muted">No notify services found. Add a notification integration (e.g. Mobile App) first.</p>`;
      } else {
        container.innerHTML = available.map(s => {
          const fullId  = `notify.${s}`;
          const label   = s.replace(/_/g, " ");
          const checked = enabledTargets.has(fullId) ? "checked" : "";
          return `<label class="svc-row">
            <input type="checkbox" class="svc-cb" value="${fullId}" ${checked}>
            <span class="svc-name">${label}</span>
            <span class="chip">${fullId}</span>
          </label>`;
        }).join("");
      }
    }

    const hp = this.shadowRoot.querySelector("#notif-high-priority");
    if (hp) hp.checked = n.high_priority === true;

    const evts = n.notify_events || {};
    const msgs = n.messages      || {};
    this.shadowRoot.querySelectorAll(".ev-cb").forEach(cb => {
      cb.checked = evts[cb.dataset.event] !== false;
    });
    this.shadowRoot.querySelectorAll(".ev-msg").forEach(inp => {
      inp.value = msgs[inp.dataset.event] || "";
    });
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

  // ── Chime ─────────────────────────────────────────────────────────────────

  _populateChime() {
    const sr   = this.shadowRoot;
    const mode = sr.querySelector("#chime-mode");
    if (mode) mode.checked = this._config?.chime_mode === true;

    const chimeTone = sr.querySelector("#chime-tone");
    if (chimeTone) chimeTone.value = this._config?.chime_tone || "";

    const chimeVol = this._config?.chime_volume ?? 0;
    const chimeSlider = sr.querySelector("#chime-volume");
    const chimeNum    = sr.querySelector("#chime-volume-num");
    if (chimeSlider) chimeSlider.value = chimeVol;
    if (chimeNum)    chimeNum.value    = chimeVol;

    const container   = sr.querySelector("#chime-sensor-list");
    if (!container) return;
    const chimeSensors = new Set(this._config?.chime_sensors || []);
    const all = this._binarySensors().sort((a, b) => {
      const aOn = chimeSensors.has(a.entity_id);
      const bOn = chimeSensors.has(b.entity_id);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return (a.attributes.friendly_name || a.entity_id)
        .localeCompare(b.attributes.friendly_name || b.entity_id);
    });
    if (!all.length) {
      container.innerHTML = `<p class="muted">No binary sensors found.</p>`;
      return;
    }
    container.innerHTML = all.map(s => {
      const name = s.attributes.friendly_name || s.entity_id;
      const dc   = s.attributes.device_class   || "—";
      return `<label class="sensor-row">
        <input type="checkbox" class="chime-cb" value="${s.entity_id}" ${chimeSensors.has(s.entity_id) ? "checked" : ""}>
        <span class="s-name">${name}</span>
        <span class="chip">${dc}</span>
      </label>`;
    }).join("");
  }

  async _saveChime() {
    const sr           = this.shadowRoot;
    const chime_mode    = sr.querySelector("#chime-mode")?.checked ?? false;
    const chime_sensors = [...sr.querySelectorAll(".chime-cb:checked")].map(cb => cb.value);
    const chime_tone    = sr.querySelector("#chime-tone")?.value.trim() || "";
    const chime_volume  = parseFloat(sr.querySelector("#chime-volume-num")?.value || "0");
    await this._api("POST", "chime", { chime_mode, chime_sensors, chime_tone, chime_volume });
    if (this._config) {
      this._config.chime_mode    = chime_mode;
      this._config.chime_sensors = chime_sensors;
      this._config.chime_tone    = chime_tone;
      this._config.chime_volume  = chime_volume;
    }
    this._toast("Chime settings saved ✓");
  }

  // ── General ───────────────────────────────────────────────────────────────

  _sirenEntities() {
    return Object.values(this._hass.states)
      .filter(s => SIREN_DOMAINS.some(d => s.entity_id.startsWith(d + ".")))
      .sort((a, b) => (a.attributes.friendly_name || a.entity_id)
        .localeCompare(b.attributes.friendly_name || b.entity_id));
  }

  _populateGeneral() {
    const sr     = this.shadowRoot;
    const armReq = sr.querySelector("#arm-req");
    if (armReq) armReq.checked = this._config?.code_arm_required !== false;

    const tt = sr.querySelector("#trigger-time");
    if (tt) tt.value = this._config?.trigger_time ?? 600;

    const dat = sr.querySelector("#disarm-after-trigger");
    if (dat) dat.checked = this._config?.disarm_after_trigger === true;

    // Populate siren entity dropdown
    const sirenSel    = sr.querySelector("#siren-entity");
    const currentSiren = this._config?.siren_entity || "";
    if (sirenSel) {
      const entities = this._sirenEntities();
      const grouped  = {};
      entities.forEach(e => {
        const domain = e.entity_id.split(".")[0];
        (grouped[domain] = grouped[domain] || []).push(e);
      });
      let opts = `<option value="">— None (no siren) —</option>`;
      Object.entries(grouped).forEach(([domain, list]) => {
        opts += `<optgroup label="${domain}">`;
        list.forEach(e => {
          const name = e.attributes.friendly_name || e.entity_id;
          const sel  = e.entity_id === currentSiren ? " selected" : "";
          opts += `<option value="${e.entity_id}"${sel}>${name} (${e.entity_id})</option>`;
        });
        opts += `</optgroup>`;
      });
      // If current value isn't in states, add it so we don't lose it
      if (currentSiren && !entities.find(e => e.entity_id === currentSiren)) {
        opts += `<option value="${currentSiren}" selected>${currentSiren}</option>`;
      }
      sirenSel.innerHTML = opts;
    }

    // Siren tone
    const sirenTone = sr.querySelector("#siren-tone");
    if (sirenTone) sirenTone.value = this._config?.siren_tone || "";

    // Siren volume
    const sirenVol    = this._config?.siren_volume ?? 0;
    const sirenSlider = sr.querySelector("#siren-volume");
    const sirenNum    = sr.querySelector("#siren-volume-num");
    if (sirenSlider) sirenSlider.value = sirenVol;
    if (sirenNum)    sirenNum.value    = sirenVol;
  }

  async _saveGeneral() {
    const sr      = this.shadowRoot;
    const payload = {
      code_arm_required:    sr.querySelector("#arm-req")?.checked ?? true,
      trigger_time:         parseInt(sr.querySelector("#trigger-time")?.value || "600", 10),
      disarm_after_trigger: sr.querySelector("#disarm-after-trigger")?.checked ?? false,
      siren_entity:         sr.querySelector("#siren-entity")?.value || "",
      siren_tone:           sr.querySelector("#siren-tone")?.value.trim() || "",
      siren_volume:         parseFloat(sr.querySelector("#siren-volume-num")?.value || "0"),
    };
    await this._api("POST", "general", payload);
    if (this._config) Object.assign(this._config, payload);
    this._toast("Saved ✓");
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

// ── Styles ────────────────────────────────────────────────────────────────────

const CSS = `
*{box-sizing:border-box;margin:0;padding:0}
:host{display:block}
.panel{
  max-width:860px;margin:0 auto;padding:20px 16px;
  font-family:var(--paper-font-body1_-_font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  color:var(--primary-text-color,#e8e8e8);
  font-size:14px;
}
.app-header{
  position:sticky;top:0;z-index:4;
  display:flex;align-items:center;gap:4px;
  padding:0 16px 0 4px;height:56px;
  background:var(--app-header-background-color,var(--primary-color,#03a9f4));
  color:var(--app-header-text-color,#fff);
  box-shadow:0 2px 4px rgba(0,0,0,.14),0 1px 10px rgba(0,0,0,.12),0 2px 4px rgba(0,0,0,.2);
}
.header-title{flex:1;font-size:20px;font-weight:400;color:var(--app-header-text-color,#fff)}
.badge{padding:3px 12px;border-radius:12px;font-size:12px;font-weight:500}
.badge.disarmed {background:#4caf5022;color:#4caf50}
.badge.armed    {background:#2196f322;color:#2196f3}
.badge.triggered{background:#f4433622;color:#f44336}
.badge.pending  {background:#ff980022;color:#ff9800}

.open-warning{
  display:flex;align-items:flex-start;gap:10px;
  background:#f4433618;border:1px solid #f4433640;
  border-radius:10px;padding:12px 16px;margin-bottom:14px;
  font-size:13px;line-height:1.5;
}
.warn-icon{font-size:18px;flex-shrink:0;margin-top:1px}
.warn-title{font-weight:500;color:#f44336;margin-bottom:2px}
.warn-detail{color:var(--primary-text-color,#e8e8e8)}
.warn-mode{font-weight:500;color:var(--secondary-text-color,#9095a5)}

.card{
  background:var(--card-background-color,#1c1e26);
  border:1px solid var(--divider-color,#383c4a);
  border-radius:12px;margin-bottom:12px;overflow:hidden
}
.card-header{
  display:flex;justify-content:space-between;align-items:center;
  padding:15px 20px;cursor:pointer;font-size:15px;font-weight:500;
  user-select:none;
}
.card-header:hover{background:var(--secondary-background-color,#1e2028)}
.card-body{padding:4px 20px 20px}
.card-body.closed{display:none}
.chevron{font-size:16px;color:var(--secondary-text-color,#9095a5)}

.tabs{display:flex;flex-wrap:wrap;gap:6px;padding-top:12px;margin-bottom:14px}
.tab{
  padding:5px 14px;border-radius:16px;border:1px solid var(--divider-color,#383c4a);
  background:transparent;color:var(--secondary-text-color,#9095a5);
  cursor:pointer;font-size:13px;font-family:inherit
}
.tab.active{background:var(--primary-color,#03a9f4);color:#fff;border-color:transparent}

.sensor-list{max-height:320px;overflow-y:auto;padding-right:4px}
.group-label{
  font-size:11px;text-transform:uppercase;letter-spacing:.6px;
  color:var(--secondary-text-color,#9095a5);padding:10px 0 4px;
  cursor:pointer;user-select:none
}
.sensor-row{
  display:flex;align-items:center;gap:8px;padding:7px 0;
  border-bottom:1px solid var(--divider-color,#383c4a22);cursor:pointer
}
.sensor-row:hover{opacity:.85}
.s-name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chip{
  font-size:11px;background:var(--secondary-background-color,#1e2028);
  padding:2px 8px;border-radius:8px;white-space:nowrap;
  color:var(--secondary-text-color,#9095a5)
}
.chip.primary{background:var(--primary-color,#03a9f4)22;color:var(--primary-color,#03a9f4)}
.chip.warn{background:#ff980022;color:#ff9800}
.chip.danger{background:#f4433622;color:#f44336}
.sensor-open{background:#f4433618;border-radius:4px}

.dtable{width:100%;border-collapse:collapse;margin-top:12px}
.dtable th{
  text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;
  letter-spacing:.5px;color:var(--secondary-text-color,#9095a5)
}
.dtable td{padding:7px 8px;border-bottom:1px solid var(--divider-color,#383c4a22)}
.mode-cell{font-size:14px;width:120px}
.num{
  width:80px;background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:5px 8px;border-radius:6px;font-size:13px;font-family:inherit
}

.user-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--divider-color,#383c4a22)}
.user-name{flex:1;font-size:14px}
.divider{border-top:1px solid var(--divider-color,#383c4a);margin:16px 0}
.sub-heading{font-size:13px;font-weight:500;margin-bottom:10px;color:var(--secondary-text-color,#9095a5)}

.svc-list{
  max-height:200px;overflow-y:auto;
  border:1px solid var(--divider-color,#383c4a);
  border-radius:6px;padding:2px 8px;margin-top:4px
}
.svc-row{
  display:flex;align-items:center;gap:8px;padding:7px 0;cursor:pointer;font-size:13px;
  border-bottom:1px solid var(--divider-color,#383c4a22)
}
.svc-row:last-child{border-bottom:none}
.svc-name{flex:1;text-transform:capitalize}

.sel-input{
  flex:1;background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:7px 10px;border-radius:6px;font-size:13px;font-family:inherit;
  min-width:0
}

.field-row{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
.field-row label{width:100px;flex-shrink:0;padding-top:7px;color:var(--secondary-text-color,#9095a5)}
.field-row input[type=text],
.field-row input[type=password]{
  flex:1;background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:7px 10px;border-radius:6px;font-size:13px;font-family:inherit
}

/* Volume row — slider + number input */
.vol-row{align-items:center}
.vol-row input[type=range]{
  flex:1;accent-color:var(--primary-color,#03a9f4);
  height:4px;cursor:pointer;min-width:0
}
.vol-num{
  width:68px;flex-shrink:0;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:5px 8px;border-radius:6px;font-size:13px;font-family:inherit;
  text-align:right;
}

.event-blocks{display:flex;flex-direction:column;gap:6px;margin:4px 0 14px}
.event-block{border:1px solid var(--divider-color,#383c4a);border-radius:8px;padding:10px 12px}
.event-block-header{display:flex;align-items:center;gap:8px;cursor:pointer}
.event-label{font-size:13px;flex:1}
.event-msg-row{margin-top:8px;padding-left:24px}
.ev-msg{
  width:100%;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:6px 10px;border-radius:6px;font-size:12px;font-family:inherit;
}
.ev-msg::placeholder{color:var(--secondary-text-color,#9095a5)}

.toggle-row{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:8px 0}
.toggle-label{font-size:14px;margin-bottom:3px}

.row-end{display:flex;justify-content:flex-end;margin-top:14px}
.btn{
  background:var(--primary-color,#03a9f4);color:#fff;
  border:none;padding:8px 20px;border-radius:6px;
  cursor:pointer;font-size:13px;font-family:inherit
}
.btn:hover{opacity:.88}
.btn-ghost{
  background:transparent;border:1px solid;
  padding:4px 10px;border-radius:6px;
  cursor:pointer;font-size:12px;font-family:inherit
}
.btn-ghost.danger{border-color:var(--error-color,#f44336);color:var(--error-color,#f44336)}
.btn-ghost.danger:hover{background:#f4433612}

.muted{color:var(--secondary-text-color,#9095a5)}
.summary-group{margin-bottom:16px}
.summary-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.summary-chip{
  display:inline-flex;align-items:center;gap:5px;
  font-size:12px;font-family:inherit;
  background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:3px 8px;border-radius:8px;white-space:nowrap;cursor:pointer;
}
.summary-chip:hover{border-color:var(--error-color,#f44336);background:#f4433614}
.summary-chip.danger{background:#f4433618;border-color:#f4433640;color:#f44336}
.chip-x{font-size:14px;line-height:1;color:var(--secondary-text-color,#9095a5)}
.summary-chip:hover .chip-x{color:var(--error-color,#f44336)}
.small{font-size:12px;margin-top:3px}
.gone{display:none}

.toast{
  position:fixed;bottom:24px;left:50%;transform:translateX(-50%);
  background:#323232;color:#fff;
  padding:10px 24px;border-radius:8px;font-size:13px;
  z-index:9999;box-shadow:0 4px 16px #0005;
  transition:opacity .25s;
}
.toast.err{background:var(--error-color,#f44336)}
`;

customElements.define("ha-alarm-panel", HaAlarmPanel);
