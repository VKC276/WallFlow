/* Självbetjäningskassa i WallFlow — admin / superadmin / kassör. */

function hideCatalogOverlay_() {
  const el = document.getElementById("app-catalog");
  if (el) el.classList.remove("show");
  document.body.classList.remove("catalog-open");
}

function closeCatalogTool() {
  hideCatalogOverlay_();
  const timeOpen = document.getElementById("app-time") && document.getElementById("app-time").classList.contains("show");
  const verifOpen = document.getElementById("app-verif") && document.getElementById("app-verif").classList.contains("show");
  const wellnessOpen = document.getElementById("app-wellness") && document.getElementById("app-wellness").classList.contains("show");
  const inspOpen = document.getElementById("app-insp") && document.getElementById("app-insp").classList.contains("show");
  const tencardOpen = document.getElementById("app-tencard") && document.getElementById("app-tencard").classList.contains("show");
  if (hasWallflowAccess_() && !timeOpen && !verifOpen && !wellnessOpen && !inspOpen && !tencardOpen) {
    document.getElementById("app-public").classList.add("ready");
    showAppChrome_();
  } else {
    showAppChrome_();
  }
}

function openCatalogTool(view) {
  if (!currentUser.authorized) return showLoginGate_();
  if (currentUser.firstLogin) return showToast("Byt lösenord först");
  if (!canManageKioskCatalog_()) return showToast("Saknar behörighet");
  catalogState_.view = view === "sales" ? "sales" : "products";
  document.getElementById("app-admin").classList.remove("show");
  document.getElementById("app-time").classList.remove("show");
  document.getElementById("app-verif").classList.remove("show");
  hideTencardOverlay_();
  hideWellnessOverlay_();
  hideInspOverlay_();
  document.getElementById("app-public").classList.remove("ready");
  if (typeof closeSearchPanel_ === "function") closeSearchPanel_();
  document.getElementById("app-catalog").classList.add("show");
  showAppChrome_();
  loadCatalogTool_();
}

let catalogState_ = {
  view: "products",
  products: [],
  settings: null,
  error: "",
  saving: false,
  filter: { name: "", price: "", category: "", status: "all" },
  sales: { fromDate: "", toDate: "", orders: [], productTotals: [], totalAmount: 0, orderCount: 0, error: "", loading: false }
};

function kioskTodayYmd_() {
  return new Date().toISOString().slice(0, 10);
}

function kioskShiftYmd_(ymd, days) {
  const d = new Date(ymd + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function kioskFormatSek_(n) {
  if (typeof formatSek_ === "function") return formatSek_(n);
  const v = Number(n) || 0;
  return new Intl.NumberFormat("sv-SE", { style: "currency", currency: "SEK", maximumFractionDigits: v % 1 === 0 ? 0 : 2 }).format(v);
}

function kioskFormatWhen_(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const d = new Date(s.indexOf("T") >= 0 || s.indexOf("Z") >= 0 ? s : s.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return s.replace("T", " ").slice(0, 16);
  return d.toLocaleString("sv-SE", { dateStyle: "short", timeStyle: "short" });
}

function catalogTabsHtml_() {
  const view = catalogState_.view === "sales" ? "sales" : "products";
  return `<div class="time-view-tabs" style="padding:0 0 12px;">
    <button type="button" class="btn ${view === "products" ? "btn-accent" : "btn-ghost"} btn-sm" data-cat-view="products">Sortiment</button>
    <button type="button" class="btn ${view === "sales" ? "btn-accent" : "btn-ghost"} btn-sm" data-cat-view="sales">Historiska Swishköp</button>
  </div>`;
}

function bindCatalogTabs_(root) {
  root.querySelectorAll("[data-cat-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      catalogState_.view = btn.getAttribute("data-cat-view") === "sales" ? "sales" : "products";
      if (catalogState_.view === "sales") loadKioskSales_();
      else renderCatalogTool_();
    });
  });
}

function catalogCategories_() {
  const listed = (catalogState_.settings && catalogState_.settings.categories) || [];
  const fromProducts = (catalogState_.products || []).map((p) => String(p.category || "").trim()).filter(Boolean);
  const out = [];
  const seen = new Set();
  listed.concat(fromProducts).forEach((name) => {
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  });
  return out.length ? out : ["Övrigt"];
}

