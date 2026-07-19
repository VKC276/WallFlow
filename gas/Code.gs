/**
 * WallFlow — Google Apps Script backend (STANDALONE)
 *
 * Viktigt: skapa ett NYTT Apps Script-projekt som INTE är bundet till sheetet.
 * Sheetet har redan egen bunden kod (Kod.gs) — klistra inte in WallFlow där
 * (då krockar bl.a. SPREADSHEET_ID).
 *
 * Setup:
 *   1. https://script.google.com → New project → namnge "WallFlow API"
 *   2. Ersätt Code.gs med denna fil + kopiera appsscript.json (manifest med Drive-scope)
 *   3. Kör setupFirstSuperadmin(...) en gång (godkänn Sheets)
 *   4. Kör authorizeDriveAccess() en gång (godkänn Drive — krävs för Bilder)
 *   5. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   6. Klistra in /exec-URL:en i index.html som GAS_API_URL
 *
 * Spreadsheet (öppnas via ID, ej bundet):
 *   1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0
 *
 * Flikar:
 *   "Alla leder" — Nr | Gradering | Dags att bygga om | Ledbyggare | Byggdatum | Slutdatum | Anteckningar | Bild
 *   "Grades"     — Ordning | Färgnamn (t.ex. 1|Grön … 5|Vit) — tillåtna graderingar
 *   "Users"      — Username | passwordHash | salt | role | name | FirstLogin   (samma som Crags)
 *
 * API: POST text/plain JSON { action, token, args: [...] } → JSON
 */

var WALLFLOW_SPREADSHEET_ID = "1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0";
var WALLFLOW_SHEET_ROUTES = "Alla leder";
var WALLFLOW_SHEET_GRADES = "Grades";
var WALLFLOW_SHEET_USERS = "Users";

/**
 * Kolumn I (per led-rad): antal dagar från Byggdatum (E) till Slutdatum (F).
 * Formel i F: =OM(E2=0;"";E2+I2) — ingår inte i ROUTE_HEADERS.
 */
var ROUTE_LIFETIME_COL = 9; // I
var DEFAULT_ROUTE_LIFETIME_DAYS = 30;

var ROUTE_HEADERS = [
  "Nr",
  "Gradering",
  "Dags att bygga om",
  "Ledbyggare",
  "Byggdatum",
  "Slutdatum",
  "Anteckningar",
  "Bild"
];

var USER_HEADERS = [
  "Username",
  "passwordHash",
  "salt",
  "role",
  "name",
  "FirstLogin"
];

var SESSION_HOURS = 24 * 14;
var SESSION_PREFIX = "wf_sess_";

function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents ? e.postData.contents : "{}";
    var payload = JSON.parse(body);
    var action = String(payload.action || "");
    var token = String(payload.token || "");
    var args = payload.args || [];
    return json_(dispatch_(action, token, args));
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, app: "WallFlow", sheet: WALLFLOW_SPREADSHEET_ID }))
    .setMimeType(ContentService.MimeType.JSON);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(action, token, args) {
  var publicActions = {
    getAppData: true,
    verifyAdminPassword: true
  };

  var session = null;
  if (!publicActions[action]) {
    session = getSession_(token);
    if (!session) return { ok: false, error: "Ej inloggad" };
  }

  switch (action) {
    case "getAppData": {
      var appData = {
        routes: readRoutes_(),
        grades: readGrades_(),
        routeLifetimeDays: readRouteLifetimeDays_()
      };
      // Om token finns: bifoga inloggad användares visningsnamn (inte användarnamn)
      if (token) {
        var meSession = getSession_(token);
        if (meSession && meSession.username) {
          var meUsers = readUsers_();
          for (var mi = 0; mi < meUsers.length; mi++) {
            if (meUsers[mi].username.toLowerCase() === String(meSession.username).toLowerCase()) {
              appData.me = {
                username: meUsers[mi].username,
                name: meUsers[mi].name || "",
                role: meUsers[mi].role
              };
              break;
            }
          }
        }
      }
      return appData;
    }

    case "verifyAdminPassword":
      return verifyAdminPassword_(args[0], args[1]);

    case "finalizeUserPassword":
      return finalizeUserPassword_(args[0], args[1], session);

    case "changeOwnPassword":
      return changeOwnPassword_(args[0], args[1], session);

    case "saveRoute":
      return saveRoute_(args[0], session);

    case "uploadRouteImage":
      return uploadRouteImage_(args[0], session);

    case "deleteRouteImage":
      return deleteRouteImage_(args[0], session);

    case "deleteRoute":
      return deleteRoute_(args[0], session);

    case "getAllAdmins":
      return getAllAdmins_(session);

    case "createNewAdmin":
      // Crags skickar ett objekt; stöd även lösa argument
      return createNewAdmin_(args[0], session);

    case "updateUserRole":
      return updateUserRole_(args[0], args[1], session);

    case "deleteUserAction":
      return deleteUserAction_(args[0], session);

    case "setRouteLifetimeDays":
      return setRouteLifetimeDays_(args[0], session);

    default:
      return { ok: false, error: "Okänd action: " + action };
  }
}

/* ---------- Spreadsheet helpers ---------- */

