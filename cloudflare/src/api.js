/**
 * WallFlow API — samma action-kontrakt som gas/Code.gs (doPost).
 * Body: { action, token, args }
 */

import {
  canEdit,
  canManageLifetime,
  canManageRouteStructure,
  canManageUsers,
  getSession,
  hashPassword,
  isAdminActor,
  isFirstLogin,
  isLedbyggareRole,
  isSuperadminRole,
  normalizeRole,
  parseExtraRoles,
  randomSalt,
  roleOf,
  saveSession,
  validateUsername
} from "./auth.js";
import {
  countSuperadmins,
  deleteUser,
  findUser,
  getRouteByNr,
  isAllowedGrade,
  nextRouteNumber,
  normalizeLifetimeDays,
  readBaseUrlQr,
  readGrades,
  readRouteLifetimeDays,
  readRoutes,
  readUsers,
  refreshSessionRole,
  renameUser,
  setSetting,
  upsertUser
} from "./db.js";
import {
  addTimeEntry,
  canDeleteTimeEntry,
  canManageTimeSettings,
  canTreasurerReport,
  canUseTimeTool,
  capStatus,
  deleteTimeEntryById,
  inclusiveDateRange,
  listEntriesForReport,
  listEntriesForUser,
  publicSessionFlags,
  readTimeSettings,
  retargetTimeEntriesUsername,
  saveTimeSettings,
  stockholmYearMonthNow,
  stockholmYearNow,
  summarizeEntries,
  yearCompensationForUser,
  yearMonthBounds
} from "./time.js";
import {
  deleteBilderByRouteNr,
  deleteBilderKey,
  isR2ImageKey,
  uploadRouteImage
} from "./images.js";

export async function dispatch(env, action, token, args) {
  const publicActions = {
    getAppData: true,
    verifyAdminPassword: true
  };

  let session = null;
  if (!publicActions[action]) {
    session = await getSession(env, token);
    if (!session) return { ok: false, error: "Ej inloggad" };
    session = await refreshSessionRole(env, session);
  }

  switch (action) {
    case "getAppData":
      return getAppData(env, token);
    case "verifyAdminPassword":
      return verifyAdminPassword(env, args[0], args[1]);
    case "finalizeUserPassword":
      return finalizeUserPassword(env, args[0], args[1], session);
    case "changeOwnPassword":
      return changeOwnPassword(env, args[0], args[1], session);
    case "saveRoute":
      return saveRoute(env, args[0], session);
    case "uploadRouteImage": {
      if (!canEdit(session)) return { ok: false, error: "Saknar behörighet" };
      return uploadRouteImage(env, args[0]);
    }
    case "deleteRouteImage": {
      if (!canEdit(session)) return { ok: false, error: "Saknar behörighet" };
      const payload = args[0] || {};
      const key = String(payload.fileId || "").trim();
      if (isR2ImageKey(key)) await deleteBilderKey(env, key);
      await deleteBilderByRouteNr(env, payload.nr);
      return { ok: true };
    }
    case "deleteRoute":
      return deleteRoute(env, args[0], session);
    case "getAllAdmins":
      return getAllAdmins(env, session);
    case "createNewAdmin":
      return createNewAdmin(env, args[0], session);
    case "updateUserRole":
      return updateUserRole(env, args[0], args[1], session);
    case "deleteUserAction":
      return deleteUserAction(env, args[0], session);
    case "changeOwnUsername": {
      const renameRes = await changeOwnUsername(env, args[0], session);
      if (renameRes && renameRes.ok && token) {
        await saveSession(env, token, renameRes.username, roleOf(session), session.extraRoles);
      }
      return renameRes;
    }
    case "updateUserDisplayName":
      return updateUserDisplayName(env, args[0], args[1], session);
    case "updateUserRoles":
      return updateUserRoles(env, args[0], session);
    case "setRouteLifetimeDays":
      return setRouteLifetimeDays(env, args[0], session);
    case "setBaseUrlQr":
      return setBaseUrlQr(env, args[0], session);
    case "getTimeApp":
      return getTimeApp(env, args[0], session);
    case "addTimeEntry":
      return addTimeEntryAction(env, args[0], session);
    case "getTreasurerReport":
      return getTreasurerReport(env, args[0], session);
    case "deleteTimeEntry":
      return deleteTimeEntryAction(env, args[0], session);
    case "saveTimeSettings":
      return saveTimeSettingsAction(env, args[0], session);
    default:
      return { ok: false, error: "Okänd action: " + action };
  }
}

