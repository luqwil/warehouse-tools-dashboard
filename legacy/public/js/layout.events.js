import {
  LEVEL_SOFT_CAP,
  heatClassForRatio,
  applyHeatmapClass,
  chooseNextAvailableLevelByQty,
  normalizeHighlightLocations,
} from "./layout.logic.js";
import {
  getStaticElements,
  getRowsContainer,
  setShelfMessage,
  openModal,
  closeModal,
  setBarcodeTargetUI,
  ensureBarcodePanel,
  ensureReceiveOverflowBanner,
  ensureOverflowPanel,
  ensureHeatmapToolbar,
  updateHeatmapLegend,
  renderOverflowPanelContent,
  renderReceiveOverflowBannerContent,
  renderCart,
  setBarcodeStatus,
  getBarcodePanelElements,
  getLookupPanelElements,
  ensureBarcodeStyles,
  ensureLayoutPolishStyles,
  appendLayoutGuideLine,
} from "./layout.dom.js";
import {
  fetchLayout,
  fetchShelf,
  fetchItemLocations,
  fetchGlobalOverflow,
  fetchSummary,
  shipFromShelf,
  assignToBlowout,
  assignOverflowToBlowout,
  putToShelf,
  enrichLocationsWithLevels,
  findIsbnAcrossAllShelves,
} from "./layout.api.js";

const toolbarId = "heatmap-toolbar";
const legendId = "heatmap-legend";

let blowoutTotalsByLocation = {};
let normalLevelTotalsByLocation = {};

const highlightParams = new URLSearchParams(window.location.search);
const highlightRow = highlightParams.get("highlight_row");
const highlightBay = highlightParams.get("highlight_bay");
const highlightSide = highlightParams.get("highlight_side");

function maybeHighlightAfterRender() {
  if (!highlightRow || !highlightBay || !highlightSide) return;

  const baySelector =
    '[data-row="' + highlightRow + '"][data-bay="' + highlightBay + '"]';
  const bayEl = document.querySelector(baySelector);
  if (!bayEl) return;

  bayEl.classList.add("highlight-bay");
  bayEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

  const sideCells = bayEl.querySelectorAll(
    '[data-side="' + highlightSide + '"] .cell:not(.blowout)'
  );
  sideCells.forEach((c) => c.classList.add("highlight-cell"));

  window.setTimeout(() => {
    bayEl.classList.remove("highlight-bay");
    sideCells.forEach((c) => c.classList.remove("highlight-cell"));
  }, 4500);
}

function wmsBindLookupPanelOnce() {
  const panel = document.getElementById("overflow-panel");
  if (!panel) return;

  if (panel.dataset.lookupBound === "1") return;

  const { lookupIsbnEl, lookupBtn, lookupResultEl, lookupTableContainer } = getLookupPanelElements(panel);
  if (!lookupIsbnEl || !lookupBtn || !lookupResultEl || !lookupTableContainer) return;

  panel.dataset.lookupBound = "1";

  function showLookupResult(el, msg, ok) {
    if (!el) return;
    el.style.display = "block";
    el.textContent = msg || "";
    el.className = "result " + (ok ? "ok" : "error");
  }

  async function doLookup() {
    const isbn = String(lookupIsbnEl.value || "").trim();
    if (!isbn) {
      showLookupResult(lookupResultEl, "Please scan or enter an ISBN to lookup.", false);
      lookupTableContainer.innerHTML = "";
      return;
    }

    lookupBtn.disabled = true;
    const originalText = lookupBtn.textContent;
    lookupBtn.textContent = "Working…";

    try {
      const { res, data, raw } = await fetchItemLocations(isbn);
      console.log("[WMS lookup] status=", res.status, "data=", data);

      if (!res.ok) {
        showLookupResult(
          lookupResultEl,
          data && data.message ? data.message : "Lookup failed (" + res.status + "). " + (raw ? raw.slice(0, 200) : ""),
          false
        );
        lookupTableContainer.innerHTML = "";
        return;
      }

      const locs = Array.isArray(data && data.locations) ? data.locations : [];
      const total = Number((data && data.total) || 0);

      showLookupResult(
        lookupResultEl,
        "Found " + total + " copies of " + isbn + " across " + locs.length + " shelf face(s). Jumping to the main shelf now…",
        true
      );

      if (!locs.length) {
        showLookupResult(
          lookupResultEl,
          "No locations returned by server. Searching all shelves (A–D) now…",
          true
        );

        const scanned = await findIsbnAcrossAllShelves(isbn, {
          layout: window.__wms_layout_cache,
          onProgress: (current, totalCount) => {
            try {
              if (lookupBtn) lookupBtn.textContent = "Searching shelves… " + current + "/" + totalCount;
            } catch {
              // ignore
            }
          },
        });

        if (!scanned.length) {
          lookupTableContainer.innerHTML = '<div class="muted" style="margin-top:10px;">No locations found.</div>';
          showLookupResult(lookupResultEl, "No copies of " + isbn + " were found on any shelf.", false);
          return;
        }

        data.locations = scanned;
        locs.length = 0;
        scanned.forEach((x) => locs.push(x));

        showLookupResult(
          lookupResultEl,
          "Found " + scanned.length + " shelf level hit(s) for " + isbn + " across rows A–D. Highlighting now…",
          true
        );
      }

      const primary = locs
        .slice()
        .sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0))[0] || locs[0];

      const row = String(primary.row || "").toUpperCase();
      const bayNum = Number(primary.bay);
      const bay = String(Number.isNaN(bayNum) ? (primary.bay || "") : bayNum);
      const side = String(primary.side || "").toUpperCase().charAt(0);
      const level = Number(primary.level || 1);

      lookupTableContainer.innerHTML = "";

      if (typeof window.closeShelfModal === "function") {
        window.closeShelfModal();
      } else {
        const sm = document.getElementById("shelf-modal");
        if (sm) sm.style.display = "none";
      }
      window.__wms_skip_scroll_restore = true;

      if (typeof window.highlightShelves === "function") {
        const needsEnrich = locs.some((l) => {
          if (!l) return true;
          if (l.level != null) return false;
          if (Array.isArray(l.levels) && l.levels.length) return false;
          if (l.level1 != null || l.level2 != null || l.level3 != null || l.level4 != null) return false;
          const code = String(l.location_code || l.location || l.code || "").toUpperCase();
          if (/-L[1-4]$/.test(code)) return false;
          return true;
        });

        if (needsEnrich) {
          const enriched = await enrichLocationsWithLevels(isbn, locs);
          if (enriched.length) {
            locs.length = 0;
            enriched.forEach((x) => locs.push(x));
          }
        }

        window.highlightShelves(locs);
      } else if (typeof window.highlightShelf === "function") {
        window.highlightShelf(row, bay, side, level);
      } else if (typeof window.highlightBay === "function") {
        window.highlightBay(row, bay, side);
      }

      window.setTimeout(() => {
        window.__wms_skip_scroll_restore = false;
      }, 250);

      const code = primary.location_code || row + "-" + String(bay).padStart(2, "0") + "-" + side;
      const hint = document.createElement("div");
      hint.className = "muted";
      hint.style.marginTop = "10px";
      hint.textContent = "Jumped to " + code + " • Level " + level + ". (Click the highlighted shelf to open contents.)";
      lookupTableContainer.appendChild(hint);
    } catch (err) {
      console.error(err);
      showLookupResult(lookupResultEl, "Network or server error while looking up ISBN.", false);
      lookupTableContainer.innerHTML = "";
    } finally {
      lookupBtn.disabled = false;
      lookupBtn.textContent = originalText || "🔎 Find Locations";
    }
  }

  lookupBtn.addEventListener("click", doLookup);
  lookupIsbnEl.addEventListener("focus", () => {
    try {
      lookupIsbnEl.select();
    } catch {
      // ignore
    }
  });
  lookupIsbnEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      doLookup();
    }
  });
}

