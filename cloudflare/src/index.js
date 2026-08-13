/**
 * WallFlow Worker — ersätter Google Apps Script Web App.
 *
 * POST / (eller /api)  → { action, token, args } JSON (text/plain eller application/json)
 * GET  /img/<key>      → R2-bild
 * GET  /               → health
 */

import { dispatch } from "./api.js";
import { serveImage } from "./images.js";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400"
};

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json; charset=UTF-8",
      ...CORS_HEADERS
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Bilder från R2
    if (request.method === "GET" && (url.pathname.startsWith("/img/") || url.pathname.startsWith("/img%2F"))) {
      const key = url.pathname.replace(/^\/img\/?/, "");
      const res = await serveImage(env, key);
      if (!res) return new Response("Not found", { status: 404, headers: CORS_HEADERS });
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/api")) {
      return jsonResponse({ ok: true, app: "WallFlow", backend: "cloudflare" });
    }

    if (request.method === "POST" && (url.pathname === "/" || url.pathname === "/api" || url.pathname === "/api/")) {
      try {
        const bodyText = await request.text();
        const payload = JSON.parse(bodyText || "{}");
        const action = String(payload.action || "");
        const token = String(payload.token || "");
        const args = Array.isArray(payload.args) ? payload.args : [];
        const result = await dispatch(env, action, token, args);
        return jsonResponse(result);
      } catch (err) {
        return jsonResponse({
          ok: false,
          error: String(err && err.message ? err.message : err)
        });
      }
    }

    return new Response("Not found", { status: 404, headers: CORS_HEADERS });
  }
};