async function getAppData(env, token) {
  const appData = {
    routes: await readRoutes(env),
    grades: await readGrades(env),
    routeLifetimeDays: await readRouteLifetimeDays(env),
    baseUrlQr: await readBaseUrlQr(env)
  };
  if (token) {
    const meSession = await getSession(env, token);
    if (meSession && meSession.username) {
      const me = await findUser(env, meSession.username);
      if (me) {
        appData.me = {
          username: me.username,
          name: me.name || "",
          role: me.role,
          extraRoles: me.extraRoles || [],
          flags: publicSessionFlags({ ...me, extraRoles: me.extraRoles })
        };
      }
    }
  }
  return appData;
}

async function verifyAdminPassword(env, username, password) {
  username = String(username || "").trim();
  password = String(password || "");
  const u = await findUser(env, username);
  if (!u || !u.salt || !u.passwordHash) return { authorized: false };
  const hash = await hashPassword(password, u.salt);
  if (hash !== u.passwordHash) return { authorized: false };

  const token = crypto.randomUUID();
  await saveSession(env, token, u.username, u.role, u.extraRoles);
  return {
    authorized: true,
    token,
    role: u.role,
    extraRoles: u.extraRoles || [],
    username: u.username,
    name: u.name,
    firstLogin: isFirstLogin(u.FirstLogin),
    flags: publicSessionFlags(u)
  };
}

async function finalizeUserPassword(env, username, newPassword, session) {
  const target = String(username || session.username || "").trim();
  if (!session || target.toLowerCase() !== String(session.username).toLowerCase()) {
    return { ok: false, error: "Ej behörig" };
  }
  if (!newPassword || String(newPassword).length < 6) {
    return { ok: false, error: "Lösenordet måste vara minst 6 tecken" };
  }
  const u = await findUser(env, target);
  if (!u) return { ok: false, error: "Användaren hittades inte" };
  const salt = randomSalt();
  await upsertUser(env, {
    ...u,
    salt,
    passwordHash: await hashPassword(String(newPassword), salt),
    FirstLogin: "FALSE",
    first_login: false
  });
  return { ok: true };
}

async function changeOwnPassword(env, oldPw, newPw, session) {
  if (!session) return { ok: false, error: "Ej inloggad" };
  if (!newPw || String(newPw).length < 6) {
    return { ok: false, error: "Lösenordet måste vara minst 6 tecken" };
  }
  const u = await findUser(env, session.username);
  if (!u) return { ok: false, error: "Användaren hittades inte" };
  const cur = await hashPassword(String(oldPw || ""), u.salt);
  if (cur !== u.passwordHash) return { ok: false, error: "Fel lösenord" };
  const salt = randomSalt();
  await upsertUser(env, {
    ...u,
    salt,
    passwordHash: await hashPassword(String(newPw), salt),
    FirstLogin: "FALSE",
    first_login: false
  });
  return { ok: true };
}

async function changeOwnUsername(env, newUsername, session) {
  if (!session) return { ok: false, error: "Ej inloggad" };
  const check = validateUsername(newUsername);
  if (!check.ok) return check;
  const next = check.username;
  const old = String(session.username || "").trim();
  if (!old) return { ok: false, error: "Ej inloggad" };
  if (next.toLowerCase() === old.toLowerCase()) {
    return { ok: true, username: old };
  }
  if (await findUser(env, next)) {
    return { ok: false, error: "Användarnamnet är upptaget" };
  }
  const u = await findUser(env, old);
  if (!u) return { ok: false, error: "Användaren hittades inte" };
  await renameUser(env, old, next);
  try {
    await retargetTimeEntriesUsername(env, old, next);
  } catch {
    /* tidtabell kanske inte finns ännu */
  }
  return { ok: true, username: next };
}

