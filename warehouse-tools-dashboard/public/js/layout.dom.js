const shelfModal = document.getElementById("shelf-modal");
const shelfDetail = document.getElementById("shelf-detail");
const shelfTableContainer = document.getElementById("shelf-table-container");
const shelfCloseBtn = document.getElementById("shelf-close");
const layoutInfoModal = document.getElementById("layout-info-modal");
const layoutInfoOpenBtn = document.getElementById("layout-info-open");
const layoutInfoCloseBtn = document.getElementById("layout-info-close");

export function getStaticElements() {
  return {
    shelfModal,
    shelfDetail,
    shelfTableContainer,
    shelfCloseBtn,
    layoutInfoModal,
    layoutInfoOpenBtn,
    layoutInfoCloseBtn,
  };
}

export function getRowsContainer() {
  return document.getElementById("rows");
}

export function setShelfMessage(msg, isError) {
  if (!shelfDetail) return;
  shelfDetail.style.display = "block";
  shelfDetail.textContent = msg;
  shelfDetail.className = "result " + (isError ? "error" : "ok");
}

export function openModal(modal) {
  if (modal) modal.style.display = "flex";
}

export function closeModal(modal) {
  if (modal) modal.style.display = "none";
}

export function setBarcodeTargetUI(loc, level) {
  const shelfEl = document.getElementById("br-shelf");
  const targetEl = document.getElementById("br-target");

  const code = String(loc.row) + "-" + String(loc.bay).padStart(2, "0") + "-" + String(loc.side);
  const lvl = Number(level) || 1;

  if (shelfEl) shelfEl.value = code + "-L" + lvl;
  if (targetEl) targetEl.textContent = "Target: " + code + " L" + lvl;

  return {
    row: loc.row,
    bay: loc.bay,
    side: loc.side,
    preferredLevel: lvl,
    location_id: loc.location_id,
  };
}

