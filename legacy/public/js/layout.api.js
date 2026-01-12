async function readJsonSafe(res) {
  let raw = "";
  try {
    raw = await res.text();
  } catch {
    raw = "";
  }

  if (!raw) return { data: null, raw: "" };

  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    return { data: null, raw };
  }
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchLayout() {
  const res = await fetch("/inventory/layout");
  if (!res.ok) throw new Error("layout fetch failed");
  return res.json();
}

export async function fetchShelf(row, bay, side) {
  const params = new URLSearchParams({
    row,
    bay: String(bay),
    side,
  });

  const res = await fetch("/inventory/shelf?" + params.toString());
  const data = await readJson(res);
  return { res, data };
}

export async function fetchItemLocations(isbn) {
  const res = await fetch("/inventory/item-locations?isbn=" + encodeURIComponent(isbn));
  const { data, raw } = await readJsonSafe(res);
  return { res, data, raw };
}

export async function fetchGlobalOverflow() {
  const res = await fetch("/inventory/global-overflow");
  if (!res.ok) return [];
  return res.json();
}

export async function fetchSummary() {
  const res = await fetch("/inventory/summary");
  if (!res.ok) return null;
  return res.json();
}

export async function shipFromShelf(payload) {
  const res = await fetch("/inventory/ship-from-shelf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  return { res, data };
}

export async function assignToBlowout(payload) {
  const res = await fetch("/inventory/assign-to-blowout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  return { res, data };
}

export async function assignOverflowToBlowout(payload) {
  const res = await fetch("/inventory/assign-overflow-to-blowout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  return { res, data };
}

export async function putToShelf(payload) {
  const res = await fetch("/inventory/put-to-shelf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  return { res, data };
}

export async function enrichLocationsWithLevels(isbn, faceLocs) {
  const needle = String(isbn || "").trim();
  if (!needle) return [];

  const faces = [];
  const seen = new Set();

  for (const l of faceLocs || []) {
    const code = String(l.location_code || l.location || l.code || "").trim().toUpperCase();
    let row = String(l.row || "").toUpperCase();
    let bay = l.bay != null ? String(l.bay) : "";
    let side = String(l.side || "").toUpperCase();

    if ((!row || !bay || !side) && code) {
      const m = code.match(/^([A-D])-(\d{1,2})-(F|B)/);
      if (m) {
        row = m[1];
        bay = m[2];
        side = m[3];
      }
    }

    const bayNum = Number(bay);
    const bayNorm = String(Number.isNaN(bayNum) ? "" : bayNum);
    const sideNorm = side ? side.charAt(0) : "";

    if (!row || !bayNorm || !sideNorm) continue;

    const key = row + "|" + bayNorm + "|" + sideNorm;
    if (seen.has(key)) continue;
    seen.add(key);

    faces.push({
      row,
      bay: bayNorm,
      side: sideNorm,
      location_code: code || row + "-" + String(bayNorm).padStart(2, "0") + "-" + sideNorm,
    });
  }

  const found = [];
  for (const f of faces) {
    const qs = new URLSearchParams({ row: f.row, bay: String(f.bay), side: f.side });
    const r = await fetch("/inventory/shelf?" + qs.toString());
    if (!r.ok) continue;

    const d = await r.json();
    const levelItems = Array.isArray(d.level_items) ? d.level_items : [];

    const match = levelItems.find((it) => String(it.isbn || "").trim() === needle);
    if (!match) continue;

    for (let lvl = 1; lvl <= 4; lvl++) {
      const q = Number(match["level" + lvl] || 0);
      if (q > 0) {
        found.push({
          row: f.row,
          bay: Number(f.bay),
          side: f.side,
          level: lvl,
          quantity: q,
          location_code: f.location_code,
        });
      }
    }
  }

  return found;
}

export async function findIsbnAcrossAllShelves(isbn, { layout, onProgress } = {}) {
  const needle = String(isbn || "").trim();
  if (!needle) return [];

  // Use cached layout if available, otherwise fetch layout
  let layoutData = Array.isArray(layout) ? layout : null;
  if (!layoutData) {
    try {
      layoutData = await fetchLayout();
    } catch {
      layoutData = null;
    }
  }

  if (!Array.isArray(layoutData) || !layoutData.length) return [];

  // Unique shelf faces (row+bay+side)
  const faces = [];
  const seen = new Set();
  for (const loc of layoutData) {
    const key = String(loc.row) + "|" + String(Number(loc.bay)) + "|" + String(loc.side);
    if (seen.has(key)) continue;
    seen.add(key);
    faces.push({ row: loc.row, bay: Number(loc.bay), side: loc.side, location_code: loc.location_code });
  }

  // Concurrency limiter (don’t hammer the server)
  const CONCURRENCY = 6;
  let idx = 0;
  const found = [];

  async function worker() {
    while (idx < faces.length) {
      const i = idx++;
      const f = faces[i];

      if (typeof onProgress === "function") {
        try {
          onProgress(i + 1, faces.length);
        } catch {
          // ignore
        }
      }

      try {
        const qs = new URLSearchParams({ row: String(f.row), bay: String(f.bay), side: String(f.side) });
        const r = await fetch("/inventory/shelf?" + qs.toString());
        if (!r.ok) continue;
        const d = await r.json();

        // Prefer per-level breakdown if present
        const levelItems = Array.isArray(d.level_items) ? d.level_items : [];
        const normalItems = Array.isArray(d.items) ? d.items : [];

        // Find entries for this ISBN
        const matchingLevel = levelItems.find((it) => String(it.isbn || "").trim() === needle);
        if (matchingLevel) {
          // Push one entry per level that has qty > 0
          for (let lvl = 1; lvl <= 4; lvl++) {
            const q = Number(matchingLevel["level" + lvl] || 0);
            if (q > 0) {
              found.push({
                row: f.row,
                bay: f.bay,
                side: f.side,
                level: lvl,
                quantity: q,
                location_code: f.location_code || String(f.row) + "-" + String(f.bay).padStart(2, "0") + "-" + String(f.side),
              });
            }
          }
          continue;
        }

        // If we only have total quantity (no level breakdown), do NOT guess which levels.
        // We prefer to highlight only exact level cells.
        const matching = normalItems.find((it) => String(it.isbn || "").trim() === needle);
        if (matching) {
          // No-op: known on this face but unknown level(s). Operator can click the face to inspect.
        }
      } catch {
        // ignore shelf fetch errors; continue
      }
    }
  }

  const workers = [];
  for (let w = 0; w < CONCURRENCY; w++) workers.push(worker());
  await Promise.all(workers);

  // Deduplicate results by row-bay-side-level
  const out = [];
  const dedupe = new Set();
  for (const x of found) {
    const key = String(x.row) + "|" + String(Number(x.bay)) + "|" + String(x.side) + "|" + String(Number(x.level));
    if (dedupe.has(key)) continue;
    dedupe.add(key);
    out.push(x);
  }

  // Sort: higher qty first
  out.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
  return out;
}

export { readJsonSafe };
