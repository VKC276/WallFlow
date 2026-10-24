/* Gruppbokningar — admin-UI för WallFlow */
(function () {
  const DOW = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
  const MONTHS_SV = [
    "januari", "februari", "mars", "april", "maj", "juni",
    "juli", "augusti", "september", "oktober", "november", "december"
  ];
  const PUBLIC_URL = "https://wallflow.vastervikclimbing.se/gruppbokningar/";

  const state = {
    view: "calendar",
    yearMonth: "",
    today: "",
    days: [],
    bookings: [],
    hostOptions: [],
    loading: false,
    formMode: "new",
    editingId: "",
    from: "",
    to: "",
    startTime: "",
    endTime: "",
    groupName: "",
    contactName: "",
    contactEmail: "",
    contactPhone: "",
    clubHost: "",
    note: ""
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

  function formatPeriodLabel_(from, to) {
    if (!to || from === to) return from;
    return from + " – " + to;
  }

  function hostSelectHtml_(id, selected) {
    const opts = [`<option value="">— Ingen —</option>`];
    (state.hostOptions || []).forEach((h) => {
      const sel = String(selected || "").toLowerCase() === String(h.username).toLowerCase() ? " selected" : "";
      opts.push(`<option value="${escapeHtml_(h.username)}"${sel}>${escapeHtml_(h.name)}</option>`);
    });
    return `<select id="${escapeHtml_(id)}" class="form-select">${opts.join("")}</select>`;
  }

  function resetForm_(from, to) {
    const f = String(from || state.today || todayYmd_()).slice(0, 10);
    const t = String(to || f).slice(0, 10);
    state.formMode = "new";
    state.editingId = "";
    state.from = f;
    state.to = t;
    state.startTime = "";
    state.endTime = "";
    state.groupName = "";
    state.contactName = "";
    state.contactEmail = "";
    state.contactPhone = "";
    state.clubHost = "";
    state.note = "";
  }

  function loadForm_(b) {
    state.formMode = "edit";
    state.editingId = String((b && b.id) || "").trim();
    state.from = String((b && b.from) || "").slice(0, 10);
    state.to = String((b && b.to) || state.from).slice(0, 10);
    state.startTime = (b && b.startTime) || "";
    state.endTime = (b && b.endTime) || "";
    state.groupName = (b && b.groupName) || "";
    state.contactName = (b && b.contactName) || "";
    state.contactEmail = (b && b.contactEmail) || "";
    state.contactPhone = (b && b.contactPhone) || "";
    state.clubHost = (b && b.clubHost) || "";
    state.note = (b && b.note) || "";
  }

  function readFormIntoState_() {
    const get = (id) => document.getElementById(id);
    if (get("gb-from")) state.from = String(get("gb-from").value || "").slice(0, 10);
    if (get("gb-to")) state.to = String(get("gb-to").value || "").slice(0, 10) || state.from;
    if (get("gb-start")) state.startTime = String(get("gb-start").value || "");
    if (get("gb-end")) state.endTime = String(get("gb-end").value || "");
    if (get("gb-group")) state.groupName = String(get("gb-group").value || "");
    if (get("gb-contact")) state.contactName = String(get("gb-contact").value || "");
    if (get("gb-email")) state.contactEmail = String(get("gb-email").value || "");
    if (get("gb-phone")) state.contactPhone = String(get("gb-phone").value || "");
    if (get("gb-host")) state.clubHost = String(get("gb-host").value || "");
    if (get("gb-note")) state.note = String(get("gb-note").value || "");
  }

  function daysByDate_() {
    const map = {};
    (state.days || []).forEach((d) => { if (d && d.date) map[d.date] = d; });
    return map;
  }

  function renderTabs_() {
    const tabs = [
      { id: "calendar", label: "Kalender" },
      { id: "list", label: "Bokningar" }
    ];
    return `<div class="gb-tabs" role="tablist">
      ${tabs.map((t) =>
        `<button type="button" class="btn btn-sm ${state.view === t.id ? "btn-accent" : "btn-ghost"}" onclick="gbSetView_('${t.id}')">${t.label}</button>`
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
      if (!c) return `<button type="button" class="gb-cell outside" tabindex="-1" aria-hidden="true"></button>`;
      const bookings = (c.day && c.day.bookings) || [];
      const has = bookings.length > 0;
      const today = c.date === state.today ? " is-today" : "";
      const mini = bookings.slice(0, 3).map((b) =>
        `<span class="gb-mini">${escapeHtml_((b.hoursLabel || "") + " " + (b.groupName || ""))}</span>`
      ).join("");
      const more = bookings.length > 3 ? `<span class="gb-mini">+${bookings.length - 3} till</span>` : "";
      return `<button type="button" class="gb-cell ${has ? "has-booking" : ""}${today}" onclick="gbOpenDay_('${c.date}')">
        <span class="num">${c.num}</span>
        ${mini}${more}
      </button>`;
    }).join("");

    return `
      <div class="admin-card">
        <h3>Månadskalender</h3>
        <p class="gb-hint">Klicka ett datum för att skapa bokning. Gröna dagar har gruppbokning. Kontaktuppgifter och klubbvärd syns bara här.</p>
        <div class="gb-month-nav">
          <button type="button" class="btn btn-sm btn-ghost" onclick="gbShiftMonth_(-1)">←</button>
          <p class="gb-month-label">${escapeHtml_(monthTitle_(ym))}</p>
          <button type="button" class="btn btn-sm btn-ghost" onclick="gbShiftMonth_(1)">→</button>
        </div>
        <div class="gb-cal">
          ${DOW.map((d) => `<div class="gb-dow">${d}</div>`).join("")}
          ${grid}
        </div>
      </div>
      ${renderFormCard_()}`;
  }

  function renderList_() {
    const list = (state.bookings || []).slice().sort((a, b) =>
      String(a.from || "").localeCompare(String(b.from || "")) ||
      String(a.startTime || "").localeCompare(String(b.startTime || ""))
    );
    const items = list.length
      ? list.map((b) => {
        const label = formatPeriodLabel_(b.from, b.to);
        const hours = b.hoursLabel || ((b.startTime || "") + "–" + (b.endTime || ""));
        const host = b.clubHostName || b.clubHost || "—";
        const contact = [b.contactName, b.contactPhone, b.contactEmail].filter(Boolean).join(" · ") || "—";
        return `<div class="gb-item">
          <div class="gb-top">
            <span class="gb-title">${escapeHtml_(b.groupName || "Grupp")}</span>
            <span class="gb-meta">${escapeHtml_(label)} · ${escapeHtml_(hours)}</span>
          </div>
          <div class="gb-meta">Kontakt: ${escapeHtml_(contact)}</div>
          <div class="gb-meta">Värd från klubben<span class="gb-private-tag">intern</span>: ${escapeHtml_(host)}</div>
          ${b.note ? `<div class="gb-meta">${escapeHtml_(b.note)}</div>` : ""}
          <div class="gb-actions">
            <button type="button" class="btn btn-sm btn-ghost" onclick="gbEditBooking_('${escapeHtml_(b.id)}')">Redigera</button>
            <button type="button" class="btn btn-sm btn-ghost" onclick="gbDeleteBooking_('${escapeHtml_(b.id)}')">Ta bort</button>
          </div>
        </div>`;
      }).join("")
      : `<p class="gb-hint">Inga gruppbokningar i den här månaden.</p>`;

    return `
      <div class="admin-card">
        <h3>Bokningar</h3>
        <div class="gb-list">${items}</div>
      </div>
      ${renderFormCard_()}`;
  }

  function renderFormCard_() {
    if (!state.from) resetForm_(state.today || todayYmd_());
    const saveLabel = state.formMode === "edit" ? "Spara bokning" : "Skapa ny bokning";
    return `
      <div class="admin-card mt-3">
        <h3>${state.formMode === "edit" ? "Redigera bokning" : "Ny gruppbokning"}</h3>
        <p class="gb-hint">Värd från klubben syns bara i WallFlow — inte på den publika kalendern.</p>
        <div class="row g-2 mb-3">
          <div class="col-6 col-md-3">
            <label class="form-label" for="gb-from">Från</label>
            <input id="gb-from" type="date" class="form-control" value="${escapeHtml_(state.from)}" onchange="gbFormChange_()">
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label" for="gb-to">Till</label>
            <input id="gb-to" type="date" class="form-control" value="${escapeHtml_(state.to)}" onchange="gbFormChange_()">
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label" for="gb-start">Starttid</label>
            <input id="gb-start" type="time" class="form-control" value="${escapeHtml_(state.startTime)}" onchange="gbFormChange_()">
          </div>
          <div class="col-6 col-md-3">
            <label class="form-label" for="gb-end">Sluttid</label>
            <input id="gb-end" type="time" class="form-control" value="${escapeHtml_(state.endTime)}" onchange="gbFormChange_()">
          </div>
          <div class="col-12">
            <label class="form-label" for="gb-group">Gruppnamn</label>
            <input id="gb-group" type="text" class="form-control" maxlength="120" value="${escapeHtml_(state.groupName)}" onchange="gbFormChange_()" placeholder="t.ex. Skolklass 5B">
          </div>
          <div class="col-12 col-md-4">
            <label class="form-label" for="gb-contact">Kontaktperson</label>
            <input id="gb-contact" type="text" class="form-control" maxlength="120" value="${escapeHtml_(state.contactName)}" onchange="gbFormChange_()">
          </div>
          <div class="col-12 col-md-4">
            <label class="form-label" for="gb-email">E-post</label>
            <input id="gb-email" type="email" class="form-control" maxlength="120" value="${escapeHtml_(state.contactEmail)}" onchange="gbFormChange_()">
          </div>
          <div class="col-12 col-md-4">
            <label class="form-label" for="gb-phone">Telefon</label>
            <input id="gb-phone" type="tel" class="form-control" maxlength="40" value="${escapeHtml_(state.contactPhone)}" onchange="gbFormChange_()">
          </div>
          <div class="col-12">
            <label class="form-label" for="gb-host">Värd från klubben <span class="gb-private-tag">intern</span></label>
            ${hostSelectHtml_("gb-host", state.clubHost)}
          </div>
          <div class="col-12">
            <label class="form-label" for="gb-note">Anteckning (valfri, publik)</label>
            <input id="gb-note" type="text" class="form-control" maxlength="200" value="${escapeHtml_(state.note)}" onchange="gbFormChange_()" placeholder="t.ex. Visning / födelsedag">
          </div>
        </div>
        <button type="button" class="btn btn-accent w-100" onclick="gbSaveBooking_()">${saveLabel}</button>
      </div>`;
  }

  function render_() {
    const main = document.getElementById("groupbookings-main");
    if (!main) return;
    const body = state.view === "list" ? renderList_() : renderCalendar_();
    main.innerHTML = `
      <p class="admin-kicker">Hallen</p>
      <h2 class="mb-2">Gruppbokningar</h2>
      <div class="gb-public-link">
        Publik kalender (grupp + tider, utan kontakt/värd):
        <a href="${PUBLIC_URL}" target="_blank" rel="noopener">${PUBLIC_URL}</a><br>
        Bädda in med <code>?embed=1</code>.
      </div>
      ${renderTabs_()}
      ${state.loading ? `<p class="gb-hint">Laddar…</p>` : ""}
      ${body}
    `;
  }

  function applyPayload_(res) {
    state.today = String(res.today || todayYmd_());
    if (!state.yearMonth) state.yearMonth = state.today.slice(0, 7);
    state.days = res.days || [];
    state.bookings = res.bookings || [];
    state.hostOptions = res.hostOptions || [];
    state.loading = false;
  }

  function loadAdmin_() {
    state.loading = true;
    render_();
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) {
          state.loading = false;
          toast_((res && res.error) || "Kunde inte hämta gruppbokningar");
          render_();
          return;
        }
        applyPayload_(res);
        render_();
      })
      .withFailureHandler(() => {
        state.loading = false;
        toast_("Nätverksfel");
        render_();
      })
      .getGroupBookingsAdmin({ yearMonth: state.yearMonth || todayYmd_().slice(0, 7) });
  }

  function hideGroupBookingsOverlay_() {
    const el = document.getElementById("app-groupbookings");
    if (el) el.classList.remove("show");
    document.body.classList.remove("groupbookings-open");
  }

  function openGroupBookingsTool() {
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
    if (typeof hideOpeningHoursOverlay_ === "function") hideOpeningHoursOverlay_();
    hideGroupBookingsOverlay_();

    const pub = document.getElementById("app-public");
    if (pub) pub.classList.remove("ready");
    if (typeof closeSearchPanel_ === "function") closeSearchPanel_();

    const panel = document.getElementById("app-groupbookings");
    if (panel) panel.classList.add("show");
    document.body.classList.add("groupbookings-open");
    if (typeof showAppChrome_ === "function") showAppChrome_();

    if (!state.yearMonth) state.yearMonth = todayYmd_().slice(0, 7);
    if (!state.from) resetForm_(state.today || todayYmd_());
    loadAdmin_();
  }

  function closeGroupBookingsTool() {
    hideGroupBookingsOverlay_();
  }

  function openGroupBookingsFromMenu_() {
    if (typeof closeAccountMenu_ === "function") closeAccountMenu_();
    openGroupBookingsTool();
  }

  function gbSetView_(view) {
    state.view = view || "calendar";
    render_();
  }

  function gbShiftMonth_(delta) {
    state.yearMonth = shiftMonth_(state.yearMonth || todayYmd_().slice(0, 7), delta);
    loadAdmin_();
  }

  function gbOpenDay_(date) {
    const ymd = String(date || "").slice(0, 10);
    const day = (state.days || []).find((d) => d.date === ymd);
    const bookings = (day && day.bookings) || [];
    if (bookings.length === 1) {
      const full = (state.bookings || []).find((b) => b.id === bookings[0].id);
      if (full) {
        loadForm_(full);
        state.view = "list";
        render_();
        return;
      }
    }
    resetForm_(ymd, ymd);
    state.view = "list";
    render_();
  }

  function gbEditBooking_(id) {
    const b = (state.bookings || []).find((x) => String(x.id) === String(id));
    if (!b) return toast_("Bokningen hittades inte");
    loadForm_(b);
    state.view = "list";
    render_();
  }

  function gbFormChange_() {
    readFormIntoState_();
  }

  function gbSaveBooking_() {
    readFormIntoState_();
    let from = state.from;
    let to = state.to || from;
    if (from && to && from > to) {
      const tmp = from;
      from = to;
      to = tmp;
    }
    const payload = {
      from,
      to,
      startTime: state.startTime,
      endTime: state.endTime,
      groupName: state.groupName,
      contactName: state.contactName,
      contactEmail: state.contactEmail,
      contactPhone: state.contactPhone,
      clubHost: state.clubHost,
      note: state.note
    };
    if (state.formMode === "edit" && state.editingId) payload.id = state.editingId;
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte spara");
        toast_(state.formMode === "edit" ? "Bokning uppdaterad" : "Bokning skapad");
        if (from) state.yearMonth = from.slice(0, 7);
        resetForm_(state.today || todayYmd_());
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .saveGroupBooking(payload);
  }

  function gbDeleteBooking_(id) {
    const b = (state.bookings || []).find((x) => String(x.id) === String(id));
    const label = b ? (b.groupName + " (" + formatPeriodLabel_(b.from, b.to) + ")") : id;
    if (!window.confirm("Ta bort bokningen " + label + "?")) return;
    google.script.run
      .withSuccessHandler((res) => {
        if (!res || res.ok === false) return toast_((res && res.error) || "Kunde inte ta bort");
        toast_("Bokning borttagen");
        resetForm_(state.today || todayYmd_());
        loadAdmin_();
      })
      .withFailureHandler(() => toast_("Nätverksfel"))
      .deleteGroupBooking({ id });
  }

  window.hideGroupBookingsOverlay_ = hideGroupBookingsOverlay_;
  window.openGroupBookingsTool = openGroupBookingsTool;
  window.closeGroupBookingsTool = closeGroupBookingsTool;
  window.openGroupBookingsFromMenu_ = openGroupBookingsFromMenu_;
  window.gbSetView_ = gbSetView_;
  window.gbShiftMonth_ = gbShiftMonth_;
  window.gbOpenDay_ = gbOpenDay_;
  window.gbEditBooking_ = gbEditBooking_;
  window.gbFormChange_ = gbFormChange_;
  window.gbSaveBooking_ = gbSaveBooking_;
  window.gbDeleteBooking_ = gbDeleteBooking_;
})();