function bindModalEvents() {
  const { shelfModal, shelfCloseBtn, layoutInfoModal, layoutInfoOpenBtn, layoutInfoCloseBtn } = getStaticElements();

  if (shelfCloseBtn) {
    shelfCloseBtn.addEventListener("click", () => closeModal(shelfModal));
  }

  if (shelfModal) {
    shelfModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) {
        closeModal(shelfModal);
      }
    });
  }

  if (layoutInfoOpenBtn) {
    layoutInfoOpenBtn.addEventListener("click", () => openModal(layoutInfoModal));
  }

  if (layoutInfoCloseBtn) {
    layoutInfoCloseBtn.addEventListener("click", () => closeModal(layoutInfoModal));
  }

  if (layoutInfoModal) {
    layoutInfoModal.addEventListener("click", (e) => {
      if (e.target.classList.contains("modal-backdrop")) {
        closeModal(layoutInfoModal);
      }
    });
  }
}

function bindBarcodePanelOnce(panel) {
  if (!panel || panel.dataset.barcodeBound === "1") return;

  panel.dataset.barcodeBound = "1";

  const { isbnEl, qtyEl, addBtn, shelfEl, commitBtn, cartEl, statusEl, infoBtn, infoModal } = getBarcodePanelElements();
  if (!cartEl || !statusEl) return;

  function renderCartWithHandlers() {
    const cart = window.__wms_barcode_cart || [];
    renderCart(cartEl, cart);

    cartEl.onclick = (e) => {
      const row = e.target.closest("[data-br-select]");
      if (row) {
        const i = Number(row.getAttribute("data-br-select"));
        if (!Number.isNaN(i) && window.__wms_barcode_cart[i]) {
          window.__wms_barcode_cart[i].selected = !window.__wms_barcode_cart[i].selected;
          renderCartWithHandlers();
        }
        return;
      }
      const btn = e.target && e.target.closest ? e.target.closest("[data-br-remove]") : null;
      if (!btn) return;
      const i = Number(btn.getAttribute("data-br-remove"));
      if (Number.isNaN(i)) return;
      const next = (window.__wms_barcode_cart || []).filter((_, j) => j !== i);
      window.__wms_barcode_cart = next;
      renderCartWithHandlers();
    };
  }

  function setStatus(msg, isError) {
    setBarcodeStatus(statusEl, msg, isError);
  }

  renderCartWithHandlers();

  function closeInfoModal() {
    if (!infoModal) return;
    infoModal.style.display = "none";
  }

  function openInfoModal() {
    if (!infoModal) return;
    infoModal.style.display = "flex";
    try {
      infoBtn && infoBtn.focus({ preventScroll: true });
    } catch {
      // ignore
    }
  }

  if (infoBtn) {
    infoBtn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openInfoModal();
    });
  }

  if (infoModal) {
    infoModal.addEventListener("click", (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('[data-br-info-close="1"]')) {
        e.preventDefault();
        closeInfoModal();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeInfoModal();
  });

  function addToCart() {
    const isbn = isbnEl ? String(isbnEl.value || "").trim() : "";
    const qty = qtyEl ? Number(qtyEl.value) : 0;
    if (!isbn) {
      setStatus("Scan an ISBN first.", true);
      return;
    }
    if (!qty || Number.isNaN(qty) || qty <= 0) {
      setStatus("Qty must be positive.", true);
      return;
    }

    const cart = window.__wms_barcode_cart || [];
    const existing = cart.find((x) => x.isbn === isbn);
    if (existing) {
      existing.qty = Number(existing.qty || 0) + qty;
    } else {
      cart.push({ isbn, qty, selected: false });
    }
    window.__wms_barcode_cart = cart;

    if (isbnEl) isbnEl.value = "";
    if (qtyEl) qtyEl.value = "1";
    setStatus("Added to cart. Now scan shelf label to commit.", false);
    renderCartWithHandlers();
    if (isbnEl) {
      try {
        isbnEl.focus({ preventScroll: true });
      } catch {
        isbnEl.focus();
      }
    }
  }

  async function commitToShelf() {
    const rawShelf = shelfEl ? String(shelfEl.value || "").trim().toUpperCase() : "";

    let target = window.__wms_barcode_target || null;
    let row = null;
    let bay = null;
    let side = null;
    let preferredLevel = null;

    if (rawShelf) {
      let m = rawShelf.match(/^([A-D])-(\d{1,2})-(F|B)-L([1-4])$/);
      if (m) {
        row = m[1];
        bay = Number(m[2]);
        side = m[3];
        preferredLevel = Number(m[4]);
        target = null;
      } else {
        m = rawShelf.match(/^([A-D])-(\d{1,2})-(F|B)$/);
        if (m) {
          row = m[1];
          bay = Number(m[2]);
          side = m[3];
          preferredLevel = 1;
          target = null;
        }
      }
    }

    if (target && !row) {
      row = target.row;
      bay = Number(target.bay);
      side = target.side;
      preferredLevel = Number(target.preferredLevel || 1);
    }

    if (!row || !bay || !side) {
      setStatus("Scan a shelf (B-02-F or B-02-F-L1) or click a shelf level on the map first.", true);
      return;
    }

    let locationId = target ? target.location_id : null;
    if (!locationId && Array.isArray(window.__wms_layout_cache)) {
      const found = window.__wms_layout_cache.find((l) => l.row === row && Number(l.bay) === Number(bay) && l.side === side);
      if (found) locationId = found.location_id;
    }

    if (!locationId) {
      setStatus("Could not resolve shelf target. Try clicking the shelf on the map.", true);
      return;
    }

    const allowOverfill = !!window.__wms_allow_overfill;
    const chosenLevel = allowOverfill
      ? Math.max(1, Math.min(4, Number(preferredLevel) || 1))
      : chooseNextAvailableLevelByQty(locationId, preferredLevel, normalLevelTotalsByLocation);

    if (!chosenLevel) {
      setStatus("This shelf face is at/over the 40-book reference on all levels. Pick another shelf, or hold SHIFT while committing to overfill intentionally.", true);
      return;
    }

    if (!allowOverfill && chosenLevel == null) {
      return;
    }

    const code = row + "-" + String(bay).padStart(2, "0") + "-" + side + "-L" + chosenLevel;
    if (shelfEl) shelfEl.value = code;
    const targetEl = document.getElementById("br-target");
    if (targetEl) targetEl.textContent = "Target: " + row + "-" + String(bay).padStart(2, "0") + "-" + side + " L" + chosenLevel;

    const cart = window.__wms_barcode_cart || [];
    const selected = cart.filter((x) => x.selected);
    const linesToCommit = selected.length ? selected : cart;
    if (!cart.length) {
      setStatus("Cart is empty. Add ISBNs first.", true);
      return;
    }
    if (!linesToCommit.length) {
      setStatus("No items selected to commit.", true);
      return;
    }

    window.__wms_skip_scroll_restore = false;
    window.__wms_lock_scroll_during_receive = true;
    commitBtn.disabled = true;
    const originalText = commitBtn.textContent;
    commitBtn.textContent = "Working…";

    try {
      const nextCart = [];
      for (const line of linesToCommit) {
        const { res, data } = await putToShelf({
          isbn: line.isbn,
          quantity: Number(line.qty || 0),
          row,
          bay,
          side,
          level: chosenLevel,
          allow_overfill: !!window.__wms_allow_overfill,
        });

        const d = data || {};
        const requestedQty = Number(line.qty || 0);

        if (!res.ok) {
          setStatus(d.message || ("Shelf is full — " + line.isbn + " was NOT placed. Choose another shelf."), true);
          nextCart.push({ isbn: line.isbn, qty: requestedQty, selected: true });
          continue;
        }

        const placed = Number(d.placed || 0);
        let remaining = Number(d.remaining);

        if (!Number.isFinite(remaining)) {
          remaining = Math.max(0, requestedQty - Math.max(0, placed));
        }

        if (placed <= 0) {
          setStatus(
            d.message ? String(d.message) : "Shelf is full — " + line.isbn + " was NOT placed. Choose another shelf.",
            true
          );
          nextCart.push({ isbn: line.isbn, qty: requestedQty, selected: true });
          continue;
        }

        if (remaining > 0) {
          nextCart.push({ isbn: line.isbn, qty: remaining, selected: line.selected || false });
        }

        setStatus(
          "Shelf " + row + "-" + String(bay).padStart(2, "0") + "-" + side + "-L" + chosenLevel + ": " + line.isbn +
            " → placed " + placed + (remaining > 0 ? " • remaining " + remaining : ""),
          false
        );
      }

      const untouched = cart.filter((x) => !linesToCommit.includes(x));
      window.__wms_barcode_cart = untouched.concat(nextCart);
      renderCartWithHandlers();

      if (typeof window.loadLayout === "function") window.loadLayout();
    } catch (err) {
      console.error(err);
      setStatus("Network/server error while committing to shelf.", true);
    } finally {
      commitBtn.disabled = false;
      commitBtn.textContent = originalText || "✅ Commit to Shelf";
      if (shelfEl) {
        try {
          shelfEl.focus({ preventScroll: true });
        } catch {
          shelfEl.focus();
        }
      }
      window.__wms_lock_scroll_during_receive = false;
    }
  }

  if (addBtn) addBtn.addEventListener("click", addToCart);
  if (commitBtn) {
    commitBtn.addEventListener("click", (e) => {
      window.__wms_allow_overfill = !!(e && e.shiftKey);
      commitToShelf();
    });
  }

  if (isbnEl) {
    isbnEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        addToCart();
      }
    });
  }
  if (shelfEl) {
    shelfEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitToShelf();
      }
    });
  }
}