export function ensureBarcodePanel(parent) {
  const brPanelId = "barcode-receive-panel";
  if (!parent || document.getElementById(brPanelId)) return document.getElementById(brPanelId);

  const panel = document.createElement("div");
  panel.id = brPanelId;
  panel.className = "barcode-receive-panel";
  panel.innerHTML =
    '<div class="barcode-receive-head">' +
      '<div class="barcode-receive-head-row">' +
        '<div class="barcode-receive-title">📦 Barcode Receiving</div>' +
        '<button id="br-info-btn" class="br-info-btn layout-guide-btn" type="button" aria-label="Barcode Receiving guide" title="Barcode Guide">' +
          '<span class="layout-guide-icon">ℹ️</span>' +
          '<span class="layout-guide-text">Barcode Guide</span>' +
        '</button>' +
      '</div>' +
      '<div id="br-info-modal" class="br-info-modal" style="display:none;" role="dialog" aria-modal="true" aria-label="Barcode Receiving info">' +
        '<div class="br-info-backdrop" data-br-info-close="1"></div>' +
        '<div class="br-info-card" role="document">' +
          '<div class="br-info-card-head">' +
            '<div class="br-info-card-title">Barcode Guide</div>' +
            '<button type="button" class="br-info-close" data-br-info-close="1" aria-label="Close">✕</button>' +
          '</div>' +
          '<div class="br-info-card-body">' +
            '<div class="br-info-line"><strong>Quick workflow</strong></div>' +
            '<div class="br-info-line">1) Scan or type an ISBN and Qty, then click <strong>➕ Add</strong>.</div>' +
            '<div class="br-info-line">2) (Optional) Click any cart row to <strong>select</strong> it (blue highlight).</div>' +
            '<div class="br-info-line">3) Scan a shelf label (or click a shelf level on the heatmap) to set a <strong>Target</strong>.</div>' +
            '<div class="br-info-line">4) Click <strong>✅ Commit to Shelf</strong> to place the selected items (or the full cart if nothing is selected).</div>' +
            '<div class="br-info-divider"></div>' +
            '<div class="br-info-line"><strong>Selecting items</strong></div>' +
            '<div class="br-info-line">• Click a row to toggle selection. Selected rows commit first.</div>' +
            '<div class="br-info-line">• If <em>no</em> rows are selected, committing places <strong>everything</strong> in the cart.</div>' +
            '<div class="br-info-line">• Use selection when you want to split copies of the same ISBN across different shelves.</div>' +
            '<div class="br-info-divider"></div>' +
            '<div class="br-info-line"><strong>Shelf barcode formats</strong></div>' +
            '<div class="br-info-line mono">B-02-F-L1</div>' +
            '<div class="br-info-line muted">Places on that exact shelf face + level (Levels 1–4).</div>' +
            '<div class="br-info-line mono">B-02-F</div>' +
            '<div class="br-info-line muted">Targets the shelf face. The system will pick the next available level (1–4).</div>' +
            '<div class="br-info-line muted">Tip: clicking a level on the heatmap sets the exact level automatically.</div>' +
            '<div class="br-info-divider"></div>' +
            '<div class="br-info-line"><strong>Capacity &amp; safety</strong></div>' +
            '<div class="br-info-line">• Levels 1–4 use a <strong>40-book reference</strong> per level for placement decisions and heatmap colors.</div>' +
            '<div class="br-info-line">• If your chosen level is full, items automatically go to the <strong>next available level (1–4)</strong>.</div>' +
            '<div class="br-info-line"><strong>No inventory is ever dropped.</strong> If something can’t be placed, it stays in the cart.</div>' +
            '<div class="br-info-divider"></div>' +
            '<div class="br-info-line"><strong>Manual overfill (advanced)</strong></div>' +
            '<div class="br-info-line">• Hold <strong>SHIFT</strong> while clicking <strong>✅ Commit to Shelf</strong> to intentionally overfill.</div>' +
            '<div class="br-info-line muted">Use this only when you physically know the shelf can take more than the 40-book reference.</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="barcode-receive-body">' +
      '<div class="barcode-row barcode-row-top">' +
        '<div class="barcode-col">' +
          '<label class="barcode-label">ISBN</label>' +
          '<input id="br-isbn" class="barcode-input" placeholder="Scan or type ISBN" autocomplete="off" />' +
        '</div>' +
        '<div class="barcode-col qty">' +
          '<label class="barcode-label">Qty</label>' +
          '<input id="br-qty" class="barcode-input" type="number" min="1" value="1" />' +
        '</div>' +
        '<div class="barcode-col actions">' +
          '<button id="br-add" class="btn btn-small pl-touch" type="button">➕ Add</button>' +
        '</div>' +
      '</div>' +
      '<div class="barcode-cart" id="br-cart"></div>' +
      '<div class="barcode-row">' +
        '<div class="barcode-col">' +
          '<label class="barcode-label">Shelf Barcode (or click shelf on map)</label>' +
          '<input id="br-shelf" class="barcode-input" placeholder="Scan shelf (e.g., B-02-F or B-02-F-L1) or click a shelf" autocomplete="off" />' +
          '<div id="br-target" class="br-target">Target: none</div>' +
        '</div>' +
        '<button id="br-commit" class="btn btn-small pl-touch" type="button">✅ Commit to Shelf</button>' +
      '</div>' +
      '<div class="barcode-status" id="br-status"></div>' +
    '</div>';

  parent.insertBefore(panel, parent.firstChild);
  return panel;
}

export function ensureReceiveOverflowBanner(parent, container) {
  const receiveBannerId = "receive-overflow-banner";
  if (!parent || document.getElementById(receiveBannerId)) return document.getElementById(receiveBannerId);

  const banner = document.createElement("div");
  banner.id = receiveBannerId;
  banner.className = "receive-overflow-banner";
  banner.style.display = "none";
  banner.innerHTML =
    '<div class="receive-overflow-head">' +
      '<div class="receive-overflow-title">⚠️ Receive created overflow</div>' +
      '<button class="btn btn-small secondary" type="button" id="receive-overflow-dismiss">Dismiss</button>' +
    '</div>' +
    '<div class="receive-overflow-body"></div>';

  parent.insertBefore(banner, container);
  return banner;
}