/** Fristående projekt: öppna alltid sheetet via ID (inte getActiveSpreadsheet). */
function ss_() {
  return SpreadsheetApp.openById(WALLFLOW_SPREADSHEET_ID);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error("Saknar flik: " + name);
  return sh;
}

function ensureUserSheetHeaders_() {
  var sh = sheet_(WALLFLOW_SHEET_USERS);
  var lastCol = Math.max(sh.getLastColumn(), USER_HEADERS.length);
  var header = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var needWrite = false;
  for (var i = 0; i < USER_HEADERS.length; i++) {
    if (String(header[i] || "") !== USER_HEADERS[i]) {
      needWrite = true;
      break;
    }
  }
  if (needWrite && sh.getLastRow() <= 1) {
    sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
  }
}

function readTable_(sheetName) {
  var sh = sheet_(sheetName);
  var values = sh.getDataRange().getValues();
  if (!values || values.length < 1) return { headers: [], rows: [] };
  var headers = values[0].map(function (h) { return String(h || "").trim(); });
  var rows = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    if (!row || !row.join("")) continue;
    var obj = { __row: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      if (!headers[c]) continue;
      obj[headers[c]] = row[c];
    }
    rows.push(obj);
  }
  return { headers: headers, rows: rows };
}

function formatDate_(v) {
  if (v === null || v === undefined || v === "") return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v.getTime())) {
    return Utilities.formatDate(v, Session.getScriptTimeZone() || "Europe/Stockholm", "yyyy-MM-dd");
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function normalizeJaNej_(v) {
  var s = String(v == null ? "" : v).trim().toLowerCase();
  if (s === "ja" || s === "yes" || s === "true" || s === "1") return "Ja";
  if (s === "nej" || s === "no" || s === "false" || s === "0") return "Nej";
  // Ej uppsatt (formel i C) → "-"
  if (s === "-" || s === "–" || s === "—") return "-";
  // Behåll övrigt (t.ex. summeringsrader) men UI filtrerar dem bort
  return String(v == null ? "" : v).trim();
}

function isWildcardNr_(nr) {
  // W1, W2, w12 …
  return /^w\d+$/i.test(String(nr == null ? "" : nr).trim());
}

function isRouteRow_(obj) {
  var nr = String(obj["Nr"] == null ? "" : obj["Nr"]).trim();
  var grad = String(obj["Gradering"] == null ? "" : obj["Gradering"]).trim();
  var rebuild = String(obj["Dags att bygga om"] == null ? "" : obj["Dags att bygga om"]).trim().toLowerCase();
  if (rebuild === "antal") return false;
  // Vanliga numeriska leder
  if (nr && !isNaN(Number(nr))) return true;
  // Wildcard-nummer t.ex. W1, W2
  if (isWildcardNr_(nr)) return true;
  // Wildcard-rader utan Nr men med gradering
  if (!nr && grad && (rebuild === "ja" || rebuild === "nej" || rebuild === "-")) return true;
  return false;
}

function mapRoute_(obj) {
  var nrRaw = obj["Nr"];
  var nr = (nrRaw === "" || nrRaw === null || nrRaw === undefined) ? "" : String(nrRaw).trim();
  var lifeRaw = obj["Livslangd"];
  if (lifeRaw === undefined || lifeRaw === null || lifeRaw === "") {
    lifeRaw = obj["Livslängd"];
  }
  var life = (lifeRaw === undefined || lifeRaw === null || lifeRaw === "")
    ? DEFAULT_ROUTE_LIFETIME_DAYS
    : normalizeRouteLifetimeDays_(lifeRaw);
  return {
    Nr: nr,
    Gradering: String(obj["Gradering"] == null ? "" : obj["Gradering"]).trim(),
    DagsAttByggaOm: normalizeJaNej_(obj["Dags att bygga om"]),
    Ledbyggare: String(obj["Ledbyggare"] == null ? "" : obj["Ledbyggare"]).trim(),
    Byggdatum: formatDate_(obj["Byggdatum"]),
    Slutdatum: formatDate_(obj["Slutdatum"]),
    Anteckningar: String(obj["Anteckningar"] == null ? "" : obj["Anteckningar"]).trim(),
    Bild: String(obj["Bild"] == null ? "" : obj["Bild"]).trim(),
    Livslangd: life,
    __row: obj.__row
  };
}

/**
 * Fliken Grades: rader som "1, Grön" / "2, Blå" …
 * Returnerar färgnamn i sheet-ordning.
 */
function readGrades_() {
  var sh = sheet_(WALLFLOW_SHEET_GRADES);
  var values = sh.getDataRange().getValues();
  var out = [];
  var seen = {};
  for (var i = 0; i < values.length; i++) {
    var row = values[i] || [];
    var a = String(row[0] == null ? "" : row[0]).trim();
    var b = String(row[1] == null ? "" : row[1]).trim();
    // Hoppa över tom rad / ev. header
    if (!a && !b) continue;
    var name = "";
    var order = i + 1;
    if (b && isNaN(Number(b)) && String(b).toLowerCase() !== "gradering" && String(b).toLowerCase() !== "grade") {
      name = b;
      if (!isNaN(Number(a))) order = Number(a);
    } else if (a && isNaN(Number(a)) && String(a).toLowerCase() !== "gradering" && String(a).toLowerCase() !== "grade") {
      name = a;
    }
    if (!name || seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = true;
    out.push({ Order: order, Namn: name });
  }
  out.sort(function (x, y) { return (x.Order || 0) - (y.Order || 0); });
  return out.map(function (g) { return g.Namn; });
}

function isWildcardGrade_(name) {
  var target = String(name || "").trim().toLowerCase();
  return target === "wildcard" || target === "wildcards";
}

function isEjUppsattGrade_(name) {
  return String(name || "").trim().toLowerCase() === "ej uppsatt";
}

function isAllowedGrade_(name) {
  var target = String(name || "").trim().toLowerCase();
  // Specialgraderingar som alltid får sparas/listas
  if (isWildcardGrade_(target) || isEjUppsattGrade_(target)) return true;
  var grades = readGrades_();
  for (var i = 0; i < grades.length; i++) {
    if (String(grades[i]).toLowerCase() === target) return true;
  }
  return false;
}

function readRoutes_() {
  var sh = sheet_(WALLFLOW_SHEET_ROUTES);
  var table = readTable_(WALLFLOW_SHEET_ROUTES);
  var out = [];
  for (var i = 0; i < table.rows.length; i++) {
    if (!isRouteRow_(table.rows[i])) continue;
    var route = mapRoute_(table.rows[i]);
    // Kolumn I saknar ofta header — läs per rad
    try {
      var rawI = sh.getRange(route.__row, ROUTE_LIFETIME_COL).getValue();
      if (rawI !== "" && rawI != null) route.Livslangd = normalizeRouteLifetimeDays_(rawI);
    } catch (eI) { /* behåll default */ }
    out.push(route);
  }
  out.sort(function (a, b) {
    // Numeriska lednummer först, wildcards (W1/W2 …) sist
    var aw = isWildcardNr_(a.Nr) || isWildcardGrade_(a.Gradering);
    var bw = isWildcardNr_(b.Nr) || isWildcardGrade_(b.Gradering);
    if (aw !== bw) return aw ? 1 : -1;

    var na = Number(a.Nr);
    var nb = Number(b.Nr);
    var aNum = !isNaN(na) && String(a.Nr) !== "";
    var bNum = !isNaN(nb) && String(b.Nr) !== "";
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    if (isWildcardNr_(a.Nr) && isWildcardNr_(b.Nr)) {
      return (Number(String(a.Nr).replace(/^w/i, "")) || 0) - (Number(String(b.Nr).replace(/^w/i, "")) || 0);
    }
    return String(a.Nr || "").localeCompare(String(b.Nr || ""), "sv");
  });
  return out;
}

/* ---------- Auth (Crags-kompatibel Users-flik) ---------- */

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || "") + String(password || ""),
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    var v = b < 0 ? b + 256 : b;
    var h = v.toString(16);
    return h.length === 1 ? "0" + h : h;
  }).join("");
}

