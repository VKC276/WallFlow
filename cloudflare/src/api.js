/**
 * WallFlow API — samma action-kontrakt som gas/Code.gs (doPost).
 * Body: { action, token, args }
 */

import {
  canEdit,
  canManageLifetime,
  canManageRouteStructure,
  canManageUsers,
  canWallReset,
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
  savePasswordReset,
  saveSession,
  takePasswordReset,
  validateEmail,
  validateUsername
} from "./auth.js";
import {
  countSuperadmins,
  deleteUser,
  findUser,
  findUserByEmail,
  findUserByLogin,
  getRouteByNr,
  isAllowedGrade,
  isEjUppsattGrade,
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
import { clipInviteMessage, mailPasswordReset, mailWelcome } from "./mail.js";
import {
  getVerifApp,
  saveVerifSettingsAction,
  submitVerification
} from "./verif.js";
import {
  clipTencardAction,
  deleteTencardAction,
  listTencardsAction,
  lookupTencardAction,
  saveTencardAction
} from "./tencards.js";
import {
  deleteWellnessReceipt,
  emailWellnessReceipt,
  getWellnessApp,
  getWellnessReceipt,
  getWellnessSettings,
  issueWellnessReceipt,
  saveWellnessSettings
} from "./friskvard.js";

export async function dispatch(env, action, token, args, extras) {
  extras = extras || {};
  const publicActions = {
    getAppData: true,
    verifyAdminPassword: true,
    requestPasswordReset: true,
    completePasswordReset: true,
    getVerifApp: true
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
    case "requestPasswordReset":
      return requestPasswordReset(env, args[0]);
    case "completePasswordReset":
      return completePasswordReset(env, args[0], args[1]);
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
    case "resetWall":
      return resetWall(env, args[0], session);
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
    case "updateUserEmail":
      return updateUserEmail(env, args[0], args[1], session);
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
    case "getVerifApp":
      return getVerifApp(env, session);
    case "saveVerifSettings":
      return saveVerifSettingsAction(env, args[0], session);
    case "submitVerification": {
      const me = await findUser(env, session.username);
      return submitVerification(env, args[0], session, me, extras && extras.origin);
    }
    case "listTencards":
      return listTencardsAction(env, session);
    case "lookupTencard":
      return lookupTencardAction(env, args[0], session);
    case "saveTencard":
      return saveTencardAction(env, args[0], session);
    case "clipTencard":
      return clipTencardAction(env, args[0], session);
    case "deleteTencard":
      return deleteTencardAction(env, args[0], session);
    case "getWellnessApp":
      return getWellnessApp(env, session, extras && extras.origin);
    case "getWellnessReceipt":
      return getWellnessReceipt(env, args[0], session, extras && extras.origin);
    case "getWellnessSettings":
      return getWellnessSettings(env, session);
    case "saveWellnessSettings":
      return saveWellnessSettings(env, args[0], session);
    case "issueWellnessReceipt":
      return issueWellnessReceipt(env, args[0], session, extras && extras.origin);
    case "emailWellnessReceipt":
      return emailWellnessReceipt(env, args[0], session, extras && extras.origin);
    case "deleteWellnessReceipt":
      return deleteWellnessReceipt(env, args[0], session);
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
          email: me.email || "",
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
  const u = await findUserByLogin(env, username);
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
    email: u.email || "",
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

async function requestPasswordReset(env, identifier) {
  const generic = { ok: true };
  const login = String(identifier || "").trim();
  if (!login) return generic;
  const u = await findUserByLogin(env, login);
  if (!u || !u.email) return generic;
  const token = crypto.randomUUID().replace(/-/g, "") + randomSalt().slice(0, 16);
  await savePasswordReset(env, token, u.username);
  try {
    await mailPasswordReset(env, u, token);
  } catch (err) {
    console.error("Kunde inte skicka återställningsmejl", String(err && err.message ? err.message : err));
  }
  return generic;
}

async function completePasswordReset(env, token, newPassword) {
  if (!newPassword || String(newPassword).length < 6) {
    return { ok: false, error: "Lösenordet måste vara minst 6 tecken" };
  }
  const reset = await takePasswordReset(env, token);
  if (!reset) return { ok: false, error: "Länken är ogiltig eller har gått ut" };
  const u = await findUser(env, reset.username);
  if (!u) return { ok: false, error: "Länken är ogiltig eller har gått ut" };
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

async function updateUserEmail(env, username, email, session) {
  if (!canManageUsers(session)) return { ok: false, error: "Saknar behörighet" };
  const target = String(username || "").trim();
  if (!target) return { ok: false, error: "Användarnamn saknas" };
  const mailCheck = validateEmail(email);
  if (!mailCheck.ok) return mailCheck;
  const u = await findUser(env, target);
  if (!u) return { ok: false, error: "Hittades inte" };
  if (isAdminActor(session) && !isLedbyggareRole(u.role)) {
    return { ok: false, error: "Admin kan bara hantera ledbyggare" };
  }
  const taken = await findUserByEmail(env, mailCheck.email, target);
  if (taken) return { ok: false, error: "E-postadressen används redan" };
  await upsertUser(env, { ...u, email: mailCheck.email });
  return { ok: true, username: target, email: mailCheck.email };
}

async function getAllAdmins(env, session) {
  if (!canManageUsers(session)) return [];
  let users = (await readUsers(env)).map((u) => ({
    username: u.username,
    name: u.name,
    email: u.email || "",
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
  const emailCheck = validateEmail(obj.email);
  if (!emailCheck.ok) return emailCheck;
  const email = emailCheck.email;
  const sendInvite = obj.sendInvite === true || obj.sendInvite === "true" || obj.sendInvite === 1 || obj.sendInvite === "1";
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
  if (await findUserByEmail(env, email)) {
    return { ok: false, error: "E-postadressen används redan" };
  }

  const salt = randomSalt();
  const created = {
    username,
    passwordHash: await hashPassword(password, salt),
    salt,
    role,
    extraRoles,
    name,
    email,
    FirstLogin: "TRUE",
    first_login: true
  };
  await upsertUser(env, created);

  let mailSent = false;
  let mailError = "";
  if (sendInvite) {
    try {
      await mailWelcome(env, created, password, clipInviteMessage(obj.message || obj.inviteMessage));
      mailSent = true;
    } catch (err) {
      mailError = String(err && err.message ? err.message : err);
      console.error("Kunde inte skicka välkomstmejl", mailError);
    }
  }
  return { ok: true, mailSent, mailError };
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

  const unset = isEjUppsattGrade(grade);
  const ledbyggare = unset ? "" : String(route.Ledbyggare || "").trim();
  const byggdatum = unset ? "" : String(route.Byggdatum || "").trim();
  const anteckningar = String(route.Anteckningar || "");
  if (!unset) {
    if (!ledbyggare) return { ok: false, error: "Ange ledbyggare" };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(byggdatum.slice(0, 10))) {
      return { ok: false, error: "Ange byggdatum" };
    }
  }

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

async function verifySessionPassword(env, session, password) {
  if (!String(password || "")) {
    return { ok: false, error: "Ange ditt lösenord för att bekräfta" };
  }
  const u = await findUser(env, session && session.username);
  if (!u || !u.salt || !u.passwordHash) {
    return { ok: false, error: "Användaren hittades inte" };
  }
  const hash = await hashPassword(String(password), u.salt);
  if (hash !== u.passwordHash) return { ok: false, error: "Fel lösenord" };
  return { ok: true };
}

function uniqueRouteNrs(raw) {
  const seen = {};
  const out = [];
  const list = Array.isArray(raw) ? raw : [];
  for (let i = 0; i < list.length; i++) {
    const nr = String(list[i] == null ? "" : list[i]).trim();
    if (!nr || seen[nr]) continue;
    seen[nr] = true;
    out.push(nr);
  }
  return out;
}

async function resetWall(env, payload, session) {
  if (!canWallReset(session)) {
    return { ok: false, error: "Bara admin kan återställa väggen" };
  }
  payload = payload && typeof payload === "object" ? payload : {};
  const pwCheck = await verifySessionPassword(env, session, payload.password);
  if (!pwCheck.ok) return pwCheck;

  const wanted = uniqueRouteNrs(payload.nrs || payload.nrsToReset || payload.routes);
  if (!wanted.length) {
    return { ok: false, error: "Välj minst ett problem" };
  }
  let targets = [];
  const chunk = 40;
  for (let i = 0; i < wanted.length; i += chunk) {
    const part = wanted.slice(i, i + chunk);
    const placeholders = part.map(() => "?").join(",");
    const { results } = await env.DB.prepare(
      "SELECT nr, bild_key FROM routes WHERE nr IN (" + placeholders + ")"
    ).bind(...part).all();
    targets = targets.concat(results || []);
  }
  if (!targets.length) {
    return { ok: false, error: "Inga matchande problem hittades" };
  }

  if (targets.length) {
    const stmts = targets.map((row) =>
      env.DB.prepare(
        `UPDATE routes
         SET gradering = 'Ej uppsatt', ledbyggare = '', byggdatum = '', anteckningar = '', bild_key = ''
         WHERE nr = ?`
      ).bind(String(row.nr))
    );
    const batchSize = 50;
    for (let i = 0; i < stmts.length; i += batchSize) {
      await env.DB.batch(stmts.slice(i, i + batchSize));
    }
    for (let i = 0; i < targets.length; i++) {
      const row = targets[i];
      const nr = String(row.nr == null ? "" : row.nr).trim();
      const img = String(row.bild_key || "").trim();
      try {
        if (isR2ImageKey(img)) await deleteBilderKey(env, img);
        if (nr) await deleteBilderByRouteNr(env, nr);
      } catch {
        /* rensning av bild får inte faila reset */
      }
    }
  }

  const nrs = targets.map((row) => String(row.nr == null ? "" : row.nr).trim()).filter(Boolean);
  return { ok: true, resetCount: nrs.length, nrs };
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