export function ensureOverflowPanel(parent, container, toolbarId) {
  const overflowPanelId = "overflow-panel";
  if (!parent || document.getElementById(overflowPanelId)) return document.getElementById(overflowPanelId);

  const panel = document.createElement("div");
  panel.id = overflowPanelId;
  panel.className = "overflow-panel";
  panel.innerHTML =
    '<div class="overflow-panel-head">' +
      '<div class="overflow-panel-title">🔎 Lookup ISBN</div>' +
      '<div class="overflow-panel-sub"></div>' +
    '</div>' +
    '<div class="overflow-panel-body">' +
      '<label for="lookup-isbn" style="margin-top:0;">ISBN</label>' +
      '<input id="lookup-isbn" placeholder="Scan or type ISBN — Find exactly where a book lives" />' +
      '<button id="lookupBtn" class="btn secondary" type="button">🔎 Find Locations</button>' +
      '<div id="lookup-result" class="result" style="display:none;"></div>' +
      '<div id="lookup-table-container"></div>' +
    '</div>';

  const toolbarEl = document.getElementById(toolbarId);
  if (toolbarEl) parent.insertBefore(panel, toolbarEl);
  else parent.insertBefore(panel, container);

  return panel;
}

export function ensureHeatmapToolbar(parent, container, toolbarId, legendId) {
  if (!parent || document.getElementById(toolbarId)) return document.getElementById(toolbarId);

  const bar = document.createElement("div");
  bar.id = toolbarId;
  bar.className = "heatmap-toolbar";

  const btn = document.createElement("div");
  btn.className = "muted";
  btn.id = "heatmap-toggle-btn";
  btn.textContent = "🔥 Heatmap: AUTO";

  const legend = document.createElement("div");
  legend.id = legendId;
  legend.className = "heatmap-legend";

  bar.appendChild(btn);
  bar.appendChild(legend);

  parent.insertBefore(bar, container);
  return bar;
}

export function updateHeatmapLegend(legendEl) {
  if (!legendEl) return;
  legendEl.innerHTML =
    '<span class="legend-item"><span class="legend-swatch heat-low"></span>Green 0–13</span>' +
    '<span class="legend-item"><span class="legend-swatch heat-mid"></span>Yellow 14–26</span>' +
    '<span class="legend-item"><span class="legend-swatch heat-crit"></span>Red 27+</span>' +
    '<span class="legend-item"><span class="legend-swatch" style="background:#e5e7eb;"></span>Level 5 = Blowout</span>';
}

export function renderOverflowPanelContent(panel, { globalOverflow = [], alerts = [], blowoutHotspots = [] } = {}) {
  const body = panel ? panel.querySelector(".overflow-panel-body") : null;
  if (!body) return null;

  // This panel is now used for Lookup ISBN. Do not overwrite its contents.
  if (panel.querySelector("#lookup-isbn")) return null;

  // Defensive: endpoints may return objects; normalize to arrays
  const ovList = Array.isArray(globalOverflow)
    ? globalOverflow
    : globalOverflow && Array.isArray(globalOverflow.items)
      ? globalOverflow.items
      : [];

  const alertList = Array.isArray(alerts)
    ? alerts
    : alerts && Array.isArray(alerts.items)
      ? alerts.items
      : [];

  const blowoutList = Array.isArray(blowoutHotspots)
    ? blowoutHotspots
    : blowoutHotspots && Array.isArray(blowoutHotspots.items)
      ? blowoutHotspots.items
      : [];

  const overflowRows = ovList.slice(0, 10)
    .map((o) => {
      const isbn = o && o.isbn != null ? String(o.isbn) : "";
      const qty = o && o.quantity != null ? Number(o.quantity) : 0;
      return (
        '<div class="overflow-row">' +
          '<span class="mono">' + isbn + '</span>' +
          '<span class="overflow-qty">' + qty + '</span>' +
          '<button class="btn btn-small secondary" type="button" data-assign-overflow="1" data-isbn="' + isbn + '" data-qty="' + qty + '">Assign</button>' +
        '</div>'
      );
    })
    .join("");

  const alertRows = alertList.slice(0, 10)
    .map((a) => {
      const code = a && a.location_code != null ? String(a.location_code) : "";
      const percent = a && a.percent_full != null ? Number(a.percent_full) : 0;
      return '<div class="alert-row"><span class="mono">' + code + '</span><span class="alert-pill">' + percent + '%</span></div>';
    })
    .join("");

  const blowoutRows = blowoutList.slice(0, 10)
    .map((b) => {
      const code = b && b.location_code != null ? String(b.location_code) : "";
      const qty = b && b.quantity != null ? Number(b.quantity) : 0;
      return '<div class="blowout-row"><span class="mono">' + code + '</span><span class="blowout-qty">L5 ' + qty + '</span></div>';
    })
    .join("");

  body.innerHTML =
    '<div class="overflow-grid">' +
      '<div class="overflow-col">' +
        '<div class="overflow-col-title">Unassigned Overflow</div>' +
        (overflowRows || '<div class="muted">None 🎉</div>') +
      '</div>' +
      '<div class="overflow-col">' +
        '<div class="overflow-col-title">Shelves Near Capacity</div>' +
        (alertRows || '<div class="muted">None</div>') +
      '</div>' +
      '<div class="overflow-col">' +
        '<div class="overflow-col-title">Blowout Hotspots (L5)</div>' +
        (blowoutRows || '<div class="muted">None</div>') +
      '</div>' +
    '</div>';

  return body;
}

