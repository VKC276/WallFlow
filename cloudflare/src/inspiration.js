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
  ["Viktöverföring", "Teknik"],
  ["Högt fotsteg", "Fotarbete"],
  ["Fotbyte", "Fotarbete"],
  ["Handbyte", "Teknik"],
  ["Matcha händer", "Teknik"],
  ["Flagga", "Balans"],
  ["Enkel backstep", "Fotarbete"],
  ["Kroppen nära väggen", "Kroppskontroll"],
  ["Långt statiskt drag", "Räckvidd"],
  ["Flytta höften åt sidan", "Kroppskontroll"],
  ["Rotera höften", "Kroppskontroll"],
  ["Pressa genom foten", "Fotarbete"],
  ["Stå på liten fot", "Balans"],
  ["Sträcka ut kroppen", "Räckvidd"],
  ["Cross", "Handteknik"],
  ["Gaston", "Handteknik"],
  ["Undercling", "Handteknik"],
  ["Sidodrag", "Handteknik"],
  ["Drop knee", "Kropp/fot"],
  ["Backstep", "Fotarbete"],
  ["Enkel heel hook", "Fot"],
  ["Enkel toe hook", "Fot"],
  ["Layback", "Kropp"],
  ["Mantle", "Teknik"],
  ["Stor flagga", "Balans"],
  ["Långt cross", "Räckvidd"],
  ["Hand–fot-koordinering", "Koordination"],
  ["Heel hook för att nå", "Fot"],
  ["Smearing", "Fotarbete"],
  ["Rockover", "Kropp"],
  ["Avancerad heel hook", "Fot"],
  ["Toe hook", "Fot"],
  ["Heel-toe cam", "Fot"],
  ["Liten dyno", "Dynamisk"],
  ["Stor dyno", "Dynamisk"],
  ["Koordinationsrörelse", "Koordination"],
  ["Deadpoint", "Dynamisk"],
  ["Cut loose", "Dynamisk"],
  ["Paddle", "Dynamisk"],
  ["Stor cross", "Handteknik"],
  ["Dynamisk cross", "Dynamisk"],
  ["Compression", "Kropp"],
  ["Kneebar", "Kropp"],
  ["Stor höftrotation", "Kropp"],
  ["Dynamiskt fotbyte", "Fot"],
  ["Skicka fötterna högt", "Fot"],
  ["Heel hook → handflytt", "Kombination"],
  ["Cross → flagga", "Kombination"],
  ["Drop knee → långt drag", "Kombination"],
  ["Dyno → match", "Dynamisk"],
  ["Campusliknande flytt", "Styrka"],
  ["Campus 1-2-3", "Styrka"],
  ["Stor koordinationsdyno", "Dynamisk"],
  ["Paddle dyno", "Dynamisk"],
  ["One-arm move", "Styrka"],
  ["Avancerad compression", "Styrka"],
  ["Avancerad kneebar", "Kropp"],
  ["Cut loose → catch", "Dynamisk"],
  ["Dyno från dålig fot", "Dynamisk"],
  ["Dynamisk heel hook", "Fot"],
  ["Heel hook → dyno", "Kombination"],
  ["Toe hook → dynamisk flytt", "Kombination"],
  ["Paddle mellan dåliga grepp", "Dynamisk"],
  ["Stor deadpoint", "Dynamisk"],
  ["Deadpoint med kroppsvridning", "Dynamisk"],
  ["Campus + fot", "Styrka"],
  ["Cut feet → återtag", "Dynamisk"],
  ["Extremt högt fotsteg", "Rörlighet"],
  ["Compression → dynamisk flytt", "Kombination"],
  ["Stor lateral dyno", "Dynamisk"],
  ["Bathang", "Avancerad"],
  ["Bathang → handflytt", "Kombination"],
  ["One-arm dyno", "Extrem"],
  ["Stor koordinationssekvens", "Koordination"],
  ["Campus utan fötter", "Styrka"],
  ["Dubbel dyno", "Dynamisk"],
  ["Dyno → dyno", "Dynamisk"],
  ["Extrem compression", "Styrka"],
  ["Heel hook → dyno → catch", "Kombination"],
  ["Cut loose → dynamisk catch", "Dynamisk"],
  ["Paddle → paddle → catch", "Koordination"],
  ["Extrem lateral dyno", "Dynamisk"],
  ["One-arm lock-off → lång flytt", "Styrka"],
  ["Dynamisk rörelse från extrem fotposition", "Kombination"],
  ["Två tekniker i samma rörelse", "Kombination"]
];

export function defaultBuilderMoves() {
  return DEFAULT_BUILDER_MOVES.map((row, i) => ({
    id: "d" + (i + 1),
    title: row[0],
    category: row[1]
  }));
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
  return { id, title, category };
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
  }
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
  moves.push({ id: newMoveId(), title, category });
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
