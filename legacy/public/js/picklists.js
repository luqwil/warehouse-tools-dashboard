// Pick Lists Popup (extracted from layout.js)
// Loaded dynamically by layout.js so layout remains the operational page.

(function initPickListsPopup() {
  // Prevent double-loading
  if (window.__wms_picklists_loaded) return;
  window.__wms_picklists_loaded = true;

  // Create a launcher button in the existing heatmap toolbar area if possible
  function ensureLauncher() {
    const toolbar = document.getElementById('heatmap-toolbar');
    if (!toolbar) return;
    if (document.getElementById('picklists-open-btn')) return;

    const btn = document.createElement('button');
    btn.id = 'picklists-open-btn';
    btn.type = 'button';
    btn.className = 'nav-btn secondary';
    btn.textContent = '📦 Pick Lists';
    toolbar.appendChild(btn);

    btn.addEventListener('click', () => {
      const modal = document.getElementById('picklists-modal');
      if (modal) modal.style.display = 'flex';
      refreshPickListsUI();
    });
  }

  // Modal shell
  if (!document.getElementById('picklists-modal')) {
    const modal = document.createElement('div');
    modal.id = 'picklists-modal';
    modal.className = 'modal';
    modal.style.display = 'none';

    modal.innerHTML = `
      <div class="modal-backdrop" id="picklists-backdrop"></div>
      <div class="modal-card picklists-card">
        <button class="modal-close" id="picklists-close" aria-label="Close">✕</button>
        <h2 style="margin:0 0 6px; font-size:16px;">Pick Lists</h2>
        <div style="font-size:12px; color:#6b7280; margin-bottom:10px;">
          Build pick lists from current pickable inventory (Levels 1–4). Routes are generated to avoid backtracking (one pass per aisle).
        </div>

        <div class="picklists-grid">
          <div class="picklists-col">
            <div class="picklists-section-title">Build a list</div>
            <input id="pl-search" placeholder="Search ISBN (partial ok)" />
            <div id="pl-search-status" class="result" style="display:none; margin-top:8px;"></div>
            <div id="pl-inventory" class="picklists-scroll"></div>
          </div>

          <div class="picklists-col">
            <div class="picklists-section-title">Draft pick list</div>
            <div id="pl-draft" class="picklists-scroll"></div>
            <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap; margin-top:10px;">
              <input id="pl-name" placeholder="Name this pick list (e.g., Order Sheet 12/16)" style="flex:1;" />
              <button id="pl-save" class="btn btn-small" type="button">💾 Save</button>
              <button id="pl-clear" class="btn btn-small secondary" type="button">Clear</button>
            </div>
          </div>

          <div class="picklists-col">
            <div class="picklists-section-title">Upcoming pick lists</div>
            <div id="pl-saved" class="picklists-scroll"></div>
          </div>

          <div class="picklists-col" style="grid-column: 1 / -1;">
            <div class="picklists-section-title">Route preview</div>
            <div id="pl-route" class="route-preview"></div>
          </div>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close handlers
    const close = () => { modal.style.display = 'none'; };
    modal.querySelector('#picklists-close')?.addEventListener('click', close);
    modal.querySelector('#picklists-backdrop')?.addEventListener('click', close);
  }

  // Data model (localStorage)
  const LS_SAVED = 'wms_picklists_saved_v1';
  const LS_DRAFT = 'wms_picklists_draft_v1';
  const LS_PROGRESS = 'wms_picklists_progress_v1';

  // Track which saved list is being viewed (used for progress persistence)
  let currentListId = null;
  let currentPlan = null;

function loadProgress() {
  try { return JSON.parse(localStorage.getItem(LS_PROGRESS) || '{}') || {}; } catch { return {}; }
}
function saveProgress(obj) {
  localStorage.setItem(LS_PROGRESS, JSON.stringify(obj || {}));
}
function getProgressForList(listId) {
  const all = loadProgress();
  if (!all[listId]) all[listId] = { completedKeys: {} };
  return all;
}

function stableStopKey(stop) {
  const r = String(stop.row || '').toUpperCase();
  const b = String(Number(stop.bay || 0)).padStart(2, '0');
  const s = String(stop.side || '').toUpperCase().charAt(0);
  return r && b && s ? `${r}-${b}-${s}` : '';
}
function rowOfStop(stop) {
  return String(stop.row || '').toUpperCase();
}

  function loadSaved() {
    try { return JSON.parse(localStorage.getItem(LS_SAVED) || '[]') || []; } catch { return []; }
  }
  function saveSaved(arr) {
    localStorage.setItem(LS_SAVED, JSON.stringify(arr || []));
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(LS_DRAFT) || '[]') || []; } catch { return []; }
  }
  function saveDraft(arr) {
    localStorage.setItem(LS_DRAFT, JSON.stringify(arr || []));
  }

  function addToDraft(isbn) {
    const draft = loadDraft();
    const existing = draft.find((d) => d.isbn === isbn);
    if (existing) existing.quantity += 1;
    else draft.push({ isbn, quantity: 1 });
    saveDraft(draft);
    refreshPickListsUI();
  }

  function setDraftQty(isbn, qty) {
    const draft = loadDraft();
    const d = draft.find((x) => x.isbn === isbn);
    if (!d) return;
    d.quantity = Math.max(1, Number(qty) || 1);
    saveDraft(draft);
  }

  function removeFromDraft(isbn) {
    const draft = loadDraft().filter((d) => d.isbn !== isbn);
    saveDraft(draft);
    refreshPickListsUI();
  }

  async function fetchInventory(query) {
    const qs = new URLSearchParams();
    if (query) qs.set('query', query);
    const res = await fetch('/inventory/inventory-index?' + qs.toString());
    const data = await res.json();
    if (!res.ok) throw new Error(data?.message || 'Failed to load inventory');
    return Array.isArray(data?.items) ? data.items : [];
  }

  function renderInventory(items) {
    const el = document.getElementById('pl-inventory');
    if (!el) return;

    if (!items.length) {
      el.innerHTML = '<div style="font-size:12px; color:#6b7280; padding:8px;">No results.</div>';
      return;
    }

    let html = '';
    for (const it of items) {
      const locPreview = (it.locations || []).slice(0, 2).map((l) => l.location_code + ' (' + l.quantity + ')').join(', ');
      html += `
        <div class="pl-row">
          <div>
            <div class="pl-isbn">${it.isbn}</div>
            <div class="pl-meta">Pickable: <strong>${it.total}</strong> • ${locPreview || 'No locations'}</div>
          </div>
          <button class="btn btn-small" type="button" data-add-isbn="${it.isbn}">➕ Add</button>
        </div>
      `;
    }

    el.innerHTML = html;

    el.querySelectorAll('[data-add-isbn]').forEach((btn) => {
      btn.addEventListener('click', () => addToDraft(btn.getAttribute('data-add-isbn')));
    });
  }

  function renderDraft() {
    const el = document.getElementById('pl-draft');
    if (!el) return;

    const draft = loadDraft();
    if (!draft.length) {
      el.innerHTML = '<div style="font-size:12px; color:#6b7280; padding:8px;">Draft is empty. Search inventory and click Add.</div>';
      return;
    }

    let html = '';
    for (const d of draft) {
      html += `
        <div class="pl-row">
          <div>
            <div class="pl-isbn">${d.isbn}</div>
            <div class="pl-meta">Qty: <input class="pl-qty" type="number" min="1" value="${d.quantity}" data-qty-isbn="${d.isbn}" /></div>
          </div>
          <button class="btn btn-small secondary" type="button" data-rm-isbn="${d.isbn}">✕</button>
        </div>
      `;
    }
    el.innerHTML = html;

    el.querySelectorAll('[data-qty-isbn]').forEach((inp) => {
      inp.addEventListener('change', () => {
        setDraftQty(inp.getAttribute('data-qty-isbn'), inp.value);
        refreshPickListsUI();
      });
    });
    el.querySelectorAll('[data-rm-isbn]').forEach((btn) => {
      btn.addEventListener('click', () => removeFromDraft(btn.getAttribute('data-rm-isbn')));
    });
  }

  function renderSaved() {
    const el = document.getElementById('pl-saved');
    if (!el) return;

    const saved = loadSaved();
    if (!saved.length) {
      el.innerHTML = '<div style="font-size:12px; color:#6b7280; padding:8px;">No saved pick lists yet.</div>';
      return;
    }

    let html = '';
    for (const s of saved) {
      const count = (s.lines || []).reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);
      html += `
        <div class="pl-row">
          <div>
            <div class="pl-isbn">${s.name || 'Untitled'}</div>
            <div class="pl-meta">Lines: ${(s.lines || []).length} • Total qty: <strong>${count}</strong></div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn btn-small" type="button" data-view-list="${s.id}">🧭 View</button>
            <button class="btn btn-small secondary" type="button" data-del-list="${s.id}">🗑</button>
          </div>
        </div>
      `;
    }

    el.innerHTML = html;

    el.querySelectorAll('[data-view-list]').forEach((btn) => {
      btn.addEventListener('click', () => viewPickList(btn.getAttribute('data-view-list')));
    });
    el.querySelectorAll('[data-del-list]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-del-list');
        saveSaved(loadSaved().filter((x) => String(x.id) !== String(id)));
        refreshPickListsUI();
        const routeEl = document.getElementById('pl-route');
        if (routeEl) routeEl.innerHTML = '';
      });
    });
  }

  function renderRoute(plan, listName) {
    const el = document.getElementById('pl-route');
    if (!el) return;

    const stops = Array.isArray(plan?.stops) ? plan.stops : [];
    const diagram = plan?.diagram;

    if (!stops.length) {
      el.innerHTML = '<div style="font-size:12px; color:#6b7280;">No pickable stock found for this list.</div>';
      return;
    }

    let html = '';

    html += `<div class="route-title">${listName || 'Pick List'} — One-pass route</div>`;
html += `
  <div class="route-controls">
    <button class="btn btn-small secondary pl-touch" type="button" id="pl-prev-stop">← Prev</button>
    <div class="route-controls-mid">
      <div class="route-controls-title">Guided Pick</div>
      <div class="route-controls-sub" id="pl-current-stop">Stop 1 of ${stops.length}</div>
 </div>
  <div class="route-controls-right">
    <button class="btn btn-small secondary pl-touch" type="button" id="pl-mode-guided">🧭 Guided</button>
    <button class="btn btn-small secondary pl-touch" type="button" id="pl-mode-list">📋 Full List</button>
    <button class="btn btn-small secondary pl-touch" type="button" id="pl-print">🖨 Print</button>
    <button class="btn btn-small pl-touch" type="button" id="pl-next-stop">Next →</button>
  </div>
</div>
`;

html += `<div id="pl-guided" class="pl-guided"></div>`;
    // Full warehouse map (always show entire layout)
    const ROW_CONFIG = {
      A: { bays: 4, frontOnlyBays: new Set([4]), label: 'Row A' },
      B: { bays: 4, frontOnlyBays: new Set([]), label: 'Row B' },
      C: { bays: 5, frontOnlyBays: new Set([5]), label: 'Row C' },
      D: { bays: 4, frontOnlyBays: new Set([4]), label: 'Row D (Audio)' },
    };
    const ROW_ORDER = ['A', 'B', 'C', 'D'];

    function pad2(n) { return String(n).padStart(2, '0'); }
    function stopKey(row, bay, side) { return `${row}-${pad2(bay)}-${side}`; }

    const stopInfoByKey = new Map();
    stops.forEach((s, idx) => {
      const r = String(s.row || '').toUpperCase();
      const b = Number(s.bay || 0);
      const side = String(s.side || '').toUpperCase().charAt(0);
      if (!r || !b || !side) return;
      stopInfoByKey.set(stopKey(r, b, side), { idx: idx + 1, stop: s });
    });

    const dirByRow = new Map();
    if (diagram && Array.isArray(diagram.rows)) {
      for (const r of diagram.rows) {
        dirByRow.set(String(r.row || '').toUpperCase(), r.direction === 'DESC' ? 'DESC' : 'ASC');
      }
    }
    if (!dirByRow.has('A')) dirByRow.set('A', 'ASC');
    if (!dirByRow.has('B')) dirByRow.set('B', 'DESC');
    if (!dirByRow.has('C')) dirByRow.set('C', 'ASC');
    if (!dirByRow.has('D')) dirByRow.set('D', 'DESC');

    function bayListForRow(row) {
      const cfg = ROW_CONFIG[row];
      if (!cfg) return [];
      const dir = dirByRow.get(row) || 'ASC';
      const arr = [];
      for (let i = 1; i <= cfg.bays; i++) arr.push(i);
      return dir === 'DESC' ? arr.reverse() : arr;
    }

    const stopPathText = stops.map((s, i) => `${i + 1}:${s.location_code}`).join('  →  ');

    html += '<div class="pl-map">';
    html += '<div class="pl-map-top">';
    html += '<div class="pl-map-legend">';
    html += '<span class="pl-map-legend-item"><span class="pl-map-dot pl-map-dot-stop"></span>Stop</span>';
    html += '<span class="pl-map-legend-item"><span class="pl-map-dot pl-map-dot-active"></span>Current stop</span>';
    html += '<span class="pl-map-legend-item"><span class="pl-map-dot pl-map-dot-path"></span>Walking direction</span>';
    html += '</div>';
    html += `<div class="pl-map-path">${stopPathText}</div>`;
    html += '</div>';

    for (const row of ROW_ORDER) {
      const cfg = ROW_CONFIG[row];
      if (!cfg) continue;

      const dir = dirByRow.get(row) || 'ASC';
      const bays = bayListForRow(row);

      html += '<div class="pl-map-row">';
      html += `<div class="pl-map-row-label">${cfg.label} <span class="pl-map-dir">${dir === 'ASC' ? '→' : '←'}</span></div>`;
      html += '<div class="pl-map-row-track">';

      bays.forEach((bay, i) => {
        const isEndcap = cfg.frontOnlyBays.has(bay);
        const isAudio = row === 'D';

        const kF = stopKey(row, bay, 'F');
        const kB = stopKey(row, bay, 'B');
        const sF = stopInfoByKey.get(kF);
        const sB = stopInfoByKey.get(kB);

        html += `<div class="pl-map-bay ${isEndcap ? 'endcap' : ''} ${isAudio ? 'audio' : ''}" data-map-row="${row}" data-map-bay="${bay}">`;
        html += `<div class="pl-map-bay-top">Bay ${pad2(bay)}</div>`;

        html += `<div class="pl-map-side ${sF ? 'stop' : ''}" data-map-key="${kF}">`;
        html += `<span class="pl-map-side-label">F</span>`;
        if (sF) html += `<span class="pl-map-badge">${sF.idx}</span>`;
        html += `</div>`;

        html += `<div class="pl-map-side ${isEndcap ? 'disabled' : ''} ${sB ? 'stop' : ''}" data-map-key="${kB}">`;
        html += `<span class="pl-map-side-label">B</span>`;
        if (isEndcap) html += `<span class="pl-map-side-note">—</span>`;
        else if (sB) html += `<span class="pl-map-badge">${sB.idx}</span>`;
        html += `</div>`;

        html += `</div>`;

        if (i < bays.length - 1) {
          html += `<div class="pl-map-connector">${dir === 'ASC' ? '→' : '←'}</div>`;
        }
      });

      html += '</div></div>';
    }

    html += '</div>'; // pl-map

    html += '<div id="pl-stoplist" style="margin-top:10px;">';
    stops.forEach((stop, idx) => {
      const r = String(stop.row || '').toUpperCase();
      const b = Number(stop.bay || 0);
      const s = String(stop.side || '').toUpperCase().charAt(0);
      const skey = r && b && s ? `${r}-${String(b).padStart(2,'0')}-${s}` : '';

      html += `<div class="route-stop" data-stop-key="${skey}">`;
      html += `<div class="route-stop-head"><span class="route-stop-badge">${idx + 1}</span> ${stop.location_code} <span class="route-stop-hint">(Pick from Levels 1–4)</span></div>`;
      html += '<table style="margin-top:6px;"><thead><tr><th>ISBN</th><th>Qty</th><th>Levels</th></tr></thead><tbody>';
      (stop.picks || []).forEach((p) => {
        const levels = Array.isArray(p.levels) ? p.levels.map((lv) => `L${lv.level}:${lv.quantity}`).join(', ') : '';
        html += `<tr><td>${p.isbn}</td><td><strong>${p.quantity}</strong></td><td>${levels}</td></tr>`;
      });
      html += '</tbody></table>';
      html += '</div>';
    });
    html += '</div>';

el.innerHTML = html;

// Mode state (defaults to Guided)
let mode = 'guided';
let currentIdx = 0;

const guidedEl = el.querySelector('#pl-guided');
const stopListEl = el.querySelector('#pl-stoplist');
const modeGuidedBtn = el.querySelector('#pl-mode-guided');
const modeListBtn = el.querySelector('#pl-mode-list');

// Progress (completion) store per list
const listId = currentListId || (listName ? String(listName) : 'adhoc');
const allProg = getProgressForList(listId);
const completedKeys = allProg[listId].completedKeys || {};

function saveCompleted() {
  allProg[listId].completedKeys = completedKeys;
  saveProgress(allProg);
}

function setMode(nextMode) {
  mode = nextMode === 'list' ? 'list' : 'guided';
  if (modeGuidedBtn) modeGuidedBtn.classList.toggle('active', mode === 'guided');
  if (modeListBtn) modeListBtn.classList.toggle('active', mode === 'list');

  if (stopListEl) stopListEl.style.display = (mode === 'list') ? 'block' : 'none';
  if (guidedEl) guidedEl.style.display = (mode === 'guided') ? 'block' : 'none';

  setCurrent(currentIdx, { scroll: mode === 'list' });
}

    function isStopCompleted(stop) {
      const k = stableStopKey(stop);
      return !!(k && completedKeys[k]);
    }

    function areAllStopsCompleted() {
      return stops.length ? stops.every((s) => isStopCompleted(s)) : false;
    }

    function findNextIncompleteIdx(fromIdx, direction) {
      const dir = direction >= 0 ? 1 : -1;
      let i = Number(fromIdx) || 0;

      // start one step away so "next" doesn't re-check the current index
      i += dir;

      while (i >= 0 && i < stops.length) {
        if (!isStopCompleted(stops[i])) return i;
        i += dir;
      }

      // If no incomplete stop exists in that direction, stay put
      return Math.max(0, Math.min(stops.length - 1, Number(fromIdx) || 0));
    }

    function findFirstIncompleteIdx() {
      for (let i = 0; i < stops.length; i++) {
        if (!isStopCompleted(stops[i])) return i;
      }
      return 0;
    }

function renderTransition(toIdx) {
  if (!guidedEl) return;
  if (toIdx <= 0) return;

  const prev = stops[toIdx - 1];
  const cur = stops[toIdx];
  const prevRow = rowOfStop(prev);
  const curRow = rowOfStop(cur);
  if (!prevRow || !curRow || prevRow === curRow) return;

  guidedEl.insertAdjacentHTML(
    'beforeend',
    `<div class="pl-transition">✅ Finish Row <strong>${prevRow}</strong> → Walk to Row <strong>${curRow}</strong> (continue one-pass)</div>`
  );
}

    function renderGuided(stop, idx) {
      if (!guidedEl) return;

      const completed = isStopCompleted(stop);
      const stopKeyStr = stableStopKey(stop);
      const allDone = areAllStopsCompleted();

      const lines = (stop.picks || []).map((p) => {
        const lv = Array.isArray(p.levels)
          ? p.levels.map((x) => `L${x.level}:${x.quantity}`).join(', ')
          : '';
        return `
          <label class="pl-check">
            <input type="checkbox" data-pick-check="${stopKeyStr}|${p.isbn}" />
            <span><strong>${p.quantity}</strong> × <span class="pl-isbn-inline">${p.isbn}</span>
              <span class="pl-levels-inline">${lv ? '(' + lv + ')' : ''}</span>
            </span>
          </label>
        `;
      }).join('');

      guidedEl.innerHTML = `
        <div class="pl-stopcard ${completed ? 'done' : ''}">
          <div class="pl-stopcard-top">
            <div class="pl-stopcard-badge">STOP ${idx + 1}</div>
            <div class="pl-stopcard-loc">${stop.location_code}</div>
            <div class="pl-stopcard-sub">Pick from Levels 1–4 • Don’t backtrack</div>
          </div>

          <div class="pl-stopcard-body">
            ${lines || '<div class="pl-muted">No picks at this stop.</div>'}
          </div>

          ${allDone ? '<div class="pl-done-banner">✅ All stops complete. You\'re done.</div>' : ''}

        <div class="pl-stopcard-actions">
             <button type="button" class="btn btn-small secondary pl-touch" id="pl-mark-incomplete">↩ Mark Incomplete</button>
            <button type="button" class="btn btn-small pl-touch" id="pl-mark-complete">✓ Mark Stop Complete</button>
        </div>
    </div>
     `;

      const completeBtn = guidedEl.querySelector('#pl-mark-complete');
      const incompleteBtn = guidedEl.querySelector('#pl-mark-incomplete');

      if (completeBtn) {
        completeBtn.addEventListener('click', () => {
          if (!stopKeyStr) return;

          // Idempotent: if already complete, just advance
          if (!completedKeys[stopKeyStr]) {
            completedKeys[stopKeyStr] = true;
            saveCompleted();
          }

          // Prevent rapid double-taps from queuing multiple advances
          completeBtn.disabled = true;

          const nextIdx = findNextIncompleteIdx(currentIdx, +1);
          setCurrent(nextIdx, { scroll: mode === 'list' });
        });
      }
      if (incompleteBtn) {
        incompleteBtn.addEventListener('click', () => {
          if (!stopKeyStr) return;
          delete completedKeys[stopKeyStr];
          saveCompleted();
          setCurrent(currentIdx, { scroll: false });
        });
      }

      const checks = Array.from(guidedEl.querySelectorAll('[data-pick-check]'));
      checks.forEach((c) => {
        c.addEventListener('change', () => {
          const allChecked = checks.length ? checks.every((x) => x.checked) : false;
          if (allChecked && stopKeyStr) {
            if (!completedKeys[stopKeyStr]) {
              completedKeys[stopKeyStr] = true;
              saveCompleted();
            }

            const nextIdx = findNextIncompleteIdx(currentIdx, +1);
            setCurrent(nextIdx, { scroll: mode === 'list' });
          }
        });
      });

      if (completed) checks.forEach((c) => { c.checked = true; });

      // Auto-focus for warehouse flow (keyboard/scanner)
      if (completeBtn) {
        window.requestAnimationFrame(() => {
          try { completeBtn.focus({ preventScroll: true }); } catch { /* ignore */ }
        });
      }
    }

    function setCurrent(idx, opts = {}) {
      const next = Math.max(0, Math.min(stops.length - 1, Number(idx) || 0));
      currentIdx = next;

      el.querySelectorAll('.route-stop.active').forEach((n) => n.classList.remove('active'));
      el.querySelectorAll('.pl-map-side.active').forEach((n) => n.classList.remove('active'));

      const stop = stops[currentIdx];
      const key = stableStopKey(stop);

      const card = key ? el.querySelector('.route-stop[data-stop-key="' + key + '"]') : null;
      if (card) card.classList.add('active');

      const mapNode = key ? el.querySelector('.pl-map-side[data-map-key="' + key + '"]') : null;
      if (mapNode) mapNode.classList.add('active');

      const label = el.querySelector('#pl-current-stop');
      if (label) label.textContent = `Stop ${currentIdx + 1} of ${stops.length} • ${stop.location_code}`;

      // Disable Prev/Next on first/last stop
      const prevBtn = el.querySelector('#pl-prev-stop');
      const nextBtn = el.querySelector('#pl-next-stop');
      if (prevBtn) prevBtn.disabled = (currentIdx <= 0);
      if (nextBtn) nextBtn.disabled = (currentIdx >= (stops.length - 1));

      if (mode === 'guided') {
        renderGuided(stop, currentIdx);
        renderTransition(currentIdx);
      }

      if (opts.scroll !== false && mode === 'list' && card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
function isTypingTarget(elm) {
  if (!elm) return false;
  const tag = String(elm.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
  if (elm.isContentEditable) return true;
  return false;
}

function markCurrentIncomplete() {
  const stop = stops[currentIdx];
  const k = stableStopKey(stop);
  if (!k) return;
  delete completedKeys[k];
  saveCompleted();
  setCurrent(currentIdx, { scroll: false });
}

    function markCurrentCompleteAndAdvance() {
      const stop = stops[currentIdx];
      const k = stableStopKey(stop);
      if (!k) return;
      if (!completedKeys[k]) {
        completedKeys[k] = true;
        saveCompleted();
      }

      const nextIdx = findNextIncompleteIdx(currentIdx, +1);
      setCurrent(nextIdx, { scroll: mode === 'list' });
    }

    function toggleNextPickCheckbox() {
      if (!guidedEl) return;
      // Find the next unchecked checkbox in the current guided stop
      const boxes = Array.from(guidedEl.querySelectorAll('input[type="checkbox"][data-pick-check]'));
      if (!boxes.length) return;
      const next = boxes.find((b) => !b.checked) || boxes[0];
      // Toggle and trigger change handler
      next.checked = !next.checked;
      next.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function closePicklistsModal() {
      const modalEl = document.getElementById('picklists-modal');
      if (!modalEl) return;
      modalEl.style.display = 'none';
    }

function onKeyDown(e) {
  const modalEl = document.getElementById('picklists-modal');
  if (!modalEl || modalEl.style.display !== 'flex') return;
  if (isTypingTarget(e.target)) return;

  if (e.key === 'Escape') {
    e.preventDefault();
    closePicklistsModal();
  }
  else if (e.key === 'Enter') {
    e.preventDefault();
    markCurrentCompleteAndAdvance();
  }
  else if (e.key === 'Backspace') {
    e.preventDefault();
    markCurrentIncomplete();
  }
  else if (e.key === 'ArrowLeft') {
    e.preventDefault();
    setCurrent(currentIdx - 1, { scroll: mode === 'list' });
  }
  else if (e.key === 'ArrowRight') {
    e.preventDefault();
    setCurrent(currentIdx + 1, { scroll: mode === 'list' });
  }
  else if (e.key === ' ' || e.code === 'Space') {
    // Space toggles next unchecked item for fast warehouse flow
    e.preventDefault();
    toggleNextPickCheckbox();
  }
}
// Rebind safely (avoid stacking listeners across rerenders)
if (window.__wms_picklists_keydown) {
  window.removeEventListener('keydown', window.__wms_picklists_keydown);
}
window.__wms_picklists_keydown = onKeyDown;
window.addEventListener('keydown', window.__wms_picklists_keydown);

// Map click jump
el.querySelectorAll('.pl-map-side.stop').forEach((node) => {
  node.addEventListener('click', () => {
    const key = node.getAttribute('data-map-key');
    if (!key) return;
    const info = stopInfoByKey.get(key);
    if (!info) return;
    setCurrent(info.idx - 1, { scroll: mode === 'list' });
  });
});

// Route controls (delegated clicks so buttons always work after rerenders)
function onRouteClick(e) {
  const modalEl = document.getElementById('picklists-modal');
  if (!modalEl || modalEl.style.display !== 'flex') return;

  const next = e.target?.closest?.('#pl-next-stop');
  if (next) {
    e.preventDefault();
    e.stopPropagation();
    const nextIdx = findNextIncompleteIdx(currentIdx, +1);
    setCurrent(nextIdx, { scroll: mode === 'list' });
    return;
  }

  const prev = e.target?.closest?.('#pl-prev-stop');
  if (prev) {
    e.preventDefault();
    e.stopPropagation();
    setCurrent(currentIdx - 1, { scroll: mode === 'list' });
    return;
  }

  const pr = e.target?.closest?.('#pl-print');
  if (pr) {
    e.preventDefault();
    e.stopPropagation();
    setMode('list');
    window.print();
    return;
  }

  const mg = e.target?.closest?.('#pl-mode-guided');
  if (mg) {
    e.preventDefault();
    e.stopPropagation();
    setMode('guided');
    return;
  }

  const ml = e.target?.closest?.('#pl-mode-list');
  if (ml) {
    e.preventDefault();
    e.stopPropagation();
    setMode('list');
    return;
  }
}

// Rebind safely per render
if (el.__wms_picklists_route_click) {
  el.removeEventListener('click', el.__wms_picklists_route_click);
}
el.__wms_picklists_route_click = onRouteClick;
el.addEventListener('click', el.__wms_picklists_route_click);

// Init
setMode('guided');
setCurrent(findFirstIncompleteIdx(), { scroll: false });
  }

  async function viewPickList(id) {
    const saved = loadSaved();
    const s = saved.find((x) => String(x.id) === String(id));
    if (!s) return;
    currentListId = String(s.id);

    const routeEl = document.getElementById('pl-route');
    if (routeEl) routeEl.innerHTML = '<div style="font-size:12px; color:#6b7280;">Generating route…</div>';

    const res = await fetch('/inventory/pick-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lines: s.lines || [] })
    });
    const plan = await res.json();
    if (!res.ok) {
      if (routeEl) routeEl.innerHTML = '<div class="result error">' + (plan?.message || 'Failed to generate pick plan') + '</div>';
      return;
    }

    currentPlan = plan;
    renderRoute(plan, s.name);
  }

  async function refreshPickListsUI() {
    renderDraft();
    renderSaved();
  }

  window.refreshPickListsUI = refreshPickListsUI;

  const modal = document.getElementById('picklists-modal');
  if (modal) {
    const search = modal.querySelector('#pl-search');
    const status = modal.querySelector('#pl-search-status');
    const saveBtn = modal.querySelector('#pl-save');
    const clearBtn = modal.querySelector('#pl-clear');
    const nameInput = modal.querySelector('#pl-name');

    let t = null;
    async function runSearch() {
      if (!search) return;
      const q = String(search.value || '').trim();
      if (status) status.style.display = 'none';

      try {
        const items = await fetchInventory(q);
        renderInventory(items);
      } catch (e) {
        if (status) {
          status.style.display = 'block';
          status.className = 'result error';
          status.textContent = e.message || 'Error searching inventory';
        }
      }
    }

    search?.addEventListener('input', () => {
      if (t) window.clearTimeout(t);
      t = window.setTimeout(runSearch, 250);
    });

    saveBtn?.addEventListener('click', () => {
      const draft = loadDraft();
      if (!draft.length) return;

      const name = String(nameInput?.value || '').trim() || 'Untitled';
      const saved = loadSaved();
      const id = String(Date.now());
      saved.unshift({ id, name, lines: draft });
      saveSaved(saved);
      saveDraft([]);
      if (nameInput) nameInput.value = '';
      refreshPickListsUI();
    });

    clearBtn?.addEventListener('click', () => {
      saveDraft([]);
      refreshPickListsUI();
      const routeEl = document.getElementById('pl-route');
      if (routeEl) routeEl.innerHTML = '';
    });

    refreshPickListsUI();
    runSearch();
  }

  // Try to mount the launcher now, and again after the layout toolbar is created.
  ensureLauncher();
  let tries = 0;
  const poll = window.setInterval(() => {
    ensureLauncher();
    tries += 1;
    if (document.getElementById('picklists-open-btn') || tries > 30) window.clearInterval(poll);
  }, 200);
})();

