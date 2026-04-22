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

class HaAlarmPanel extends HTMLElement {
  constructor() {
    super();
    this._hass        = null;
    this._config      = null;
    this._activeMode  = "armed_away";
    this._showOthers  = {};
    this._ready       = false;
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._ready) {
      this._ready = true;
      this._build();
      this._load();
    } else {
      this._refreshBadge();
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
    this.innerHTML = `<style>${CSS}</style>
<div class="panel">
  <div class="page-header">
    <span class="page-title">Alarm Settings</span>
    <span class="badge disarmed" id="badge">Loading…</span>
  </div>

  ${this._card("sensors", "Sensors", `
    <div class="tabs" id="mode-tabs">
      ${MODES.map((m,i) => `<button class="tab${i===0?" active":""}" data-mode="${m.key}">${m.label}</button>`).join("")}
    </div>
    <div id="sensor-list" class="sensor-list"><p class="muted">Loading sensors…</p></div>
    <div class="row-end"><button class="btn" id="save-sensors">Save Sensors</button></div>
  `)}

  ${this._card("delays", "Entry & Exit Delays", `
    <table class="dtable">
      <thead><tr><th>Mode</th><th>Entry (s)</th><th>Exit (s)</th></tr></thead>
      <tbody>
        ${MODES.map(m=>`
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
    <div class="field-row">
      <label>Targets</label>
      <textarea id="notif-targets" rows="3" placeholder="notify.mobile_app_phone, notify.group_name"></textarea>
    </div>
    <p class="muted small">Comma-separated list of notify service targets.</p>
    <p class="sub-heading" style="margin-top:16px">Notify on</p>
    <div class="event-grid">
      ${ALL_EVENTS.map(e=>`
      <label class="event-row">
        <input type="checkbox" class="ev-cb" data-event="${e}">
        <span>${EVENT_LABELS[e]}</span>
      </label>`).join("")}
    </div>
    <div class="row-end"><button class="btn" id="save-notif">Save Notifications</button></div>
  `)}

  ${this._card("general", "General Settings", `
    <label class="toggle-row">
      <div>
        <div class="toggle-label">Require a code to arm</div>
        <div class="muted small">When off, arm buttons work immediately. Disarm always requires a code.</div>
      </div>
      <input type="checkbox" id="arm-req" checked>
    </label>
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
    <span>${title}</span><span class="chevron" id="chev-${id}">▾</span>
  </div>
  <div class="card-body" id="body-${id}">${body}</div>
</div>`;
  }

  // ── Wire events ───────────────────────────────────────────────────────────

  _wire() {
    // Collapse toggle
    this.querySelectorAll(".card-header").forEach(h => {
      h.addEventListener("click", () => {
        const body  = this.querySelector(`#body-${h.dataset.id}`);
        const chev  = this.querySelector(`#chev-${h.dataset.id}`);
        const open  = !body.classList.contains("closed");
        body.classList.toggle("closed", open);
        chev.textContent = open ? "▸" : "▾";
      });
    });

    // Mode tabs
    this.querySelector("#mode-tabs").addEventListener("click", e => {
      const tab = e.target.closest(".tab");
      if (!tab) return;
      this.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      tab.classList.add("active");
      this._activeMode = tab.dataset.mode;
      this._renderSensors();
    });

    this.querySelector("#save-sensors")  .addEventListener("click", () => this._saveSensors());
    this.querySelector("#save-delays")   .addEventListener("click", () => this._saveDelays());
    this.querySelector("#add-user")      .addEventListener("click", () => this._addUser());
    this.querySelector("#save-notif")    .addEventListener("click", () => this._saveNotif());
    this.querySelector("#save-general")  .addEventListener("click", () => this._saveGeneral());
  }

  // ── Populate ──────────────────────────────────────────────────────────────

  _populate() {
    this._refreshBadge();
    this._renderSensors();
    this._populateDelays();
    this._populateCodes();
    this._populateNotif();
    this._populateGeneral();
  }

  _refreshBadge() {
    const badge = this.querySelector("#badge");
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

  // ── Sensors ───────────────────────────────────────────────────────────────

  _binarySensors() {
    return Object.values(this._hass.states)
      .filter(s => s.entity_id.startsWith("binary_sensor."))
      .sort((a, b) => (a.attributes.friendly_name || a.entity_id)
        .localeCompare(b.attributes.friendly_name || b.entity_id));
  }

  _renderSensors() {
    const container = this.querySelector("#sensor-list");
    if (!container) return;
    const selected = new Set(this._config?.sensors?.[this._activeMode] || []);
    const classes  = MODE_CLASSES[this._activeMode];
    const all      = this._binarySensors();
    const suggested = classes ? all.filter(s => classes.includes(s.attributes.device_class)) : all;
    const others    = classes ? all.filter(s => !classes.includes(s.attributes.device_class)) : [];

    const row = s => {
      const name = s.attributes.friendly_name || s.entity_id;
      const dc   = s.attributes.device_class   || "—";
      return `<label class="sensor-row">
        <input type="checkbox" class="s-cb" value="${s.entity_id}" ${selected.has(s.entity_id) ? "checked" : ""}>
        <span class="s-name">${name}</span>
        <span class="chip">${dc}</span>
      </label>`;
    };

    let html = "";
    if (suggested.length) {
      html += `<div class="group-label">${classes ? "Suggested for this mode" : "All sensors"}</div>`;
      html += suggested.map(row).join("");
    }
    if (others.length) {
      const show = this._showOthers[this._activeMode];
      html += `<div class="group-label toggle-others" data-mode="${this._activeMode}">
        Other sensors (${others.length}) ${show ? "▾" : "▸"}
      </div>
      <div class="${show ? "" : "gone"}" id="others-${this._activeMode}">
        ${others.map(row).join("")}
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
  }

  async _saveSensors() {
    const sensors = { ...(this._config?.sensors || {}) };
    sensors[this._activeMode] = [...this.querySelectorAll(".s-cb:checked")].map(cb => cb.value);
    await this._api("POST", "sensors", sensors);
    if (this._config) this._config.sensors = sensors;
    this._toast("Sensors saved ✓");
  }

  // ── Delays ────────────────────────────────────────────────────────────────

  _populateDelays() {
    this.querySelectorAll(".num").forEach(inp => {
      const v = this._config?.delays?.[inp.dataset.mode]?.[inp.dataset.t];
      if (v !== undefined) inp.value = v;
    });
  }

  async _saveDelays() {
    const delays = {};
    MODES.forEach(m => delays[m.key] = { entry_delay: 0, exit_delay: 0 });
    this.querySelectorAll(".num").forEach(inp => {
      delays[inp.dataset.mode][inp.dataset.t] = parseInt(inp.value, 10) || 0;
    });
    await this._api("POST", "delays", delays);
    if (this._config) this._config.delays = delays;
    this._toast("Delays saved ✓");
  }

  // ── Codes ─────────────────────────────────────────────────────────────────

  _populateCodes() {
    const el = this.querySelector("#codes-list");
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
    const name    = this.querySelector("#new-name")?.value.trim();
    const code    = this.querySelector("#new-code")?.value || "";
    const isAdmin = this.querySelector("#new-admin")?.checked || false;
    if (!name)         return this._toast("Name is required", true);
    if (code.length<4) return this._toast("Code must be at least 4 digits", true);
    await this._api("POST", "codes/add", { name, code, is_admin: isAdmin });
    this.querySelector("#new-name").value  = "";
    this.querySelector("#new-code").value  = "";
    this.querySelector("#new-admin").checked = false;
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
    const n = this._config?.notifications || {};
    const ta = this.querySelector("#notif-targets");
    if (ta) ta.value = (n.notify_targets || []).join(", ");
    const evts = n.notify_events || {};
    this.querySelectorAll(".ev-cb").forEach(cb => {
      cb.checked = evts[cb.dataset.event] !== false;
    });
  }

  async _saveNotif() {
    const raw     = this.querySelector("#notif-targets")?.value || "";
    const targets = raw.split(",").map(t => t.trim()).filter(Boolean);
    const events  = {};
    ALL_EVENTS.forEach(e => events[e] = false);
    this.querySelectorAll(".ev-cb").forEach(cb => { events[cb.dataset.event] = cb.checked; });
    await this._api("POST", "notifications", { notify_targets: targets, notify_events: events });
    this._toast("Notifications saved ✓");
  }

  // ── General ───────────────────────────────────────────────────────────────

  _populateGeneral() {
    const cb = this.querySelector("#arm-req");
    if (cb) cb.checked = this._config?.code_arm_required !== false;
  }

  async _saveGeneral() {
    const val = this.querySelector("#arm-req")?.checked ?? true;
    await this._api("POST", "general", { code_arm_required: val });
    if (this._config) this._config.code_arm_required = val;
    this._toast("Saved ✓");
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  _toast(msg, err = false) {
    const el = this.querySelector("#toast");
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
.panel{
  max-width:860px;margin:0 auto;padding:20px 16px;
  font-family:var(--paper-font-body1_-_font-family,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif);
  color:var(--primary-text-color,#e8e8e8);
  font-size:14px;
}
.page-header{display:flex;align-items:center;gap:12px;margin-bottom:20px}
.page-title{font-size:22px;font-weight:400}
.badge{padding:3px 12px;border-radius:12px;font-size:12px;font-weight:500}
.badge.disarmed {background:#4caf5022;color:#4caf50}
.badge.armed    {background:#2196f322;color:#2196f3}
.badge.triggered{background:#f4433622;color:#f44336}
.badge.pending  {background:#ff980022;color:#ff9800}

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

.sensor-list{max-height:360px;overflow-y:auto;padding-right:4px}
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

.field-row{display:flex;align-items:flex-start;gap:12px;margin-bottom:10px}
.field-row label{width:100px;flex-shrink:0;padding-top:7px;color:var(--secondary-text-color,#9095a5)}
.field-row input[type=text],
.field-row input[type=password],
.field-row textarea{
  flex:1;background:var(--secondary-background-color,#1e2028);
  border:1px solid var(--divider-color,#383c4a);
  color:var(--primary-text-color,#e8e8e8);
  padding:7px 10px;border-radius:6px;font-size:13px;font-family:inherit
}
textarea{resize:vertical;min-height:64px;width:100%}

.event-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px;margin:4px 0 14px}
.event-row{display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;font-size:13px}

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