async function updateUserDisplayName(env, username, name, session) {
  if (!canManageUsers(session)) return { ok: false, error: "Saknar behörighet" };
  const target = String(username || "").trim();
  const nextName = String(name == null ? "" : name).trim();
  if (!target) return { ok: false, error: "Användarnamn saknas" };
  if (!nextName) return { ok: false, error: "Namn saknas" };
  const u = await findUser(env, target);
  if (!u) return { ok: false, error: "Hittades inte" };
  if (isAdminActor(session) && !isLedbyggareRole(u.role)) {
    return { ok: false, error: "Admin kan bara hantera ledbyggare" };
  }
  await upsertUser(env, { ...u, name: nextName });
  return { ok: true, username: target, name: nextName };
}

async function getAllAdmins(env, session) {
  if (!canManageUsers(session)) return [];
  let users = (await readUsers(env)).map((u) => ({
    username: u.username,
    name: u.name,
    role: u.role,
    extraRoles: u.extraRoles || []
  }));
  if (isAdminActor(session)) {
    users = users.filter((u) => isLedbyggareRole(u.role));
  }
  return users;
}

async function createNewAdmin(env, payload, session) {
  if (!canManageUsers(session)) return { ok: false, error: "Saknar behörighet" };
  let obj = payload;
  if (typeof payload === "string") obj = { username: payload };
  obj = obj || {};
  let username = String(obj.username || "").trim();
  const name = String(obj.name || "").trim();
  let role = normalizeRole(obj.role || "admin");
  const extraRoles = isAdminActor(session) ? [] : parseExtraRoles(obj.extraRoles || obj.extra_roles);
  const password = String(obj.password || "");

  if (!username || !password) return { ok: false, error: "Användarnamn och lösenord krävs" };
  const userCheck = validateUsername(username);
  if (!userCheck.ok) return userCheck;
  username = userCheck.username;
  if (!name) return { ok: false, error: "Namn saknas" };

  if (isAdminActor(session)) {
    if (!isLedbyggareRole(role)) {
      return { ok: false, error: "Admin kan bara lägga till ledbyggare" };
    }
    role = "scout";
  }

  if ((role === "kassor" || role === "hallvard") && !isSuperadminRole(roleOf(session))) {
    return { ok: false, error: "Bara superadmin kan lägga till kassör och hallvärd" };
  }

  if (await findUser(env, username)) {
    return { ok: false, error: "Användaren finns redan" };
  }

  const salt = randomSalt();
  await upsertUser(env, {
    username,
    passwordHash: await hashPassword(password, salt),
    salt,
    role,
    extraRoles,
    name,
    FirstLogin: "TRUE",
    first_login: true
  });
  return { ok: true };
}

async function updateUserRole(env, username, role, session) {
  if (!canManageUsers(session)) return { ok: false, error: "Saknar behörighet" };
  let newRole = normalizeRole(role || "admin");
  const u = await findUser(env, username);
  if (!u) return { ok: false, error: "Hittades inte" };
  const oldRole = normalizeRole(u.role);

  if (isAdminActor(session)) {
    if (!isLedbyggareRole(oldRole) || !isLedbyggareRole(newRole)) {
      return { ok: false, error: "Admin kan bara hantera ledbyggare" };
    }
    newRole = "scout";
  }

  if (isSuperadminRole(oldRole) && !isSuperadminRole(newRole) && (await countSuperadmins(env)) <= 1) {
    return { ok: false, error: "Kan inte ta bort sista superadmin" };
  }

  await upsertUser(env, { ...u, role: newRole, extraRoles: u.extraRoles });
  return { ok: true };
}

async function updateUserRoles(env, payload, session) {
  if (!canManageUsers(session)) return { ok: false, error: "Saknar behörighet" };
  if (isAdminActor(session)) {
    return { ok: false, error: "Admin kan bara hantera ledbyggare" };
  }
  const obj = payload && typeof payload === "object" ? payload : {};
  const username = String(obj.username || "").trim();
  if (!username) return { ok: false, error: "Användarnamn saknas" };
  const u = await findUser(env, username);
  if (!u) return { ok: false, error: "Hittades inte" };
  const newRole = normalizeRole(obj.role || u.role);
  const extraRoles = parseExtraRoles(obj.extraRoles);
  if (isSuperadminRole(u.role) && !isSuperadminRole(newRole) && (await countSuperadmins(env)) <= 1) {
    return { ok: false, error: "Kan inte ta bort sista superadmin" };
  }
  await upsertUser(env, { ...u, role: newRole, extraRoles });
  return { ok: true, username, role: newRole, extraRoles };
}