async function prefetchShelfTotals(layout) {
  blowoutTotalsByLocation = {};
  normalLevelTotalsByLocation = {};

  for (const l of layout) {
    try {
      const { res, data } = await fetchShelf(l.row, l.bay, l.side);
      if (!res.ok || !data || !data.location) continue;

      const locId = data.location.location_id;

      const bo = Number(data.blowout_total || 0);
      if (bo > 0) {
        blowoutTotalsByLocation[locId] = bo;
      }

      const levelItems = Array.isArray(data.level_items) ? data.level_items : [];
      if (levelItems.length) {
        const totals = { 1: 0, 2: 0, 3: 0, 4: 0 };
        for (const it of levelItems) {
          totals[1] += Number(it.level1 || 0);
          totals[2] += Number(it.level2 || 0);
          totals[3] += Number(it.level3 || 0);
          totals[4] += Number(it.level4 || 0);
        }
        normalLevelTotalsByLocation[locId] = totals;
      } else {
        normalLevelTotalsByLocation[locId] = { 1: 0, 2: 0, 3: 0, 4: 0 };
      }
    } catch {
      // ignore individual shelf failures; grid should still render
    }
  }
}

function renderOverflowPanel({ globalOverflow = [], alerts = [], blowoutHotspots = [] } = {}) {
  const panel = document.getElementById("overflow-panel");
  if (!panel) return;

  const body = renderOverflowPanelContent(panel, { globalOverflow, alerts, blowoutHotspots });
  if (!body) return;

  body.onclick = async (e) => {
    const btn = e.target && e.target.closest ? e.target.closest('[data-assign-overflow="1"]') : null;
    if (!btn) return;

    const isbn = String(btn.getAttribute("data-isbn") || "").trim();
    const maxQty = Number(btn.getAttribute("data-qty") || 0);
    if (!isbn || !maxQty) {
      alert("No overflow available to assign.");
      return;
    }

    const loc = prompt(
      "Assign UNASSIGNED overflow for " + isbn + "\n\nEnter shelf face like: A-01-F (or B-03-B)",
      "A-01-F"
    );
    if (!loc) return;

    const m = String(loc).trim().toUpperCase().match(/^([A-D])-(\d+)-(F|B)$/);
    if (!m) {
      alert("Invalid location. Use format like A-01-F");
      return;
    }

    const row = m[1];
    const bay = Number(m[2]);
    const side = m[3];

    const qtyStr = prompt(
      "How many copies to move into Blowout at " + row + "-" + String(bay).padStart(2, "0") + "-" + side + "?\n\nMax available: " + maxQty,
      String(Math.min(maxQty, 35))
    );
    if (qtyStr == null) return;

    const quantity = Number(qtyStr);
    if (!quantity || Number.isNaN(quantity) || quantity <= 0) {
      alert("Quantity must be a positive number.");
      return;
    }

    btn.disabled = true;
    const originalText = btn.textContent;
    btn.textContent = "Working…";

    try {
      const { res, data } = await assignOverflowToBlowout({ isbn, row, bay, side, quantity });
      if (!res.ok) {
        alert((data && data.message) || "Failed to assign overflow to blowout.");
        return;
      }

      if (typeof window.loadLayout === "function") window.loadLayout();
    } catch (err) {
      console.error(err);
      alert("Network or server error while assigning overflow.");
    } finally {
      btn.disabled = false;
      btn.textContent = originalText || "Assign";
    }
  };
}