function randomSalt_() {
  return Utilities.getUuid().replace(/-/g, "");
}

function userDisplayName_(u) {
  // Crags/Sheets kan ha "name", "Name" eller "Namn"
  var raw = u.name != null ? u.name
    : (u.Name != null ? u.Name
      : (u.Namn != null ? u.Namn : ""));
  if (raw === "" || raw == null) {
    var keys = Object.keys(u || {});
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === "__row") continue;
      if (String(k).toLowerCase() === "name" || String(k).toLowerCase() === "namn") {
        raw = u[k];
        break;
      }
    }
  }
  return String(raw == null ? "" : raw).trim();
}

function readUsers_() {
  ensureUserSheetHeaders_();
  var table = readTable_(WALLFLOW_SHEET_USERS);
  return table.rows.map(function (u) {
    return {
      username: String(u.Username || u.username || "").trim(),
      passwordHash: String(u.passwordHash || ""),
      salt: String(u.salt || ""),
      role: String(u.role || "admin").trim().toLowerCase() || "admin",
      name: userDisplayName_(u),
      FirstLogin: String(u.FirstLogin == null ? "" : u.FirstLogin).trim(),
      __row: u.__row
    };
  }).filter(function (u) { return !!u.username; });
}

function writeUsers_(users) {
  var sh = sheet_(WALLFLOW_SHEET_USERS);
  sh.clearContents();
  sh.getRange(1, 1, 1, USER_HEADERS.length).setValues([USER_HEADERS]);
  if (!users.length) return;
  var data = users.map(function (u) {
    return [
      u.username,
      u.passwordHash || "",
      u.salt || "",
      u.role || "admin",
      u.name || "",
      u.FirstLogin == null ? "" : u.FirstLogin
    ];
  });
  sh.getRange(2, 1, data.length, USER_HEADERS.length).setValues(data);
}