function catalogFilteredProducts_() {
  const f = catalogState_.filter || { name: "", price: "", category: "", status: "all" };
  const nameQ = String(f.name || "").trim().toLowerCase();
  const priceQ = String(f.price || "").trim().toLowerCase();
  const catQ = String(f.category || "").trim();
  const status = String(f.status || "all");
  return (catalogState_.products || []).filter((p) => {
    if (nameQ && String(p.name || "").toLowerCase().indexOf(nameQ) < 0) return false;
    if (priceQ && String(p.price ?? "").toLowerCase().indexOf(priceQ) < 0) return false;
    if (catQ && String(p.category || "") !== catQ) return false;
    if (status === "visible" && !p.active) return false;
    if (status === "hidden" && p.active) return false;
    if (status === "featured" && !p.featured) return false;
    return true;
  });
}

function catalogProductRowsHtml_(cats) {
  const rows = catalogFilteredProducts_().map((p) => {
    const options = cats.slice();
    if (p.category && options.indexOf(p.category) < 0) options.push(p.category);
    return `
    <tr>
      <td>${p.imageUrl ? `<img src="${escapeHtml_(p.imageUrl)}" alt="" style="width:44px;height:44px;object-fit:cover;border-radius:8px;">` : "—"}</td>
      <td>
        <input class="form-control form-control-sm" data-cat-field="name" data-id="${escapeHtml_(p.id)}" value="${escapeHtml_(p.name)}">
      </td>
      <td style="width:88px;">
        <input class="form-control form-control-sm" type="number" step="0.5" data-cat-field="price" data-id="${escapeHtml_(p.id)}" value="${escapeHtml_(String(p.price))}">
      </td>
      <td>
        <select class="form-control form-control-sm" data-cat-field="category" data-id="${escapeHtml_(p.id)}">
          ${options.map((c) => `<option${c === p.category ? " selected" : ""}>${escapeHtml_(c)}</option>`).join("")}
        </select>
      </td>
      <td>
        <label class="small mb-0"><input type="checkbox" data-cat-field="active" data-id="${escapeHtml_(p.id)}" ${p.active ? "checked" : ""}> Synlig</label>
        <label class="small mb-0 d-block"><input type="checkbox" data-cat-field="featured" data-id="${escapeHtml_(p.id)}" ${p.featured ? "checked" : ""}> Vanlig</label>
      </td>
      <td>
        <label class="btn btn-sm btn-ghost mb-0">
          Byt bild
          <input type="file" accept="image/*" class="visually-hidden" data-cat-img="${escapeHtml_(p.id)}">
        </label>
        <button class="btn btn-sm btn-ghost" type="button" data-cat-save="${escapeHtml_(p.id)}">Spara</button>
        <button class="btn btn-sm btn-outline-danger" type="button" data-cat-del="${escapeHtml_(p.id)}">Ta bort</button>
      </td>
    </tr>`;
  }).join("");
  return rows || `<tr><td colspan="6" style="color:var(--muted);">Inga varor matchar filtret.</td></tr>`;
}

function loadCatalogTool_() {
  const main = document.getElementById("catalog-main");
  if (main) main.innerHTML = `<p class="admin-kicker">Självbetjäningskassa</p><p style="color:var(--muted);">Hämtar…</p>`;
  google.script.run
    .withSuccessHandler((res) => {
      if (!res || res.ok === false) {
        catalogState_.error = (res && res.error) || "Kunde inte hämta sortimentet";
        renderCatalogTool_();
        return;
      }
      catalogState_.error = "";
      catalogState_.products = res.products || [];
      catalogState_.settings = res;
      if (catalogState_.view === "sales") loadKioskSales_();
      else renderCatalogTool_();
    })
    .withFailureHandler((err) => {
      catalogState_.error = String(err && err.message ? err.message : err);
      renderCatalogTool_();
    })
    .listKioskCatalog();
}

function loadKioskSales_() {
  const sales = catalogState_.sales;
  if (!sales.toDate) sales.toDate = kioskTodayYmd_();
  if (!sales.fromDate) sales.fromDate = kioskShiftYmd_(sales.toDate, -30);
  sales.loading = true;
  sales.error = "";
  renderCatalogTool_();
  google.script.run
    .withSuccessHandler((res) => {
      sales.loading = false;
      if (!res || res.ok === false) {
        sales.error = (res && res.error) || "Kunde inte hämta köp";
        renderCatalogTool_();
        return;
      }
      sales.fromDate = res.fromDate || sales.fromDate;
      sales.toDate = res.toDate || sales.toDate;
      sales.orders = res.orders || [];
      sales.productTotals = res.productTotals || [];
      sales.totalAmount = res.totalAmount || 0;
      sales.orderCount = res.orderCount || 0;
      sales.error = "";
      renderCatalogTool_();
    })
    .withFailureHandler((err) => {
      sales.loading = false;
      sales.error = String(err && err.message ? err.message : err);
      renderCatalogTool_();
    })
    .listKioskSales({ fromDate: sales.fromDate, toDate: sales.toDate });
}