function renderReceiveOverflowBanner(layoutCache) {
  const banner = document.getElementById("receive-overflow-banner");
  if (!banner) return;

  const notice = window.__wms_last_receive_overflow;
  if (!notice || !notice.isbn || !notice.overflow_qty) {
    banner.style.display = "none";
    return;
  }

  const isbn = String(notice.isbn || "").trim();
  const overflowQty = Number(notice.overflow_qty || 0);
  const suggestions = Array.isArray(notice.blowout_suggestions) ? notice.blowout_suggestions : [];

  const body = renderReceiveOverflowBannerContent(banner, { isbn, overflowQty, suggestions });
  if (!body) return;

  banner.style.display = "block";

  body.onclick = async (e) => {
    const applyBtn = e.target && e.target.closest ? e.target.closest('[data-apply-suggestions="1"]') : null;
    if (applyBtn) {
      const applyIsbn = String(applyBtn.getAttribute("data-isbn") || "").trim();
      const nextSuggestions = Array.isArray(notice.blowout_suggestions) ? notice.blowout_suggestions : [];
      if (!applyIsbn || !nextSuggestions.length) {
        alert("No suggestions available to apply.");
        return;
      }

      applyBtn.disabled = true;
      const originalText = applyBtn.textContent;
      applyBtn.textContent = "Working…";

      try {
        for (const s of nextSuggestions) {
          const loc = Array.isArray(layoutCache)
            ? layoutCache.find((x) => String(x.location_id) === String(s.location_id))
            : null;
          if (!loc) continue;

          const qty = Number(s.quantity || 0);
          if (!qty || qty <= 0) continue;

          const { res, data } = await assignOverflowToBlowout({
            isbn: applyIsbn,
            quantity: qty,
            row: loc.row,
            bay: loc.bay,
            side: loc.side,
          });

          if (!res.ok) {
            alert((data && data.message) || "Failed to assign overflow to blowout.");
            break;
          }
        }

        window.__wms_last_receive_overflow = null;
        banner.style.display = "none";
        const bodyEl = banner.querySelector(".receive-overflow-body");
        if (bodyEl) bodyEl.innerHTML = "";
        if (typeof window.loadLayout === "function") window.loadLayout();
      } catch (err) {
        console.error(err);
        alert("Network or server error while assigning overflow.");
      } finally {
        applyBtn.disabled = false;
        applyBtn.textContent = originalText || "✅ Assign suggested blowout";
      }
      return;
    }

    const leaveBtn = e.target && e.target.closest ? e.target.closest('[data-leave-unassigned="1"]') : null;
    if (leaveBtn) {
      window.__wms_last_receive_overflow = null;
      banner.style.display = "none";
      const bodyEl = banner.querySelector(".receive-overflow-body");
      if (bodyEl) bodyEl.innerHTML = "";
      return;
    }

    const btn = e.target && e.target.closest ? e.target.closest('[data-open-suggested="1"]') : null;
    if (!btn) return;

    const locId = btn.getAttribute("data-loc-id");
    const qty = Number(btn.getAttribute("data-qty") || 0);
    const isbnTarget = String(btn.getAttribute("data-isbn") || "").trim();

    const loc = Array.isArray(layoutCache)
      ? layoutCache.find((x) => String(x.location_id) === String(locId))
      : null;

    if (!loc) {
      alert("Could not find suggested shelf in layout.");
      return;
    }

    await window.loadShelfContents(loc.row, loc.bay, loc.side);

    window.setTimeout(() => {
      const isbnEl = document.getElementById("blowout-isbn");
      const qtyEl = document.getElementById("blowout-qty");
      if (isbnEl) isbnEl.value = isbnTarget;
      if (qtyEl) qtyEl.value = String(qty || 1);
      const addBtn = document.getElementById("blowout-add-btn");
      if (addBtn) {
        try {
          addBtn.focus({ preventScroll: true });
        } catch {
          // ignore
        }
      }
    }, 50);
  };
}

function bindReceiveOverflowDismiss() {
  const banner = document.getElementById("receive-overflow-banner");
  if (!banner) return;

  const dismissBtn = banner.querySelector("#receive-overflow-dismiss");
  if (!dismissBtn) return;

  if (dismissBtn.dataset.bound === "1") return;
  dismissBtn.dataset.bound = "1";

  dismissBtn.addEventListener("click", () => {
    window.__wms_last_receive_overflow = null;
    banner.style.display = "none";
    const body = banner.querySelector(".receive-overflow-body");
    if (body) body.innerHTML = "";
  });
}