export function renderReceiveOverflowBannerContent(banner, { isbn, overflowQty, suggestions }) {
  const body = banner ? banner.querySelector(".receive-overflow-body") : null;
  if (!body) return null;

  let html = "";
  html += '<div class="receive-overflow-msg">' +
    '<strong>' + overflowQty + '</strong> copies of <span class="mono">' + isbn + '</span> didn\'t fit on Levels 1–4.' +
    ' Blowout is <strong>manual</strong> — here are suggested shelf faces with space:</div>';

  html +=
    '<div class="receive-overflow-actions">' +
      '<button class="btn btn-small pl-touch" type="button" data-apply-suggestions="1" data-isbn="' + isbn + '">✅ Assign suggested blowout</button>' +
      '<button class="btn btn-small secondary pl-touch" type="button" data-leave-unassigned="1">Leave unassigned</button>' +
    '</div>';

  if (!suggestions.length) {
    html += '<div class="muted">No blowout suggestions available.</div>';
  } else {
    html += '<div class="receive-overflow-suggestions">';
    for (const s of suggestions.slice(0, 8)) {
      const code = String(s.location_code || "");
      const qty = Number(s.quantity || 0);
      const locId = s.location_id;
      html +=
        '<div class="receive-overflow-sugg">' +
          '<div class="mono">' + code + '</div>' +
          '<div class="receive-overflow-sugg-right">' +
            '<span class="receive-overflow-qty">' + qty + '</span>' +
            '<button class="btn btn-small pl-touch" type="button" data-open-suggested="1" data-loc-id="' + locId + '" data-qty="' + qty + '" data-isbn="' + isbn + '">Open</button>' +
          '</div>' +
        '</div>';
    }
    html += '</div>';
  }

  body.innerHTML = html;
  return body;
}

export function renderCart(cartEl, cart) {
  if (!cartEl) return;
  if (!cart.length) {
    cartEl.innerHTML = '<div class="muted">Cart empty — scan an ISBN to start.</div>';
    return;
  }
  cartEl.innerHTML = cart
    .map((it, idx) =>
      '<div class="barcode-cart-row ' + (it.selected ? "selected" : "") + '" data-br-select="' + idx + '">' +
        '<div class="barcode-cart-isbn mono">' + String(it.isbn) + '</div>' +
        '<div class="barcode-cart-qty">' + Number(it.qty || 0) + '</div>' +
        '<div class="barcode-cart-actions">' +
          '<button class="btn btn-small secondary" type="button" data-br-remove="' + idx + '">Remove</button>' +
        '</div>' +
      '</div>'
    )
    .join("");
}

export function setBarcodeStatus(el, msg, isError) {
  if (!el) return;
  el.textContent = msg || "";
  el.className = "barcode-status " + (isError ? "error" : "ok");
}

export function getBarcodePanelElements() {
  return {
    isbnEl: document.getElementById("br-isbn"),
    qtyEl: document.getElementById("br-qty"),
    addBtn: document.getElementById("br-add"),
    shelfEl: document.getElementById("br-shelf"),
    commitBtn: document.getElementById("br-commit"),
    cartEl: document.getElementById("br-cart"),
    statusEl: document.getElementById("br-status"),
    infoBtn: document.getElementById("br-info-btn"),
    infoModal: document.getElementById("br-info-modal"),
  };
}

export function getLookupPanelElements(panel) {
  if (!panel) return {};
  return {
    lookupIsbnEl: panel.querySelector("#lookup-isbn"),
    lookupBtn: panel.querySelector("#lookupBtn"),
    lookupResultEl: panel.querySelector("#lookup-result"),
    lookupTableContainer: panel.querySelector("#lookup-table-container"),
  };
}