async function deleteUserAction(env, username, session) {
  if (!canManageUsers(session)) return { ok: false, error: "Saknar behörighet" };
  if (String(username).toLowerCase() === String(session.username).toLowerCase()) {
    return { ok: false, error: "Kan inte radera dig själv" };
  }
  const target = await findUser(env, username);
  if (!target) return { ok: false, error: "Hittades inte" };
  if (isAdminActor(session) && !isLedbyggareRole(target.role)) {
    return { ok: false, error: "Admin kan bara hantera ledbyggare" };
  }
  if (isSuperadminRole(target.role) && (await countSuperadmins(env)) <= 1) {
    return { ok: false, error: "Kan inte radera sista superadmin" };
  }
  await deleteUser(env, username);
  return { ok: true };
}

async function setRouteLifetimeDays(env, days, session) {
  if (!canManageLifetime(session)) {
    return { ok: false, error: "Bara superadmin kan ändra livslängd" };
  }
  const n = normalizeLifetimeDays(days);
  await setSetting(env, "routeLifetimeDays", String(n));
  return { ok: true, routeLifetimeDays: n };
}

async function setBaseUrlQr(env, url, session) {
  if (!canManageLifetime(session)) {
    return { ok: false, error: "Bara superadmin kan ändra QR-bas-URL" };
  }
  const v = String(url == null ? "" : url).trim().slice(0, 500);
  await setSetting(env, "baseUrlQr", v);
  return { ok: true, baseUrlQr: v };
}

async function saveRoute(env, route, session) {
  if (!canEdit(session)) return { ok: false, error: "Saknar behörighet" };
  route = route || {};
  const grade = String(route.Gradering || "").trim();
  if (!grade) return { ok: false, error: "Gradering saknas" };
  if (!(await isAllowedGrade(env, grade))) {
    const grades = await readGrades(env);
    return { ok: false, error: "Ogiltig gradering. Tillåtna: " + grades.join(", ") };
  }

  let nr = String(route.Nr == null ? "" : route.Nr).trim();
  const existing = nr ? await getRouteByNr(env, nr) : null;
  const creating = !existing;

  if (creating) {
    if (!canManageRouteStructure(session)) {
      return { ok: false, error: "Bara superadmin kan lägga till leder" };
    }
    if (!nr) {
      nr = String(await nextRouteNumber(env));
      route.Nr = nr;
    }
  }

  let lifeVal = null;
  if (route.Livslangd != null && String(route.Livslangd).trim() !== "") {
    if (!canManageLifetime(session)) {
      return { ok: false, error: "Bara superadmin kan ändra livslängd" };
    }
    const lifeParsed = Math.round(Number(route.Livslangd));
    if (!Number.isFinite(lifeParsed) || lifeParsed < 1 || lifeParsed > 3650) {
      return { ok: false, error: "Livslängd måste vara mellan 1 och 3650 dagar" };
    }
    lifeVal = lifeParsed;
  }

  const prevImg = existing ? String(existing.Bild || "").trim() : "";
  const imgVal = String(route.Bild || "").trim();
  const defaultLife = await readRouteLifetimeDays(env);
  const livslangd = lifeVal != null
    ? lifeVal
    : (existing ? existing.Livslangd : defaultLife);

  const ledbyggare = String(route.Ledbyggare || "");
  const byggdatum = String(route.Byggdatum || "");
  const anteckningar = String(route.Anteckningar || "");

  await env.DB.prepare(
    `INSERT INTO routes (nr, gradering, ledbyggare, byggdatum, anteckningar, bild_key, livslangd)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(nr) DO UPDATE SET
       gradering = excluded.gradering,
       ledbyggare = excluded.ledbyggare,
       byggdatum = excluded.byggdatum,
       anteckningar = excluded.anteckningar,
       bild_key = excluded.bild_key,
       livslangd = excluded.livslangd`
  ).bind(nr, grade, ledbyggare, byggdatum, anteckningar, imgVal, livslangd).run();

  try {
    if (prevImg && prevImg !== imgVal && isR2ImageKey(prevImg)) {
      await deleteBilderKey(env, prevImg);
    }
    if (!imgVal) {
      await deleteBilderByRouteNr(env, nr);
    }
  } catch {
    /* rensning får inte faila sparning */
  }

  const saved = await getRouteByNr(env, nr);
  return { ok: true, route: saved };
}

