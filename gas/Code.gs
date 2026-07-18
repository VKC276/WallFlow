/**
 * WallFlow — Google Apps Script backend
 *
 * Baserad på samma JSON-API-mönster som Crags:
 * POST { action, token, args: [...] } → JSON-svar
 *
 * Setup:
 * 1. Skapa ett Google Sheet med flikar: Walls, Routes, Users, Sessions
 * 2. Klistra in den här filen i Apps Script-projektet kopplat till sheetet
 * 3. Deploy → New deployment → Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Klistra in /exec-URL:en i index.html som GAS_API_URL
 *
 * Sheet-kolumner (rad 1 = header):
 * Walls:   ID | Namn | Order | Info
 * Routes:  ID | WallID | Namn | Grad | Farg | Setter | Status | SetDate | OpenDate | Kommentar | Order
 * Users:   username | name | role | passwordHash | salt
 * Sessions: token | username | role | expires
 *
 * Obs: för snabb start i demo kan lösen lagras i klartext i Users.password
 * (kolumn D). Produktionsläge bör hasha — se hashPassword_ nedan.
 */

var SHEET_WALLS = "Walls";
var SHEET_ROUTES = "Routes";
var SHEET_USERS = "Users";
var SHEET_SESSIONS = "Sessions";
var SESSION_HOURS = 24 * 14;

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
  return ContentService.createTextOutput("WallFlow API OK").setMimeType(ContentService.MimeType.TEXT);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function dispatch_(action, token, args) {
  var publicActions = { getAppData: true, verifyAdminPassword: true };
  var session = null;
  if (!publicActions[action]) {
    session = getSession_(token);
    if (!session) return { ok: false, error: "Ej inloggad" };
  }

  switch (action) {
    case "getAppData":
      return { walls: readWalls_(), routes: readRoutes_() };
    case "verifyAdminPassword":
      return verifyAdminPassword_(args[0], args[1]);
    case "saveWall":
      return saveWall_(args[0], session);
    case "deleteWall":
      return deleteWall_(args[0], session);
    case "saveRoute":
      return saveRoute_(args[0], session);
    case "deleteRoute":
      return deleteRoute_(args[0], session);
    case "getAllAdmins":
      return getAllAdmins_(session);
    case "createNewAdmin":
      return createNewAdmin_(args[0], args[1], args[2], args[3], session);
    case "updateUserRole":
      return updateUserRole_(args[0], args[1], session);
    case "deleteUserAction":
      return deleteUserAction_(args[0], session);
    case "changeOwnPassword":
      return changeOwnPassword_(args[0], args[1], session);
    default:
      return { ok: false, error: "Okänd action: " + action };
  }
}

function ss_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error("Saknar flik: " + name);
  return sh;
}

function readObjects_(sheetName) {
  var sh = sheet_(sheetName);
  var values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  var headers = values[0].map(function (h) { return String(h); });
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (!row.join("")) continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    out.push(obj);
  }
  return out;
}

function writeObjects_(sheetName, rows, headers) {
  var sh = sheet_(sheetName);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (!rows.length) return;
  var data = rows.map(function (r) {
    return headers.map(function (h) { return r[h] != null ? r[h] : ""; });
  });
  sh.getRange(2, 1, data.length, headers.length).setValues(data);
}

function readWalls_() {
  return readObjects_(SHEET_WALLS).map(function (w) {
    return {
      ID: String(w.ID),
      Namn: String(w.Namn || ""),
      Order: Number(w.Order) || 0,
      Info: String(w.Info || "")
    };
  });
}

function readRoutes_() {
  return readObjects_(SHEET_ROUTES).map(function (r) {
    return {
      ID: String(r.ID),
      WallID: String(r.WallID || ""),
      Namn: String(r.Namn || ""),
      Grad: String(r.Grad || ""),
      Farg: String(r.Farg || "orange"),
      Setter: String(r.Setter || ""),
      Status: String(r.Status || "PLANERAD"),
      SetDate: formatDate_(r.SetDate),
      OpenDate: formatDate_(r.OpenDate),
      Kommentar: String(r.Kommentar || ""),
      Order: Number(r.Order) || 0
    };
  });
}

function formatDate_(v) {
  if (!v) return "";
  if (Object.prototype.toString.call(v) === "[object Date]" && !isNaN(v)) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), "yyyy-MM-dd");
  }
  return String(v).slice(0, 10);
}

function uid_(prefix) {
  return prefix + String(Date.now()) + String(Math.floor(Math.random() * 1000));
}

function verifyAdminPassword_(username, password) {
  var users = readObjects_(SHEET_USERS);
  var u = null;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username).toLowerCase() === String(username || "").toLowerCase().trim()) {
      u = users[i];
      break;
    }
  }
  if (!u) return { authorized: false };
  var ok = false;
  if (u.password != null && String(u.password) !== "") {
    ok = String(u.password) === String(password || "");
  } else if (u.passwordHash && u.salt) {
    ok = String(u.passwordHash) === hashPassword_(password, u.salt);
  }
  if (!ok) return { authorized: false };
  var token = Utilities.getUuid();
  saveSession_(token, u.username, u.role);
  return {
    authorized: true,
    token: token,
    role: String(u.role || "admin"),
    username: String(u.username),
    name: String(u.name || "")
  };
}

