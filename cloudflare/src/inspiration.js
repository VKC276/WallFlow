/**
 * Inspirationskort för ledbyggare — momentlista + CRUD för superadmin.
 */

import { canEdit, isSuperadminRole, roleOf } from "./auth.js";
import { getSetting, setSetting } from "./db.js";

export const BUILDER_MOVES_KEY = "builderMoves";
const MAX_TITLE = 80;
const MAX_CATEGORY = 40;
const MAX_MOVES = 200;

export const DEFAULT_BUILDER_MOVES = [
  ["Viktöverföring", "Teknik", 0],
  ["Högt fotsteg", "Fotarbete", 0],
  ["Fotbyte", "Fotarbete", 0],
  ["Handbyte", "Teknik", 0],
  ["Matcha händer", "Teknik", 0],
  ["Flagga", "Balans", 0],
  ["Enkel backstep", "Fotarbete", 0],
  ["Kroppen nära väggen", "Kroppskontroll", 0],
  ["Långt statiskt drag", "Räckvidd", 0],
  ["Flytta höften åt sidan", "Kroppskontroll", 0],
  ["Rotera höften", "Kroppskontroll", 0],
  ["Pressa genom foten", "Fotarbete", 0],
  ["Stå på liten fot", "Balans", 0],
  ["Sträcka ut kroppen", "Räckvidd", 0],
  ["Smearing", "Fotarbete", 0],
  ["Cross", "Handteknik", 0],
  ["Gaston", "Handteknik", 0],
  ["Undercling", "Handteknik", 0],
  ["Sidodrag", "Handteknik", 0],
  ["Drop knee", "Kropp/fot", 0],
  ["Backstep", "Fotarbete", 0],
  ["Enkel heel hook", "Fot", 0],
  ["Enkel toe hook", "Fot", 0],
  ["Layback", "Kropp", 0],
  ["Mantle", "Teknik", 0],
  ["Stor flagga", "Balans", 0],
  ["Långt cross", "Räckvidd", 0],
  ["Hand–fot-koordinering", "Koordination", 0],
  ["Heel hook för att nå", "Fot", 0],
  ["Rockover", "Kropp", 0],
  ["Avancerad heel hook", "Fot", 1],
  ["Toe hook", "Fot", 1],
  ["Heel-toe cam", "Fot", 1],
  ["Liten dyno", "Dynamisk", 1],
  ["Stor dyno", "Dynamisk", 1],
  ["Koordinationsrörelse", "Koordination", 1],
  ["Deadpoint", "Dynamisk", 1],
  ["Cut loose", "Dynamisk", 1],
  ["Paddle", "Dynamisk", 1],
  ["Stor cross", "Handteknik", 1],
  ["Dynamisk cross", "Dynamisk", 1],
  ["Compression", "Kropp", 1],
  ["Kneebar", "Kropp", 1],
  ["Stor höftrotation", "Kropp", 1],
  ["Dynamiskt fotbyte", "Fot", 1],
  ["Skicka fötterna högt", "Fot", 1],
  ["Heel hook → handflytt", "Kombination", 1],
  ["Cross → flagga", "Kombination", 1],
  ["Drop knee → långt drag", "Kombination", 1],
  ["Dyno → match", "Dynamisk", 1],
  ["Campusliknande flytt", "Styrka", 1],
  ["Campus 1-2-3", "Styrka", 1],
  ["Stor koordinationsdyno", "Dynamisk", 1],
  ["Paddle dyno", "Dynamisk", 1],
  ["One-arm move", "Styrka", 1],
  ["Avancerad compression", "Styrka", 1],
  ["Avancerad kneebar", "Kropp", 1],
  ["Cut loose → catch", "Dynamisk", 1],
  ["Dyno från dålig fot", "Dynamisk", 1],
  ["Dynamisk heel hook", "Fot", 1],
  ["Heel hook → dyno", "Kombination", 1],
  ["Toe hook → dynamisk flytt", "Kombination", 1],
  ["Paddle mellan dåliga grepp", "Dynamisk", 1],
  ["Stor deadpoint", "Dynamisk", 1],
  ["Deadpoint med kroppsvridning", "Dynamisk", 1],
  ["Campus + fot", "Styrka", 1],
  ["Cut feet → återtag", "Dynamisk", 1],
  ["Extremt högt fotsteg", "Rörlighet", 1],
  ["Compression → dynamisk flytt", "Kombination", 1],
  ["Stor lateral dyno", "Dynamisk", 1],
  ["Bathang", "Avancerad", 1],
  ["Bathang → handflytt", "Kombination", 1],
  ["One-arm dyno", "Extrem", 1],
  ["Stor koordinationssekvens", "Koordination", 1],
  ["Campus utan fötter", "Styrka", 1],
  ["Dubbel dyno", "Dynamisk", 1],
  ["Dyno → dyno", "Dynamisk", 1],
  ["Extrem compression", "Styrka", 1],
  ["Heel hook → dyno → catch", "Kombination", 1],
  ["Cut loose → dynamisk catch", "Dynamisk", 1],
  ["Paddle → paddle → catch", "Koordination", 1],
  ["Extrem lateral dyno", "Dynamisk", 1],
  ["One-arm lock-off → lång flytt", "Styrka", 1],
  ["Dynamisk rörelse från extrem fotposition", "Kombination", 1],
  ["Två tekniker i samma rörelse", "Kombination", 1]
];

