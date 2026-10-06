(function () {
  var WALLFLOW_API = 'https://wallflow.muddy-rice-38d4.workers.dev/';
  var wallflowUser = readWallflowSession();
  var bookings = [];
  var timelineBookings = [];
  var passes = [];
  var selectedId = null;

  var TIMELINE_DAYS = 14;
  var TIMELINE_ACTIVE = {
    Requested: true,
    Approved: true,
    ChangePending: true,
    CancelPending: true,
    HandedOut: true
  };

  function $(id) { return document.getElementById(id); }

  /**
   * Statuses are stored and filtered on as English keys; this is the only place
   * that turns one into the Swedish text the admin reads. CancelPending can no
   * longer arise — a guest cancellation is immediate — but rows from the old
   * flow may still carry it.
   */
  var STATUS_LABELS = {
    Requested: 'Förfrågan',
    Approved: 'Godkänd',
    ChangePending: 'Ändring väntar',
    CancelPending: 'Avbokning väntar',
    HandedOut: 'Utlämnad',
    Returned: 'Återlämnad',
    Cancelled: 'Avbokad',
    Rejected: 'Avslagen',
    DoubleBooked: 'Dubbelbokat',
    Closed: 'Avslutade'
  };

  function statusLabel(status) {
    return STATUS_LABELS[status] || status;
  }

  /** Closed is a filter key, not a stored status. */
  var FILTER_STATUSES = ['Requested', 'Approved', 'HandedOut', 'Closed'];

  function displayStatus(b) {
    return b.doubleBooked ? 'DoubleBooked' : b.status;
  }

  var BUSY = {
    login: 'Loggar in…',
    logout: 'Loggar ut…',
    me: 'Kontrollerar inloggning…',
    adminOverview: 'Hämtar bokningar…',
    listBookings: 'Hämtar bokningar…',
    adminUpdateBooking: 'Sparar bokningen…',
    deleteBooking: 'Raderar bokningen…',
    saveAdminConfig: 'Sparar inställningar…',
    availablePadsForBooking: 'Kontrollerar ledig utrustning…',
    listPads: 'Hämtar utrustning…',
    updatePad: 'Sparar pris…',
    createPad: 'Lägger till utrustning…',
    setPadActive: 'Uppdaterar utrustning…',
    listPricingRules: 'Hämtar rabattregler…',
    savePricingRule: 'Sparar rabattregel…',
    deletePricingRule: 'Tar bort rabattregel…',
    listUsers: 'Hämtar användare…',
    createUser: 'Skapar användare…',
    deleteUser: 'Tar bort användare…',
    sendUserPasswordReset: 'Skickar återställningsmejl…',
    requestPasswordReset: 'Skickar länk…',
    resetPassword: 'Sparar lösenord…',
    changePassword: 'Byter lösenord…',
    listDoorPasses: 'Hämtar dörrlänkar…',
    createDoorPass: 'Skickar dörrlänk…',
    revokeDoorPass: 'Spärrar dörrlänk…',
    deleteDoorPass: 'Raderar dörrlänk…',
    getRentalStats: 'Hämtar statistik…'
  };

  function readWallflowSession() {
    var raw = '';
    try {
      raw = localStorage.getItem('wallflow_session_v1') || sessionStorage.getItem('wallflow_session_v1') || '';
    } catch (e) { raw = ''; }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function hasUthyrare(user) {
    if (!user || !user.token) return false;
    var role = String(user.role || '').toLowerCase();
    if (role === 'uthyrare') return true;
    var extras = user.extraRoles || user.extra_roles || [];
    if (typeof extras === 'string') extras = extras.split(/[,;]+/);
    for (var i = 0; i < extras.length; i++) {
      if (String(extras[i] || '').trim().toLowerCase() === 'uthyrare') return true;
    }
    return false;
  }

  function wallflowRental(action, payload) {
    return fetch(WALLFLOW_API, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        action: 'rentalAdmin',
        token: wallflowUser && wallflowUser.token || '',
        args: [Object.assign({ action: action }, payload || {})]
      })
    }).then(function (r) { return r.json(); }).then(function (data) {
      if (!data || data.ok === false) {
        var err = new Error((data && data.error) || 'Okänt fel');
        err.fromServer = true;
        if (/inlogg|behörighet|unauthorized/i.test(err.message)) err.status = 401;
        if (data && data.code) err.code = data.code;
        if (data && data.details) err.details = data.details;
        throw err;
      }
      return data;
    });
  }

  var Api = { call: wallflowRental };

  function api(action, payload, btn, busyLabel) {
    var label = busyLabel || BUSY[action] || 'Arbetar…';
    var call = wallflowRental(action, payload || {});
    return btn ? Status.button(btn, label, call) : Status.during(label, call);
  }

  function showLogin(show) {
    if (!show) {
      if ($('app')) $('app').hidden = false;
      if ($('nav')) $('nav').hidden = false;
      showView(activeView);
      return;
    }
    if (typeof forceRelogin_ === 'function') {
      forceRelogin_('Du har loggats ut. Logga in igen för att fortsätta.');
    }
  }

  function renderAdminUser(user) {
    var el = $('adminUser');
    if (!el) return;
    if (!user) {
      el.hidden = true;
      el.textContent = '';
      el.removeAttribute('title');
      return;
    }
    var name = String(user.name || ((user.firstName || '') + ' ' + (user.lastName || '')).trim()).trim();
    el.textContent = name || user.email || user.username || '';
    el.title = user.email || '';
    el.hidden = !el.textContent;
  }

  var VIEWS = { bookings: true, doorpass: true, settings: true, stats: true };
  var activeView = 'bookings';

  function rentalRoot() {
    return document.getElementById('app-rental') || document;
  }

  function showView(name) {
    var view = VIEWS[name] ? name : 'bookings';
    activeView = view;
    rentalRoot().querySelectorAll('.admin-view').forEach(function (el) {
      el.hidden = el.getAttribute('data-view') !== view;
    });
    rentalRoot().querySelectorAll('#nav [data-view]').forEach(function (a) {
      var on = a.getAttribute('data-view') === view;
      a.classList.toggle('is-active', on);
      a.classList.toggle('btn-accent', on);
      a.classList.toggle('btn-ghost', !on);
    });
    if (view === 'stats') loadStats();
  }

  document.querySelectorAll('#app-rental #nav [data-view]').forEach(function (a) {
    a.addEventListener('click', function () {
      showView(a.getAttribute('data-view'));
    });
  });

  function requireSession() {
    if (!hasUthyrare(wallflowUser)) {
      showLogin(true);
      return false;
    }
    return true;
  }

  function rentalOnly() {
    if (!wallflowUser) return false;
    var roles = [String(wallflowUser.role || '').toLowerCase()];
    var extras = wallflowUser.extraRoles || wallflowUser.extra_roles || [];
    if (typeof extras === 'string') extras = extras.split(/[,;]+/);
    extras.forEach(function (r) { roles.push(String(r || '').trim().toLowerCase()); });
    return !roles.some(function (r) {
      return r === 'superadmin' || r === 'admin' || r === 'scout' || r === 'kassor' || r === 'hallvard';
    });
  }

  var back = $('logout');
  if (back && rentalOnly()) {
    back.textContent = 'Logga ut';
    back.onclick = function (e) {
      e.preventDefault();
      try {
        localStorage.removeItem('wallflow_session_v1');
        sessionStorage.removeItem('wallflow_session_v1');
      } catch (err) { /* ignore */ }
      window.location.href = 'index.html';
    };
  } else if (back) {
    back.textContent = 'Tillbaka';
    back.onclick = function (e) {
      e.preventDefault();
      window.location.href = 'index.html';
    };
  }

  /**
   * One request for the whole page. Five separate calls cost five redirect
   * round trips, which dwarfs the time Apps Script spends producing the data.
   */
  function refreshAll() {
    return api('adminOverview', {
      bookingNumber: $('searchNo').value.trim(),
      status: $('filterStatus').value
    }).then(function (res) {
      renderBookings(res.bookings || []);
      renderPads(res.pads || []);
      renderRules(res.rules || []);
      renderPasses(res.passes || []);
      renderAdminConfig(res.adminConfig || {});
      renderAdminUser(wallflowUser);
      return loadTimeline();
    }).catch(function (e) {
      if (e.status === 401) showLogin(true);
      else alert(e.message);
    });
  }

  function loadBookings() {
    return api('listBookings', {
      bookingNumber: $('searchNo').value.trim(),
      status: $('filterStatus').value
    }).then(function (res) {
      renderBookings(res.bookings || []);
      return loadTimeline();
    }).catch(function (e) {
      if (e.status === 401) showLogin(true);
      else alert(e.message);
    });
  }

  /** Timeline ignores list filters so “närmast i tid” always stays visible. */
  function loadTimeline() {
    return Api.call('listBookings', { bookingNumber: '', status: '' })
      .then(function (res) {
        timelineBookings = res.bookings || [];
        renderTimeline();
      })
      .catch(function () {
        // Keep whatever was shown; list errors are already handled above.
      });
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function addDaysYmd(ymd, days) {
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function weekdayShort(ymd) {
    var p = String(ymd).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    return ['sö', 'må', 'ti', 'on', 'to', 'fr', 'lö'][d.getDay()];
  }

  function dayNum(ymd) {
    return String(ymd).slice(8);
  }

  function overlaps(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && aEnd >= bStart;
  }

  function assignLanes(items) {
    var lanes = [];
    items.forEach(function (item) {
      var lane = 0;
      while (lane < lanes.length) {
        var clash = lanes[lane].some(function (other) {
          return overlaps(item.visStart, item.visEnd, other.visStart, other.visEnd);
        });
        if (!clash) break;
        lane++;
      }
      if (!lanes[lane]) lanes[lane] = [];
      lanes[lane].push(item);
      item.lane = lane;
    });
    return lanes.length || 1;
  }

  function daysBetween(a, b) {
    var pa = String(a).split('-').map(Number);
    var pb = String(b).split('-').map(Number);
    var da = Date.UTC(pa[0], pa[1] - 1, pa[2]);
    var db = Date.UTC(pb[0], pb[1] - 1, pb[2]);
    return Math.round((db - da) / 86400000);
  }

  function whenLabel(b, today) {
    if (b.startDate <= today && b.endDate >= today) {
      if (b.endDate === today) return 'Sista dagen';
      if (b.startDate === today) return 'Börjar idag';
      return 'Pågår';
    }
    var until = daysBetween(today, b.startDate);
    if (until === 1) return 'Imorgon';
    if (until > 1) return 'Om ' + until + ' dagar';
    return b.startDate;
  }

  function barTone(b) {
    if (b.doubleBooked) return 'is-double';
    if (b.status === 'Requested' || b.status === 'ChangePending' || b.status === 'CancelPending') {
      return 'is-pending';
    }
    if (b.status === 'HandedOut') return 'is-out';
    return 'is-ok';
  }

  function bindTimelineClicks(root) {
    root.querySelectorAll('[data-id]').forEach(function (btn) {
      btn.onclick = function () { openDetail(btn.getAttribute('data-id')); };
    });
  }

  function renderTimeline() {
    var wrap = $('timelineScroll');
    var today = todayYmd();
    var end = addDaysYmd(today, TIMELINE_DAYS - 1);
    $('timelineRange').textContent = today + ' – ' + end;

    var items = timelineBookings.filter(function (b) {
      if (!TIMELINE_ACTIVE[b.status]) return false;
      return overlaps(b.startDate, b.endDate, today, end);
    }).map(function (b) {
      var visStart = b.startDate < today ? today : b.startDate;
      var visEnd = b.endDate > end ? end : b.endDate;
      return {
        booking: b,
        visStart: visStart,
        visEnd: visEnd
      };
    }).sort(function (a, b) {
      if (a.visStart !== b.visStart) return a.visStart < b.visStart ? -1 : 1;
      if (a.booking.startDate !== b.booking.startDate) {
        return a.booking.startDate < b.booking.startDate ? -1 : 1;
      }
      return a.booking.bookingNumber < b.booking.bookingNumber ? -1 : 1;
    });

    if (!items.length) {
      wrap.innerHTML = '<p class="muted" id="timelineEmpty">Inga aktiva bokningar i perioden.</p>';
      return;
    }

    var laneCount = assignLanes(items);
    var days = [];
    for (var i = 0; i < TIMELINE_DAYS; i++) days.push(addDaysYmd(today, i));

    var dayHeads = days.map(function (d, idx) {
      var cls = 'timeline-day' + (d === today ? ' is-today' : '');
      return '<div class="' + cls + '" style="grid-column:' + (idx + 1) + '">' +
        '<span class="timeline-wd">' + weekdayShort(d) + '</span>' +
        '<span class="timeline-dn">' + dayNum(d) + '</span></div>';
    }).join('');

    var bars = items.map(function (item) {
      var b = item.booking;
      var startIdx = days.indexOf(item.visStart);
      var endIdx = days.indexOf(item.visEnd);
      if (startIdx < 0 || endIdx < 0) return '';
      var colStart = startIdx + 1;
      var colEnd = endIdx + 2;
      var pads = (b.pads || []).map(function (p) { return p.name; }).join(', ');
      var shown = displayStatus(b);
      var title = b.bookingNumber + ' · ' + b.firstName + ' ' + b.lastName +
        ' · ' + b.startDate + ' – ' + b.endDate +
        (pads ? ' · ' + pads : '') + ' · ' + statusLabel(shown);
      return '<button type="button" class="timeline-bar ' + barTone(b) + '" data-id="' + b.id + '"' +
        ' style="grid-column:' + colStart + ' / ' + colEnd + '; grid-row:' + (item.lane + 1) + '"' +
        ' title="' + escapeHtml(title) + '">' +
        '<span class="timeline-bar-no">' + escapeHtml(b.bookingNumber) + '</span>' +
        '<span class="timeline-bar-who">' + escapeHtml(b.firstName + ' ' + b.lastName) + '</span>' +
        '</button>';
    }).join('');

    var mobile = items.map(function (item) {
      var b = item.booking;
      var shown = displayStatus(b);
      var pads = (b.pads || []).map(function (p) { return p.name; }).join(', ');
      return '<button type="button" class="timeline-m-item ' + barTone(b) + '" data-id="' + b.id + '">' +
        '<span class="timeline-m-when">' + escapeHtml(whenLabel(b, today)) + '</span>' +
        '<span class="timeline-m-main">' +
          '<span class="timeline-m-who">' + escapeHtml(b.firstName + ' ' + b.lastName) + '</span>' +
          '<span class="timeline-m-meta">' + escapeHtml(b.bookingNumber) + ' · ' +
            escapeHtml(b.startDate + ' – ' + b.endDate) +
            (pads ? ' · ' + escapeHtml(pads) : '') +
            ' · ' + escapeHtml(statusLabel(shown)) +
          '</span>' +
        '</span></button>';
    }).join('');

    wrap.innerHTML =
      '<p class="timeline-swipe muted timeline-desktop-only">Svep i sidled för fler dagar</p>' +
      '<div class="timeline-desktop">' +
        '<div class="timeline-grid" style="--timeline-days:' + TIMELINE_DAYS + '; --timeline-lanes:' + laneCount + '">' +
          '<div class="timeline-days">' + dayHeads + '</div>' +
          '<div class="timeline-lanes">' + bars + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="timeline-mobile" aria-label="Kommande bokningar">' + mobile + '</div>';

    bindTimelineClicks(wrap);
  }

  function renderBookings(list) {
    bookings = list;
    var wrap = $('bookingsList');
    wrap.innerHTML = bookings.map(function (b) {
      var shown = displayStatus(b);
      var badgeClass = b.doubleBooked ? ' badge-double' : '';
      return '<button type="button" class="list-row booking' + (b.doubleBooked ? ' is-double' : '') + '" data-id="' + b.id + '">' +
        '<span class="r-no">' +
          '<span class="r-no-id">' + escapeHtml(b.bookingNumber) + '</span>' +
          '<span class="r-tags">' +
            '<span class="badge' + badgeClass + '">' + escapeHtml(statusLabel(shown)) + '</span>' +
            '<span class="badge ' + (b.paid ? 'paid' : 'unpaid') + '">' + (b.paid ? 'Betald' : 'Obetald') + '</span>' +
          '</span>' +
        '</span>' +
        '<span class="r-guest">' + escapeHtml(b.firstName + ' ' + b.lastName) +
          '<span class="sub">' + escapeHtml(b.email) + '</span></span>' +
        '<span class="r-period">' + b.startDate + ' – ' + b.endDate +
          '<span class="sub">' + b.days + ' dygn</span></span>' +
        '<span class="r-price">' + b.priceTotal + ' SEK</span>' +
        '</button>';
    }).join('');
    $('bookingsEmpty').hidden = bookings.length > 0;
    wrap.querySelectorAll('.list-row').forEach(function (row) {
      row.onclick = function () { openDetail(row.getAttribute('data-id')); };
    });
  }

  function showModal(id) {
    $(id).hidden = false;
    document.body.classList.add('modal-open');
  }

  /** The page only scrolls again once no dialog is left open. */
  function hideModal(id) {
    $(id).hidden = true;
    if (!document.querySelector('.modal:not([hidden])')) {
      document.body.classList.remove('modal-open');
    }
  }

  function closeDetail() {
    selectedId = null;
    hideModal('detailModal');
  }

  function closePass() {
    hideModal('passModal');
  }

  var MODAL_CLOSERS = { detailModal: closeDetail, passModal: closePass };

  function closeAllModals() {
    Object.keys(MODAL_CLOSERS).forEach(function (id) { MODAL_CLOSERS[id](); });
  }

  // Every dialog closes the same three ways: the cross, a click outside and
  // Escape, which takes the topmost one.
  document.querySelectorAll('[data-close-modal]').forEach(function (el) {
    var modal = el.closest('.modal');
    el.onclick = function () { MODAL_CLOSERS[modal.id](); };
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelectorAll('.modal:not([hidden])');
    if (open.length) MODAL_CLOSERS[open[open.length - 1].id]();
  });

  /** The note beside the box is where the receipt for the save belongs. */
  function flagCheckbox(id, label, checked) {
    return '<label class="check"><input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + '> ' +
      label + ' <span class="check-note" id="' + id + 'Note"></span></label>';
  }

  function findBooking(id) {
    return bookings.filter(function (x) { return x.id === id; })[0] ||
      timelineBookings.filter(function (x) { return x.id === id; })[0];
  }

  /** Booking workflow: only the current step is open; the rest stay collapsed. */
  function processStep(opts) {
    var state = opts.state || 'todo';
    var open = !!opts.open;
    var cls = 'process-step is-' + state + (open ? ' is-open' : '');
    var html = '<details class="' + cls + '"' + (open ? ' open' : '') + ' data-step="' + escapeHtml(opts.id) + '">';
    html += '<summary class="process-step-head">';
    html += '<span class="process-step-num" aria-hidden="true">' + escapeHtml(opts.num) + '</span>';
    html += '<span class="process-step-title">' + escapeHtml(opts.title) + '</span>';
    if (opts.badge) html += '<span class="process-step-badge">' + escapeHtml(opts.badge) + '</span>';
    html += '</summary>';
    html += '<div class="process-step-body">';
    if (opts.lead) html += '<p class="detail-section-lead">' + opts.lead + '</p>';
    html += opts.body || '';
    html += '</div></details>';
    return html;
  }

  function accordion(opts) {
    var open = !!opts.open;
    var cls = 'detail-accordion' + (opts.danger ? ' is-danger' : '') + (open ? ' is-open' : '');
    var html = '<details class="' + cls + '"' + (open ? ' open' : '') + '>';
    html += '<summary>' + escapeHtml(opts.title);
    if (opts.badge) html += ' <span class="process-step-badge">' + escapeHtml(opts.badge) + '</span>';
    html += '</summary>';
    html += '<div class="detail-accordion-body">';
    if (opts.lead) html += '<p class="detail-section-lead muted">' + opts.lead + '</p>';
    html += opts.body || '';
    html += '</div></details>';
    return html;
  }

  function openDetail(id) {
    selectedId = id;
    var b = findBooking(id);
    if (!b) return;
    showModal('detailModal');
    $('detailTitle').textContent = b.bookingNumber;
    var html = '';
    var needsApproval = b.status === 'Requested' || b.status === 'ChangePending';
    var canHandover = ['Approved', 'HandedOut', 'Returned'].indexOf(b.status) >= 0;
    var canEditPads = ['Returned', 'Cancelled', 'Rejected'].indexOf(b.status) < 0;
    var closed = ['Returned', 'Cancelled', 'Rejected'].indexOf(b.status) >= 0;

    if (b.doubleBooked) {
      html += '<div class="conflict-box">';
      html += '<p><span class="badge badge-double">Dubbelbokat</span> ' +
        '<span class="muted">underliggande status: ' + escapeHtml(statusLabel(b.status)) + '</span></p>';
      html += '<p><strong>Krockar med</strong></p><ul class="conflict-list">';
      (b.conflicts || []).forEach(function (c) {
        html += '<li><strong>' + escapeHtml(c.padName) + '</strong> — samma period som ' +
          escapeHtml(c.otherNumber) + ' (' + escapeHtml(c.otherGuest) + ', ' +
          c.otherStart + ' – ' + c.otherEnd + ', ' + escapeHtml(statusLabel(c.otherStatus)) + ')</li>';
      });
      html += '</ul><p class="muted">Justera under Mer → Ändra period &amp; utrustning.</p></div>';
    }

    html += '<div class="detail-summary">';
    html += '<p class="detail-meta">';
    html += '<span class="badge">' + escapeHtml(statusLabel(b.status)) + '</span> ';
    html += '<span class="badge ' + (b.paid ? 'paid' : 'unpaid') + '">' + (b.paid ? 'Betald' : 'Obetald') + '</span>';
    html += '</p>';
    html += '<p class="detail-guest"><strong>' + escapeHtml(b.firstName + ' ' + b.lastName) + '</strong></p>';
    html += '<p class="muted">' + escapeHtml(b.phone) + ' · ' + escapeHtml(b.email) + '</p>';
    var guestNotes = String(b.notes || '').trim();
    if (guestNotes) {
      html += '<div class="detail-guest-message">';
      html += '<p class="detail-guest-message-label">Meddelande från kund</p>';
      html += '<blockquote class="guest-notes">' + escapeHtml(guestNotes) + '</blockquote>';
      html += '</div>';
    }
    html += '<dl class="detail-facts">';
    html += '<div><dt>Utrustning</dt><dd>' + escapeHtml((b.pads || []).map(function (p) { return p.name; }).join(', ') || '—') + '</dd></div>';
    html += '<div><dt>Period</dt><dd>' + b.startDate + ' – ' + b.endDate + ' <span class="muted">(' + b.days + ' dygn)</span></dd></div>';
    html += '<div><dt>Summa</dt><dd><strong>' + b.priceTotal + ' SEK</strong></dd></div>';
    html += '</dl></div>';

    html += '<div class="process-flow">';
    html += '<p class="process-flow-label">Process</p>';

    var approveState = 'todo';
    if (needsApproval) {
      approveState = 'current';
    } else if (['Rejected', 'Cancelled'].indexOf(b.status) >= 0) {
      approveState = 'done';
    } else {
      approveState = 'done';
    }
    var approveBody = needsApproval
      ? '<div class="actions">' +
        '<button type="button" class="btn btn-accent" id="actApprove">Godkänn</button>' +
        '<button type="button" class="btn btn-ghost" id="actReject">Avslå</button></div>' +
        '<div id="rejectBox" class="detail-panel" hidden>' +
        '<label for="rejectReason">Orsak till avslag</label>' +
        '<textarea id="rejectReason" rows="3" maxlength="500" placeholder="Kort meddelande till kunden…"></textarea>' +
        '<div class="actions">' +
        '<button type="button" class="btn btn-ghost" id="actRejectConfirm">Bekräfta avslag</button>' +
        '<button type="button" class="btn btn-ghost" id="actRejectCancel">Avbryt</button>' +
        '</div></div>'
      : (String(b.rejectReason || '').trim()
        ? '<p class="muted">Orsak: ' + escapeHtml(String(b.rejectReason).trim()) + '</p>'
        : '<p class="muted">Steget är klart.</p>');
    html += processStep({
      id: 'approve',
      num: '1',
      title: 'Godkänn',
      state: approveState,
      open: false,
      lead: needsApproval
        ? 'Godkänn eller avslå förfrågan innan betalning och utlämning.'
        : '',
      body: approveBody
    });

    var payState = b.paid ? 'done' : (needsApproval ? 'todo' : 'current');
    html += processStep({
      id: 'pay',
      num: '2',
      title: 'Betalning',
      state: payState,
      open: false,
      lead: b.paid ? 'Bokningen är markerad som betald.' : 'Ingen betalning registrerad ännu.',
      body: '<div class="actions"><button type="button" class="' + (b.paid ? 'btn btn-ghost' : 'btn btn-accent') + '" id="actPaid">' +
        (b.paid ? 'Markera som obetald' : 'Markera som betald') + '</button></div>'
    });

    var handState = 'todo';
    var handLead = 'Godkänn bokningen först.';
    var handBody = '<p class="muted">Ingen utlämningsåtgärd ännu.</p>';
    if (b.status === 'Approved') {
      handState = 'current';
      handLead = 'Lämna ut hela beställningen när kunden får utrustningen.';
      handBody = '<div class="actions"><button type="button" class="btn btn-accent" id="actHandover">Lämna ut</button></div>';
    } else if (b.status === 'HandedOut') {
      handState = 'current';
      handLead = 'Utrustningen är utlämnad. Markera när den återlämnas.';
      handBody = '<div class="actions"><button type="button" class="btn btn-accent" id="actHandover">Återlämna</button></div>';
    } else if (b.status === 'Returned') {
      handState = 'done';
      handLead = 'Återlämning är registrerad.';
      handBody = '<div class="actions"><button type="button" class="btn btn-ghost" id="actHandover">Lämna ut</button></div>' +
        '<p class="muted">Knappen ångrar återlämning.</p>';
    } else if (closed) {
      handState = 'done';
      handLead = '';
      handBody = '<p class="muted">Ingen utlämningsåtgärd för denna status.</p>';
    }
    html += processStep({
      id: 'handover',
      num: '3',
      title: 'Utlämning',
      state: handState,
      open: false,
      lead: handLead,
      body: handBody
    });

    html += '</div>';

    html += '<div class="detail-more">';
    html += '<p class="process-flow-label">Mer</p>';

    html += accordion({
      title: 'Självbetjäning',
      open: false,
      lead: 'Kunden öppnar dörren och bekräftar sedan upphämtning respektive återlämning inom angivna klockslag.',
      body: '<div class="check-row">' +
        flagCheckbox('flagPickup', 'Tillåt egen hämtning', b.allowSelfPickup) +
        flagCheckbox('flagReturn', 'Tillåt egen återlämning', b.allowSelfReturn) +
        '</div>' +
        '<div class="row" style="margin-top:0.75rem;">' +
        '<div><label for="ssStartTime">Öppen från</label>' +
        '<input id="ssStartTime" type="time" value="' +
        escapeHtml(b.selfServiceStartTime || '06:00') + '" /></div>' +
        '<div><label for="ssEndTime">Öppen till</label>' +
        '<input id="ssEndTime" type="time" value="' +
        escapeHtml(b.selfServiceEndTime || '22:00') + '" /></div>' +
        '</div>' +
        '<div class="actions" style="margin-top:0.65rem;">' +
        '<button type="button" class="btn btn-ghost" id="actSaveSelfHours">Spara tider</button></div>' +
        '<p class="ok" id="ssHoursOk" hidden></p>' +
        '<p class="err" id="ssHoursErr" hidden></p>'
    });

    if (canEditPads) {
      html += accordion({
        title: 'Ändra period & utrustning',
        open: false,
        lead: 'Ändra datum och utrustning tillsammans — då går det att lösa krockar i ett steg. Priset räknas om automatiskt.',
        body:
          '<div class="row">' +
          '<div><label for="edStart">Från</label><input id="edStart" type="date" value="' +
          escapeHtml(b.startDate) + '" /></div>' +
          '<div><label for="edEnd">Till</label><input id="edEnd" type="date" value="' +
          escapeHtml(b.endDate) + '" /></div>' +
          '</div>' +
          '<p class="muted" style="margin:0.75rem 0 0.35rem;">Utrustning för vald period</p>' +
          '<div id="editPadsBox"><p class="muted">Laddar…</p></div>' +
          '<div class="actions"><button type="button" class="btn btn-accent" id="actSaveSchedule">Spara period &amp; utrustning</button></div>' +
          '<p class="err" id="edErr" hidden></p>'
      });
    } else {
      html += '<div id="editPadsBox" hidden></div>';
    }

    html += accordion({
      title: 'Mejl & radering',
      open: false,
      lead: 'Skicka länk igen eller ta bort bokningen.',
      body:
        '<p class="muted" style="margin:0 0 0.35rem;">Mejl till kund</p>' +
        '<div class="actions"><button type="button" class="btn btn-ghost" id="actResendMail">Skicka magisk länk igen</button></div>' +
        '<p class="ok" id="mailOk" hidden></p>' +
        '<hr style="border:0;border-top:1px solid var(--line);margin:1rem 0;" />' +
        '<p class="muted" style="margin:0 0 0.35rem;">Radera bokning</p>' +
        '<p class="detail-section-lead muted">Tar bort bokningen permanent. Kan inte ångras.</p>' +
        '<div class="actions"><button type="button" class="btn btn-ghost" id="actDelete">Radera bokning</button></div>'
    });

    html += '</div>';

    html += '<p class="err" id="detailErr" hidden></p>';
    $('detail').innerHTML = html;

    // 'op', not 'action': Api.call reserves 'action' for the route name and
    // would overwrite it, leaving the server with nothing to dispatch on.
    function showNearErr(errId, message) {
      var el = errId && $(errId);
      if (!el) {
        el = $('detailErr');
      }
      if (!el) return;
      el.hidden = !message;
      el.textContent = message || '';
      if (message && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    }

    function act(op, extra, btn, errId) {
      var payload = Object.assign({ op: op, bookingId: b.id }, extra || {});
      var busy = op === 'resendMail' ? 'Skickar magisk länk…' : null;
      if (errId) showNearErr(errId, '');
      else if ($('detailErr')) $('detailErr').hidden = true;
      api('adminUpdateBooking', payload, btn, busy).then(function (res) {
        if (op === 'resendMail') {
          var ok = $('mailOk');
          if (ok) {
            ok.hidden = false;
            ok.textContent = 'Mejl med magisk länk skickat till ' + (res.mailTo || b.email) + '.';
          }
          return;
        }
        return loadBookings().then(function () {
          openDetail(b.id);
        });
      }).catch(function (e) {
        showNearErr(errId, e.message);
      });
    }

    /** The button reports its own progress, which the status banner cannot do
     *  from behind the dialog. `extra` is read on click so it sees whatever the
     *  dialog's own fields hold at that moment. */
    function onAct(id, op, extra) {
      var btn = $(id);
      if (!btn) return;
      btn.onclick = function () {
        act(op, typeof extra === 'function' ? extra() : extra, btn);
      };
    }

    /**
     * The checkbox is the control, so it saves itself the moment it changes —
     * the other buttons in the dialog act at once too, and a separate save
     * button only invited a state on screen that was never stored.
     *
     * It is disabled while the call is in flight, so a double click cannot
     * queue a second write and two answers cannot land in the wrong order.
     */
    function autoSaveFlag(id, field) {
      var box = $(id);
      var note = $(id + 'Note');
      var seq = 0;

      function setNote(text, cls) {
        note.className = 'check-note' + (cls ? ' ' + cls : '');
        note.textContent = text;
      }

      box.onchange = function () {
        var value = box.checked;
        var mine = ++seq;
        var payload = { op: 'setFlags', bookingId: b.id };
        payload[field] = value;
        box.disabled = true;
        setNote('Sparar…');
        $('detailErr').hidden = true;
        api('adminUpdateBooking', payload).then(function () {
          if (mine !== seq) return;
          b[field] = value;
          setNote('Sparat', 'is-ok');
          setTimeout(function () {
            if (mine === seq) setNote('');
          }, 3000);
        }).catch(function (e) {
          if (mine !== seq) return;
          // The box must never show a value the server did not accept.
          box.checked = !value;
          setNote('Ej sparat', 'is-err');
          $('detailErr').hidden = false;
          $('detailErr').textContent = e.message;
        }).then(function () {
          box.disabled = false;
        });
      };
    }

    onAct('actApprove', 'approve');
    onAct('actPaid', 'setPaid', { paid: !b.paid });
    onAct('actResendMail', 'resendMail');
    if ($('actReject')) {
      $('actReject').onclick = function () {
        var box = $('rejectBox');
        if (!box) return;
        box.hidden = false;
        $('rejectReason').focus();
      };
    }
    if ($('actRejectCancel')) {
      $('actRejectCancel').onclick = function () {
        var box = $('rejectBox');
        if (box) box.hidden = true;
        if ($('rejectReason')) $('rejectReason').value = '';
        $('detailErr').hidden = true;
      };
    }
    if ($('actRejectConfirm')) {
      $('actRejectConfirm').onclick = function () {
        var reason = ($('rejectReason') && $('rejectReason').value || '').trim();
        if (reason.length < 3) {
          $('detailErr').hidden = false;
          $('detailErr').textContent = 'Skriv en kort orsak till avslaget (minst 3 tecken).';
          return;
        }
        act('reject', { reason: reason }, $('actRejectConfirm'));
      };
    }
    if ($('actHandover')) {
      $('actHandover').onclick = function () {
        var op = 'handOut';
        var msg = '';
        if (b.status === 'HandedOut') {
          op = 'return';
          msg = 'Markera hela beställningen som återlämnad?';
        } else if (b.status === 'Returned') {
          op = 'undoReturn';
          msg = 'Ångra återlämning och markera som utlämnad igen?';
        } else {
          var padNames = (b.pads || []).map(function (p) { return p.name; }).join(', ') || '—';
          msg = 'Lämna ut hela beställningen?\n\n' + padNames;
        }
        if (!window.confirm(msg)) return;
        act(op, {}, $('actHandover'));
      };
    }
    var btnDelete = $('actDelete');
    if (btnDelete) {
      btnDelete.onclick = function () {
        var msg = 'Radera bokning ' + b.bookingNumber + ' permanent? Detta kan inte ångras.';
        if (!window.confirm(msg)) return;
        api('deleteBooking', { bookingId: b.id }, btnDelete).then(function () {
          closeAllModals();
          return loadBookings();
        }).catch(function (e) {
          $('detailErr').hidden = false;
          $('detailErr').textContent = e.message;
        });
      };
    }
    autoSaveFlag('flagPickup', 'allowSelfPickup');
    autoSaveFlag('flagReturn', 'allowSelfReturn');

    if ($('actSaveSelfHours')) {
      $('actSaveSelfHours').onclick = function () {
        var ok = $('ssHoursOk');
        var err = $('ssHoursErr');
        if (ok) ok.hidden = true;
        if (err) err.hidden = true;
        var startTime = $('ssStartTime').value || '06:00';
        var endTime = $('ssEndTime').value || '22:00';
        api('adminUpdateBooking', {
          op: 'setFlags',
          bookingId: b.id,
          allowSelfPickup: !!($('flagPickup') && $('flagPickup').checked),
          allowSelfReturn: !!($('flagReturn') && $('flagReturn').checked),
          selfServiceStartTime: startTime,
          selfServiceEndTime: endTime
        }, $('actSaveSelfHours')).then(function (res) {
          if (res && res.booking) {
            b.selfServiceStartTime = res.booking.selfServiceStartTime;
            b.selfServiceEndTime = res.booking.selfServiceEndTime;
          }
          if (ok) {
            ok.hidden = false;
            ok.textContent = 'Tiderna är sparade.';
          }
        }).catch(function (e) {
          if (err) {
            err.hidden = false;
            err.textContent = e.message;
          }
        });
      };
    }

    if ($('actSaveSchedule')) {
      var schedulePadById = {};
      var scheduleSelected = {};
      (b.padIds || []).forEach(function (id) { scheduleSelected[String(id)] = true; });

      function renderSchedulePads(pads) {
        var box = $('editPadsBox');
        if (!box) return;
        schedulePadById = {};
        (pads || []).forEach(function (p) { schedulePadById[String(p.id)] = p; });
        var rows = (pads || []).map(function (p) {
          var id = String(p.id);
          var isSelected = !!scheduleSelected[id];
          var checked = isSelected ? ' checked' : '';
          var disabled = !p.available && !isSelected ? ' disabled' : '';
          var mark;
          if (isSelected && !p.available) {
            mark = '<span class="badge badge-double">Konflikt</span>';
          } else if (isSelected) {
            mark = '<span class="badge">Vald</span>';
          } else if (p.available) {
            mark = '<span class="badge paid">Ledig</span>';
          } else {
            mark = '<span class="badge unpaid">Upptagen</span>';
          }
          return '<label class="check pad-pick' + (disabled ? ' is-disabled' : '') + '">' +
            '<input type="checkbox" name="epPad" value="' + escapeHtml(p.id) + '"' +
            checked + disabled + '>' +
            '<span>' + escapeHtml(p.name) + '</span> ' + mark +
            '</label>';
        }).join('');
        box.innerHTML =
          '<p class="muted">Bocka ledig utrustning för perioden. Upptagen kan inte väljas. Vid konflikt: byt datum eller utrustning innan du sparar.</p>' +
          '<div class="pad-picks">' + (rows || '<p class="muted">Ingen utrustning.</p>') + '</div>';
        box.querySelectorAll('input[name="epPad"]').forEach(function (el) {
          el.onchange = function () {
            if (el.checked) scheduleSelected[String(el.value)] = true;
            else delete scheduleSelected[String(el.value)];
          };
        });
      }

      function loadSchedulePads(btn) {
        var startDate = $('edStart').value;
        var endDate = $('edEnd').value;
        var box = $('editPadsBox');
        if (!startDate || !endDate || startDate > endDate) {
          if (box) box.innerHTML = '<p class="muted">Ange giltiga datum för att se ledig utrustning.</p>';
          return Promise.resolve();
        }
        // Keep current checkbox state across date refreshes.
        if (box) {
          box.querySelectorAll('input[name="epPad"]').forEach(function (el) {
            if (el.checked) scheduleSelected[String(el.value)] = true;
            else delete scheduleSelected[String(el.value)];
          });
        }
        return api('availablePadsForBooking', {
          bookingId: b.id,
          startDate: startDate,
          endDate: endDate
        }, btn).then(function (res) {
          renderSchedulePads(res.pads || []);
        }).catch(function (e) {
          if (box) box.innerHTML = '<p class="err">' + escapeHtml(e.message) + '</p>';
        });
      }

      $('edStart').onchange = function () { loadSchedulePads(); };
      $('edEnd').onchange = function () { loadSchedulePads(); };
      loadSchedulePads();

      $('actSaveSchedule').onclick = function () {
        var startDate = $('edStart').value;
        var endDate = $('edEnd').value;
        var btn = $('actSaveSchedule');
        if (!startDate || !endDate) {
          showNearErr('edErr', 'Ange både start- och slutdatum.');
          return;
        }
        if (startDate > endDate) {
          showNearErr('edErr', 'Startdatum måste vara före eller samma som slutdatum.');
          return;
        }
        var ids = [];
        var conflictNames = [];
        var box = $('editPadsBox');
        if (box) {
          box.querySelectorAll('input[name="epPad"]:checked').forEach(function (el) {
            ids.push(el.value);
            var p = schedulePadById[String(el.value)];
            if (p && !p.available) conflictNames.push(p.name);
          });
        }
        if (!ids.length) {
          showNearErr('edErr', 'Välj minst en utrustning.');
          return;
        }
        if (conflictNames.length) {
          showNearErr(
            'edErr',
            'Kan inte spara — vald utrustning är i konflikt på perioden: ' +
              conflictNames.join(', ') +
              '. Byt datum eller utrustning.'
          );
          return;
        }
        showNearErr('edErr', '');
        act('setSchedule', {
          startDate: startDate,
          endDate: endDate,
          padIds: ids
        }, btn, 'edErr');
      };
    }
  }

  /** The same range the server accepts, so a slip is caught before the call. */
  var MAX_PRICE_PER_DAY = 100000;
  var PRICE_ERROR = 'Pris per dygn måste vara ett tal mellan 0 och ' + MAX_PRICE_PER_DAY + '.';

  function parsePrice(value) {
    var price = Number(value);
    if (String(value).trim() === '' || !isFinite(price) || price < 0 || price > MAX_PRICE_PER_DAY) return null;
    return price;
  }

  function showPadErr(message) {
    $('padErr').hidden = !message;
    $('padErr').textContent = message || '';
  }

  function bookedCount(count) {
    return 'Uppbokad i ' + count + ' kommande bokning' + (count === 1 ? '' : 'ar');
  }

  function renderPads(pads) {
    var list = $('padsList');
    list.innerHTML = pads.map(function (p) {
      var sub = [];
      if (p.description) sub.push(escapeHtml(p.description));
      if (p.openBookings) sub.push(bookedCount(p.openBookings));
      return '<div class="pad-item' + (p.active ? '' : ' is-inactive') + '">' +
        '<div class="pad-name">' + escapeHtml(p.name) +
          (p.active ? '' : ' <span class="badge">Inaktiv</span>') +
          (sub.length ? '<span class="sub">' + sub.join(' · ') + '</span>' : '') +
        '</div>' +
        '<label class="pad-price">Pris/dygn <input data-pad="' + p.id + '" type="number" min="0" step="1" value="' +
          escapeHtml(p.pricePerDay) + '" /></label>' +
        '<div class="pad-actions">' +
          '<button type="button" class="btn btn-accent" data-save-pad="' + p.id + '">Spara</button>' +
          (p.active
            ? '<button type="button" class="btn btn-ghost" data-deactivate-pad="' + p.id + '">Ta bort</button>'
            : '<button type="button" class="btn btn-accent" data-activate-pad="' + p.id + '">Aktivera</button>') +
        '</div>' +
        '</div>';
    }).join('');

    function padById(id) {
      return pads.filter(function (p) { return p.id === id; })[0] || {};
    }

    list.querySelectorAll('[data-save-pad]').forEach(function (btn) {
      btn.onclick = function () {
        var id = btn.getAttribute('data-save-pad');
        var price = parsePrice(list.querySelector('[data-pad="' + id + '"]').value);
        if (price === null) {
          showPadErr(PRICE_ERROR);
          return;
        }
        showPadErr('');
        api('updatePad', { padId: id, pricePerDay: price }, btn).then(refreshAll).catch(function (e) {
          showPadErr(e.message);
        });
      };
    });

    list.querySelectorAll('[data-deactivate-pad]').forEach(function (btn) {
      btn.onclick = function () {
        var p = padById(btn.getAttribute('data-deactivate-pad'));
        // Deactivating a booked resource is allowed — a pad that breaks has to
        // come off the market whether or not it is spoken for — but the admin
        // is told, since the bookings themselves keep it.
        var booked = p.openBookings ? '\n\nOBS: ' + bookedCount(p.openBookings) + '. De bokningarna behåller utrustningen.' : '';
        if (!confirm('Ta bort ' + p.name + '?\n\nUtrustningen avaktiveras: den försvinner ur gästens kalender men finns kvar på tidigare bokningar och kan aktiveras igen.' + booked)) return;
        setPadActive(p.id, false, btn);
      };
    });

    list.querySelectorAll('[data-activate-pad]').forEach(function (btn) {
      btn.onclick = function () {
        setPadActive(btn.getAttribute('data-activate-pad'), true, btn);
      };
    });
  }

  function setPadActive(padId, active, btn) {
    showPadErr('');
    api('setPadActive', { padId: padId, active: active }, btn).then(refreshAll).catch(function (e) {
      showPadErr(e.message);
    });
  }

  $('btnCreatePad').onclick = function () {
    var name = $('padName').value.trim();
    var price = parsePrice($('padPrice').value);
    if (!name) {
      showPadErr('Ange ett namn på utrustningen.');
      return;
    }
    if (price === null) {
      showPadErr(PRICE_ERROR);
      return;
    }
    showPadErr('');
    api('createPad', {
      name: name,
      description: $('padDesc').value.trim(),
      pricePerDay: price
    }, $('btnCreatePad')).then(function () {
      $('padName').value = $('padDesc').value = '';
      return refreshAll();
    }).catch(function (e) {
      showPadErr(e.message);
    });
  };

  function renderRules(rules) {
    var html = '<div class="table-scroll"><table class="table"><thead><tr><th>Dim</th><th>Min</th><th>%</th><th>Label</th><th></th></tr></thead><tbody>';
    rules.forEach(function (r) {
      var dimLabel = r.dimension === 'pads' ? 'utrustning' : (r.dimension === 'days' ? 'dygn' : r.dimension);
      html += '<tr><td>' + escapeHtml(dimLabel) + '</td><td>' + r.minValue + '</td><td>' + r.percentOff + '</td><td>' + escapeHtml(r.label) +
        '</td><td><button type="button" class="btn btn-ghost" data-del-rule="' + r.id + '">Ta bort</button></td></tr>';
    });
    html += '</tbody></table></div>';
    $('rulesList').innerHTML = html;
    $('rulesList').querySelectorAll('[data-del-rule]').forEach(function (btn) {
      btn.onclick = function () {
        api('deletePricingRule', { id: btn.getAttribute('data-del-rule') }, btn).then(refreshAll);
      };
    });
  }

  $('btnAddRule').onclick = function () {
    api('savePricingRule', {
      dimension: $('ruleDim').value,
      minValue: Number($('ruleMin').value),
      percentOff: Number($('rulePct').value),
      label: $('ruleLabel').value,
      active: true
    }, $('btnAddRule')).then(refreshAll);
  };

  function renderAdminConfig(cfg) {
    $('cfgRetentionMonths').value = String(
      typeof cfg.closedBookingRetentionMonths === 'number'
        ? cfg.closedBookingRetentionMonths
        : 6
    );
  }

  $('btnSaveConfig').onclick = function () {
    $('cfgOk').hidden = true;
    $('cfgErr').hidden = true;
    api('saveAdminConfig', {
      closedBookingRetentionMonths: Number($('cfgRetentionMonths').value)
    }, $('btnSaveConfig')).then(function (res) {
      renderAdminConfig(res);
      $('cfgOk').hidden = false;
      $('cfgOk').textContent = 'Inställningarna är sparade.';
    }).catch(function (e) {
      $('cfgErr').hidden = false;
      $('cfgErr').textContent = e.message;
    });
  };

  /** A door pass is not a booking, so its state is not in STATUS_LABELS. */
  function passState(p) {
    if (p.revoked) return 'Återkallad';
    return p.validToday ? 'Gäller idag' : 'Utanför period';
  }

  function statsFilterPayload() {
    return {
      year: $('statsYear').value,
      month: $('statsMonth').value,
      padId: $('statsPad').value,
      from: $('statsFrom').value,
      to: $('statsTo').value
    };
  }

  function fillStatsFilterOptions(res) {
    var yearSel = $('statsYear');
    var padSel = $('statsPad');
    var yearVal = yearSel.value;
    var padVal = padSel.value;
    var years = res.years || [];
    yearSel.innerHTML = '<option value="">Alla år</option>' + years.map(function (y) {
      return '<option value="' + y + '">' + y + '</option>';
    }).join('');
    if (yearVal) yearSel.value = yearVal;

    var pads = res.padOptions || [];
    padSel.innerHTML = '<option value="">Alla resurser</option>' + pads.map(function (p) {
      return '<option value="' + escapeHtml(p.padId) + '">' + escapeHtml(p.padName) + '</option>';
    }).join('');
    if (padVal) padSel.value = padVal;
  }

  function formatSek(n) {
    return (Math.round(Number(n) * 100) / 100).toLocaleString('sv-SE') + ' SEK';
  }

  function renderStats(res) {
    fillStatsFilterOptions(res);
    var pads = res.pads || [];
    var totals = res.totals || {};
    $('statsTotals').hidden = false;
    $('statsTotalBookings').textContent = String(totals.bookings || 0);
    $('statsTotalDays').textContent = String(totals.rentalDays || 0);
    $('statsTotalAmount').textContent = formatSek(totals.amount || 0);

    var body = $('statsBody');
    if (!pads.length) {
      body.innerHTML = '';
      $('statsEmpty').hidden = false;
      return;
    }
    $('statsEmpty').hidden = true;
    body.innerHTML = pads.map(function (p) {
      return '<tr>' +
        '<td>' + escapeHtml(p.padName) + '</td>' +
        '<td class="num">' + p.bookings + '</td>' +
        '<td class="num">' + p.rentalDays + '</td>' +
        '<td class="num">' + formatSek(p.amount) + '</td>' +
        '</tr>';
    }).join('') +
      '<tr>' +
      '<td><strong>Totalt (filter)</strong></td>' +
      '<td class="num"><strong>' + (totals.bookings || 0) + '</strong></td>' +
      '<td class="num"><strong>' + (totals.rentalDays || 0) + '</strong></td>' +
      '<td class="num"><strong>' + formatSek(totals.amount || 0) + '</strong></td>' +
      '</tr>';
  }

  function loadStats() {
    if (!requireSession()) return Promise.resolve();
    $('statsErr').hidden = true;
    return api('getRentalStats', statsFilterPayload(), $('btnStatsApply')).then(function (res) {
      renderStats(res);
    }).catch(function (e) {
      if (e.status === 401) showLogin(true);
      else {
        $('statsErr').hidden = false;
        $('statsErr').textContent = e.message || 'Kunde inte hämta statistik';
      }
    });
  }

  $('btnStatsApply').onclick = function () {
    loadStats();
  };
  $('btnStatsClear').onclick = function () {
    $('statsYear').value = '';
    $('statsMonth').value = '';
    $('statsPad').value = '';
    $('statsFrom').value = '';
    $('statsTo').value = '';
    loadStats();
  };

  function renderPasses(list) {
    passes = list;
    var wrap = $('dpList');
    wrap.innerHTML = passes.map(function (p) {
      return '<button type="button" class="list-row pass" data-pass="' + p.id + '">' +
        '<span class="r-who">' + escapeHtml(p.recipientName) +
          '<span class="sub">' + escapeHtml(p.recipientEmail) + '</span></span>' +
        '<span class="r-period">' + p.startDate + ' – ' + p.endDate +
          '<span class="sub">kl ' + escapeHtml(p.startTime || '06:00') + '–' +
          escapeHtml(p.endTime || '22:00') + '</span></span>' +
        '<span class="r-status"><span class="badge">' + escapeHtml(passState(p)) + '</span></span>' +
        '</button>';
    }).join('');
    $('dpEmpty').hidden = passes.length > 0;
    wrap.querySelectorAll('.list-row').forEach(function (row) {
      row.onclick = function () { openPass(row.getAttribute('data-pass')); };
    });
  }

  function openPass(id) {
    var p = passes.filter(function (x) { return x.id === id; })[0];
    if (!p) return;
    showModal('passModal');
    $('passTitle').textContent = p.recipientName;
    var html = '';
    html += '<p><strong>' + escapeHtml(p.recipientName) + '</strong> — ' + escapeHtml(passState(p)) + '</p>';
    html += '<p>' + escapeHtml(p.recipientEmail) + '</p>';
    html += '<p>Giltig ' + p.startDate + ' – ' + p.endDate + ' (inkl.)</p>';
    html += '<p>Öppen kl ' + escapeHtml(p.startTime || '06:00') + '–' + escapeHtml(p.endTime || '22:00') + '</p>';
    if (!p.revoked) {
      html += '<div class="actions"><button type="button" class="btn btn-ghost" id="passRevoke">Återkalla länken</button></div>';
    } else {
      html += '<p class="muted">Länken är spärrad. Radera den för att ta bort den från listan.</p>';
      html += '<div class="actions"><button type="button" class="btn btn-ghost" id="passDelete">Radera länken</button></div>';
    }
    html += '<p class="err" id="passErr" hidden></p>';
    $('passDetail').innerHTML = html;

    if ($('passRevoke')) {
      $('passRevoke').onclick = function () {
        if (!confirm('Återkalla dörrlänken till ' + p.recipientName + '? Länken slutar fungera direkt.')) return;
        api('revokeDoorPass', { passId: p.id }, $('passRevoke')).then(function () {
          return refreshAll();
        }).then(function () {
          openPass(p.id);
        }).catch(function (e) {
          $('passErr').hidden = false;
          $('passErr').textContent = e.message;
        });
      };
    }
    if ($('passDelete')) {
      $('passDelete').onclick = function () {
        if (!confirm('Radera dörrlänken till ' + p.recipientName + ' permanent? Detta kan inte ångras.')) return;
        api('deleteDoorPass', { passId: p.id }, $('passDelete')).then(function () {
          closePass();
          return refreshAll();
        }).catch(function (e) {
          $('passErr').hidden = false;
          $('passErr').textContent = e.message;
        });
      };
    }
  }

  $('btnSendDoorPass').onclick = function () {
    $('dpOk').hidden = true;
    $('dpErr').hidden = true;
    api('createDoorPass', {
      recipientName: $('dpName').value.trim(),
      recipientEmail: $('dpEmail').value.trim(),
      startDate: $('dpStart').value,
      endDate: $('dpEnd').value,
      startTime: $('dpStartTime').value || '06:00',
      endTime: $('dpEndTime').value || '22:00',
      locale: $('dpLocale').value
    }, $('btnSendDoorPass')).then(function (res) {
      $('dpOk').hidden = false;
      $('dpOk').textContent = 'Mejl skickat till ' + res.sentTo;
      $('dpName').value = $('dpEmail').value = '';
      return refreshAll();
    }).catch(function (e) {
      $('dpErr').hidden = false;
      $('dpErr').textContent = e.message;
    });
  };

  function fillStatusFilter() {
    var select = $('filterStatus');
    FILTER_STATUSES.forEach(function (status) {
      var opt = document.createElement('option');
      opt.value = status;
      opt.textContent = statusLabel(status);
      select.appendChild(opt);
    });
  }

  $('btnReload').onclick = loadBookings;
  $('searchNo').onchange = loadBookings;
  $('filterStatus').onchange = loadBookings;

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }

  fillStatusFilter();

  window.startRentalAdmin_ = function () {
    wallflowUser = readWallflowSession();
    if (!hasUthyrare(wallflowUser)) {
      showLogin(true);
      return;
    }
    if ($('app')) $('app').hidden = false;
    if ($('nav')) $('nav').hidden = false;
    renderAdminUser(wallflowUser);
    showView(activeView);
    refreshAll();
  };
  if (window.__openRentalOnLoad) window.startRentalAdmin_();
})();