function renderCatalogTool_() {
  const main = document.getElementById("catalog-main");
  if (!main) return;
  if (catalogState_.view === "sales") {
    renderKioskSales_(main);
    return;
  }
  const s = catalogState_.settings || {};
  const cats = catalogCategories_();
  const managed = (s.categories && s.categories.length ? s.categories : cats).slice();
  const f = catalogState_.filter || { name: "", price: "", category: "", status: "all" };
  const catChips = managed.map((c) => {
    const used = (catalogState_.products || []).filter((p) => p.category === c).length;
    return `<span class="d-inline-flex align-items-center gap-1 me-2 mb-2" style="border:1px solid var(--line);border-radius:999px;padding:4px 10px;">
      ${escapeHtml_(c)}${used ? ` <span class="small" style="color:var(--muted);">(${used})</span>` : ""}
      <button type="button" class="btn btn-sm btn-ghost" style="padding:0 4px;min-height:0;" data-cat-remove="${escapeHtml_(c)}" aria-label="Ta bort ${escapeHtml_(c)}">×</button>
    </span>`;
  }).join("");
  main.innerHTML = `
    <p class="admin-kicker">Självbetjäningskassa</p>
    ${catalogTabsHtml_()}
    <h3>Varor till självbetjäningen</h3>
    <p class="small" style="color:var(--muted);">Ändringar syns i kassan inom fem minuter. Revision ${escapeHtml_(String(s.revision || 1))}.</p>
    ${catalogState_.error ? `<p style="color:#e8b4b4;">${escapeHtml_(catalogState_.error)}</p>` : ""}
    <div class="detail-grid" style="margin-bottom:16px;">
      <div class="detail-cell">
        <label>Butiksnamn</label>
        <input id="kiosk-shop-name" class="form-control" value="${escapeHtml_(s.shopName || "")}">
      </div>
      <div class="detail-cell">
        <label>Swish-nummer</label>
        <input id="kiosk-swish" class="form-control" value="${escapeHtml_(s.swishNumber || "")}">
      </div>
      <div class="detail-cell">
        <label>Tema</label>
        <select id="kiosk-theme" class="form-control">
          ${["light", "dark", "bold", "contrast"].map((t) => {
            const labels = { light: "Ljust", dark: "Mörkt", bold: "Grafit", contrast: "Kontrast" };
            return `<option value="${t}"${s.theme === t ? " selected" : ""}>${labels[t]}</option>`;
          }).join("")}
        </select>
      </div>
      <div class="detail-cell">
        <label>Logotyp</label>
        ${s.logoUrl ? `<img src="${escapeHtml_(s.logoUrl)}" alt="" style="height:40px;object-fit:contain;display:block;margin-bottom:8px;">` : ""}
        <input id="kiosk-logo" type="file" accept="image/*" class="form-control form-control-sm">
      </div>
    </div>
    <button class="btn btn-accent mb-3" type="button" id="kiosk-settings-save">Spara kassainställningar</button>
    <h4>Kategorier</h4>
    <p class="small" style="color:var(--muted);">Kategorierna visas som filter i kassan. Ta bort bara om inga varor använder den, eller godkänn flytt.</p>
    <div class="mb-2">${catChips || `<span style="color:var(--muted);">Inga kategorier.</span>`}</div>
    <div class="d-flex flex-wrap gap-2 mb-4">
      <input id="kiosk-new-category" class="form-control" style="max-width:240px;" placeholder="Ny kategori">
      <button class="btn btn-accent" type="button" id="kiosk-add-category">Lägg till kategori</button>
    </div>
    <div class="table-responsive">
      <table class="tencard-list">
        <thead>
          <tr><th></th><th>Namn</th><th>Pris</th><th>Kategori</th><th>Status</th><th></th></tr>
          <tr>
            <th></th>
            <th><input id="kiosk-filter-name" class="form-control form-control-sm" placeholder="Sök namn" value="${escapeHtml_(f.name || "")}"></th>
            <th><input id="kiosk-filter-price" class="form-control form-control-sm" placeholder="Sök pris" value="${escapeHtml_(f.price || "")}"></th>
            <th>
              <select id="kiosk-filter-category" class="form-control form-control-sm">
                <option value="">Alla</option>
                ${cats.map((c) => `<option value="${escapeHtml_(c)}"${f.category === c ? " selected" : ""}>${escapeHtml_(c)}</option>`).join("")}
              </select>
            </th>
            <th>
              <select id="kiosk-filter-status" class="form-control form-control-sm">
                <option value="all"${f.status === "all" ? " selected" : ""}>Alla</option>
                <option value="visible"${f.status === "visible" ? " selected" : ""}>Synlig</option>
                <option value="hidden"${f.status === "hidden" ? " selected" : ""}>Dold</option>
                <option value="featured"${f.status === "featured" ? " selected" : ""}>Vanlig</option>
              </select>
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody id="kiosk-product-tbody">${catalogProductRowsHtml_(cats)}</tbody>
      </table>
    </div>
    <h4 class="mt-4">Ny produkt</h4>
    <div class="detail-grid">
      <div class="detail-cell"><label>Namn</label><input id="kiosk-new-name" class="form-control"></div>
      <div class="detail-cell"><label>Pris</label><input id="kiosk-new-price" class="form-control" type="number" step="0.5"></div>
      <div class="detail-cell">
        <label>Kategori</label>
        <select id="kiosk-new-cat" class="form-control">${managed.map((c) => `<option>${escapeHtml_(c)}</option>`).join("")}</select>
      </div>
    </div>
    <button class="btn btn-accent mt-2" type="button" id="kiosk-new-save">Lägg till</button>
  `;
  bindCatalogTabs_(main);
  bindCatalogTool_(main);
}