export function defaultBuilderMoves() {
  return DEFAULT_BUILDER_MOVES.map((row, i) => ({
    id: "d" + (i + 1),
    title: row[0],
    category: row[1],
    advanced: !!row[2]
  }));
}

function defaultAdvancedMap() {
  const map = new Map();
  for (const row of DEFAULT_BUILDER_MOVES) {
    map.set(String(row[0]).toLowerCase(), !!row[2]);
  }
  return map;
}

function inferAdvanced(title, explicit) {
  if (explicit === true || explicit === 1 || explicit === "1" || explicit === "true") return true;
  if (explicit === false || explicit === 0 || explicit === "0" || explicit === "false") return false;
  const known = defaultAdvancedMap().get(String(title || "").toLowerCase());
  if (known != null) return known;
  return /dyno|campus|bathang|one-arm|extrem|avancerad|paddle|deadpoint|cut loose|kneebar/i.test(title);
}

function normalizeText(value, max) {
  return String(value == null ? "" : value).trim().replace(/\s+/g, " ").slice(0, max);
}

function normalizeMove(raw, fallbackId) {
  if (!raw || typeof raw !== "object") return null;
  const title = normalizeText(raw.title, MAX_TITLE);
  if (!title) return null;
  const category = normalizeText(raw.category, MAX_CATEGORY);
  const id = normalizeText(raw.id, 40) || fallbackId;
  const advanced = inferAdvanced(title, raw.advanced);
  return { id, title, category, advanced };
}

export function parseBuilderMoves(raw) {
  let list = [];
  if (typeof raw === "string" && raw.trim()) {
    try {
      list = JSON.parse(raw);
    } catch (_) {
      list = [];
    }
  } else if (Array.isArray(raw)) {
    list = raw;
  }
  const out = [];
  const seen = new Set();
  for (let i = 0; i < list.length; i++) {
    const move = normalizeMove(list[i], "m" + (i + 1));
    if (!move) continue;
    const key = move.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(move);
    if (out.length >= MAX_MOVES) break;
  }
  return out;
}

async function readMoves(env) {
  const raw = await getSetting(env, BUILDER_MOVES_KEY, "");
  let moves = parseBuilderMoves(raw);
  if (!moves.length) {
    moves = defaultBuilderMoves();
    await setSetting(env, BUILDER_MOVES_KEY, JSON.stringify(moves));
    return moves;
  }
  let parsed = [];
  try {
    parsed = raw ? JSON.parse(raw) : [];
  } catch (_) {
    parsed = [];
  }
  const missingFlag = Array.isArray(parsed) && parsed.some((m) => m && typeof m === "object" && m.advanced == null);
  if (missingFlag) await writeMoves(env, moves);
  return moves;
}

async function writeMoves(env, moves) {
  await setSetting(env, BUILDER_MOVES_KEY, JSON.stringify(moves));
}

function newMoveId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export async function getBuilderMoves(env, session) {
  if (!canEdit(session)) return { ok: false, error: "Saknar behörighet" };
  const moves = await readMoves(env);
  return { ok: true, moves, canManage: isSuperadminRole(roleOf(session)) };
}

export async function addBuilderMove(env, payload, session) {
  if (!isSuperadminRole(roleOf(session))) {
    return { ok: false, error: "Bara superadmin kan lägga till moment" };
  }
  const title = normalizeText(payload && payload.title, MAX_TITLE);
  const category = normalizeText(payload && payload.category, MAX_CATEGORY);
  if (!title) return { ok: false, error: "Moment saknas" };
  const moves = await readMoves(env);
  if (moves.length >= MAX_MOVES) return { ok: false, error: "Listan är full" };
  if (moves.some((m) => m.title.toLowerCase() === title.toLowerCase())) {
    return { ok: false, error: "Momentet finns redan" };
  }
  moves.push({
    id: newMoveId(),
    title,
    category,
    advanced: inferAdvanced(title, payload && payload.advanced)
  });
  await writeMoves(env, moves);
  return { ok: true, moves, canManage: true };
}

export async function updateBuilderMove(env, payload, session) {
  if (!isSuperadminRole(roleOf(session))) {
    return { ok: false, error: "Bara superadmin kan ändra moment" };
  }
  const id = normalizeText(payload && payload.id, 40);
  if (!id) return { ok: false, error: "Moment saknas" };
  const moves = await readMoves(env);
  const hit = moves.find((m) => m.id === id);
  if (!hit) return { ok: false, error: "Momentet hittades inte" };
  if (payload && payload.title != null) {
    const title = normalizeText(payload.title, MAX_TITLE);
    if (!title) return { ok: false, error: "Moment saknas" };
    if (moves.some((m) => m.id !== id && m.title.toLowerCase() === title.toLowerCase())) {
      return { ok: false, error: "Momentet finns redan" };
    }
    hit.title = title;
  }
  if (payload && payload.category != null) {
    hit.category = normalizeText(payload.category, MAX_CATEGORY);
  }
  if (payload && payload.advanced != null) {
    hit.advanced = inferAdvanced(hit.title, payload.advanced);
  }
  await writeMoves(env, moves);
  return { ok: true, moves, canManage: true };
}

export async function deleteBuilderMove(env, payload, session) {
  if (!isSuperadminRole(roleOf(session))) {
    return { ok: false, error: "Bara superadmin kan ta bort moment" };
  }
  const id = normalizeText(payload && payload.id, 40);
  if (!id) return { ok: false, error: "Moment saknas" };
  const moves = (await readMoves(env)).filter((m) => m.id !== id);
  await writeMoves(env, moves);
  return { ok: true, moves, canManage: true };
}
