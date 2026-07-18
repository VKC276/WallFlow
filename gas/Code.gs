/**
 * WallFlow — Google Apps Script backend (STANDALONE)
 *
 * Viktigt: skapa ett NYTT Apps Script-projekt som INTE är bundet till sheetet.
 * Sheetet har redan egen bunden kod (Kod.gs) — klistra inte in WallFlow där
 * (då krockar bl.a. SPREADSHEET_ID).
 *
 * Setup:
 *   1. https://script.google.com → New project → namnge "WallFlow API"
 *   2. Ersätt Code.gs med denna fil
 *   3. Kör setupFirstSuperadmin(...) en gång (godkänn tillgång till Sheets)
 *   4. Deploy → New deployment → Web app
 *        Execute as: Me
 *        Who has access: Anyone
 *   5. Klistra in /exec-URL:en i index.html som GAS_API_URL
 *
 * Spreadsheet (öppnas via ID, ej bundet):
 *   1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0
 *
 * Flikar:
 *   "Alla leder" — Nr | Gradering | Dags att bygga om | Ledbyggare | Byggdatum | Slutdatum | Anteckningar | Bild
 *   "Users"      — Username | passwordHash | salt | role | name | FirstLogin   (samma som Crags)
 *
 * API: POST text/plain JSON { action, token, args: [...] } → JSON
 */

var WALLFLOW_SPREADSHEET_ID = "1K71FH4c9FpBuxF6noBlzmF_nA5VXhAtiV84sTbPmWi0";
var WALLFLOW_SHEET_ROUTES = "Alla leder";
var WALLFLOW_SHEET_USERS = "Users";

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
    case "getAppData":
      return { routes: readRoutes_() };

    case "verifyAdminPassword":
      return verifyAdminPassword_(args[0], args[1]);

    case "finalizeUserPassword":
      return finalizeUserPassword_(args[0], args[1], session);

    case "changeOwnPassword":
      return changeOwnPassword_(args[0], args[1], session);

    case "saveRoute":
      return saveRoute_(args[0], session);

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
  // Behåll övrigt (t.ex. summeringsrader) men UI filtrerar dem bort
  return String(v == null ? "" : v).trim();
}

function isRouteRow_(obj) {
  var nr = String(obj["Nr"] == null ? "" : obj["Nr"]).trim();
  var grad = String(obj["Gradering"] == null ? "" : obj["Gradering"]).trim();
  var rebuild = String(obj["Dags att bygga om"] == null ? "" : obj["Dags att bygga om"]).trim().toLowerCase();
  if (rebuild === "antal") return false;
  if (nr && !isNaN(Number(nr))) return true;
  // Wildcard-rader utan Nr men med gradering
  if (!nr && grad && (rebuild === "ja" || rebuild === "nej")) return true;
  return false;
}

function mapRoute_(obj) {
  var nrRaw = obj["Nr"];
  var nr = (nrRaw === "" || nrRaw === null || nrRaw === undefined) ? "" : String(nrRaw).trim();
  return {
    Nr: nr,
    Gradering: String(obj["Gradering"] == null ? "" : obj["Gradering"]).trim(),
    DagsAttByggaOm: normalizeJaNej_(obj["Dags att bygga om"]),
    Ledbyggare: String(obj["Ledbyggare"] == null ? "" : obj["Ledbyggare"]).trim(),
    Byggdatum: formatDate_(obj["Byggdatum"]),
    Slutdatum: formatDate_(obj["Slutdatum"]),
    Anteckningar: String(obj["Anteckningar"] == null ? "" : obj["Anteckningar"]).trim(),
    Bild: String(obj["Bild"] == null ? "" : obj["Bild"]).trim(),
    __row: obj.__row
  };
}

function readRoutes_() {
  var table = readTable_(WALLFLOW_SHEET_ROUTES);
  var out = [];
  for (var i = 0; i < table.rows.length; i++) {
    if (!isRouteRow_(table.rows[i])) continue;
    out.push(mapRoute_(table.rows[i]));
  }
  out.sort(function (a, b) {
    var na = Number(a.Nr);
    var nb = Number(b.Nr);
    var aNum = !isNaN(na) && String(a.Nr) !== "";
    var bNum = !isNaN(nb) && String(b.Nr) !== "";
    if (aNum && bNum) return na - nb;
    if (aNum) return -1;
    if (bNum) return 1;
    return String(a.Gradering).localeCompare(String(b.Gradering), "sv");
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

function readUsers_() {
  ensureUserSheetHeaders_();
  var table = readTable_(WALLFLOW_SHEET_USERS);
  return table.rows.map(function (u) {
    return {
      username: String(u.Username || u.username || "").trim(),
      passwordHash: String(u.passwordHash || ""),
      salt: String(u.salt || ""),
      role: String(u.role || "admin").trim().toLowerCase() || "admin",
      name: String(u.name || "").trim(),
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

function routeToRowValues_(route) {
  return [
    route.Nr === "" || route.Nr == null ? "" : Number(route.Nr) || route.Nr,
    route.Gradering || "",
    normalizeJaNej_(route.DagsAttByggaOm || route["Dags att bygga om"] || "Nej"),
    route.Ledbyggare || "",
    route.Byggdatum || "",
    route.Slutdatum || "",
    route.Anteckningar || "",
    route.Bild || ""
  ];
}

function saveRoute_(route, session) {
  if (!canEdit_(session)) return { ok: false, error: "Saknar behörighet" };
  route = route || {};
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

  var values = routeToRowValues_(route);
  if (!creating && rowNum > 0) {
    // Behåll Nr från sheetet (ändras inte via app för vanliga roller)
    values[0] = Number(nr) || nr;
    sh.getRange(rowNum, 1, 1, ROUTE_HEADERS.length).setValues([values]);
  } else {
    var table = readTable_(WALLFLOW_SHEET_ROUTES);
    var lastRouteRow = 1;
    for (var j = 0; j < table.rows.length; j++) {
      if (isRouteRow_(table.rows[j])) lastRouteRow = Math.max(lastRouteRow, table.rows[j].__row);
    }
    sh.insertRowAfter(lastRouteRow);
    sh.getRange(lastRouteRow + 1, 1, 1, ROUTE_HEADERS.length).setValues([values]);
  }

  var saved = mapRoute_({
    "Nr": values[0],
    "Gradering": values[1],
    "Dags att bygga om": values[2],
    "Ledbyggare": values[3],
    "Byggdatum": values[4],
    "Slutdatum": values[5],
    "Anteckningar": values[6],
    "Bild": values[7]
  });
  return { ok: true, route: saved };
}

function deleteRoute_(nr, session) {
  if (!canManageRouteStructure_(session)) {
    return { ok: false, error: "Bara superadmin kan ta bort leder" };
  }
  var rowNum = findRouteRowNumber_(nr);
  if (rowNum < 0) return { ok: false, error: "Leden hittades inte" };
  sheet_(WALLFLOW_SHEET_ROUTES).deleteRow(rowNum);
  return { ok: true };
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