function renderKioskSales_(main) {
  const sales = catalogState_.sales;
  const orders = sales.orders || [];
  const totals = sales.productTotals || [];
  const orderRows = orders.map((order) => {
    const lines = (order.items || [])
      .map((item) => `${escapeHtml_(item.name)} × ${escapeHtml_(String(item.qty))} (${kioskFormatSek_(item.price * item.qty)})`)
      .join("<br>");
    return `<tr>
      <td>${escapeHtml_(kioskFormatWhen_(order.createdAt))}</td>
      <td><strong>${escapeHtml_(order.id)}</strong><div class="small" style="color:var(--muted);">${escapeHtml_(order.message || "")}</div></td>
      <td>${lines || "<span style='color:var(--muted);'>Inga rader sparade</span>"}</td>
      <td class="num">${kioskFormatSek_(order.amount)}</td>
    </tr>`;
  }).join("");
  const totalRows = totals.map((row) => `
    <tr>
      <td>${escapeHtml_(row.name)}</td>
      <td class="num">${escapeHtml_(String(row.qty))} st</td>
      <td class="num">${kioskFormatSek_(row.amount)}</td>
    </tr>`).join("") || `<tr><td colspan="3" style="color:var(--muted);">Inga sålda varor.</td></tr>`;
  main.innerHTML = `
    <p class="admin-kicker">Självbetjäningskassa</p>
    ${catalogTabsHtml_()}
    <h3>Historiska Swishköp</h3>
    <p class="small" style="color:var(--muted);">Matcha Swish-meddelandet mot ordernumret. Varje köp visar vad som låg i korgen.</p>
    ${sales.error ? `<p style="color:#e8b4b4;">${escapeHtml_(sales.error)}</p>` : ""}
    <div class="detail-grid" style="margin-bottom:16px;">
      <div class="detail-cell">
        <label>Från</label>
        <input id="kiosk-sales-from" class="form-control" type="date" value="${escapeHtml_(sales.fromDate)}">
      </div>
      <div class="detail-cell">
        <label>Till</label>
        <input id="kiosk-sales-to" class="form-control" type="date" value="${escapeHtml_(sales.toDate)}">
      </div>
    </div>
    <div class="d-flex flex-wrap gap-2 mb-3">
      <button class="btn btn-accent" type="button" id="kiosk-sales-load">Visa period</button>
      <button class="btn btn-ghost" type="button" id="kiosk-sales-pdf">Ladda ner PDF</button>
    </div>
    ${sales.loading ? `<p style="color:var(--muted);">Hämtar…</p>` : `
    <div class="admin-card" style="margin-bottom:16px;">
      <p class="mb-1"><strong>${escapeHtml_(String(sales.orderCount || 0))} köp</strong> · ${kioskFormatSek_(sales.totalAmount)}</p>
    </div>
    <h4>Per vara</h4>
    <div class="table-responsive mb-4">
      <table class="tencard-list">
        <thead><tr><th>Vara</th><th class="num">Antal</th><th class="num">Summa</th></tr></thead>
        <tbody>${totalRows}</tbody>
      </table>
    </div>
    <h4>Köprader</h4>
    <div class="table-responsive">
      <table class="tencard-list">
        <thead><tr><th>Tid</th><th>Order / Swish-meddelande</th><th>Innehåll</th><th class="num">Belopp</th></tr></thead>
        <tbody>${orderRows || `<tr><td colspan="4" style="color:var(--muted);">Inga köp i perioden.</td></tr>`}</tbody>
      </table>
    </div>`}
  `;
  bindCatalogTabs_(main);
  const loadBtn = main.querySelector("#kiosk-sales-load");
  if (loadBtn) {
    loadBtn.addEventListener("click", () => {
      const from = document.getElementById("kiosk-sales-from");
      const to = document.getElementById("kiosk-sales-to");
      catalogState_.sales.fromDate = from ? from.value : catalogState_.sales.fromDate;
      catalogState_.sales.toDate = to ? to.value : catalogState_.sales.toDate;
      loadKioskSales_();
    });
  }
  const pdfBtn = main.querySelector("#kiosk-sales-pdf");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", () => {
      downloadKioskSalesPdf_().catch((err) => {
        if (typeof showToast === "function") showToast(String(err && err.message ? err.message : err));
      });
    });
  }
}

