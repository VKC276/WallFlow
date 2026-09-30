/**
 * Kiosk-katalog: produkter, priser och bilder för självbetjäningen.
 * Publik läsning via GET /kiosk/revision (en rad) och GET /kiosk/catalog.
 */

import { hasRole, roleOf } from "./auth.js";
import { deleteKioskLogoBilder, deleteKioskProductBilder, isR2ImageKey } from "./images.js";

const DEFAULT_CATEGORIES = ["Entre", "Hyra", "Dryck", "Snacks", "Utrustning", "Övrigt"];

export function canManageKioskCatalog(session) {
  const r = roleOf(session);
  return r === "superadmin" || r === "admin" || hasRole(session, "kassor");
}

export async function readCatalogRevision(env) {
  const row = await env.DB.prepare("SELECT revision FROM catalog_revision WHERE id = 1").first();
  return Number(row && row.revision) || 1;
}

async function bumpRevision(env) {
  await env.DB.prepare(
    "UPDATE catalog_revision SET revision = revision + 1, updated_at = datetime('now') WHERE id = 1"
  ).run();
  return readCatalogRevision(env);
}

async function setting(env, key, fallback) {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first();
  const v = row && row.value;
  return v == null || v === "" ? fallback : String(v);
}

function parseCategories(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_CATEGORIES.slice();
    const out = [];
    const seen = new Set();
    for (const item of parsed) {
      const name = String(item || "").trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
    return out.length ? out : DEFAULT_CATEGORIES.slice();
  } catch {
    return DEFAULT_CATEGORIES.slice();
  }
}

function normalizeTheme(value) {
  if (value === "dark" || value === "bold" || value === "contrast") return value;
  return "light";
}

function normalizeSwish(value) {
  return String(value || "").replace(/\s+/g, "");
}

function mapProduct(row, origin) {
  const imageKey = String(row.image_key || "").trim();
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price) || 0,
    category: row.category || "Övrigt",
    sort: Number(row.sort) || 0,
    active: Number(row.active) !== 0,
    featured: Number(row.featured) !== 0,
    imageKey,
    imageHash: String(row.image_hash || ""),
    imageUrl: imageKey
      ? origin + "/img/" + encodeURIComponent(imageKey) + (row.image_hash ? "?v=" + encodeURIComponent(String(row.image_hash)) : "")
      : null
  };
}

export async function publicCatalog(env, origin) {
  const [revision, shopName, swishNumber, theme, logoKey, logoHash, categoriesRaw, products] = await Promise.all([
    readCatalogRevision(env),
    setting(env, "kioskShopName", "Klätterhallen"),
    setting(env, "kioskSwishNumber", ""),
    setting(env, "kioskTheme", "light"),
    setting(env, "kioskLogoKey", ""),
    setting(env, "kioskLogoHash", ""),
    setting(env, "kioskCategories", JSON.stringify(DEFAULT_CATEGORIES)),
    env.DB.prepare(
      "SELECT id, name, price, category, sort, active, featured, image_key, image_hash FROM kiosk_products WHERE active = 1 ORDER BY featured DESC, category, sort, name"
    ).all()
  ]);
  const logo = String(logoKey || "").trim();
  const swish = normalizeSwish(swishNumber);
  return {
    ok: true,
    revision,
    shopName,
    theme: normalizeTheme(theme),
    swishNumber: swish,
    swishConfigured: Boolean(swish),
    logoUrl: logo
      ? origin + "/img/" + encodeURIComponent(logo) + (logoHash ? "?v=" + encodeURIComponent(String(logoHash)) : "")
      : null,
    logoHash: String(logoHash || logo || ""),
    categories: parseCategories(categoriesRaw),
    products: (products.results || []).map((row) => mapProduct(row, origin))
  };
}

export async function listKioskCatalog(env, session, origin) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  const catalog = await publicCatalog(env, origin);
  const all = await env.DB.prepare(
    "SELECT id, name, price, category, sort, active, featured, image_key, image_hash FROM kiosk_products ORDER BY category, sort, name"
  ).all();
  return {
    ok: true,
    ...catalog,
    products: (all.results || []).map((row) => mapProduct(row, origin))
  };
}