function isFirstLogin_(v) {
  var s = String(v == null ? "" : v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "ja";
}

function saveSession_(token, username, role) {
  var cache = CacheService.getScriptCache();
  var payload = JSON.stringify({
    username: username,
    role: role,
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  });
  // Cache max 6h per put — förnya vid behov via längre Properties fallback
  cache.put(SESSION_PREFIX + token, payload, Math.min(21600, SESSION_HOURS * 3600));
  PropertiesService.getScriptProperties().setProperty(SESSION_PREFIX + token, payload);
}

function getSession_(token) {
  if (!token) return null;
  var key = SESSION_PREFIX + token;
  var cache = CacheService.getScriptCache();
  var raw = cache.get(key);
  if (!raw) raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  try {
    var obj = JSON.parse(raw);
    if (!obj || !obj.exp || obj.exp < Date.now()) {
      PropertiesService.getScriptProperties().deleteProperty(key);
      return null;
    }
    // Förnya cache
    cache.put(key, raw, Math.min(21600, Math.floor((obj.exp - Date.now()) / 1000)));
    return { username: String(obj.username), role: String(obj.role || "admin") };
  } catch (e) {
    return null;
  }
}

function roleOf_(session) {
  return String(session && session.role || "").toLowerCase();
}

function canEdit_(session) {
  var r = roleOf_(session);
  return r === "superadmin" || r === "admin" || r === "scout" || r === "developer";
}

function canDelete_(session) {
  var r = roleOf_(session);
  return r === "superadmin" || r === "admin";
}

/** Superadmin: lägga till / ta bort led-rader. Övriga får bara redigera befintliga. */
function canManageRouteStructure_(session) {
  return roleOf_(session) === "superadmin";
}

function canManageUsers_(session) {
  return roleOf_(session) === "superadmin";
}

function verifyAdminPassword_(username, password) {
  username = String(username || "").trim();
  password = String(password || "");
  var users = readUsers_();
  var u = null;
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === username.toLowerCase()) {
      u = users[i];
      break;
    }
  }
  if (!u) return { authorized: false };
  if (!u.salt || !u.passwordHash) return { authorized: false };
  var hash = hashPassword_(password, u.salt);
  if (hash !== u.passwordHash) return { authorized: false };

  var token = Utilities.getUuid();
  saveSession_(token, u.username, u.role);
  return {
    authorized: true,
    token: token,
    role: u.role,
    username: u.username,
    name: u.name,
    firstLogin: isFirstLogin_(u.FirstLogin)
  };
}

function finalizeUserPassword_(username, newPassword, session) {
  // Tillåt antingen session-användaren eller explicit username som matchar session
  var target = String(username || session.username || "").trim();
  if (!session || target.toLowerCase() !== String(session.username).toLowerCase()) {
    return { ok: false, error: "Ej behörig" };
  }
  if (!newPassword || String(newPassword).length < 6) {
    return { ok: false, error: "Lösenordet måste vara minst 6 tecken" };
  }
  var users = readUsers_();
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === target.toLowerCase()) {
      var salt = randomSalt_();
      users[i].salt = salt;
      users[i].passwordHash = hashPassword_(String(newPassword), salt);
      users[i].FirstLogin = "FALSE";
      writeUsers_(users);
      return { ok: true };
    }
  }
  return { ok: false, error: "Användaren hittades inte" };
}

function changeOwnPassword_(oldPw, newPw, session) {
  if (!session) return { ok: false, error: "Ej inloggad" };
  if (!newPw || String(newPw).length < 6) {
    return { ok: false, error: "Lösenordet måste vara minst 6 tecken" };
  }
  var users = readUsers_();
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === String(session.username).toLowerCase()) {
      var cur = hashPassword_(String(oldPw || ""), users[i].salt);
      if (cur !== users[i].passwordHash) return { ok: false, error: "Fel lösenord" };
      var salt = randomSalt_();
      users[i].salt = salt;
      users[i].passwordHash = hashPassword_(String(newPw), salt);
      users[i].FirstLogin = "FALSE";
      writeUsers_(users);
      return { ok: true };
    }
  }
  return { ok: false, error: "Användaren hittades inte" };
}

function getAllAdmins_(session) {
  if (!canManageUsers_(session)) return [];
  return readUsers_().map(function (u) {
    return { username: u.username, name: u.name, role: u.role };
  });
}

function createNewAdmin_(payload, session) {
  if (!canManageUsers_(session)) return { ok: false, error: "Saknar behörighet" };

  // Crags: createNewAdmin({ name, username, password, role })
  var obj = payload;
  if (typeof payload === "string") {
    // bakåtkompat: (username, name, role, password) via felaktig anropssignatur — ignoreras
    obj = { username: payload };
  }
  obj = obj || {};
  var username = String(obj.username || "").trim();
  var name = String(obj.name || "").trim();
  var role = String(obj.role || "admin").trim().toLowerCase() || "admin";
  var password = String(obj.password || "");

  if (!username || !password) return { ok: false, error: "Användarnamn och lösenord krävs" };

  var users = readUsers_();
  for (var i = 0; i < users.length; i++) {
    if (users[i].username.toLowerCase() === username.toLowerCase()) {
      return { ok: false, error: "Användaren finns redan" };
    }
  }

  var salt = randomSalt_();
  users.push({
    username: username,
    passwordHash: hashPassword_(password, salt),
    salt: salt,
    role: role,
    name: name,
    FirstLogin: "TRUE"
  });
  writeUsers_(users);
  return { ok: true };
}

function updateUserRole_(username, role, session) {
  if (!canManageUsers_(session)) return { ok: false, error: "Saknar behörighet" };
  var users = readUsers_();
  var found = false;
  for (var i = 0; i < users.length; i++) {
    if (users[i].username === String(username)) {
      users[i].role = String(role || "admin").toLowerCase();
      found = true;
      break;
    }
  }
  if (!found) return { ok: false, error: "Hittades inte" };
  writeUsers_(users);
  return { ok: true };
}