function kioskPdfText_(text) {
  return String(text || "")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u00a0/g, " ")
    .replace(/[^\x20-\x7E\u00C0-\u00FF]/g, "");
}

function kioskPdfMoney_(n) {
  return kioskPdfText_(kioskFormatSek_(n).replace(/\u00a0/g, " "));
}

async function buildKioskSalesPdf_() {
  const sales = catalogState_.sales || {};
  const orders = sales.orders || [];
  const totals = sales.productTotals || [];
  const { PDFDocument, StandardFonts, rgb, PageSizes } = pdfLib_();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const fontBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pageW = PageSizes.A4[0];
  const pageH = PageSizes.A4[1];
  const margin = 40;
  const contentW = pageW - margin * 2;
  const ink = rgb(0.12, 0.14, 0.16);
  const muted = rgb(0.4, 0.45, 0.5);
  const line = rgb(0.82, 0.84, 0.86);
  const accent = rgb(0.05, 0.43, 0.43);

  let page = doc.addPage([pageW, pageH]);
  let y = pageH - margin;

  function newPage_() {
    page = doc.addPage([pageW, pageH]);
    y = pageH - margin;
  }

  function ensure_(need) {
    if (y - need < margin) newPage_();
  }

  function draw_(text, x, yy, size, bold, color) {
    page.drawText(kioskPdfText_(text), {
      x, y: yy, size, font: bold ? fontBold : font, color: color || ink
    });
  }

  function drawWrapped_(text, x, size, bold, color, maxW) {
    const wrap = typeof wrapPdfText_ === "function"
      ? wrapPdfText_(bold ? fontBold : font, text, size, maxW)
      : [kioskPdfText_(text)];
    wrap.forEach((ln) => {
      ensure_(size + 4);
      draw_(ln, x, y, size, bold, color);
      y -= size + 4;
    });
    return wrap.length;
  }

  function hrule_() {
    page.drawLine({
      start: { x: margin, y: y + 4 },
      end: { x: pageW - margin, y: y + 4 },
      thickness: 0.7,
      color: line
    });
    y -= 8;
  }

  const from = sales.fromDate || "";
  const to = sales.toDate || "";
  const period = from && to ? (from + " – " + to) : (from || to || "");

  draw_("Självbetjäningskassa", margin, y, 10, true, accent);
  y -= 16;
  draw_("Historiska Swishköp", margin, y, 18, true);
  y -= 16;
  if (period) {
    draw_("Period " + period, margin, y, 11, false, muted);
    y -= 14;
  }
  draw_(String(sales.orderCount || 0) + " köp · " + kioskPdfMoney_(sales.totalAmount), margin, y, 12, true);
  y -= 18;
  hrule_();

  draw_("Per vara", margin, y, 13, true);
  y -= 16;

  const prodCols = [
    { key: "name", label: "Vara", x: margin, w: contentW - 150 },
    { key: "qty", label: "Antal", x: margin + contentW - 150, w: 60, right: true },
    { key: "amount", label: "Summa", x: margin + contentW - 90, w: 90, right: true }
  ];

  function drawHeader_(cols) {
    ensure_(22);
    cols.forEach((c) => {
      const label = c.label;
      const tw = fontBold.widthOfTextAtSize(label, 9);
      const x = c.right ? c.x + c.w - tw : c.x;
      draw_(label, x, y, 9, true, muted);
    });
    y -= 12;
    hrule_();
  }

  drawHeader_(prodCols);
  if (!totals.length) {
    drawWrapped_("Inga sålda varor.", margin, 10, false, muted, contentW);
    y -= 6;
  } else {
    totals.forEach((row) => {
      const nameLines = typeof wrapPdfText_ === "function"
        ? wrapPdfText_(font, row.name, 10, prodCols[0].w - 4)
        : [kioskPdfText_(row.name)];
      const rowH = Math.max(14, nameLines.length * 12);
      ensure_(rowH + 4);
      nameLines.forEach((ln, i) => draw_(ln, prodCols[0].x, y - i * 12, 10, false));
      const qty = String(row.qty) + " st";
      const qtyW = font.widthOfTextAtSize(kioskPdfText_(qty), 10);
      draw_(qty, prodCols[1].x + prodCols[1].w - qtyW, y, 10, false);
      const amt = kioskPdfMoney_(row.amount);
      const amtW = font.widthOfTextAtSize(amt, 10);
      draw_(amt, prodCols[2].x + prodCols[2].w - amtW, y, 10, false);
      y -= rowH;
    });
  }

  y -= 10;
  ensure_(40);
  draw_("Köprader", margin, y, 13, true);
  y -= 16;

  const orderCols = [
    { key: "when", label: "Tid", x: margin, w: 90 },
    { key: "order", label: "Order / Swish", x: margin + 94, w: 130 },
    { key: "items", label: "Innehåll", x: margin + 228, w: contentW - 228 - 72 },
    { key: "amount", label: "Belopp", x: margin + contentW - 72, w: 72, right: true }
  ];
  drawHeader_(orderCols);

  if (!orders.length) {
    drawWrapped_("Inga köp i perioden.", margin, 10, false, muted, contentW);
  } else {
    orders.forEach((order) => {
      const when = kioskFormatWhen_(order.createdAt);
      const orderId = String(order.id || "");
      const msg = String(order.message || "").trim();
      const itemLines = (order.items || []).map((item) => {
        const qty = item.qty != null ? String(item.qty) : "1";
        return String(item.name || "") + " x " + qty + " (" + kioskPdfMoney_(Number(item.price || 0) * Number(item.qty || 0)) + ")";
      });
      const itemsText = itemLines.length ? itemLines.join("\n") : "Inga rader sparade";

      const whenWrap = typeof wrapPdfText_ === "function" ? wrapPdfText_(font, when, 9, orderCols[0].w - 2) : [kioskPdfText_(when)];
      const orderWrap = [];
      [orderId, msg].filter(Boolean).forEach((part) => {
        const wrapped = typeof wrapPdfText_ === "function" ? wrapPdfText_(font, part, 9, orderCols[1].w - 2) : [kioskPdfText_(part)];
        wrapped.forEach((w) => orderWrap.push(w));
      });
      if (!orderWrap.length) orderWrap.push("");
      const itemsWrap = [];
      itemsText.split("\n").forEach((part) => {
        const wrapped = typeof wrapPdfText_ === "function" ? wrapPdfText_(font, part, 9, orderCols[2].w - 2) : [kioskPdfText_(part)];
        wrapped.forEach((w) => itemsWrap.push(w));
      });
      const rowH = Math.max(14, Math.max(whenWrap.length, orderWrap.length, itemsWrap.length) * 11 + 4);
      ensure_(rowH + 6);

      whenWrap.forEach((ln, i) => draw_(ln, orderCols[0].x, y - i * 11, 9, false));
      orderWrap.forEach((ln, i) => draw_(ln, orderCols[1].x, y - i * 11, 9, i === 0));
      itemsWrap.forEach((ln, i) => draw_(ln, orderCols[2].x, y - i * 11, 9, false, muted));
      const amt = kioskPdfMoney_(order.amount);
      const amtW = fontBold.widthOfTextAtSize(amt, 9);
      draw_(amt, orderCols[3].x + orderCols[3].w - amtW, y, 9, true);

      y -= rowH;
      page.drawLine({
        start: { x: margin, y: y + 2 },
        end: { x: pageW - margin, y: y + 2 },
        thickness: 0.4,
        color: line
      });
      y -= 4;
    });
  }

  const bytes = await doc.save();
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const stamp = (from && to) ? (from + "_" + to) : kioskTodayYmd_();
  return { bytes: u8, filename: "swishkop-" + stamp + ".pdf" };
}

