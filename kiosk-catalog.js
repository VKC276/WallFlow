/* Kassasortiment i WallFlow — admin / superadmin / kassör. */

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

function openCatalogTool() {
  if (!currentUser.authorized) return showLoginGate_();
  if (currentUser.firstLogin) return showToast("Byt lösenord först");
  if (!canManageKioskCatalog_()) return showToast("Saknar behörighet");
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

let catalogState_ = { products: [], settings: null, error: "", saving: false };

function loadCatalogTool_() {
  const main = document.getElementById("catalog-main");
  if (main) main.innerHTML = `<p class="admin-kicker">Kassasortiment</p><p style="color:var(--muted);">Hämtar…</p>`;
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
      renderCatalogTool_();
    })
    .withFailureHandler((err) => {
      catalogState_.error = String(err && err.message ? err.message : err);
      renderCatalogTool_();
    })
    .listKioskCatalog();
}

function renderCatalogTool_() {
  const main = document.getElementById("catalog-main");
  if (!main) return;
  const s = catalogState_.settings || {};
  const cats = s.categories || ["Övrigt"];
  const rows = (catalogState_.products || []).map((p) => `
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
          ${cats.map((c) => `<option${c === p.category ? " selected" : ""}>${escapeHtml_(c)}</option>`).join("")}
        </select>
      </td>
      <td>
        <label class="small mb-0"><input type="checkbox" data-cat-field="active" data-id="${escapeHtml_(p.id)}" ${p.active ? "checked" : ""}> Synlig</label>
        <label class="small mb-0 d-block"><input type="checkbox" data-cat-field="featured" data-id="${escapeHtml_(p.id)}" ${p.featured ? "checked" : ""}> Vanlig</label>
      </td>
      <td>
        <label class="btn btn-sm btn-ghost mb-0">Bild
          <input type="file" accept="image/*" hidden data-cat-img="${escapeHtml_(p.id)}">
        </label>
        <button class="btn btn-sm btn-ghost" type="button" data-cat-save="${escapeHtml_(p.id)}">Spara</button>
        <button class="btn btn-sm btn-outline-danger" type="button" data-cat-del="${escapeHtml_(p.id)}">Ta bort</button>
      </td>
    </tr>`).join("");
  main.innerHTML = `
    <p class="admin-kicker">Kassasortiment</p>
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
    <div class="table-responsive">
      <table class="tencard-list">
        <thead><tr><th></th><th>Namn</th><th>Pris</th><th>Kategori</th><th></th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="6" style="color:var(--muted);">Inga produkter ännu.</td></tr>`}</tbody>
      </table>
    </div>
    <h4 class="mt-4">Ny produkt</h4>
    <div class="detail-grid">
      <div class="detail-cell"><label>Namn</label><input id="kiosk-new-name" class="form-control"></div>
      <div class="detail-cell"><label>Pris</label><input id="kiosk-new-price" class="form-control" type="number" step="0.5"></div>
      <div class="detail-cell">
        <label>Kategori</label>
        <select id="kiosk-new-cat" class="form-control">${cats.map((c) => `<option>${escapeHtml_(c)}</option>`).join("")}</select>
      </div>
    </div>
    <button class="btn btn-accent mt-2" type="button" id="kiosk-new-save">Lägg till</button>
  `;
  bindCatalogTool_(main);
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
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ dataBase64: String(reader.result || ""), mimeType: file.type || "image/jpeg" });
    reader.onerror = () => reject(new Error("Kunde inte läsa filen"));
    reader.readAsDataURL(file);
  });
}

function bindCatalogTool_(root) {
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
        .saveKioskSettings({
          shopName: document.getElementById("kiosk-shop-name").value,
          swishNumber: document.getElementById("kiosk-swish").value,
          theme: document.getElementById("kiosk-theme").value,
          categories: (catalogState_.settings && catalogState_.settings.categories) || []
        });
    });
  }
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
      if (!file) return;
      const id = input.getAttribute("data-cat-img");
      const payload = await fileToPayload_(file);
      payload.id = id;
      google.script.run
        .withSuccessHandler((res) => {
          if (!res || res.ok === false) return showToast((res && res.error) || "Kunde inte ladda upp");
          showToast("Bild sparad");
          loadCatalogTool_();
        })
        .uploadKioskProductImage(payload);
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
