#!/usr/bin/env node
/**
 * Lokal smoke-test mot wrangler dev (D1/KV/R2 local).
 * Kräver: schema + seed körda, och `npm run dev` igång på :8787.
 *
 *   node cloudflare/scripts/seed-local.mjs
 *   cd cloudflare && npm run dev
 *   node cloudflare/scripts/smoke-api.mjs
 */
const BASE = process.env.WALLFLOW_API || "http://127.0.0.1:8787";

async function call(action, args = [], token = "") {
  const res = await fetch(BASE + "/", {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=UTF-8" },
    body: JSON.stringify({ action, token, args })
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch {
    throw new Error(action + " non-JSON: " + text.slice(0, 200));
  }
  return json;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const health = await fetch(BASE + "/").then((r) => r.json());
  assert(health.ok && health.app === "WallFlow", "health failed");

  const data = await call("getAppData");
  assert(Array.isArray(data.routes), "routes missing");
  assert(Array.isArray(data.grades) && data.grades.length > 0, "grades missing");
  console.log("getAppData: routes=%d grades=%d life=%s", data.routes.length, data.grades.length, data.routeLifetimeDays);

  const login = await call("verifyAdminPassword", ["admin", "wallflow"]);
  assert(login.authorized && login.token, "login failed — seed admin/wallflow?");
  console.log("login ok role=%s", login.role);

  const me = await call("getAppData", [], login.token);
  assert(me.me && me.me.username === "admin", "me missing");

  const route = data.routes[0];
  if (route) {
    const patch = { ...route, Anteckningar: (route.Anteckningar || "") + " [smoke]" };
    delete patch.Livslangd; // scout/admin utan lifetime-behörighet i test — admin är superadmin
    const saved = await call("saveRoute", [patch], login.token);
    assert(saved.ok && saved.route, "saveRoute failed: " + JSON.stringify(saved));
    console.log("saveRoute ok nr=%s rebuild=%s slut=%s", saved.route.Nr, saved.route.DagsAttByggaOm, saved.route.Slutdatum);
  }

  const denied = await call("saveRoute", [{ Gradering: "Blå" }], "");
  assert(denied.ok === false, "expected auth deny");

  console.log("smoke ok");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