async function downloadKioskSalesPdf_() {
  if (catalogState_.sales && catalogState_.sales.loading) {
    if (typeof showToast === "function") showToast("Vänta tills perioden är hämtad");
    return;
  }
  const pdf = await buildKioskSalesPdf_();
  downloadBytes_(pdf.bytes, pdf.filename);
  if (typeof showToast === "function") showToast("PDF nedladdad");
}

function catalogProductFromRow_(id) {
  const name = document.querySelector(`[data-cat-field="name"][data-id="${CSS.escape(id)}"]`);
  const price = document.querySelector(`[data-cat-field="price"][data-id="${CSS.escape(id)}"]`);
  const category = document.querySelector(`[data-cat-field="category"][data-id="${CSS.escape(id)}"]`);
  const active = document.querySelector(`[data-cat-field="active"][data-id="${CSS.escape(id)}"]`);
  const featured = document.querySelector(`[data-cat-field="featured"][data-id="${CSS.escape(id)}"]`);
  return {
    id,
    name: name ? name.value : "",
    price: price ? Number(price.value) : 0,
    category: category ? category.value : "Övrigt",
    active: !!(active && active.checked),
    featured: !!(featured && featured.checked)
  };
}

function fileToPayload_(file) {
  const maxEdge = 1600;
  return new Promise((resolve, reject) => {
    const fallback = () => {
      const reader = new FileReader();
      reader.onload = () => resolve({ dataBase64: String(reader.result || ""), mimeType: file.type || "image/jpeg" });
      reader.onerror = () => reject(new Error("Kunde inte läsa filen"));
      reader.readAsDataURL(file);
    };
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      let width = img.naturalWidth || img.width;
      let height = img.naturalHeight || img.height;
      if (!width || !height) return fallback();
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return fallback();
      ctx.drawImage(img, 0, 0, width, height);
      resolve({ dataBase64: canvas.toDataURL("image/jpeg", 0.84), mimeType: "image/jpeg" });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      fallback();
    };
    img.src = url;
  });
}