export async function saveKioskProduct(env, session, payload) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  const name = String(payload.name || "").trim();
  const price = Number(payload.price);
  const category = String(payload.category || "Övrigt").trim() || "Övrigt";
  if (!name) return { ok: false, error: "Namn krävs" };
  if (!Number.isFinite(price) || price < 0) return { ok: false, error: "Ogiltigt pris" };
  let id = String(payload.id || "").trim();
  if (!id) {
    id = slugify(category, name) + "-" + crypto.randomUUID().slice(0, 8);
  }
  const existing = await env.DB.prepare("SELECT image_key, image_hash FROM kiosk_products WHERE id = ?").bind(id).first();
  await env.DB.prepare(
    `INSERT INTO kiosk_products (id, name, price, category, sort, active, featured, image_key, image_hash, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       price = excluded.price,
       category = excluded.category,
       sort = excluded.sort,
       active = excluded.active,
       featured = excluded.featured,
       updated_at = excluded.updated_at`
  )
    .bind(
      id,
      name,
      Math.round(price * 100) / 100,
      category,
      Number(payload.sort) || 0,
      payload.active === false || payload.active === 0 ? 0 : 1,
      payload.featured ? 1 : 0,
      (existing && existing.image_key) || "",
      (existing && existing.image_hash) || ""
    )
    .run();
  const revision = await bumpRevision(env);
  return { ok: true, id, revision };
}

export async function deleteKioskProduct(env, session, id) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  id = String(id || "").trim();
  if (!id) return { ok: false, error: "Id saknas" };
  const row = await env.DB.prepare("SELECT image_key FROM kiosk_products WHERE id = ?").bind(id).first();
  if (!row) return { ok: false, error: "Produkten hittades inte" };
  if (row.image_key) await deleteKioskProductBilder(env, id);
  await env.DB.prepare("DELETE FROM kiosk_products WHERE id = ?").bind(id).run();
  const revision = await bumpRevision(env);
  return { ok: true, revision };
}

function slugify(category, name) {
  return `${category}-${name}`
    .toLowerCase()
    .replace(/å/g, "a")
    .replace(/ä/g, "a")
    .replace(/ö/g, "o")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function sha16(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return hex.slice(0, 16);
}

export async function uploadKioskProductImage(env, session, payload) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  const id = String(payload.id || "").trim();
  if (!id) return { ok: false, error: "Spara produkten innan du laddar upp bild" };
  const product = await env.DB.prepare("SELECT image_key FROM kiosk_products WHERE id = ?").bind(id).first();
  if (!product) return { ok: false, error: "Produkten hittades inte" };
  const raw = String(payload.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) return { ok: false, error: "Ingen bilddata" };
  if (raw.length > 6000000) return { ok: false, error: "Bilden är för stor — prova en mindre fil" };
  let mime = String(payload.mimeType || "image/jpeg").trim() || "image/jpeg";
  if (mime.indexOf("image/") !== 0) mime = "image/jpeg";
  const ext = mime.indexOf("png") >= 0 ? "png" : mime.indexOf("webp") >= 0 ? "webp" : "jpg";
  const bytes = base64ToBytes(raw);
  const hash = await sha16(bytes);
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "vara";
  const key = "kiosk-" + safeId + "-" + hash + "." + ext;
  await deleteKioskProductBilder(env, id);
  await env.BILDER.put(key, bytes, { httpMetadata: { contentType: mime } });
  await env.DB.prepare(
    "UPDATE kiosk_products SET image_key = ?, image_hash = ?, updated_at = datetime('now') WHERE id = ?"
  )
    .bind(key, hash, id)
    .run();
  const revision = await bumpRevision(env);
  return { ok: true, imageKey: key, imageHash: hash, revision };
}

export async function saveKioskSettings(env, session, payload) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  const shopName = String(payload.shopName || "").trim();
  if (!shopName) return { ok: false, error: "Butiksnamn krävs" };
  const theme = normalizeTheme(payload.theme);
  const swish = normalizeSwish(payload.swishNumber);
  const categories = parseCategories(JSON.stringify(payload.categories || DEFAULT_CATEGORIES));
  const upsert = env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await env.DB.batch([
    upsert.bind("kioskShopName", shopName),
    upsert.bind("kioskSwishNumber", swish),
    upsert.bind("kioskTheme", theme),
    upsert.bind("kioskCategories", JSON.stringify(categories))
  ]);
  const revision = await bumpRevision(env);
  return { ok: true, revision };
}