function deleteUserAction_(username, session) {
  if (!canManageUsers_(session)) return { ok: false, error: "Saknar behörighet" };
  if (String(username).toLowerCase() === String(session.username).toLowerCase()) {
    return { ok: false, error: "Kan inte radera dig själv" };
  }
  var users = readUsers_().filter(function (u) {
    return u.username.toLowerCase() !== String(username).toLowerCase();
  });
  writeUsers_(users);
  return { ok: true };
}

/* ---------- Routes CRUD på "Alla leder" ---------- */

function findRouteRowNumber_(nr) {
  var sh = sheet_(WALLFLOW_SHEET_ROUTES);
  var values = sh.getDataRange().getValues();
  var target = String(nr).trim();
  for (var r = 1; r < values.length; r++) {
    var cell = values[r][0];
    if (cell === "" || cell === null) continue;
    if (String(cell).trim() === target) return r + 1;
  }
  return -1;
}

function nextRouteNumber_() {
  var routes = readRoutes_();
  var max = 0;
  for (var i = 0; i < routes.length; i++) {
    var n = Number(routes[i].Nr);
    if (!isNaN(n) && n > max) max = n;
  }
  return max + 1;
}

/** Hitta en rad som har formel i C (Dags att bygga om) och/eller F (Slutdatum). */
function findFormulaTemplateRow_(sh, preferRow) {
  function hasFormula_(row) {
    if (row < 2) return false;
    return !!(sh.getRange(row, 3).getFormula() || sh.getRange(row, 6).getFormula());
  }
  if (hasFormula_(preferRow)) return preferRow;
  var last = sh.getLastRow();
  for (var r = 2; r <= last; r++) {
    if (hasFormula_(r)) return r;
  }
  return -1;
}

/**
 * Formel för C via Apps Script setFormula.
 *
 * Viktigt: setFormula använder den engelska formelmotorn.
 * Skriver man OM(...) via script → #NAME?
 * I sheetets UI (svenska) skriver man OM med semikolon manuellt.
 * Via script måste det vara IF med komma — samma logik, fungerar i SE-ark.
 *
 * UI-motsvarighet:
 * =OM(E9=0;"";OM(B9="Ej uppsatt";"-";OM(F9-TODAY()<0;"Ja";"Nej")))
 */
function rebuildStatusFormula_(row) {
  return '=IF(E' + row + '=0,"",IF(UPPER(B' + row + ')="EJ UPPSATT","-",IF(F' + row + '-TODAY()<0,"Ja","Nej")))';
}

/**
 * F = Byggdatum + dagar i samma rads kolumn I.
 * UI-motsvarighet: =OM(E2=0;"";E2+I2)
 */
function slutdatumFormula_(row) {
  return '=IF(E' + row + '=0,"",E' + row + '+I' + row + ')';
}

function setRebuildStatusFormula_(sh, row) {
  if (row < 2) return;
  sh.getRange(row, 3).setFormula(rebuildStatusFormula_(row));
}

function setSlutdatumFormula_(sh, row) {
  if (row < 2) return;
  sh.getRange(row, 6).setFormula(slutdatumFormula_(row));
}

function normalizeRouteLifetimeDays_(n) {
  var days = Math.round(Number(n));
  if (!isFinite(days) || days < 1) return DEFAULT_ROUTE_LIFETIME_DAYS;
  if (days > 3650) return 3650;
  return days;
}

/** Standardlivslängd för nya leder (script property, fallback första radens I / 30). */
function readRouteLifetimeDays_() {
  try {
    var prop = PropertiesService.getScriptProperties().getProperty("routeLifetimeDaysDefault");
    if (prop !== null && prop !== "") return normalizeRouteLifetimeDays_(prop);
  } catch (eProp) { /* ignore */ }
  try {
    var sh = sheet_(WALLFLOW_SHEET_ROUTES);
    var table = readTable_(WALLFLOW_SHEET_ROUTES);
    for (var i = 0; i < table.rows.length; i++) {
      if (!isRouteRow_(table.rows[i])) continue;
      var raw = sh.getRange(table.rows[i].__row, ROUTE_LIFETIME_COL).getValue();
      if (raw !== "" && raw != null && isFinite(Number(raw)) && Number(raw) > 0) {
        return normalizeRouteLifetimeDays_(raw);
      }
    }
    var fallback = sh.getRange(2, ROUTE_LIFETIME_COL).getValue();
    if (fallback !== "" && fallback != null) return normalizeRouteLifetimeDays_(fallback);
    return DEFAULT_ROUTE_LIFETIME_DAYS;
  } catch (e) {
    return DEFAULT_ROUTE_LIFETIME_DAYS;
  }
}

/**
 * Superadmin: sätt standardlivslängd för nya leder (ändrar inte befintliga).
 * Per-led livslängd redigeras i ledformuläret.
 */
function setRouteLifetimeDays_(days, session) {
  if (!canManageUsers_(session)) {
    return { ok: false, error: "Bara superadmin kan ändra livslängd" };
  }
  var parsed = Math.round(Number(days));
  if (!isFinite(parsed) || parsed < 1 || parsed > 3650) {
    return { ok: false, error: "Ange antal dagar mellan 1 och 3650" };
  }
  PropertiesService.getScriptProperties().setProperty("routeLifetimeDaysDefault", String(parsed));
  return { ok: true, routeLifetimeDays: parsed };
}