function saveSession_(token, username, role) {
  var sessions = readObjects_(SHEET_SESSIONS);
  var expires = new Date(Date.now() + SESSION_HOURS * 3600 * 1000).toISOString();
  sessions.push({ token: token, username: username, role: role, expires: expires });
  // Keep last 200 sessions
  if (sessions.length > 200) sessions = sessions.slice(sessions.length - 200);
  writeObjects_(SHEET_SESSIONS, sessions, ["token", "username", "role", "expires"]);
}

function getSession_(token) {
  if (!token) return null;
  var sessions = readObjects_(SHEET_SESSIONS);
  var now = Date.now();
  for (var i = 0; i < sessions.length; i++) {
    if (String(sessions[i].token) === String(token)) {
      var exp = Date.parse(sessions[i].expires);
      if (!exp || exp < now) return null;
      return {
        username: String(sessions[i].username),
        role: String(sessions[i].role || "admin")
      };
    }
  }
  return null;
}

function roleOf_(session) {
  return String(session && session.role || "").toLowerCase();
}

function canEdit_(session) {
  var r = roleOf_(session);
  return r === "superadmin" || r === "admin" || r === "scout";
}

function canDelete_(session) {
  var r = roleOf_(session);
  return r === "superadmin" || r === "admin";
}

function canManageUsers_(session) {
  return roleOf_(session) === "superadmin";
}

function saveWall_(wall, session) {
  if (!canEdit_(session)) return { ok: false, error: "Saknar behörighet" };
  var walls = readWalls_();
  if (wall.ID) {
    var found = false;
    for (var i = 0; i < walls.length; i++) {
      if (walls[i].ID === String(wall.ID)) {
        walls[i] = {
          ID: walls[i].ID,
          Namn: String(wall.Namn || walls[i].Namn),
          Order: Number(wall.Order) || walls[i].Order,
          Info: String(wall.Info != null ? wall.Info : walls[i].Info)
        };
        found = true;
        wall = walls[i];
        break;
      }
    }
    if (!found) return { ok: false, error: "Väggen finns inte" };
  } else {
    wall = {
      ID: uid_("w"),
      Namn: String(wall.Namn || ""),
      Order: Number(wall.Order) || walls.length + 1,
      Info: String(wall.Info || "")
    };
    walls.push(wall);
  }
  writeObjects_(SHEET_WALLS, walls, ["ID", "Namn", "Order", "Info"]);
  return { ok: true, wall: wall };
}

function deleteWall_(id, session) {
  if (!canDelete_(session)) return { ok: false, error: "Saknar behörighet" };
  var walls = readWalls_().filter(function (w) { return w.ID !== String(id); });
  var routes = readRoutes_().filter(function (r) { return r.WallID !== String(id); });
  writeObjects_(SHEET_WALLS, walls, ["ID", "Namn", "Order", "Info"]);
  writeObjects_(SHEET_ROUTES, routes, ["ID", "WallID", "Namn", "Grad", "Farg", "Setter", "Status", "SetDate", "OpenDate", "Kommentar", "Order"]);
  return { ok: true };
}

function saveRoute_(route, session) {
  if (!canEdit_(session)) return { ok: false, error: "Saknar behörighet" };
  var routes = readRoutes_();
  if (route.ID) {
    var found = false;
    for (var i = 0; i < routes.length; i++) {
      if (routes[i].ID === String(route.ID)) {
        routes[i] = normalizeRoute_(route, routes[i]);
        route = routes[i];
        found = true;
        break;
      }
    }
    if (!found) return { ok: false, error: "Leden finns inte" };
  } else {
    route = normalizeRoute_(route, { ID: uid_("r"), Order: routes.length + 1 });
    routes.push(route);
  }
  writeObjects_(SHEET_ROUTES, routes, ["ID", "WallID", "Namn", "Grad", "Farg", "Setter", "Status", "SetDate", "OpenDate", "Kommentar", "Order"]);
  return { ok: true, route: route };
}

function normalizeRoute_(incoming, base) {
  return {
    ID: String(incoming.ID || base.ID),
    WallID: String(incoming.WallID || base.WallID || ""),
    Namn: String(incoming.Namn || base.Namn || ""),
    Grad: String(incoming.Grad != null ? incoming.Grad : base.Grad || ""),
    Farg: String(incoming.Farg || base.Farg || "orange"),
    Setter: String(incoming.Setter != null ? incoming.Setter : base.Setter || ""),
    Status: String(incoming.Status || base.Status || "PLANERAD"),
    SetDate: formatDate_(incoming.SetDate != null ? incoming.SetDate : base.SetDate),
    OpenDate: formatDate_(incoming.OpenDate != null ? incoming.OpenDate : base.OpenDate),
    Kommentar: String(incoming.Kommentar != null ? incoming.Kommentar : base.Kommentar || ""),
    Order: Number(incoming.Order != null ? incoming.Order : base.Order) || 0
  };
}

