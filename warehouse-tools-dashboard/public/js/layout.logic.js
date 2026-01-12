export const LEVEL_SOFT_CAP = 40;

export const HEAT_BANDS = {
  greenMax: Math.floor(LEVEL_SOFT_CAP / 3),
  yellowMax: Math.floor((LEVEL_SOFT_CAP * 2) / 3),
};

export function colorForUsage(ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const r = Math.round(239 + clamped * (220 - 239)); // from light green-ish → light red-ish
  const g = Math.round(246 - clamped * 120);
  const b = Math.round(255 - clamped * 80);
  return "rgb(" + r + "," + g + "," + b + ")";
}

export function applyHeatmapClass(cell, ratio) {
  cell.classList.remove("heat-low", "heat-mid", "heat-high", "heat-crit");

  const used = Math.round(Math.max(0, ratio) * LEVEL_SOFT_CAP);

  if (used <= HEAT_BANDS.greenMax) cell.classList.add("heat-low");
  else if (used <= HEAT_BANDS.yellowMax) cell.classList.add("heat-mid");
  else cell.classList.add("heat-crit");
}

export function heatClassForRatio(ratio) {
  const used = Math.round(Math.max(0, ratio) * LEVEL_SOFT_CAP);
  if (used <= HEAT_BANDS.greenMax) return "heat-low";
  if (used <= HEAT_BANDS.yellowMax) return "heat-mid";
  return "heat-crit";
}

export function pct(ratio) {
  return Math.round(Math.max(0, Math.min(1, ratio)) * 100);
}

export function chooseNextAvailableLevelByQty(locationId, preferredLevel, totalsByLocation) {
  const start = Math.max(1, Math.min(4, Number(preferredLevel) || 1));
  const totals = (totalsByLocation || {})[String(locationId)] || {};

  for (let lvl = start; lvl <= 4; lvl++) {
    const used = Number(totals[lvl] || 0);
    if (used < LEVEL_SOFT_CAP) return lvl;
  }
  for (let lvl = 1; lvl < start; lvl++) {
    const used = Number(totals[lvl] || 0);
    if (used < LEVEL_SOFT_CAP) return lvl;
  }
  return null;
}

export function parseFace(l) {
  // Prefer explicit fields
  let r = String((l && l.row) || "").toUpperCase();
  let bayVal = l && l.bay != null ? l.bay : "";
  let s = String((l && l.side) || "").toUpperCase();

  // If missing, try parsing location_code like "A-02-F" or "A-02-F-L1"
  if ((!r || !bayVal || !s) && l && (l.location_code || l.location || l.code)) {
    const code = String(l.location_code || l.location || l.code || "").trim().toUpperCase();
    // Accept A-02-F or A-02-F-L1
    const m = code.match(/^([A-D])-(\d{1,2})-(F|B)(?:-L([1-4]))?$/);
    if (m) {
      r = m[1];
      bayVal = m[2];
      s = m[3];
      // If a level was embedded in the code, we will treat it as a candidate level later.
    }
  }

  // Normalize bay + side
  const bayNum = Number(bayVal);
  const b = String(Number.isNaN(bayNum) ? "" : bayNum);
  const side = s ? s.charAt(0) : "";

  if (!r || !b || !side) return null;
  return { row: r, bay: b, side };
}

export function extractLevels(l) {
  // Return an array of levels that contain the ISBN on this shelf face.
  // Supports a few possible payload shapes.

  // 1) Explicit `level` field
  if (l && l.level != null) {
    const lvl = Number(l.level);
    if ([1, 2, 3, 4].includes(lvl)) return [lvl];
  }

  // 2) Explicit `levels` array (e.g., [1,3] or ['2','4'])
  if (l && Array.isArray(l.levels) && l.levels.length) {
    const out = l.levels.map((x) => Number(x)).filter((n) => [1, 2, 3, 4].includes(n));
    if (out.length) return Array.from(new Set(out));
  }

  // 3) Per-level quantities fields (level1..level4)
  const hasLevelQtyFields = l && (l.level1 != null || l.level2 != null || l.level3 != null || l.level4 != null);
  if (hasLevelQtyFields) {
    const out = [];
    for (let i = 1; i <= 4; i++) {
      const q = Number(l["level" + i] || 0);
      if (q > 0) out.push(i);
    }
    if (out.length) return out;
  }

  // 4) Embedded in location_code like A-02-F-L3
  if (l && (l.location_code || l.location || l.code)) {
    const code = String(l.location_code || l.location || l.code || "").trim().toUpperCase();
    const m = code.match(/^([A-D])-(\d{1,2})-(F|B)-L([1-4])$/);
    if (m) return [Number(m[4])];
  }

  // Fallback (unknown): do NOT guess levels.
  return [];
}

export function normalizeHighlightLocations(locs) {
  const seen = new Set();
  const uniq = [];

  for (const l of locs) {
    const face = parseFace(l);
    if (!face) continue;
    const levels = extractLevels(l);
    for (const level of levels) {
      const key = face.row + "|" + face.bay + "|" + face.side + "|" + level;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push({ row: face.row, bay: face.bay, side: face.side, level });
    }
  }

  return uniq;
}