/**
 * C och F: kopiera från fungerande mallrad om den räknar rätt.
 * Annars sätt engelsk IF via setFormula (OM via setFormula → #NAME?).
 */
function copyComputedFormulas_(sh, templateRow, destRow) {
  if (destRow < 2) return;
  var copiedC = false;
  var copiedF = false;
  if (templateRow >= 2 && templateRow !== destRow) {
    var srcC = sh.getRange(templateRow, 3);
    if (srcC.getFormula()) {
      var cDisplay = String(srcC.getDisplayValue() || "");
      // Kopiera bara om mallcellen inte är fel (#NAME?, #REF!, …)
      if (cDisplay.charAt(0) !== "#") {
        srcC.copyTo(sh.getRange(destRow, 3), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
        copiedC = true;
      }
    }
    var srcF = sh.getRange(templateRow, 6);
    if (srcF.getFormula()) {
      srcF.copyTo(sh.getRange(destRow, 6), SpreadsheetApp.CopyPasteType.PASTE_FORMULA, false);
      copiedF = true;
    }
    // Kopiera ledtid (I) från mallrad — F använder relativ I-referens
    var srcI = sh.getRange(templateRow, ROUTE_LIFETIME_COL).getValue();
    if (srcI !== "" && srcI != null && isFinite(Number(srcI)) && Number(srcI) > 0) {
      sh.getRange(destRow, ROUTE_LIFETIME_COL).setValue(normalizeRouteLifetimeDays_(srcI));
    } else {
      sh.getRange(destRow, ROUTE_LIFETIME_COL).setValue(readRouteLifetimeDays_());
    }
  } else {
    sh.getRange(destRow, ROUTE_LIFETIME_COL).setValue(readRouteLifetimeDays_());
  }
  if (!copiedC) {
    setRebuildStatusFormula_(sh, destRow);
  }
  if (!copiedF) {
    setSlutdatumFormula_(sh, destRow);
  }
}

/**
 * Engångsjobb: sätt engelsk IF-formel på C för alla led-rader
 * (fixar #NAME? efter felaktig OM via setFormula).
 * Kör manuellt i Apps Script-editorn efter deploy.
 */
function refreshRebuildStatusFormulas() {
  var sh = sheet_(WALLFLOW_SHEET_ROUTES);
  var table = readTable_(WALLFLOW_SHEET_ROUTES);
  var n = 0;
  for (var i = 0; i < table.rows.length; i++) {
    if (!isRouteRow_(table.rows[i])) continue;
    setRebuildStatusFormula_(sh, table.rows[i].__row);
    n++;
  }
  return { ok: true, updated: n };
}

/**
 * Skrivbara kolumner från appen.
 * "Dags att bygga om" (C) och "Slutdatum" (F) räknas ut i sheetet — rörs aldrig vid uppdatering.
 * Vid ny rad kopieras formlerna från en befintlig led-rad.
 * Kolumnordning: A Nr, B Gradering, C Dags att bygga om, D Ledbyggare,
 * E Byggdatum, F Slutdatum, G Anteckningar, H Bild
 * I = livslängd per rad (F = E+I; redigeras av superadmin per led)
 */
function saveRoute_(route, session) {
  if (!canEdit_(session)) return { ok: false, error: "Saknar behörighet" };
  route = route || {};
  var grade = String(route.Gradering || "").trim();
  if (!grade) return { ok: false, error: "Gradering saknas" };
  if (!isAllowedGrade_(grade)) {
    return { ok: false, error: "Ogiltig gradering. Tillåtna: " + readGrades_().join(", ") };
  }
  route.Gradering = grade;
  var sh = sheet_(WALLFLOW_SHEET_ROUTES);

  // Säkerställ header
  var header = sh.getRange(1, 1, 1, ROUTE_HEADERS.length).getValues()[0];
  var headerOk = true;
  for (var i = 0; i < ROUTE_HEADERS.length; i++) {
    if (String(header[i] || "").trim() !== ROUTE_HEADERS[i]) headerOk = false;
  }
  if (!headerOk && sh.getLastRow() <= 1) {
    sh.getRange(1, 1, 1, ROUTE_HEADERS.length).setValues([ROUTE_HEADERS]);
  }

  var nr = String(route.Nr == null ? "" : route.Nr).trim();
  var rowNum = nr ? findRouteRowNumber_(nr) : -1;
  var creating = !nr || rowNum < 0;

  // Befintliga rader: alla med edit-roll. Nya rader: bara superadmin.
  if (creating) {
    if (!canManageRouteStructure_(session)) {
      return { ok: false, error: "Bara superadmin kan lägga till leder" };
    }
    if (!nr) {
      nr = String(nextRouteNumber_());
      route.Nr = nr;
    }
  }

  // Behåll W1/W2 som text; skriv bara rena siffror som Number
  var nrVal = (/^\d+$/.test(nr)) ? Number(nr) : nr;
  var gradVal = route.Gradering || "";
  var setterVal = route.Ledbyggare || "";
  var buildVal = route.Byggdatum || "";
  var noteVal = route.Anteckningar || "";
  var imgVal = String(route.Bild || "").trim();
  var lifeVal = null;
  if (route.Livslangd != null && String(route.Livslangd).trim() !== "") {
    if (!canManageUsers_(session)) {
      return { ok: false, error: "Bara superadmin kan ändra livslängd" };
    }
    var lifeParsed = Math.round(Number(route.Livslangd));
    if (!isFinite(lifeParsed) || lifeParsed < 1 || lifeParsed > 3650) {
      return { ok: false, error: "Livslängd måste vara mellan 1 och 3650 dagar" };
    }
    lifeVal = lifeParsed;
  }
  var prevImg = "";
  if (!creating && rowNum > 0) {
    prevImg = String(sh.getRange(rowNum, 8).getDisplayValue() || sh.getRange(rowNum, 8).getValue() || "").trim();
  }

  if (!creating && rowNum > 0) {
    // Uppdatera bara manuella fält — lämna formler i C och F orörda
    sh.getRange(rowNum, 1).setValue(nrVal);           // A Nr
    sh.getRange(rowNum, 2).setValue(gradVal);         // B Gradering
    sh.getRange(rowNum, 4).setValue(setterVal);       // D Ledbyggare
    sh.getRange(rowNum, 5).setValue(buildVal);        // E Byggdatum
    sh.getRange(rowNum, 7).setValue(noteVal);         // G Anteckningar
    sh.getRange(rowNum, 8).setValue(imgVal);          // H Bild
    if (lifeVal != null) {
      sh.getRange(rowNum, ROUTE_LIFETIME_COL).setValue(lifeVal); // I Livslängd
    }
  } else {
    var table = readTable_(WALLFLOW_SHEET_ROUTES);
    var lastRouteRow = 1;
    for (var j = 0; j < table.rows.length; j++) {
      if (isRouteRow_(table.rows[j])) lastRouteRow = Math.max(lastRouteRow, table.rows[j].__row);
    }
    var templateRow = findFormulaTemplateRow_(sh, lastRouteRow);
    sh.insertRowAfter(lastRouteRow);
    var newRow = lastRouteRow + 1;
    // Skriv manuella fält — rör inte C/F med tomma värden
    sh.getRange(newRow, 1).setValue(nrVal);           // A Nr
    sh.getRange(newRow, 2).setValue(gradVal);         // B Gradering
    sh.getRange(newRow, 4).setValue(setterVal);       // D Ledbyggare
    sh.getRange(newRow, 5).setValue(buildVal);        // E Byggdatum
    sh.getRange(newRow, 7).setValue(noteVal);         // G Anteckningar
    sh.getRange(newRow, 8).setValue(imgVal);          // H Bild
    // Kopiera/sätt formler för C + F och ledtid i I
    copyComputedFormulas_(sh, templateRow > 0 ? templateRow : -1, newRow);
    if (lifeVal != null) {
      sh.getRange(newRow, ROUTE_LIFETIME_COL).setValue(lifeVal);
    }
    rowNum = newRow;
  }

  // Håll Bilder-mappen ren: ta bort gammal fil om Bild töms eller byts
  try {
    if (prevImg && prevImg !== imgVal) {
      trashBilderFile_(prevImg);
    }
    if (!imgVal) {
      trashBilderByRouteNr_(nr);
    }
  } catch (eImg) { /* rensning får inte faila sparning */ }

  SpreadsheetApp.flush();
  var rowValues = sh.getRange(rowNum, 1, 1, ROUTE_HEADERS.length).getValues()[0];
  var lifeOut = sh.getRange(rowNum, ROUTE_LIFETIME_COL).getValue();
  var saved = mapRoute_({
    "Nr": rowValues[0],
    "Gradering": rowValues[1],
    "Dags att bygga om": rowValues[2],
    "Ledbyggare": rowValues[3],
    "Byggdatum": rowValues[4],
    "Slutdatum": rowValues[5],
    "Anteckningar": rowValues[6],
    "Bild": rowValues[7],
    "Livslangd": lifeOut,
    __row: rowNum
  });
  return { ok: true, route: saved };
}

function deleteRoute_(nr, session) {
  if (!canManageRouteStructure_(session)) {
    return { ok: false, error: "Bara superadmin kan ta bort leder" };
  }
  var rowNum = findRouteRowNumber_(nr);
  if (rowNum < 0) return { ok: false, error: "Leden hittades inte" };
  // Rensa tillhörande bild i Bilder-mappen (en bild per led)
  try {
    var bildId = String(sheet_(WALLFLOW_SHEET_ROUTES).getRange(rowNum, 8).getValue() || "").trim();
    trashBilderFile_(bildId);
    trashBilderByRouteNr_(nr);
  } catch (e1) { /* ignorera */ }
  sheet_(WALLFLOW_SHEET_ROUTES).deleteRow(rowNum);
  return { ok: true };
}

/* ---------- Bilder (Drive-mapp bredvid sheetet) ---------- */

/**
 * Hitta eller skapa mappen "Bilder" i samma Drive-mapp som kalkylarket.
 */
function getBilderFolder_() {
  var ssFile = DriveApp.getFileById(WALLFLOW_SPREADSHEET_ID);
  var parents = ssFile.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var it = parent.getFoldersByName("Bilder");
  if (it.hasNext()) return it.next();
  return parent.createFolder("Bilder");
}

function isWallflowDriveId_(id) {
  id = String(id == null ? "" : id).trim();
  if (!id) return false;
  if (/^https?:/i.test(id) || /^data:/i.test(id)) return false;
  return /^[a-zA-Z0-9_-]{20,}$/.test(id);
}

function safeRouteNrForFile_(nr) {
  var s = String(nr == null ? "" : nr).trim().replace(/[^\w\-]+/g, "_");
  return s || "x";
}

/** Flytta fil till papperskorgen om den ligger i Bilder-mappen. */
function trashBilderFile_(fileId) {
  if (!isWallflowDriveId_(fileId)) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    var folder = getBilderFolder_();
    var parents = file.getParents();
    var inBilder = false;
    while (parents.hasNext()) {
      if (parents.next().getId() === folder.getId()) {
        inBilder = true;
        break;
      }
    }
    if (inBilder) {
      file.setTrashed(true);
      return true;
    }
  } catch (e) { /* fil saknas */ }
  return false;
}