function deleteRoute_(id, session) {
  if (!canDelete_(session)) return { ok: false, error: "Saknar behörighet" };
  var routes = readRoutes_().filter(function (r) { return r.ID !== String(id); });
  writeObjects_(SHEET_ROUTES, routes, ["ID", "WallID", "Namn", "Grad", "Farg", "Setter", "Status", "SetDate", "OpenDate", "Kommentar", "Order"]);
  return { ok: true };
}

function getAllAdmins_(session) {
  if (!canManageUsers_(session)) return [];
  return readObjects_(SHEET_USERS).map(function (u) {
    return { username: String(u.username), name: String(u.name || ""), role: String(u.role || "admin") };
  });
}

function createNewAdmin_(username, name, role, password, session) {
  if (!canManageUsers_(session)) return { ok: false, error: "Saknar behörighet" };
  username = String(username || "").trim();
  if (!username) return { ok: false, error: "Användarnamn saknas" };
  var users = readObjects_(SHEET_USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username).toLowerCase() === username.toLowerCase()) {
      return { ok: false, error: "Användaren finns redan" };
    }
  }
  users.push({
    username: username,
    name: String(name || ""),
    role: String(role || "admin"),
    password: String(password || "changeme"),
    passwordHash: "",
    salt: ""
  });
  writeObjects_(SHEET_USERS, users, ["username", "name", "role", "password", "passwordHash", "salt"]);
  return { ok: true };
}

function updateUserRole_(username, role, session) {
  if (!canManageUsers_(session)) return { ok: false, error: "Saknar behörighet" };
  var users = readObjects_(SHEET_USERS);
  var found = false;
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username) === String(username)) {
      users[i].role = String(role || "admin");
      found = true;
      break;
    }
  }
  if (!found) return { ok: false, error: "Hittades inte" };
  writeObjects_(SHEET_USERS, users, ["username", "name", "role", "password", "passwordHash", "salt"]);
  return { ok: true };
}

function deleteUserAction_(username, session) {
  if (!canManageUsers_(session)) return { ok: false, error: "Saknar behörighet" };
  if (String(username) === String(session.username)) return { ok: false, error: "Kan inte radera dig själv" };
  var users = readObjects_(SHEET_USERS).filter(function (u) {
    return String(u.username) !== String(username);
  });
  writeObjects_(SHEET_USERS, users, ["username", "name", "role", "password", "passwordHash", "salt"]);
  return { ok: true };
}

function changeOwnPassword_(oldPw, newPw, session) {
  var users = readObjects_(SHEET_USERS);
  for (var i = 0; i < users.length; i++) {
    if (String(users[i].username) === String(session.username)) {
      var u = users[i];
      var ok = false;
      if (u.password != null && String(u.password) !== "") ok = String(u.password) === String(oldPw || "");
      else if (u.passwordHash && u.salt) ok = String(u.passwordHash) === hashPassword_(oldPw, u.salt);
      if (!ok) return { ok: false, error: "Fel lösenord" };
      users[i].password = String(newPw || "");
      users[i].passwordHash = "";
      users[i].salt = "";
      writeObjects_(SHEET_USERS, users, ["username", "name", "role", "password", "passwordHash", "salt"]);
      return { ok: true };
    }
  }
  return { ok: false, error: "Användaren hittades inte" };
}

function hashPassword_(password, salt) {
  var raw = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(salt || "") + ":" + String(password || ""),
    Utilities.Charset.UTF_8
  );
  return raw.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? "0" + v : v;
  }).join("");
}

/** Kör en gång manuellt för att skapa flikar + demo-rader. */
function setupWallFlowSheets() {
  var ss = ss_();
  ensureSheet_(ss, SHEET_WALLS, ["ID", "Namn", "Order", "Info"], [
    ["w1", "Spraywall", 1, "Sätts löpande"],
    ["w2", "Slab A", 2, "Familjevänlig vägg"],
    ["w3", "Overhang B", 3, "Brant sektor"],
    ["w4", "Competition", 4, "Tävlingsvägg"]
  ]);
  ensureSheet_(ss, SHEET_ROUTES, ["ID", "WallID", "Namn", "Grad", "Farg", "Setter", "Status", "SetDate", "OpenDate", "Kommentar", "Order"], [
    ["r1", "w3", "Amber Line", "6C", "orange", "Chris", "SATTS", "2026-07-17", "", "Sätts idag", 1],
    ["r2", "w2", "Soft Start", "5A", "gul", "Lisa", "PLANERAD", "2026-07-20", "", "Planerad ombyggnad", 1],
    ["r3", "w3", "Crimp Train", "7A+", "bla", "Chris", "AKTIV", "2026-07-10", "2026-07-11", "", 2]
  ]);
  ensureSheet_(ss, SHEET_USERS, ["username", "name", "role", "password", "passwordHash", "salt"], [
    ["admin", "Admin", "superadmin", "wallflow", "", ""]
  ]);
  ensureSheet_(ss, SHEET_SESSIONS, ["token", "username", "role", "expires"], []);
}

function ensureSheet_(ss, name, headers, rows) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows && rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}
