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
  const PUBLIC_BAR_URL = "https://wallflow.vastervikclimbing.se/openinghoursbar/";

  const state = {
    view: "calendar", // calendar | week | exceptions
    yearMonth: "",
    today: "",
    week: null,
    days: [],
    exceptions: [],
    hostOptions: [],
    loading: false,
    selectedDate: "",
    selectedDateTo: "",
    /** "new" = skapa ny period. "edit" = uppdatera period med editingId. */
    formMode: "new",
    editingId: "",
    formClosed: false,
    formOpen: "",
    formClose: "",
    formHost: "",
    formNote: ""
  };

  function resetExceptionForm_(from, to) {
    const f = String(from || state.today || todayYmd_()).slice(0, 10);
    const t = String(to || f).slice(0, 10);
    state.selectedDate = f;
    state.selectedDateTo = t;
    state.formMode = "new";
    state.editingId = "";
    state.formClosed = false;
    state.formOpen = "";
    state.formClose = "";
    state.formHost = "";
    state.formNote = "";
  }

  function loadExceptionForm_(ex) {
    const f = String((ex && (ex.from || ex.date)) || "").slice(0, 10);
    const t = String((ex && ex.to) || f).slice(0, 10);
    state.selectedDate = f;
    state.selectedDateTo = t;
    state.formMode = "edit";
    state.editingId = String((ex && ex.id) || "").trim();
    state.formClosed = !!(ex && ex.closed);
    state.formOpen = ex && !ex.closed ? (ex.open || "") : "";
    state.formClose = ex && !ex.closed ? (ex.close || "") : "";
    state.formHost = (ex && (ex.hostUsername || "")) || "";
    state.formNote = (ex && (ex.note || "")) || "";
  }

  function readExceptionFormIntoState_() {
    const fromEl = document.getElementById("oh-ex-from");
    const toEl = document.getElementById("oh-ex-to");
    if (fromEl) state.selectedDate = String(fromEl.value || "").slice(0, 10);
    if (toEl) state.selectedDateTo = String(toEl.value || "").slice(0, 10) || state.selectedDate;
    const closedEl = document.getElementById("oh-ex-closed");
    if (closedEl) state.formClosed = !!closedEl.checked;
    const openEl = document.getElementById("oh-ex-open");
    const closeEl = document.getElementById("oh-ex-close");
    if (openEl) state.formOpen = String(openEl.value || "");
    if (closeEl) state.formClose = String(closeEl.value || "");
    const hostEl = document.getElementById("oh-ex-host");
    if (hostEl) state.formHost = String(hostEl.value || "");
    const noteEl = document.getElementById("oh-ex-note");
    if (noteEl) state.formNote = String(noteEl.value || "");
  }

  function formatPeriodLabel_(from, to) {
    if (!to || from === to) return from;
    return from + " – " + to;
  }

  /** Perioder som täcker ett datum (senast uppdaterad först). */
  function periodsCovering_(ymd) {
    return (state.exceptions || [])
      .filter((p) => p && p.from && p.to && ymd >= p.from && ymd <= p.to)
      .slice()
      .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
  }

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
    if (day.hoursLabel) return String(day.hoursLabel);
    if (Array.isArray(day.slots) && day.slots.length) {
      return day.slots.map((s) => String(s.open || "") + "–" + String(s.close || "")).join(" · ");
    }
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
      return `<button type="button" class="oh-cell ${closed ? "closed" : "open"}${today}" onclick="ohOpenDay_('${c.date}')">
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
    const periods = (state.exceptions || []).slice().sort((a, b) =>
      String(a.from || "").localeCompare(String(b.from || "")) ||
      String(a.to || "").localeCompare(String(b.to || ""))
    );
    const items = periods.length
      ? periods.map((g) => {
        const hours = g.closed ? "Stängt" : `${g.open || ""}–${g.close || ""}`;
        const host = g.hostName || g.hostUsername || "—";
        const note = g.note ? `<div class="oh-ex-meta">${escapeHtml_(g.note)}</div>` : "";
        const label = formatPeriodLabel_(g.from, g.to);
        const id = escapeHtml_(g.id || "");
        return `<div class="oh-ex-item">
          <div class="oh-ex-top">
            <span class="oh-ex-date">${escapeHtml_(label)}</span>
            <span class="oh-ex-meta">${escapeHtml_(hours)} · Hallvärd: ${escapeHtml_(host)}</span>
          </div>
          ${note}
          <div class="oh-ex-actions">
            <button type="button" class="btn btn-sm btn-ghost" onclick="ohEditException_('${id}')">Redigera</button>
            <button type="button" class="btn btn-sm btn-ghost" onclick="ohDeleteException_('${id}')">Ta bort</button>
          </div>
        </div>`;
      }).join("")
      : `<p class="oh-hint">Inga undantag i den här månaden ännu.</p>`;

    if (!state.selectedDate) resetExceptionForm_(state.today || todayYmd_());
    const selFrom = state.selectedDate;
    const selTo = state.selectedDateTo || selFrom;
    const closed = !!state.formClosed;
    const saveLabel = state.formMode === "edit" ? "Spara undantag" : "Skapa nytt undantag";
    const modeHint = state.formMode === "edit"
      ? "Redigerar valt undantag. Överlappande öppettider samma dag slås ihop i kalendern (t.ex. 12–15 · 18–21)."
      : "Skapa undantag för ett datum eller en period. Flera öppna pass samma dag visas tillsammans i kalendern.";

    return `
      <div class="admin-card">
        <h3>Undantag</h3>
        <p class="oh-hint">${modeHint}</p>
        <div class="row g-2 mb-3">
          <div class="col-6 col-md-4">
            <label class="form-label" for="oh-ex-from">Från</label>
            <input id="oh-ex-from" type="date" class="form-control" value="${escapeHtml_(selFrom)}" onchange="ohExceptionDateChange_()">
          </div>
          <div class="col-6 col-md-4">
            <label class="form-label" for="oh-ex-to">Till</label>
            <input id="oh-ex-to" type="date" class="form-control" value="${escapeHtml_(selTo)}" onchange="ohExceptionDateChange_()">
          </div>
          <div class="col-12 col-md-4">
            <label class="oh-check" style="margin-top:1.7rem">
              <input type="checkbox" id="oh-ex-closed" ${closed ? "checked" : ""} onchange="ohExceptionClosedToggle_()">
              Stängt hela dagen
            </label>
          </div>
          <div class="col-6">
            <label class="form-label" for="oh-ex-open">Öppnar</label>
            <input id="oh-ex-open" type="time" class="form-control" value="${escapeHtml_(state.formOpen)}" ${closed ? "disabled" : ""}>
          </div>
          <div class="col-6">
            <label class="form-label" for="oh-ex-close">Stänger</label>
            <input id="oh-ex-close" type="time" class="form-control" value="${escapeHtml_(state.formClose)}" ${closed ? "disabled" : ""}>
          </div>
          <div class="col-12">
            <label class="form-label" for="oh-ex-host">Hallvärd (intern)</label>
            ${hostSelectHtml_("oh-ex-host", state.formHost, true)}
          </div>
          <div class="col-12">
            <label class="form-label" for="oh-ex-note">Publik anteckning (valfri)</label>
            <input id="oh-ex-note" type="text" class="form-control" maxlength="200" value="${escapeHtml_(state.formNote)}" placeholder="t.ex. Stängt p.g.a. tävling">
          </div>
        </div>
        <button type="button" class="btn btn-accent w-100 mb-3" onclick="ohSaveException_()">${saveLabel}</button>
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
        Öppettidsbar (idag/imorgon):
        <a href="${PUBLIC_BAR_URL}" target="_blank" rel="noopener">${PUBLIC_BAR_URL}</a><br>
        Kalender: <code>?embed=1</code> · Baren är bäddbar som standard.
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
    if (typeof hideGroupBookingsOverlay_ === "function") hideGroupBookingsOverlay_();
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

  function ohNewException_(from, to) {
    resetExceptionForm_(from || state.today || todayYmd_(), to);
    state.view = "exceptions";
    render_();
  }

  function ohEditException_(id) {
    const ex = (state.exceptions || []).find((e) => String(e.id || "") === String(id || ""));
    if (!ex) return toast_("Undantaget hittades inte");
    loadExceptionForm_(ex);
    state.view = "exceptions";
    render_();
  }

  /** Kalenderklick: redigera senast sparade period som täcker dagen, annars nytt. */
  function ohOpenDay_(date) {
    const ymd = String(date || "").slice(0, 10);
    const covering = periodsCovering_(ymd);
    if (covering.length) ohEditException_(covering[0].id);
    else ohNewException_(ymd, ymd);
  }

  function ohExceptionDateChange_() {
    readExceptionFormIntoState_();
  }

  function ohExceptionClosedToggle_() {
    readExceptionFormIntoState_();
    const openEl = document.getElementById("oh-ex-open");
    const closeEl = document.getElementById("oh-ex-close");
    if (openEl) openEl.disabled = state.formClosed;
    if (closeEl) closeEl.disabled = state.formClosed;
  }

  function ohSaveException_() {
    readExceptionFormIntoState_();
    let from = state.selectedDate;
    let to = state.selectedDateTo || from;
    if (from && to && from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const closed = !!state.formClosed;
    const open = state.formOpen;
    const close = state.formClose;
    const hostUsername = state.formHost;
    const note = state.formNote;
    const payload = { from, to, closed, open, close, hostUsername, note };
    if (state.formMode === "edit" && state.editingId) payload.id = state.editingId;
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte spara");
        toast_(state.formMode === "edit" ? "Undantag uppdaterat" : "Undantag skapat");
        if (from) state.yearMonth = from.slice(0, 7);
        resetExceptionForm_(state.today || todayYmd_());
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .saveOpeningHoursException(payload);
  }

  function ohDeleteException_(id) {
    const ex = (state.exceptions || []).find((e) => String(e.id || "") === String(id || ""));
    const label = ex ? formatPeriodLabel_(ex.from, ex.to) : id;
    if (!window.confirm("Ta bort undantaget " + label + "?")) return;
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte ta bort");
        toast_("Undantag borttaget");
        resetExceptionForm_(state.today || todayYmd_());
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .deleteOpeningHoursException({ id });
  }

  window.hideOpeningHoursOverlay_ = hideOpeningHoursOverlay_;
  window.openOpeningHoursTool = openOpeningHoursTool;
  window.closeOpeningHoursTool = closeOpeningHoursTool;
  window.openOpeningHoursFromMenu_ = openOpeningHoursFromMenu_;
  window.ohSetView_ = ohSetView_;
  window.ohShiftMonth_ = ohShiftMonth_;
  window.ohWeekClosedToggle_ = ohWeekClosedToggle_;
  window.ohSaveWeek_ = ohSaveWeek_;
  window.ohNewException_ = ohNewException_;
  window.ohEditException_ = ohEditException_;
  window.ohOpenDay_ = ohOpenDay_;
  window.ohExceptionDateChange_ = ohExceptionDateChange_;
  window.ohExceptionClosedToggle_ = ohExceptionClosedToggle_;
  window.ohSaveException_ = ohSaveException_;
  window.ohDeleteException_ = ohDeleteException_;
})();