async function deleteRoute(env, nr, session) {
  if (!canManageRouteStructure(session)) {
    return { ok: false, error: "Bara superadmin kan ta bort leder" };
  }
  const existing = await getRouteByNr(env, nr);
  if (!existing) return { ok: false, error: "Leden hittades inte" };
  try {
    if (isR2ImageKey(existing.Bild)) await deleteBilderKey(env, existing.Bild);
    await deleteBilderByRouteNr(env, nr);
  } catch {
    /* ignore */
  }
  await env.DB.prepare("DELETE FROM routes WHERE nr = ?").bind(String(nr).trim()).run();
  return { ok: true };
}

function yearMonthFromPayload(payload) {
  const raw = payload && typeof payload === "object" ? payload.yearMonth : payload;
  const s = String(raw || "").trim();
  return /^\d{4}-\d{2}$/.test(s) ? s : stockholmYearMonthNow();
}

function lastYmdBeforeExclusive(endExclusive) {
  const d = new Date(String(endExclusive) + "T12:00:00Z");
  if (Number.isNaN(d.getTime())) return "";
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function treasurerRangeFromPayload(payload) {
  const p = payload && typeof payload === "object" ? payload : {};
  const fromRaw = p.fromDate || p.startDate || p.from;
  const toRaw = p.toDate || p.endDate || p.to;
  if (fromRaw || toRaw) return inclusiveDateRange(fromRaw, toRaw);
  const bounds = yearMonthBounds(yearMonthFromPayload(p));
  if (!bounds) return { ok: false, error: "Ogiltig period" };
  return {
    ok: true,
    fromDate: bounds.start,
    toDate: lastYmdBeforeExclusive(bounds.endExclusive)
  };
}

async function getTimeApp(env, payload, session) {
  if (!canUseTimeTool(session)) return { ok: false, error: "Ej inloggad" };
  const yearMonth = yearMonthFromPayload(payload);
  const settings = await readTimeSettings(env);
  const entries = await listEntriesForUser(env, session.username, yearMonth);
  const yearTotal = await yearCompensationForUser(env, session.username, stockholmYearNow(), settings);
  return {
    ok: true,
    yearMonth,
    settings,
    entries,
    summary: summarizeEntries(entries, settings),
    cap: capStatus(yearTotal, settings),
    flags: publicSessionFlags(session)
  };
}

async function addTimeEntryAction(env, payload, session) {
  if (!canUseTimeTool(session)) return { ok: false, error: "Ej inloggad" };
  return addTimeEntry(env, session, payload || {});
}

async function getTreasurerReport(env, payload, session) {
  if (!canTreasurerReport(session)) return { ok: false, error: "Saknar behörighet" };
  const range = treasurerRangeFromPayload(payload);
  if (!range.ok) return { ok: false, error: range.error };
  const settings = await readTimeSettings(env);
  const listed = await listEntriesForReport(env, range.fromDate, range.toDate);
  if (!listed.ok) return { ok: false, error: listed.error };
  return {
    ok: true,
    fromDate: listed.fromDate,
    toDate: listed.toDate,
    yearMonth: String(listed.fromDate || "").slice(0, 7),
    settings,
    entries: listed.entries,
    summary: summarizeEntries(listed.entries, settings)
  };
}

async function deleteTimeEntryAction(env, id, session) {
  if (!canDeleteTimeEntry(session)) return { ok: false, error: "Bara superadmin kan ta bort tidrader" };
  return deleteTimeEntryById(env, id);
}

async function saveTimeSettingsAction(env, payload, session) {
  if (!canManageTimeSettings(session)) {
    return { ok: false, error: "Bara superadmin kan ändra arvode och gränser" };
  }
  return saveTimeSettings(env, payload || {});
}
