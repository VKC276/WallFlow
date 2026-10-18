/* Öppettider — admin-UI för WallFlow (standardtider, undantag, intern hallvärd). */
(function () {
  const DOW = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
  const MONTHS_SV = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december"
  ];
  const WEEK_ORDER = ["1", "2", "3", "4", "5", "6", "7"];
  const WEEK_LABELS = {
    1: "Måndag", 2: "Tisdag", 3: "Onsdag", 4: "Torsdag",
    5: "Fredag", 6: "Lördag", 7: "Söndag"
  };
  const PUBLIC_URL = "https://wallflow.vastervikclimbing.se/openinghours/";

  const state = {
    view: "calendar", // calendar | week | exceptions
    yearMonth: "",
    today: "",
    week: null,
    days: [],
    exceptions: [],
    hostOptions: [],
    loading: false,
    selectedDate: ""
  };

  function escapeHtml_(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function toast_(msg) {
    if (typeof showToast === "function") showToast(msg);
    else window.alert(msg);
  }

  function todayYmd_() {
    const d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  function shiftMonth_(ym, delta) {
    const [y, m] = String(ym).split("-").map(Number);
    const dt = new Date(y, m - 1 + delta, 1);
    return dt.getFullYear() + "-" + String(dt.getMonth() + 1).padStart(2, "0");
  }

  function monthTitle_(ym) {
    const [y, m] = String(ym).split("-").map(Number);
    return (MONTHS_SV[m - 1] || "") + " " + y;
  }

  function hostSelectHtml_(id, selected, includeEmpty) {
    const opts = [];
    if (includeEmpty !== false) {
      opts.push(`<option value="">— Ingen —</option>`);
    }
    (state.hostOptions || []).forEach((h) => {
      const sel = String(selected || "").toLowerCase() === String(h.username).toLowerCase() ? " selected" : "";
      opts.push(`<option value="${escapeHtml_(h.username)}"${sel}>${escapeHtml_(h.name)}</option>`);
    });
    return `<select id="${escapeHtml_(id)}" class="form-select">${opts.join("")}</select>`;
  }

  function formatHours_(day) {
    if (!day || day.closed) return "Stängt";
    return `${day.open || ""}–${day.close || ""}`;
  }

  function daysByDate_() {
    const map = {};
    (state.days || []).forEach((d) => { if (d && d.date) map[d.date] = d; });
    return map;
  }

  function renderTabs_() {
    const tabs = [
      { id: "calendar", label: "Kalender" },
      { id: "week", label: "Standardtider" },
      { id: "exceptions", label: "Undantag" }
    ];
    return `<div class="oh-tabs" role="tablist">
      ${tabs.map((t) =>
        `<button type="button" class="btn btn-sm ${state.view === t.id ? "btn-accent" : "btn-ghost"}" onclick="ohSetView_('${t.id}')">${t.label}</button>`
      ).join("")}
    </div>`;
  }

  function renderCalendar_() {
    const ym = state.yearMonth || todayYmd_().slice(0, 7);
    const byDate = daysByDate_();
    const [y, m] = ym.split("-").map(Number);
    const first = new Date(y, m - 1, 1);
    const lastDate = new Date(y, m, 0).getDate();
    let startPad = first.getDay() - 1;
    if (startPad < 0) startPad = 6;
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= lastDate; d++) {
      const date = ym + "-" + String(d).padStart(2, "0");
      cells.push({ date, num: d, day: byDate[date] || null });
    }
    while (cells.length % 7 !== 0) cells.push(null);

    const grid = cells.map((c) => {
      if (!c) return `<button type="button" class="oh-cell outside" tabindex="-1" aria-hidden="true"></button>`;
      const closed = !c.day || c.day.closed;
      const host = (c.day && (c.day.hostName || c.day.hostUsername)) || "";
      const today = c.date === state.today ? " is-today" : "";
      return `<button type="button" class="oh-cell ${closed ? "closed" : "open"}${today}" onclick="ohEditException_('${c.date}')">
        <span class="num">${c.num}</span>
        <span class="hours">${escapeHtml_(formatHours_(c.day))}</span>
        <span class="host">${escapeHtml_(host || "—")}</span>
      </button>`;
    }).join("");

    return `
      <div class="admin-card">
        <h3>Månadskalender</h3>
        <p class="oh-hint">Hallvärd syns bara här i WallFlow — inte på den publika sidan. Klicka ett datum för att skapa/redigera undantag.</p>
        <div class="oh-month-nav">
          <button type="button" class="btn btn-sm btn-ghost" onclick="ohShiftMonth_(-1)">←</button>
          <p class="oh-month-label">${escapeHtml_(monthTitle_(ym))}</p>
          <button type="button" class="btn btn-sm btn-ghost" onclick="ohShiftMonth_(1)">→</button>
        </div>
        <div class="oh-cal">
          ${DOW.map((d) => `<div class="oh-dow">${d}</div>`).join("")}
          ${grid}
        </div>
      </div>`;
  }

  function renderWeek_() {
    const week = state.week || {};
    const rows = WEEK_ORDER.map((key) => {
      const slot = week[key] || { closed: true, open: "", close: "", hostUsername: "" };
      const disabled = slot.closed ? "disabled" : "";
      return `<div class="oh-day-card" data-weekday="${key}">
        <h4>${WEEK_LABELS[key]}</h4>
        <label class="oh-check">
          <input type="checkbox" id="oh-week-closed-${key}" ${slot.closed ? "checked" : ""} onchange="ohWeekClosedToggle_('${key}')">
          Stängt
        </label>
        <div class="oh-day-fields">
          <div>
            <label class="form-label" for="oh-week-open-${key}">Öppnar</label>
            <input id="oh-week-open-${key}" type="time" class="form-control" value="${escapeHtml_(slot.open || "")}" ${disabled}>
          </div>
          <div>
            <label class="form-label" for="oh-week-close-${key}">Stänger</label>
            <input id="oh-week-close-${key}" type="time" class="form-control" value="${escapeHtml_(slot.close || "")}" ${disabled}>
          </div>
          <div class="oh-span-2">
            <label class="form-label" for="oh-week-host-${key}">Normal hallvärd (intern)</label>
            ${hostSelectHtml_("oh-week-host-" + key, slot.hostUsername, true)}
          </div>
        </div>
      </div>`;
    }).join("");

    return `
      <div class="admin-card">
        <h3>Standardtider</h3>
        <p class="oh-hint">Gäller varje vecka tills ett undantag finns för ett specifikt datum. Hallvärd visas inte publikt.</p>
        <div class="oh-day-grid">${rows}</div>
        <button type="button" class="btn btn-accent w-100 mt-3" onclick="ohSaveWeek_()">Spara standardtider</button>
      </div>`;
  }

  function renderExceptions_() {
    const list = (state.exceptions || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
    const items = list.length
      ? list.map((ex) => {
        const hours = ex.closed ? "Stängt" : `${ex.open || ""}–${ex.close || ""}`;
        const host = ex.hostName || ex.hostUsername || "—";
        const note = ex.note ? `<div class="oh-ex-meta">${escapeHtml_(ex.note)}</div>` : "";
        return `<div class="oh-ex-item">
          <div class="oh-ex-top">
            <span class="oh-ex-date">${escapeHtml_(ex.date)}</span>
            <span class="oh-ex-meta">${escapeHtml_(hours)} · Hallvärd: ${escapeHtml_(host)}</span>
          </div>
          ${note}
          <div class="oh-ex-actions">
            <button type="button" class="btn btn-sm btn-ghost" onclick="ohEditException_('${escapeHtml_(ex.date)}')">Redigera</button>
            <button type="button" class="btn btn-sm btn-ghost" onclick="ohDeleteException_('${escapeHtml_(ex.date)}')">Ta bort</button>
          </div>
        </div>`;
      }).join("")
      : `<p class="oh-hint">Inga undantag i den här månaden ännu.</p>`;

    const sel = state.selectedDate || state.today || todayYmd_();
    const existing = list.find((e) => e.date === sel) || null;
    const closed = existing ? !!existing.closed : false;
    const open = existing && !existing.closed ? (existing.open || "") : "";
    const close = existing && !existing.closed ? (existing.close || "") : "";
    const note = existing ? (existing.note || "") : "";
    const host = existing ? (existing.hostUsername || "") : "";

    return `
      <div class="admin-card">
        <h3>Undantag</h3>
        <p class="oh-hint">Ändra öppettider eller hallvärd för ett valt datum. Tom hallvärd innebär att veckans normalvärd gäller.</p>
        <div class="row g-2 mb-3">
          <div class="col-12 col-md-4">
            <label class="form-label" for="oh-ex-date">Datum</label>
            <input id="oh-ex-date" type="date" class="form-control" value="${escapeHtml_(sel)}" onchange="ohExceptionDateChange_()">
          </div>
          <div class="col-12 col-md-8">
            <label class="oh-check" style="margin-top:1.7rem">
              <input type="checkbox" id="oh-ex-closed" ${closed ? "checked" : ""} onchange="ohExceptionClosedToggle_()">
              Stängt hela dagen
            </label>
          </div>
          <div class="col-6">
            <label class="form-label" for="oh-ex-open">Öppnar</label>
            <input id="oh-ex-open" type="time" class="form-control" value="${escapeHtml_(open)}" ${closed ? "disabled" : ""}>
          </div>
          <div class="col-6">
            <label class="form-label" for="oh-ex-close">Stänger</label>
            <input id="oh-ex-close" type="time" class="form-control" value="${escapeHtml_(close)}" ${closed ? "disabled" : ""}>
          </div>
          <div class="col-12">
            <label class="form-label" for="oh-ex-host">Hallvärd (intern)</label>
            ${hostSelectHtml_("oh-ex-host", host, true)}
          </div>
          <div class="col-12">
            <label class="form-label" for="oh-ex-note">Publik anteckning (valfri)</label>
            <input id="oh-ex-note" type="text" class="form-control" maxlength="200" value="${escapeHtml_(note)}" placeholder="t.ex. Stängt p.g.a. tävling">
          </div>
        </div>
        <button type="button" class="btn btn-accent w-100 mb-3" onclick="ohSaveException_()">Spara undantag</button>
        <h4 class="mb-2">Undantag i perioden</h4>
        <div class="oh-ex-list">${items}</div>
      </div>`;
  }

  function render_() {
    const main = document.getElementById("openinghours-main");
    if (!main) return;
    const body = state.view === "week"
      ? renderWeek_()
      : (state.view === "exceptions" ? renderExceptions_() : renderCalendar_());
    main.innerHTML = `
      <p class="admin-kicker">Hallen</p>
      <h2 class="mb-2">Öppettider</h2>
      <div class="oh-public-link">
        Publik kalender (utan hallvärd):
        <a href="${PUBLIC_URL}" target="_blank" rel="noopener">${PUBLIC_URL}</a><br>
        Bädda in med <code>?embed=1</code>.
      </div>
      ${renderTabs_()}
      ${state.loading ? `<p class="oh-hint">Laddar…</p>` : ""}
      ${body}
    `;
  }

  function applyAdminPayload_(res) {
    state.today = String(res.today || todayYmd_());
    if (!state.yearMonth) state.yearMonth = state.today.slice(0, 7);
    state.week = res.week || {};
    state.days = res.days || [];
    state.exceptions = res.exceptions || [];
    state.hostOptions = res.hostOptions || [];
    state.loading = false;
  }

  function loadAdmin_(opts) {
    state.loading = true;
    render_();
    const payload = { yearMonth: state.yearMonth || todayYmd_().slice(0, 7) };
    if (opts && opts.from) payload.from = opts.from;
    if (opts && opts.to) payload.to = opts.to;
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) {
          state.loading = false;
          toast_((res && res.error) || "Kunde inte hämta öppettider");
          render_();
          return;
        }
        applyAdminPayload_(res);
        render_();
      })
      .withFailureHandler(() => {
        state.loading = false;
        toast_("Nätverksfel");
        render_();
      })
      .getOpeningHoursAdmin(payload);
  }

  function hideOpeningHoursOverlay_() {
    const el = document.getElementById("app-openinghours");
    if (el) el.classList.remove("show");
    document.body.classList.remove("openinghours-open");
  }

  function openOpeningHoursTool() {
    if (typeof canManageOpeningHours_ === "function" && !canManageOpeningHours_()) {
      return toast_("Saknar behörighet");
    }
    if (typeof currentUser !== "undefined" && currentUser && currentUser.firstLogin) {
      return toast_("Byt lösenord först");
    }
    const admin = document.getElementById("app-admin");
    if (admin) admin.classList.remove("show");
    const time = document.getElementById("app-time");
    if (time) time.classList.remove("show");
    const verif = document.getElementById("app-verif");
    if (verif) verif.classList.remove("show");
    if (typeof hideTencardOverlay_ === "function") hideTencardOverlay_();
    if (typeof hideWellnessOverlay_ === "function") hideWellnessOverlay_();
    if (typeof hideInspOverlay_ === "function") hideInspOverlay_();
    if (typeof hideCatalogOverlay_ === "function") hideCatalogOverlay_();
    if (typeof hideRentalOverlay_ === "function") hideRentalOverlay_();
    hideOpeningHoursOverlay_();

    const pub = document.getElementById("app-public");
    if (pub) pub.classList.remove("ready");
    if (typeof closeSearchPanel_ === "function") closeSearchPanel_();

    const panel = document.getElementById("app-openinghours");
    if (panel) panel.classList.add("show");
    document.body.classList.add("openinghours-open");
    if (typeof showAppChrome_ === "function") showAppChrome_();

    if (!state.yearMonth) state.yearMonth = todayYmd_().slice(0, 7);
    loadAdmin_();
  }

  function closeOpeningHoursTool() {
    hideOpeningHoursOverlay_();
  }

  function openOpeningHoursFromMenu_() {
    if (typeof closeAccountMenu_ === "function") closeAccountMenu_();
    openOpeningHoursTool();
  }

  function ohSetView_(view) {
    state.view = view || "calendar";
    render_();
  }

  function ohShiftMonth_(delta) {
    state.yearMonth = shiftMonth_(state.yearMonth || todayYmd_().slice(0, 7), delta);
    loadAdmin_();
  }

  function ohWeekClosedToggle_(key) {
    const closedEl = document.getElementById("oh-week-closed-" + key);
    const closed = !!(closedEl && closedEl.checked);
    const openEl = document.getElementById("oh-week-open-" + key);
    const closeEl = document.getElementById("oh-week-close-" + key);
    if (openEl) openEl.disabled = closed;
    if (closeEl) closeEl.disabled = closed;
  }

  function readWeekFromForm_() {
    const week = {};
    for (const key of WEEK_ORDER) {
      const closed = !!(document.getElementById("oh-week-closed-" + key) || {}).checked;
      const open = String((document.getElementById("oh-week-open-" + key) || {}).value || "");
      const close = String((document.getElementById("oh-week-close-" + key) || {}).value || "");
      const hostUsername = String((document.getElementById("oh-week-host-" + key) || {}).value || "");
      week[key] = { closed, open, close, hostUsername };
    }
    return week;
  }

  function ohSaveWeek_() {
    const week = readWeekFromForm_();
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte spara");
        toast_("Standardtider sparade");
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .saveOpeningHoursWeek({ week });
  }

  function ohEditException_(date) {
    state.selectedDate = String(date || "").slice(0, 10);
    state.view = "exceptions";
    render_();
  }

  function ohExceptionDateChange_() {
    const el = document.getElementById("oh-ex-date");
    state.selectedDate = String(el && el.value || "").slice(0, 10);
    render_();
  }

  function ohExceptionClosedToggle_() {
    const closed = !!(document.getElementById("oh-ex-closed") || {}).checked;
    const openEl = document.getElementById("oh-ex-open");
    const closeEl = document.getElementById("oh-ex-close");
    if (openEl) openEl.disabled = closed;
    if (closeEl) closeEl.disabled = closed;
  }

  function ohSaveException_() {
    const date = String((document.getElementById("oh-ex-date") || {}).value || "").slice(0, 10);
    const closed = !!(document.getElementById("oh-ex-closed") || {}).checked;
    const open = String((document.getElementById("oh-ex-open") || {}).value || "");
    const close = String((document.getElementById("oh-ex-close") || {}).value || "");
    const hostUsername = String((document.getElementById("oh-ex-host") || {}).value || "");
    const note = String((document.getElementById("oh-ex-note") || {}).value || "");
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte spara");
        toast_("Undantag sparat");
        state.selectedDate = date;
        if (date) state.yearMonth = date.slice(0, 7);
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .saveOpeningHoursException({ date, closed, open, close, hostUsername, note });
  }

  function ohDeleteException_(date) {
    if (!window.confirm("Ta bort undantaget " + date + "?")) return;
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte ta bort");
        toast_("Undantag borttaget");
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .deleteOpeningHoursException({ date });
  }

  window.hideOpeningHoursOverlay_ = hideOpeningHoursOverlay_;
  window.openOpeningHoursTool = openOpeningHoursTool;
  window.closeOpeningHoursTool = closeOpeningHoursTool;
  window.openOpeningHoursFromMenu_ = openOpeningHoursFromMenu_;
  window.ohSetView_ = ohSetView_;
  window.ohShiftMonth_ = ohShiftMonth_;
  window.ohWeekClosedToggle_ = ohWeekClosedToggle_;
  window.ohSaveWeek_ = ohSaveWeek_;
  window.ohEditException_ = ohEditException_;
  window.ohExceptionDateChange_ = ohExceptionDateChange_;
  window.ohExceptionClosedToggle_ = ohExceptionClosedToggle_;
  window.ohSaveException_ = ohSaveException_;
  window.ohDeleteException_ = ohDeleteException_;
})();