function bindLayoutGlobals() {
  window.setReceiveOverflowNotice = function setReceiveOverflowNotice(payload) {
    window.__wms_last_receive_overflow = payload || null;
    if (typeof window.loadLayout === "function") window.loadLayout();
  };

  window.highlightBay = function highlightBay(row, bay, side) {
    const r = String(row || "").toUpperCase();
    const b = String(bay || "");
    const s = String(side || "").toUpperCase().charAt(0);
    if (!r || !b || !s) return;

    const baySelector = '[data-row="' + r + '"][data-bay="' + b + '"]';
    const bayEl = document.querySelector(baySelector);
    if (!bayEl) return;

    bayEl.classList.add("highlight-bay");
    bayEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

    const sideCells = bayEl.querySelectorAll('[data-side="' + s + '"] .cell:not(.blowout)');
    sideCells.forEach((c) => c.classList.add("highlight-cell"));

    setTimeout(() => {
      bayEl.classList.remove("highlight-bay");
      sideCells.forEach((c) => c.classList.remove("highlight-cell"));
    }, 4500);
  };

  window.highlightShelf = function highlightShelf(row, bay, side, level) {
    const r = String(row || "").toUpperCase();

    const bayNum = Number(bay);
    const b = String(Number.isNaN(bayNum) ? (bay || "") : bayNum);

    const s = String(side || "").toUpperCase().charAt(0);
    const lvl = Number(level || 0);
    if (!r || !b || !s || !lvl) return;

    const bayEl = document.querySelector('[data-row="' + r + '"][data-bay="' + b + '"]');
    if (!bayEl) {
      window.__wms_pending_highlight = { row: r, bay: b, side: s, level: lvl };
      if (typeof window.loadLayout === "function") {
        try {
          window.loadLayout();
        } catch {
          // ignore
        }
      }
      return;
    }

    const sideCol = bayEl.querySelector('[data-side="' + s + '"]');
    if (!sideCol) {
      window.__wms_pending_highlight = { row: r, bay: b, side: s, level: lvl };
      return;
    }

    let cell = sideCol.querySelector('.cell[data-level="' + String(lvl) + '"]');

    if (!cell) {
      const cells = Array.from(sideCol.querySelectorAll(".cell"));
      cell = cells.find((c) => String(c.textContent || "").includes("Level " + String(lvl))) || null;
    }

    if (!cell) {
      console.warn("[WMS highlightShelf] level cell not found", { row: r, bay: b, side: s, level: lvl });
      window.__wms_pending_highlight = { row: r, bay: b, side: s, level: lvl };
      bayEl.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      return;
    }

    document.querySelectorAll(".lookup-target-bay").forEach((el) => el.classList.remove("lookup-target-bay"));
    document.querySelectorAll(".lookup-target-cell").forEach((el) => {
      el.classList.remove("lookup-target-cell");
      el.style.outline = "";
      el.style.outlineOffset = "";
    });

    cell.classList.add("lookup-target-cell");
    cell.style.outline = "3px solid rgba(239, 68, 68, 0.95)";
    cell.style.outlineOffset = "2px";

    try {
      cell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      window.scrollBy({ top: -80, left: 0, behavior: "smooth" });
    } catch {
      // ignore
    }

    setTimeout(() => {
      cell.classList.remove("lookup-target-cell");
      cell.style.outline = "";
      cell.style.outlineOffset = "";
    }, 6500);
  };

  window.highlightShelves = function highlightShelves(locations) {
    const locs = Array.isArray(locations) ? locations : [];
    if (!locs.length) return;

    document.querySelectorAll(".lookup-target-bay").forEach((el) => el.classList.remove("lookup-target-bay"));
    document.querySelectorAll(".lookup-target-cell").forEach((el) => {
      el.classList.remove("lookup-target-cell");
      el.style.outline = "";
      el.style.outlineOffset = "";
    });

    let firstCell = null;

    const uniq = normalizeHighlightLocations(locs);
    const queued = [];

    for (const t of uniq) {
      const bayEl = document.querySelector('[data-row="' + t.row + '"][data-bay="' + t.bay + '"]');
      if (!bayEl) {
        queued.push(t);
        continue;
      }

      const sideCol = bayEl.querySelector('[data-side="' + t.side + '"]');
      if (!sideCol) {
        queued.push(t);
        continue;
      }

      let cell = sideCol.querySelector('.cell[data-level="' + String(t.level) + '"]');
      if (!cell) {
        const cells = Array.from(sideCol.querySelectorAll(".cell"));
        cell = cells.find((c) => String(c.textContent || "").includes("Level " + String(t.level))) || null;
      }

      if (!cell) {
        queued.push(t);
        continue;
      }

      cell.classList.add("lookup-target-cell");
      cell.style.outline = "3px solid rgba(239, 68, 68, 0.95)";
      cell.style.outlineOffset = "2px";

      if (!firstCell) firstCell = cell;
    }

    console.log(
      "[WMS highlightShelves] requested=",
      locs.length,
      "normalized=",
      uniq.length,
      "highlighted=",
      firstCell ? ">=1" : "0",
      "queued=",
      queued.length
    );

    if (queued.length) {
      window.__wms_pending_highlight = queued;
      if (typeof window.loadLayout === "function") {
        try {
          window.loadLayout();
        } catch {
          // ignore
        }
      }
    }

    if (firstCell) {
      try {
        firstCell.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        window.scrollBy({ top: -80, left: 0, behavior: "smooth" });
      } catch {
        // ignore
      }
    }
  };
}