export async function uploadKioskLogo(env, session, payload) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  const raw = String(payload.dataBase64 || "").replace(/^data:[^;]+;base64,/, "").replace(/\s/g, "");
  if (!raw) return { ok: false, error: "Ingen bilddata" };
  if (raw.length > 6000000) return { ok: false, error: "Bilden är för stor" };
  let mime = String(payload.mimeType || "image/png").trim() || "image/png";
  if (mime.indexOf("image/") !== 0) mime = "image/png";
  const ext = mime.indexOf("jpeg") >= 0 || mime.indexOf("jpg") >= 0 ? "jpg" : mime.indexOf("webp") >= 0 ? "webp" : "png";
  const bytes = base64ToBytes(raw);
  const hash = await sha16(bytes);
  const key = "kiosk-logo-" + hash + "." + ext;
  await deleteKioskLogoBilder(env);
  await env.BILDER.put(key, bytes, { httpMetadata: { contentType: mime } });
  const upsert = env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await env.DB.batch([upsert.bind("kioskLogoKey", key), upsert.bind("kioskLogoHash", hash)]);
  const revision = await bumpRevision(env);
  return { ok: true, logoKey: key, logoHash: hash, revision };
}

function ymdOr(value, fallback) {
  const s = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : fallback;
}

function todayYmdUtc() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysYmd(ymd, days) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseOrderItems(raw) {
  try {
    const parsed = JSON.parse(raw || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        id: String((row && row.id) || ""),
        name: String((row && row.name) || "Vara").trim() || "Vara",
        price: Math.round((Number(row && row.price) || 0) * 100) / 100,
        qty: Number(row && row.qty) || 0
      }))
      .filter((row) => row.qty > 0);
  } catch {
    return [];
  }
}

export async function listKioskSales(env, session, payload) {
  if (!canManageKioskCatalog(session)) return { ok: false, error: "Saknar behörighet" };
  payload = payload || {};
  const toDate = ymdOr(payload.toDate, todayYmdUtc());
  const fromDate = ymdOr(payload.fromDate, addDaysYmd(toDate, -30));
  if (fromDate > toDate) return { ok: false, error: "Startdatum kan inte vara efter slutdatum" };
  const listed = await env.DB.prepare(
    `SELECT id, created_at, amount, message, items_json
     FROM kiosk_orders
     WHERE date(created_at) >= date(?) AND date(created_at) <= date(?)
     ORDER BY created_at DESC
     LIMIT 500`
  )
    .bind(fromDate, toDate)
    .all();
  const orders = (listed.results || []).map((row) => {
    const items = parseOrderItems(row.items_json);
    const amount = Math.round((Number(row.amount) || 0) * 100) / 100;
    return {
      id: String(row.id || ""),
      createdAt: String(row.created_at || ""),
      message: String(row.message || ""),
      amount,
      items
    };
  });
  const productMap = new Map();
  for (const order of orders) {
    for (const item of order.items) {
      const key = item.name;
      const prev = productMap.get(key) || { name: item.name, qty: 0, amount: 0 };
      prev.qty += item.qty;
      prev.amount += item.price * item.qty;
      productMap.set(key, prev);
    }
  }
  const productTotals = [...productMap.values()]
    .map((row) => ({ ...row, amount: Math.round(row.amount * 100) / 100 }))
    .sort((a, b) => b.amount - a.amount);
  const totalAmount = Math.round(orders.reduce((sum, order) => sum + order.amount, 0) * 100) / 100;
  return {
    ok: true,
    fromDate,
    toDate,
    orders,
    productTotals,
    totalAmount,
    orderCount: orders.length
  };
}

export async function recordKioskSale(env, payload) {
  payload = payload || {};
  const items = Array.isArray(payload.items) ? payload.items : [];
  const amount = Number(payload.amount);
  const message = String(payload.message || "").trim().slice(0, 50);
  if (!items.length || !Number.isFinite(amount) || amount < 1) {
    return { ok: false, error: "Ogiltigt köp" };
  }
  const id = String(payload.orderId || crypto.randomUUID().slice(0, 8)).toUpperCase();
  await env.DB.prepare(
    "INSERT OR REPLACE INTO kiosk_orders (id, created_at, amount, message, items_json) VALUES (?, datetime('now'), ?, ?, ?)"
  )
    .bind(id, Math.round(amount * 100) / 100, message || "Kassa " + id, JSON.stringify(items))
    .run();
  return { ok: true, orderId: id };
}

export { isR2ImageKey };
