/**
 * Kiosk-katalog: produkter, priser och bilder för självbetjäningen.
 * Publik läsning via GET /kiosk/revision (en rad) och GET /kiosk/catalog.
 */

import { hasRole, roleOf } from "./auth.js";
import { deleteBilderKey, isR2ImageKey } from "./images.js";

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
    imageUrl: imageKey ? origin + "/img/" + encodeURIComponent(imageKey) : null
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
    logoUrl: logo ? origin + "/img/" + encodeURIComponent(logo) : null,
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
  if (row.image_key) await deleteBilderKey(env, row.image_key);
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
  if (raw.length > 6000000) return { ok: false, error: "Bilden är för stor" };
  let mime = String(payload.mimeType || "image/jpeg").trim() || "image/jpeg";
  if (mime.indexOf("image/") !== 0) mime = "image/jpeg";
  const ext = mime.indexOf("png") >= 0 ? "png" : mime.indexOf("webp") >= 0 ? "webp" : "jpg";
  const key = "kiosk-" + id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) + "." + ext;
  const bytes = base64ToBytes(raw);
  const hash = await sha16(bytes);
  if (product.image_key && product.image_key !== key) await deleteBilderKey(env, product.image_key);
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
  const key = "kiosk-logo." + ext;
  const prev = await setting(env, "kioskLogoKey", "");
  const bytes = base64ToBytes(raw);
  const hash = await sha16(bytes);
  if (prev && prev !== key) await deleteBilderKey(env, prev);
  await env.BILDER.put(key, bytes, { httpMetadata: { contentType: mime } });
  const upsert = env.DB.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  await env.DB.batch([upsert.bind("kioskLogoKey", key), upsert.bind("kioskLogoHash", hash)]);
  const revision = await bumpRevision(env);
  return { ok: true, logoKey: key, logoHash: hash, revision };
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