function kioskSettingsPayload_(categories) {
  const s = catalogState_.settings || {};
  const shop = document.getElementById("kiosk-shop-name");
  const swish = document.getElementById("kiosk-swish");
  const theme = document.getElementById("kiosk-theme");
  return {
    shopName: shop ? shop.value : s.shopName,
    swishNumber: swish ? swish.value : s.swishNumber,
    theme: theme ? theme.value : s.theme,
    categories: categories || s.categories || []
  };
}

function persistKioskCategories_(categories, okMessage) {
  google.script.run
    .withSuccessHandler((res) => {
      if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte spara kategorier");
      if (okMessage) showToast(okMessage);
      loadCatalogTool_();
    })
    .saveKioskSettings(kioskSettingsPayload_(categories));
}

function bindCatalogProductRows_(root) {
  root.querySelectorAll("[data-cat-save]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-cat-save");
      google.script.run
        .withSuccessHandler((res) => {
          if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte spara");
          showToast("Sparad");
          loadCatalogTool_();
        })
        .saveKioskProduct(catalogProductFromRow_(id));
    });
  });
  root.querySelectorAll("[data-cat-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-cat-del");
      if (!window.confirm("Ta bort produkten?")) return;
      google.script.run
        .withSuccessHandler((res) => {
          if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte ta bort");
          loadCatalogTool_();
        })
        .deleteKioskProduct(id);
    });
  });
  root.querySelectorAll("[data-cat-img]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      const id = input.getAttribute("data-cat-img");
      showToast("Laddar upp bild…");
      try {
        const payload = await fileToPayload_(file);
        payload.id = id;
        google.script.run
          .withSuccessHandler((res) => {
            if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte ladda upp");
            showToast("Bild sparad");
            loadCatalogTool_();
          })
          .withFailureHandler((err) => showToast(String(err && err.message ? err.message : err)))
          .uploadKioskProductImage(payload);
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Kunde inte läsa bilden");
      }
    });
  });
}