function bindShelfModalHelpers() {
  window.closeShelfModal = function closeShelfModal() {
    const { shelfModal } = getStaticElements();
    closeModal(shelfModal);
  };

  window.loadShelfContents = async function loadShelfContents(row, bay, side, levelFilter) {
    const { shelfDetail, shelfTableContainer } = getStaticElements();
    if (!shelfDetail || !shelfTableContainer) return;

    try {
      const { res, data } = await fetchShelf(row, bay, side);

      if (!res.ok) {
        setShelfMessage((data && data.message) || "Error loading shelf contents", true);
        shelfTableContainer.innerHTML = "";
        alert((data && data.message) || "Error loading shelf contents");
        return;
      }

      const loc = data.location;
      const { shelfModal } = getStaticElements();
      openModal(shelfModal);

      const filterLevel = levelFilter ? Number(levelFilter) : null;

      const normalItems = Array.isArray(data.items) ? data.items : [];
      const levelItems = Array.isArray(data.level_items) ? data.level_items : [];
      const blowoutItems = Array.isArray(data.blowout_items) ? data.blowout_items : [];
      const blowoutTotal = Number(data.blowout_total || 0);
      const normalTotal = Number(data.total || 0);

      const headerMsg = filterLevel
        ? "Shelf " + loc.location_code + " → Viewing Level " + filterLevel
        : "Shelf " + loc.location_code + " → Level 1–4: " + normalTotal + " • Blowout (L5): " + blowoutTotal;

      setShelfMessage(headerMsg, false);

      let html = "";

      if (!normalItems.length) {
        html += '<p><strong>Levels 1–4</strong>: No books currently on normal shelves for this face.</p>';
      } else {
        let rows = levelItems.length
          ? levelItems
          : normalItems.map((it) => ({ isbn: it.isbn, total: it.quantity, level1: 0, level2: 0, level3: 0, level4: 0 }));

        if (filterLevel && [1, 2, 3, 4].includes(filterLevel)) {
          rows = rows
            .map((it) => {
              const lvlQty = Number(it["level" + filterLevel] || 0);
              return {
                isbn: it.isbn,
                level_only: lvlQty,
                total: lvlQty,
                level1: it.level1 || 0,
                level2: it.level2 || 0,
                level3: it.level3 || 0,
                level4: it.level4 || 0,
              };
            })
            .filter((it) => Number(it.total || 0) > 0);
        }

        const levelHeading = filterLevel && [1, 2, 3, 4].includes(filterLevel)
          ? "Level " + filterLevel + " (This specific shelf level)"
          : "Levels 1–4 (Pickable)";

        html +=
          '<h3 style="margin:10px 0 6px; font-size:14px;">' + levelHeading + "</h3>" +
          "<table><thead><tr>" +
            "<th>ISBN</th>" +
            (filterLevel && [1, 2, 3, 4].includes(filterLevel)
              ? "<th>L" + filterLevel + "</th>"
              : "<th>L1</th><th>L2</th><th>L3</th><th>L4</th>") +
            "<th>Total</th>" +
            "<th>Ship</th>" +
          "</tr></thead><tbody>";

        for (const item of rows) {
          const maxQty = item.total || 0;
          const levelCellHtml = filterLevel && [1, 2, 3, 4].includes(filterLevel)
            ? "<td>" + Number(item["level" + filterLevel] || item.level_only || 0) + "</td>"
            : (
              "<td>" + (item.level1 || 0) + "</td>" +
              "<td>" + (item.level2 || 0) + "</td>" +
              "<td>" + (item.level3 || 0) + "</td>" +
              "<td>" + (item.level4 || 0) + "</td>"
            );

          html +=
            "<tr>" +
            "<td>" + item.isbn + "</td>" +
            levelCellHtml +
            "<td><strong>" + maxQty + "</strong></td>" +
            "<td>" +
              '<input type="number" class="ship-qty-input" min="1" max="' +
              maxQty +
              '" value="1" style="width:70px; margin-right:6px; padding:4px 6px; border-radius:6px; border:1px solid #d1d5db; font-size:12px;" />' +
              '<button class="btn btn-small ship-item-btn" data-isbn="' +
              item.isbn +
              '" data-location-id="' +
              loc.location_id +
              '" data-max="' +
              maxQty +
              '">🚚 Ship</button>' +
            "</td>" +
            "</tr>";
        }

        html += "</tbody></table>";
      }

      html +=
        '<div style="margin-top:12px; padding:10px; border:1px dashed #d1d5db; border-radius:10px; background:#f9fafb;">' +
          '<h3 style="margin:0 0 6px; font-size:14px;">Level 5 — Blowout (Manual Overflow)</h3>';

      if (!blowoutItems.length) {
        html += '<div style="font-size:13px;">No blowout inventory on this shelf yet.</div>';
      } else {
        html += "<table><thead><tr><th>ISBN</th><th>Qty (Blowout)</th></tr></thead><tbody>";
        for (const item of blowoutItems) {
          html += "<tr><td>" + item.isbn + "</td><td>" + item.quantity + "</td></tr>";
        }
        html += "</tbody></table>";
      }

      html +=
        '<div style="margin-top:10px; display:flex; gap:8px; align-items:flex-end; flex-wrap:wrap;">' +
          '<div style="display:flex; flex-direction:column; gap:4px;">' +
            '<label style="font-size:12px; color:#374151;">ISBN</label>' +
            '<input id="blowout-isbn" placeholder="Scan or type ISBN" style="width:220px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db;" />' +
          "</div>" +
          '<div style="display:flex; flex-direction:column; gap:4px;">' +
            '<label style="font-size:12px; color:#374151;">Qty</label>' +
            '<input id="blowout-qty" type="number" min="1" value="1" style="width:90px; padding:6px 8px; border-radius:8px; border:1px solid #d1d5db;" />' +
          "</div>" +
          '<button id="blowout-add-btn" class="btn btn-small" type="button">➕ Add to Blowout</button>' +
        "</div>" +
      "</div>";

      shelfTableContainer.innerHTML = html;

      const shipButtons = shelfTableContainer.querySelectorAll(".ship-item-btn");
      shipButtons.forEach((btn) => {
        btn.addEventListener("click", async () => {
          const isbn = btn.getAttribute("data-isbn");
          const locationId = btn.getAttribute("data-location-id");
          const maxQty = Number(btn.getAttribute("data-max"));

          const rowEl = btn.closest("tr");
          const qtyInput = rowEl ? rowEl.querySelector(".ship-qty-input") : null;
          if (!qtyInput) {
            alert("Quantity input not found.");
            return;
          }

          const qty = Number(qtyInput.value);
          if (!qty || Number.isNaN(qty) || qty <= 0) {
            alert("Please enter a valid positive number to ship.");
            return;
          }
          if (qty > maxQty) {
            alert("You requested " + qty + " but only " + maxQty + " are on this shelf.");
            return;
          }

          try {
            const { res, data } = await shipFromShelf({ isbn, location_id: locationId, quantity: qty });
            if (!res.ok) {
              if (res.status === 409) {
                alert(
                  (data && data.message ? data.message : "Not enough stock on this shelf.") +
                    " Requested: " +
                    qty +
                    ", Available: " +
                    data.available
                );
              } else {
                alert((data && data.message) || "Error shipping from this shelf.");
              }
              return;
            }

            alert(
              "Shipped " +
                data.shipped +
                " copies of " +
                isbn +
                " from shelf " +
                loc.location_code +
                ". Remaining on shelf: " +
                data.remaining_on_shelf
            );

            loadShelfContents(row, bay, side);
          } catch (err) {
            console.error(err);
            alert("Network or server error while shipping.");
          }
        });
      });

      const blowoutAddBtn = document.getElementById("blowout-add-btn");
      if (blowoutAddBtn) {
        blowoutAddBtn.addEventListener("click", async () => {
          const isbnEl = document.getElementById("blowout-isbn");
          const qtyEl = document.getElementById("blowout-qty");
          const isbn = isbnEl ? String(isbnEl.value || "").trim() : "";
          const qty = qtyEl ? Number(qtyEl.value) : 0;

          if (!isbn) {
            alert("Please scan or enter an ISBN for blowout.");
            return;
          }
          if (!qty || Number.isNaN(qty) || qty <= 0) {
            alert("Please enter a valid positive quantity for blowout.");
            return;
          }

          try {
            const { res, data } = await assignToBlowout({
              isbn,
              quantity: qty,
              row: loc.row,
              bay: loc.bay,
              side: loc.side,
            });

            if (!res.ok) {
              alert((data && data.message) || "Error assigning to blowout.");
              return;
            }

            alert((data && data.message) || "Assigned to blowout.");
            loadShelfContents(row, bay, side);
          } catch (err) {
            console.error(err);
            alert("Network or server error while assigning to blowout.");
          }
        });
      }
    } catch (err) {
      console.error(err);
      setShelfMessage("Network or server error", true);
      shelfTableContainer.innerHTML = "";
      alert("Network or server error");
    }
  };
}

