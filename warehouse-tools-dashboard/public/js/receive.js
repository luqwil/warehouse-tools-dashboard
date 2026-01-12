// public/js/receive.js

const isbnEl = document.getElementById('isbn');
const qtyEl = document.getElementById('qty');
const receiveBtn = document.getElementById('receiveBtn');
const resultEl = document.getElementById('result');

const overflowSummaryEl = document.getElementById('overflow-summary');
const overflowTableContainer = document.getElementById('overflow-table-container');

// Receive Inventory has been deprecated in favor of shelf-directed placement.
// Hide and disable all receive-related UI + logic.
function hideReceiveSection() {
  // Preferred: explicit container
  const explicit = document.getElementById('receive-section');
  if (explicit) {
    explicit.style.display = 'none';
    return;
  }

  // Fallback: hide the nearest section/card that contains the receive inputs/buttons.
  // This works even if the HTML has no wrapper id.
  const anchor = receiveBtn || qtyEl || isbnEl;
  if (!anchor) return;

  // Try common wrappers
  const wrapper =
    anchor.closest('section') ||
    anchor.closest('.card') ||
    anchor.closest('.panel') ||
    anchor.closest('.box') ||
    anchor.closest('form') ||
    anchor.parentElement;

  if (wrapper) wrapper.style.display = 'none';
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hideReceiveSection);
} else {
  hideReceiveSection();
}

function showResult(el, msg, ok) {
  if (!el) return;
  el.style.display = 'block';
  el.textContent = msg;
  el.className = 'result ' + (ok ? 'ok' : 'error');
}

function clearNode(node) {
  if (node) node.innerHTML = '';
}

async function readJsonOrText(res) {
  const raw = await res.text();
  if (!raw) return { data: null, raw: '' };
  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    return { data: null, raw };
  }
}

async function refreshGlobalOverflow() {
  if (!overflowSummaryEl || !overflowTableContainer) return;

  try {
    const res = await fetch('/inventory/global-overflow');
    const { data, raw } = await readJsonOrText(res);

    if (!res.ok) {
      overflowSummaryEl.style.display = 'none';
      overflowTableContainer.innerHTML = '';
      return;
    }

    const items = Array.isArray(data?.items) ? data.items : [];
    const total = Number(data?.total || 0);

    if (!items.length || total <= 0) {
      overflowSummaryEl.style.display = 'none';
      overflowTableContainer.innerHTML =
        '<p style="margin-top:10px; font-size:13px; color:#6b7280;">No unassigned overflow right now.</p>';
      return;
    }

    showResult(
      overflowSummaryEl,
      'Unassigned overflow total: ' + total + ' copies across ' + items.length + ' ISBN(s).',
      false
    );

    let html = '<table><thead><tr><th>ISBN</th><th>Qty</th></tr></thead><tbody>';
    for (const it of items) {
      html += '<tr><td>' + String(it.isbn || '') + '</td><td>' + (it.quantity || 0) + '</td></tr>';
    }
    html += '</tbody></table>';
    overflowTableContainer.innerHTML = html;
  } catch (e) {
    // silent: this is a dashboard panel
    console.warn('refreshGlobalOverflow failed', e);
  }
}

async function doReceive() {
  showResult(resultEl, 'Receiving is disabled. Use shelf-level placement instead.', false);
  return;
}

// Populate Unassigned Overflow panel on load
refreshGlobalOverflow();