function bindCatalogFilters_(root) {
  const apply = () => {
    catalogState_.filter = {
      name: (document.getElementById("kiosk-filter-name") || {}).value || "",
      price: (document.getElementById("kiosk-filter-price") || {}).value || "",
      category: (document.getElementById("kiosk-filter-category") || {}).value || "",
      status: (document.getElementById("kiosk-filter-status") || {}).value || "all"
    };
    const tbody = document.getElementById("kiosk-product-tbody");
    if (!tbody) return;
    tbody.innerHTML = catalogProductRowsHtml_(catalogCategories_());
    bindCatalogProductRows_(root);
  };
  ["kiosk-filter-name", "kiosk-filter-price"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", apply);
  });
  ["kiosk-filter-category", "kiosk-filter-status"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", apply);
  });
}

function bindCatalogTool_(root) {
  bindCatalogFilters_(root);
  bindCatalogProductRows_(root);
  const saveSettings = root.querySelector("#kiosk-settings-save");
  if (saveSettings) {
    saveSettings.addEventListener("click", () => {
      google.script.run
        .withSuccessHandler((res) => {
          if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte spara");
          showToast("Kassainställningar sparade");
          const logo = document.getElementById("kiosk-logo");
          const file = logo && logo.files && logo.files[0];
          if (!file) return loadCatalogTool_();
          fileToPayload_(file).then((payload) => {
            google.script.run.withSuccessHandler(() => loadCatalogTool_()).uploadKioskLogo(payload);
          });
        })
        .saveKioskSettings(kioskSettingsPayload_());
    });
  }
  const addCat = root.querySelector("#kiosk-add-category");
  if (addCat) {
    addCat.addEventListener("click", () => {
      const input = document.getElementById("kiosk-new-category");
      const name = String((input && input.value) || "").trim();
      if (!name) return showToast("Ange ett kategorinamn");
      const cats = ((catalogState_.settings && catalogState_.settings.categories) || []).slice();
      if (cats.some((c) => c.toLowerCase() === name.toLowerCase())) return showToast("Kategorin finns redan");
      cats.push(name);
      persistKioskCategories_(cats, "Kategori tillagd");
    });
  }
  const catInput = root.querySelector("#kiosk-new-category");
  if (catInput) {
    catInput.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      if (addCat) addCat.click();
    });
  }
  root.querySelectorAll("[data-cat-remove]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = btn.getAttribute("data-cat-remove");
      const cats = ((catalogState_.settings && catalogState_.settings.categories) || []).slice();
      if (cats.length < 2) return showToast("Minst en kategori måste finnas kvar");
      const used = (catalogState_.products || []).filter((p) => p.category === name);
      const next = cats.filter((c) => c !== name);
      const fallback = next[0];
      if (used.length) {
        if (!window.confirm(`${used.length} varor har kategorin "${name}". De flyttas till "${fallback}". Fortsätt?`)) return;
        let left = used.length;
        used.forEach((product) => {
          google.script.run
            .withSuccessHandler((res) => {
              if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte flytta vara");
              left -= 1;
              if (left === 0) persistKioskCategories_(next, "Kategori borttagen");
            })
            .saveKioskProduct({
              id: product.id,
              name: product.name,
              price: product.price,
              category: fallback,
              active: product.active,
              featured: product.featured,
              sort: product.sort
            });
        });
        return;
      }
      persistKioskCategories_(next, "Kategori borttagen");
    });
  });
  const addBtn = root.querySelector("#kiosk-new-save");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      google.script.run
        .withSuccessHandler((res) => {
          if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte lägga till");
          showToast("Tillagd");
          loadCatalogTool_();
        })
        .saveKioskProduct({
          name: document.getElementById("kiosk-new-name").value,
          price: Number(document.getElementById("kiosk-new-price").value),
          category: document.getElementById("kiosk-new-cat").value,
          active: true,
          featured: false
        });
    });
  }
}