/** Rensa alla led-{nr}* i Bilder — håller max en bild per led. */
function trashBilderByRouteNr_(nr) {
  var safeNr = safeRouteNrForFile_(nr);
  if (!safeNr || safeNr === "x") return 0;
  var folder = getBilderFolder_();
  var prefix = "led-" + safeNr;
  var n = 0;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    var name = String(f.getName() || "");
    if (name === prefix + ".jpg" || name === prefix + ".png" ||
        name.indexOf(prefix + "-") === 0 || name.indexOf(prefix + ".") === 0) {
      try {
        f.setTrashed(true);
        n++;
      } catch (e2) { /* ignore */ }
    }
  }
  return n;
}

/**
 * Ta bort ledens bild(er) i Bilder utan att ladda upp ny.
 * payload: { fileId, nr }
 */
function deleteRouteImage_(payload, session) {
  if (!canEdit_(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  trashBilderFile_(payload.fileId);
  trashBilderByRouteNr_(payload.nr);
  return { ok: true };
}

/**
 * Ladda upp led-bild till Bilder-mappen.
 * En bild per led: gamla led-{nr}* + previousFileId rensas först.
 * payload: { dataBase64, mimeType, nr, previousFileId }
 */
function uploadRouteImage_(payload, session) {
  if (!canEdit_(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  var raw = String(payload.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) return { ok: false, error: "Ingen bilddata" };
  // Begränsa storlek (~4.5 MB base64 ≈ 3.3 MB binärt) — håll under GAS-gränser
  if (raw.length > 6000000) return { ok: false, error: "Bilden är för stor — prova lägre upplösning" };

  var mime = String(payload.mimeType || "image/jpeg").trim() || "image/jpeg";
  if (mime.indexOf("image/") !== 0) mime = "image/jpeg";
  var nr = String(payload.nr || "").trim();
  var safeNr = safeRouteNrForFile_(nr);
  if (!nr || safeNr === "x") {
    return { ok: false, error: "Lednummer krävs för bilduppladdning" };
  }
  var ext = mime.indexOf("png") >= 0 ? "png" : "jpg";
  // Stabilt filnamn → en fil per lednummer
  var name = "led-" + safeNr + "." + ext;

  // Håll mappen ren: ta bort tidigare bild för samma led
  trashBilderFile_(payload.previousFileId);
  trashBilderByRouteNr_(nr);

  var bytes = Utilities.base64Decode(raw);
  var blob = Utilities.newBlob(bytes, mime, name);
  var folder = getBilderFolder_();
  var file = folder.createFile(blob);
  // Så lh3.googleusercontent.com/d/ID fungerar i appen
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return {
    ok: true,
    fileId: file.getId(),
    url: "https://drive.google.com/uc?export=view&id=" + file.getId(),
    name: file.getName()
  };
}

/**
 * Kör manuellt en gång efter att Drive lagts till (eller vid felet
 * "Du har inte behörighet att ringa DriveApp...").
 * Godkänn https://www.googleapis.com/auth/drive i popupen, skapa sedan
 * en ny Web App-deployment / ny version.
 */
function authorizeDriveAccess() {
  var folder = getBilderFolder_();
  var probe = folder.createFile(
    Utilities.newBlob("wallflow-drive-ok", "text/plain", "wallflow-auth-probe.txt")
  );
  var id = probe.getId();
  probe.setTrashed(true);
  Logger.log("Drive OK — Bilder: " + folder.getName() + " (" + folder.getId() + "), probe=" + id);
  return "Drive-behörighet OK. Deploy → ny version av Web App.";
}

/**
 * Skapa första superadmin om Users är tom.
 * Kör manuellt i Apps Script-editorn: setupFirstSuperadmin("admin", "DittNamn", "tillfalligtLosen")
 */
function setupFirstSuperadmin(username, name, password) {
  ensureUserSheetHeaders_();
  var users = readUsers_();
  if (users.length) {
    throw new Error("Users har redan " + users.length + " rad(er). Avbryter.");
  }
  var salt = randomSalt_();
  writeUsers_([{
    username: String(username || "admin").trim(),
    passwordHash: hashPassword_(String(password || "changeme"), salt),
    salt: salt,
    role: "superadmin",
    name: String(name || "Admin"),
    FirstLogin: "TRUE"
  }]);
  return "OK — logga in och byt lösenord (FirstLogin=TRUE).";
}