function initGlobals() {
  window.__wms_last_receive_overflow = window.__wms_last_receive_overflow || null;
  window.__wms_lock_scroll_during_receive = window.__wms_lock_scroll_during_receive || false;
  window.__wms_pending_highlight = window.__wms_pending_highlight || null;
  window.__wms_skip_scroll_restore = window.__wms_skip_scroll_restore || false;
  window.__wms_barcode_cart = window.__wms_barcode_cart || [];
}

async function loadLayout() {
  const container = getRowsContainer();
  if (!container) {
    console.error("[WMS] #rows container not found; layout not rendered");
    return;
  }

  const __prevScrollY = window.scrollY || 0;
  const __shouldRestoreScroll =
    !window.__wms_skip_scroll_restore &&
    !window.__wms_lock_scroll_during_receive;

  let __scrollLockApplied = false;
  const __body = document.body;
  const __html = document.documentElement;
  const __prevBodyPosition = __body ? __body.style.position : "";
  const __prevBodyTop = __body ? __body.style.top : "";
  const __prevBodyLeft = __body ? __body.style.left : "";
  const __prevBodyRight = __body ? __body.style.right : "";
  const __prevBodyWidth = __body ? __body.style.width : "";
  const __prevHtmlOverflowY = __html ? __html.style.overflowY : "";

  function __lockScroll() {
    if (!__shouldRestoreScroll || __scrollLockApplied || !__body || !__html) return;
    __scrollLockApplied = true;
    __html.style.overflowY = "hidden";
    __body.style.position = "fixed";
    __body.style.top = -__prevScrollY + "px";
    __body.style.left = "0";
    __body.style.right = "0";
    __body.style.width = "100%";
  }

  function __unlockScroll() {
    if (!__scrollLockApplied || !__body || !__html) return;
    __scrollLockApplied = false;
    __html.style.overflowY = __prevHtmlOverflowY;
    __body.style.position = __prevBodyPosition;
    __body.style.top = __prevBodyTop;
    __body.style.left = __prevBodyLeft;
    __body.style.right = __prevBodyRight;
    __body.style.width = __prevBodyWidth;
    try {
      window.scrollTo({ top: __prevScrollY, left: 0, behavior: "auto" });
    } catch {
      window.scrollTo(0, __prevScrollY);
    }
  }

  const __prevContainerHeight = container.offsetHeight || 0;
  if (__shouldRestoreScroll && __prevContainerHeight > 0) {
    container.style.minHeight = __prevContainerHeight + "px";
  }

  const parent = container ? container.parentElement : null;

  ["lookup-isbn", "lookupBtn", "lookup-result", "lookup-table-container"].forEach((id) => {
    const el = document.getElementById(id);
    if (el && !el.closest("#overflow-panel")) {
      const card = el.closest(".card");
      if (card) card.remove();
      else el.remove();
    }
  });

  const barcodePanel = ensureBarcodePanel(parent);
  ensureBarcodeStyles();
  ensureLayoutPolishStyles();
  bindBarcodePanelOnce(barcodePanel);

  const receiveBanner = ensureReceiveOverflowBanner(parent, container);
  if (receiveBanner) bindReceiveOverflowDismiss();

  ensureOverflowPanel(parent, container, toolbarId);
  ensureHeatmapToolbar(parent, container, toolbarId, legendId);

  const legendEl = document.getElementById(legendId);
  updateHeatmapLegend(legendEl);

  wmsBindLookupPanelOnce();

  try {
    const layout = await fetchLayout();
    window.__wms_layout_cache = layout;

    let globalOverflow = [];
    let summary = null;
    try {
      const [ov, sum] = await Promise.all([fetchGlobalOverflow(), fetchSummary()]);
      globalOverflow = ov;
      summary = sum;
    } catch {
      // Non-fatal
    }

    await prefetchShelfTotals(layout);

    const blowoutHotspots = Object.entries(blowoutTotalsByLocation)
      .map(([locId, qty]) => {
        const loc = layout.find((x) => String(x.location_id) === String(locId));
        return {
          location_id: Number(locId),
          location_code: loc ? loc.location_code : String(locId),
          quantity: Number(qty || 0),
        };
      })
      .filter((x) => (x.quantity || 0) > 0)
      .sort((a, b) => (b.quantity || 0) - (a.quantity || 0));

    const alerts = summary && Array.isArray(summary.alerts) ? summary.alerts : [];
    renderOverflowPanel({ globalOverflow, alerts, blowoutHotspots });
    renderReceiveOverflowBanner(layout);

    const byRow = {};
    for (const loc of layout) {
      if (!byRow[loc.row]) byRow[loc.row] = [];
      byRow[loc.row].push(loc);
    }

    const rowOrder = ["A", "B", "C", "D"];

    __lockScroll();
    container.innerHTML = "";

    for (const row of rowOrder) {
      const rowLocs = byRow[row] || [];
      if (!rowLocs.length) continue;

      const byBay = {};
      for (const loc of rowLocs) {
        if (!byBay[loc.bay]) byBay[loc.bay] = [];
        byBay[loc.bay].push(loc);
      }

      const rowDiv = document.createElement("div");
      rowDiv.className = "row";

      const title = document.createElement("div");
      title.className = "row-header";

      const label = document.createElement("span");
      let rowLabel = "Row " + row;
      if (row === "D") {
        rowLabel += " · Audio / CDs (not used for book receiving)";
      }
      label.textContent = rowLabel;

      const meta = document.createElement("span");
      const totalCap = rowLocs.reduce((sum, l) => sum + l.capacity, 0);
      const totalUsed = rowLocs.reduce((sum, l) => sum + l.used, 0);
      const totalRatio = totalCap === 0 ? 0 : totalUsed / totalCap;
      const pill = document.createElement("span");
      pill.className = "pill";
      pill.textContent = Math.round(totalRatio * 100) + "% full";
      meta.appendChild(pill);

      title.appendChild(label);
      title.appendChild(meta);
      rowDiv.appendChild(title);

      const bayGroup = document.createElement("div");
      bayGroup.className = "bay-group";

      const bays = Object.keys(byBay)
        .map(Number)
        .sort((a, b) => a - b);

      for (const bay of bays) {
        const locs = byBay[bay];

        const bayDiv = document.createElement("div");
        bayDiv.className = "bay";
        bayDiv.setAttribute("data-row", String(row));
        bayDiv.setAttribute("data-bay", String(bay));
        if ((row === "A" && bay === 4) || (row === "C" && bay === 5) || (row === "D" && bay === 4)) {
          bayDiv.className += " endcap-bay";
        }

        ["F", "B"].forEach((side) => {
          const loc = locs.find((l) => l.side === side);
          if (!loc) return;

          const sideCol = document.createElement("div");
          sideCol.className = "side-column";
          sideCol.setAttribute("data-side", String(side));

          if ((blowoutTotalsByLocation[loc.location_id] || 0) > 0) {
            sideCol.classList.add("shelf-has-blowout");
          }

          sideCol.addEventListener("click", (e) => {
            const cell = e.target && e.target.closest ? e.target.closest(".cell") : null;
            if (cell && !cell.classList.contains("blowout")) {
              const lvl = Number(cell.getAttribute("data-level") || 1);
              window.__wms_barcode_target = setBarcodeTargetUI(loc, lvl);

              const cart = window.__wms_barcode_cart || [];
              if (cart.length) {
                e.preventDefault();
                e.stopPropagation();
                const commitBtn = document.getElementById("br-commit");
                try {
                  commitBtn.focus({ preventScroll: true });
                } catch {
                  // ignore
                }
                if (commitBtn) commitBtn.click();
                return;
              }

              e.preventDefault();
              e.stopPropagation();
              window.loadShelfContents(loc.row, loc.bay, loc.side, lvl);
              return;
            }

            window.loadShelfContents(loc.row, loc.bay, loc.side);
          });

          const sideLabel = document.createElement("div");
          sideLabel.className = "side-label";
          sideLabel.textContent = "Bay " + bay + " " + (side === "F" ? "Front" : "Back");
          sideCol.appendChild(sideLabel);

          for (let level = 1; level <= 5; level++) {
            const cell = document.createElement("div");
            cell.className = "cell" + (level === 5 ? " blowout" : "");
            cell.setAttribute("data-level", String(level));
            if (level === 5) {
              cell.classList.remove("heat-low", "heat-mid", "heat-high", "heat-crit");
            }

            if (level !== 5) {
              const totals = normalLevelTotalsByLocation[loc.location_id] || { 1: 0, 2: 0, 3: 0, 4: 0 };
              const usedThisLevel = Number(totals[level] || 0);
              const levelRatio = usedThisLevel / LEVEL_SOFT_CAP;

              cell.title =
                "Row " + loc.row + " • Bay " + loc.bay + " • " + (loc.side === "F" ? "Front" : "Back") +
                " • Level " + level + "\n" +
                usedThisLevel + " copies (ref " + LEVEL_SOFT_CAP + ")";

              cell.style.backgroundColor = "";
              cell.classList.remove("heat-low", "heat-mid", "heat-high", "heat-crit");
              cell.classList.add(heatClassForRatio(levelRatio));

              cell.style.cursor = "pointer";
            }

            const levelLabel = document.createElement("div");
            levelLabel.className = "level-label";
            levelLabel.textContent =
              level === 5 ? "Level 5 — Blowout (Manual Overflow)" : "Level " + level;
            const code = document.createElement("div");
            code.className = "loc-code";
            code.textContent = loc.location_code;

            const usage = document.createElement("div");
            usage.className = "usage";
            if (level === 5) {
              const boQty = blowoutTotalsByLocation[loc.location_id] || 0;
              usage.textContent = String(boQty);
            } else {
              const totals = normalLevelTotalsByLocation[loc.location_id] || { 1: 0, 2: 0, 3: 0, 4: 0 };
              const usedThisLevel = Number(totals[level] || 0);
              usage.textContent = String(usedThisLevel);
            }

            cell.appendChild(levelLabel);
            cell.appendChild(code);
            cell.appendChild(usage);

            sideCol.appendChild(cell);
          }

          bayDiv.appendChild(sideCol);
        });

        bayGroup.appendChild(bayDiv);
      }

      rowDiv.appendChild(bayGroup);
      container.appendChild(rowDiv);
    }

    __unlockScroll();
    container.style.minHeight = "";

    maybeHighlightAfterRender();
    if (window.__wms_pending_highlight) {
      const ph = window.__wms_pending_highlight;
      window.__wms_pending_highlight = null;
      setTimeout(() => {
        if (Array.isArray(ph) && typeof window.highlightShelves === "function") {
          window.highlightShelves(ph);
        } else if (ph && typeof window.highlightShelf === "function") {
          window.highlightShelf(ph.row, ph.bay, ph.side, ph.level);
        }
      }, 0);
    }
  } catch (err) {
    console.error(err);
    try {
      container.style.minHeight = "";
    } catch {
      // ignore
    }
    try {
      __unlockScroll();
    } catch {
      // ignore
    }
    container.textContent = "Error loading layout: " + (err && err.message ? err.message : String(err));
  }
}

export function initLayout() {  initGlobals();
  bindLayoutGlobals();
  bindModalEvents();
  bindShelfModalHelpers();

  window.loadLayout = loadLayout;

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", () => window.loadLayout());
  } else {
    window.loadLayout();
  }

  appendLayoutGuideLine();
}