export function ensureBarcodeStyles() {
  const styleId = "barcode-cart-row-selected-style";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
.barcode-cart {
  margin-top: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 10px;
  overflow: hidden;
  background: #ffffff;
}

.barcode-cart-row {
  display: grid;
  grid-template-columns: 1fr 60px auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  font-size: 13px;
  border-bottom: 1px solid #f1f5f9;
  cursor: pointer;
}

.barcode-cart-row:last-child {
  border-bottom: none;
}

.barcode-cart-row:hover {
  background: #f8fafc;
}

.barcode-cart-row.selected {
  background: #e0f2fe;
  border-left: 4px solid #0284c7;
}

.barcode-cart-isbn {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.barcode-cart-qty {
  text-align: center;
  font-weight: 600;
}

.barcode-cart-actions {
  display: flex;
  justify-content: flex-end;
}

.barcode-cart-actions .btn {
  padding: 4px 8px;
  font-size: 11px;
}

.barcode-receive-panel {
  margin-bottom: 16px;
}

.barcode-receive-head {
  padding-bottom: 6px;
}

.barcode-receive-title {
  font-size: 15px;
  font-weight: 600;
}

.barcode-receive-sub {
  font-size: 12px;
  color: #6b7280;
}

.barcode-row {
  align-items: flex-end;
  gap: 8px;
}

.barcode-label {
  font-size: 11px;
  color: #6b7280;
}

.barcode-input {
  height: 34px;
  font-size: 13px;
}

.br-target {
  font-size: 12px;
  margin-top: 4px;
  color: #374151;
}

.barcode-status {
  margin-top: 6px;
  font-size: 12px;
}
 
.barcode-receive-note {
  margin-top: 6px;
  font-size: 12px;
  color: #6b7280;
  line-height: 1.4;
}
`;
  // --- PATCH: Stack Barcode Guide above Add button, aligned top-right ---
  // (No longer needed, but keep .actions column aligned right)
  style.textContent += `
.barcode-row-top .actions {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
}
`;
  // --- Header alignment: title left, guide button right ---
  style.textContent += `
/* Header alignment: title left, guide button right */
.barcode-receive-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
`;
  // --- Popover styles for Barcode Receiving info ---
  style.textContent += `
.barcode-receive-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.br-info-btn {
  border: 1px solid #e5e7eb;
  background: #ffffff;
  border-radius: 999px;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.br-info-btn:hover {
  background: #f8fafc;
}

.br-info-popover {
  margin-top: 8px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  padding: 10px 12px;
  box-shadow: 0 10px 25px rgba(0,0,0,0.08);
  max-width: 520px;
}

.br-info-popover-inner {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.br-info-line {
  font-size: 12px;
  color: #374151;
  line-height: 1.4;
}
  .br-info-divider {
  height: 1px;
  background: #f1f5f9;
  margin: 6px 0;
}

.br-info-line.mono,
.br-info-card-body .mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}
      `;
  // --- Modal overlay styles for Barcode Receiving info (appended after popover styles) ---
  style.textContent += `
/* Modal overlay version of Barcode Receiving info */
.br-info-modal {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: none; /* toggled to flex */
  align-items: center;
  justify-content: center;
  padding: 20px;
}

.br-info-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(17, 24, 39, 0.35);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}

.br-info-card {
  position: relative;
  z-index: 1;
  width: min(560px, calc(100vw - 40px));
  border: 1px solid #e5e7eb;
  border-radius: 14px;
  background: #ffffff;
  box-shadow: 0 20px 60px rgba(0,0,0,0.20);
  overflow: hidden;
}

.br-info-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid #f1f5f9;
}

.br-info-card-title {
  font-size: 14px;
  font-weight: 700;
  color: #111827;
}

.br-info-card-body {
  padding: 12px 14px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.br-info-close {
  border: 1px solid #e5e7eb;
  background: #ffffff;
  border-radius: 10px;
  width: 34px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.br-info-close:hover {
  background: #f8fafc;
}
      `;
  // --- PATCHED: Move Barcode Receiving info button to top-right and modal blur for all .modal-backdrop ---
  style.textContent += `
/* Keep Barcode Guide button aligned like Layout Guide (top-right within the header row) */
.barcode-receive-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
`;
  // --- Barcode Guide button: match Layout Guide pill style (override earlier icon-only styles) ---
  style.textContent += `
/* Barcode Guide button: match Layout Guide pill style (override earlier icon-only styles) */
.br-info-btn.layout-guide-btn {
  width: auto;
  height: auto;
  border-radius: 999px;
  padding: 8px 12px;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  border: 1px solid #e5e7eb;
  background: #f1f5f9;
  color: #111827;
  font-size: 12px;
}

.br-info-btn.layout-guide-btn:hover {
  background: #e5e7eb;
}

/* Make the ℹ️ look like the Layout Guide icon badge */
.br-info-btn.layout-guide-btn .layout-guide-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: #e5e7eb;
  border: 1px solid #d1d5db;
  font-size: 12px;
  line-height: 1;
}

.br-info-btn.layout-guide-btn .layout-guide-text {
  font-weight: 600;
}
`;
  style.textContent += `
/* Blur/dim backdrop for existing modals (Layout Guide, Shelf modal, etc.) */
.modal-backdrop {
  background: rgba(17, 24, 39, 0.35) !important;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
`;
  style.textContent += `
/* Match Layout Guide button style */
.layout-guide-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  font-size: 12px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: #ffffff;
  color: #374151;
}

.layout-guide-btn:hover {
  background: #f8fafc;
}

.layout-guide-icon {
  font-size: 13px;
  line-height: 1;
}

.layout-guide-text {
  font-weight: 500;
}
`;
  style.textContent += `
/* Ensure Barcode Guide stays top-right on the same header line (no wrap) */
.barcode-receive-head-row {
  flex-wrap: nowrap;
}

/* Nudge Barcode Guide up slightly while keeping it right-aligned */
.br-info-btn.layout-guide-btn {
  margin-left: auto;
  align-self: flex-start;
  margin-top: -6px;
}

/* Anchor Barcode Guide to the panel's top-right corner (match Layout Guide corner placement) */
.barcode-receive-panel {
  position: relative;
}

#br-info-btn.br-info-btn.layout-guide-btn {
  position: absolute;
  top: 10px;
  right: 14px;
  margin: 0;          /* override previous margin-left/margin-top */
  align-self: auto;   /* override previous align-self */
  z-index: 2;
}

/* Ensure header content doesn't collide with the corner button */
.barcode-receive-head {
  padding-right: 170px; /* room for the pill button */
}
`;

  document.head.appendChild(style);
}

export function ensureLayoutPolishStyles() {
  const styleId = "wms-layout-polish";
  if (document.getElementById(styleId)) return;

  const style = document.createElement("style");
  style.id = styleId;
  style.textContent = `
      /* Lookup ISBN panel */
.overflow-panel {
  margin-bottom: 14px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
}

.overflow-panel-head {
  padding: 10px 14px 6px;
  border-bottom: 1px solid #f1f5f9;
}

.overflow-panel-title {
  font-size: 14px;
  font-weight: 600;
}

.overflow-panel-sub {
  font-size: 12px;
  color: #6b7280;
}

.overflow-panel-body {
  padding: 10px 14px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

#lookup-isbn {
  height: 34px;
  font-size: 13px;
  border-radius: 8px;
}

#lookupBtn {
  align-self: flex-start;
  margin-top: 4px;
}

#lookup-result {
  font-size: 12px;
}
/* Warehouse Layout header */
.heatmap-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 14px;
  border: 1px solid #e5e7eb;
  border-radius: 12px;
  background: #ffffff;
  margin-bottom: 12px;
}

.heatmap-toolbar .muted {
  font-size: 14px;
  font-weight: 600;
  color: #111827;
}
`;
  document.head.appendChild(style);
}

export function appendLayoutGuideLine() {
  if (!layoutInfoModal) return;

  let guideBody = layoutInfoModal.querySelector(".modal-body");
  if (!guideBody) {
    const divs = Array.from(layoutInfoModal.querySelectorAll("div"));
    if (divs.length > 0) guideBody = divs[divs.length - 1];
  }
  if (guideBody && !guideBody.__appendedGuideLine) {
    const usesP = !!guideBody.querySelector("p");
    const line = usesP ? document.createElement("p") : document.createElement("div");
    line.className = "muted";
    line.style.marginTop = "10px";
    guideBody.appendChild(line);
    guideBody.__appendedGuideLine = true;
  }
}
