// src/services/db.js
// In-memory "database" – supports splitting large quantities across shelves,
// querying where books live, and shipping (removing) stock.

let nextItemId = 1;

// isbn -> item record
const itemsByIsbn = new Map();

// Stock (Levels 1–4): array of { item_id, location_id, level, quantity }
// UI can still show aggregated totals per shelf face; we track level internally.
const stockLevels = [];

// Blowout stock (Level 5): array of { item_id, location_id, quantity }
// IMPORTANT: Blowout is manual-only overflow and does NOT count toward shelf capacity/usage.
const blowoutLevels = [];

// Unassigned overflow when absolutely no shelf (including Blowout) has room
// { item_id, quantity }
const globalOverflow = [];

// Soft cap reference per physical shelf level (Levels 1–4)
const LEVEL_SOFT_CAP = 40;

// Capacity for Blowout (Level 5) per shelf face (one physical shelf)
const BLOWOUT_CAPACITY = 40;

// All shelf locations in the warehouse
const locations = [];

// --- Warehouse Intelligence: chronic full shelves (simple, in-memory) ---
// Tracks how often a shelf face is "very full" at the time we generate summaries.
// This is intentionally lightweight and operator-friendly.
const chronicShelfStats = new Map();
// % full threshold to count as a "full hit"
const CHRONIC_FULL_THRESHOLD_PCT = 95;
// Minimum number of hits before we call something "chronic"
const CHRONIC_MIN_HITS = 5;

function noteChronicSampleForLocation(loc) {
  if (!loc || !(loc.capacity > 0)) return;
  const pct = loc.capacity > 0 ? Math.round((loc.used / loc.capacity) * 100) : 0;

  const prev = chronicShelfStats.get(loc.location_id) || {
    samples: 0,
    hits: 0,
    last_seen: null,
  };

  prev.samples += 1;
  if (pct >= CHRONIC_FULL_THRESHOLD_PCT) prev.hits += 1;
  prev.last_seen = new Date().toISOString();

  chronicShelfStats.set(loc.location_id, prev);
}

// Build your layout based on the real warehouse:
//
// Row A: 3 bays in a row + 1 perpendicular endcap  → bays 1–4 (bay 4 = endcap, front only)
// Row B: 4 bays in a row                          → bays 1–4 (front + back)
// Row C: 4 bays in a row + 1 perpendicular endcap → bays 1–5 (bay 5 = endcap, front only)
// Row D: 3 bays in a row + 1 perpendicular endcap → bays 1–4 (bay 4 = endcap, front only, AUDIO ONLY)
//
// Note: Row D shelves are visible in the layout but have capacity 0 so they are
// not used by the auto-placement logic when receiving books.
(function initLocations() {
  const defaultCapacity = LEVEL_SOFT_CAP * 4;

  // Per-row bay counts and whether the row is audio-only (D)
  const rowsConfig = {
    A: { bays: 4, audio: false },
    B: { bays: 4, audio: false },
    C: { bays: 5, audio: false },
    D: { bays: 4, audio: true }, // audio row → not used for auto-placement
  };

  let id = 1;

  for (const [row, cfg] of Object.entries(rowsConfig)) {
    for (let bay = 1; bay <= cfg.bays; bay++) {
      // Determine if this bay is a perpendicular endcap for this row
      const isEndcap =
        (row === "A" && bay === 4) ||
        (row === "C" && bay === 5) ||
        (row === "D" && bay === 4);

      // Endcaps: only front side; straight runs: front + back
      const sides = isEndcap ? ["F"] : ["F", "B"];

      for (const side of sides) {
        locations.push({
          location_id: id++,
          row,
          bay,
          side,
          location_code: `${row}-${bay.toString().padStart(2, "0")}-${side}`,
          // Audio row (D) shelves are layout-only for now, so give them capacity 0.
          capacity: cfg.audio ? 0 : defaultCapacity,
          used: 0,
        });
      }
    }
  }
})();

// Recalculate "used" per location from NORMAL stock (Levels 1–4) only
function recomputeUsed() {
  for (const loc of locations) loc.used = 0;
  for (const s of stockLevels) {
    const loc = locations.find((l) => l.location_id === s.location_id);
    if (loc) loc.used += (s.quantity || 0);
  }
}

// Sorted walking order: by row, bay, side
function getSortedLocations() {
  return [...locations].sort((a, b) => {
    if (a.row !== b.row) return a.row.localeCompare(b.row);
    if (a.bay !== b.bay) return a.bay - b.bay;
    return a.side.localeCompare(b.side);
  });
}

// Levels 1–4 are normal shelves. We track quantities per level internally.
const NORMAL_LEVELS = [1, 2, 3, 4];

function levelCapsForLocation(loc) {
  // Soft cap: treat each level as 40 for auto-placement + heatmap reference.
  // This is a planning cap, not a hard physical limit.
  return {
    1: LEVEL_SOFT_CAP,
    2: LEVEL_SOFT_CAP,
    3: LEVEL_SOFT_CAP,
    4: LEVEL_SOFT_CAP,
  };
}

function usedOnLevel(locationId, level) {
  return stockLevels
    .filter((s) => s.location_id === locationId && (s.level || 1) === level)
    .reduce((sum, s) => sum + (s.quantity || 0), 0);
}

export const db = {
  // Create-or-get item for receiving
  async getOrCreateItemByIsbn(isbn) {
    if (itemsByIsbn.has(isbn)) {
      return itemsByIsbn.get(isbn);
    }
    const item = { item_id: nextItemId++, isbn };
    itemsByIsbn.set(isbn, item);
    return item;
  },

  // Non-creating lookup (used for shipping / queries)
  async findItemByIsbn(isbn) {
    return itemsByIsbn.get(isbn) || null;
  },

  // Inventory index for picking UI (pickable stock only: Levels 1–4)
  // Optional `query` filters by ISBN substring.
  async getInventoryIndex({ query = '' } = {}) {
    recomputeUsed();

    const q = String(query || '').trim();

    // Precompute item_id -> isbn for fast lookups
    const itemIdToIsbn = new Map();
    for (const [isbn, it] of itemsByIsbn.entries()) {
      itemIdToIsbn.set(it.item_id, isbn);
    }

    // item_id -> { isbn, total, byLoc: Map(location_id -> qty) }
    const aggByItem = new Map();

    for (const s of stockLevels) {
      if (!s || (s.quantity || 0) <= 0) continue;

      const lvl = Number(s.level || 1);
      if (lvl < 1 || lvl > 4) continue; // pickable only

      const isbn = itemIdToIsbn.get(s.item_id);
      if (!isbn) continue;
      if (q && !isbn.includes(q)) continue;

      if (!aggByItem.has(s.item_id)) {
        aggByItem.set(s.item_id, { isbn, total: 0, byLoc: new Map() });
      }

      const rec = aggByItem.get(s.item_id);
      rec.total += (s.quantity || 0);
      rec.byLoc.set(s.location_id, (rec.byLoc.get(s.location_id) || 0) + (s.quantity || 0));
    }

    const items = [];

    for (const rec of aggByItem.values()) {
      const locationsOut = [];

      for (const [locId, qty] of rec.byLoc.entries()) {
        const loc = locations.find((l) => l.location_id === locId);
        if (!loc) continue;

        locationsOut.push({
          location_id: loc.location_id,
          location_code: loc.location_code,
          row: loc.row,
          bay: loc.bay,
          side: loc.side,
          quantity: qty,
        });
      }

      // Sort locations by physical order (matches your warehouse)
      locationsOut.sort((a, b) => {
        if (a.row !== b.row) return a.row.localeCompare(b.row);
        if (a.bay !== b.bay) return a.bay - b.bay;
        return a.side.localeCompare(b.side);
      });

      items.push({ isbn: rec.isbn, total: rec.total, locations: locationsOut });
    }

    // Sort by total desc then ISBN asc
    items.sort((a, b) => {
      const td = (b.total || 0) - (a.total || 0);
      if (td !== 0) return td;
      return String(a.isbn).localeCompare(String(b.isbn));
    });

    return items;
  },

  // For suggestion only: "where would we start putting this quantity"
  async findLocationWithFreeSpace(quantity) {
    recomputeUsed();
    const sorted = getSortedLocations();

    for (const loc of sorted) {
      const free = loc.capacity - loc.used;
      if (free >= quantity) {
        return loc;
      }
    }
    // If no single shelf fits all, just return the first shelf that has any free space
    for (const loc of sorted) {
      const free = loc.capacity - loc.used;
      if (free > 0) return loc;
    }
    return null;
  },

  // Receiving: split a large quantity across multiple shelves
  // Returns array of { location_id, location_code, quantity, level?, blowout? }
  async addStockSplit({ itemId, totalQty }) {
    recomputeUsed();
    let remaining = totalQty;
    const allocations = [];
    const sorted = getSortedLocations();

    for (const loc of sorted) {
      if (remaining <= 0) break;

      // Skip shelves that are not used for receiving (capacity 0, e.g., Row D)
      if (!loc.capacity || loc.capacity <= 0) continue;

      // Allocate into levels 1–4 inside this shelf face
      const caps = levelCapsForLocation(loc);

      for (const level of NORMAL_LEVELS) {
        if (remaining <= 0) break;

        const usedLvl = usedOnLevel(loc.location_id, level);
        const freeLvl = (caps[level] || 0) - usedLvl;
        if (freeLvl <= 0) continue;

        const toPlace = Math.min(freeLvl, remaining);

        let rec = stockLevels.find(
          (s) =>
            s.item_id === itemId &&
            s.location_id === loc.location_id &&
            (s.level || 1) === level
        );
        if (!rec) {
          rec = {
            item_id: itemId,
            location_id: loc.location_id,
            level,
            quantity: 0,
          };
          stockLevels.push(rec);
        }

        rec.quantity += toPlace;

        allocations.push({
          location_id: loc.location_id,
          location_code: loc.location_code,
          quantity: toPlace,
          level,
          blowout: false,
        });

        remaining -= toPlace;
        loc.used += toPlace; // keep face-level used in sync for speed
      }
    }

    recomputeUsed();

    // NOTE: Blowout (Level 5) is MANUAL ONLY.
    // We do NOT auto-place into blowout here.
    // If normal shelves fill up, we will leave the remainder as global overflow
    // and provide operator-facing suggestions for which blowout faces have space.
    let blowoutSuggestions = [];
    if (remaining > 0) {
      const sorted = getSortedLocations();

      // Build a ranked list of blowout faces with available space
      blowoutSuggestions = sorted
        .filter((loc) => (loc.capacity || 0) > 0) // ignore capacity 0 faces (e.g., Row D)
        .map((loc) => {
          const usedBlowout = blowoutLevels
            .filter((b) => b.location_id === loc.location_id)
            .reduce((sum, b) => sum + (b.quantity || 0), 0);

          const freeBlowout = Math.max(0, BLOWOUT_CAPACITY - usedBlowout);
          return {
            location_id: loc.location_id,
            location_code: loc.location_code,
            free: freeBlowout,
          };
        })
        .filter((x) => (x.free || 0) > 0);

      // Turn that into a concrete "if you choose blowout" plan for this receive
      // (still NOT applied; just guidance)
      let toAllocate = remaining;
      const plan = [];
      for (const s of blowoutSuggestions) {
        if (toAllocate <= 0) break;
        const qty = Math.min(s.free, toAllocate);
        if (qty <= 0) continue;
        plan.push({
          location_id: s.location_id,
          location_code: s.location_code,
          quantity: qty,
          level: 5,
          blowout: true,
          suggested: true,
        });
        toAllocate -= qty;
      }

      // Store the suggested plan on the function scope so we can attach it to the overflow record below
      blowoutSuggestions = plan;
    }

    // FINAL PASS: nothing fits anywhere
    if (remaining > 0) {
      let rec = globalOverflow.find((o) => o.item_id === itemId);
      if (!rec) {
        rec = { item_id: itemId, quantity: 0 };
        globalOverflow.push(rec);
      }
      rec.quantity += remaining;

      allocations.push({
        location_code: 'UNASSIGNED-OVERFLOW',
        quantity: remaining,
        level: 'UNASSIGNED',
        blowout: false,
        // Operator guidance: where this could go if you choose to assign Blowout
        blowout_suggestions: (typeof blowoutSuggestions !== 'undefined') ? blowoutSuggestions : [],
      });

      remaining = 0;
    }

    return allocations;
  },

  // Barcode receiving: place stock onto an EXACT shelf face + level.
  // This is operator-confirmed (scan ISBN(s), physically place, then scan shelf barcode).
  // Behavior: places up to the level's free capacity; returns remaining qty NOT placed.
  async putToExactShelfLevel({ isbn, row, bay, side, level, quantity, allow_overfill = false }) {
    const cleanIsbn = String(isbn || '').trim();
    if (!cleanIsbn) {
      return { success: false, message: 'ISBN is required.' };
    }

    const qty = Number(quantity);
    if (!qty || Number.isNaN(qty) || qty <= 0) {
      return { success: false, message: 'Quantity must be a positive number.' };
    }

    const lvl = Number(level);
    if (!lvl || Number.isNaN(lvl) || lvl < 1 || lvl > 4) {
      return { success: false, message: 'Level must be 1–4 for barcode receiving.' };
    }

    // Normalize bay/side
    const bayNum = Number(bay);
    const normalizedSide = typeof side === 'string' ? side.toUpperCase().charAt(0) : side;

    const loc = locations.find(
      (l) => l.row === String(row || '').toUpperCase() && l.bay === bayNum && l.side === normalizedSide
    );

    if (!loc) {
      return { success: false, message: 'Shelf not found for given barcode.' };
    }

    // Capacity 0 shelves (e.g., Row D audio) are not receivable.
    if (!loc.capacity || loc.capacity <= 0) {
      return { success: false, message: 'This shelf is not receivable (capacity 0).' };
    }

    // Ensure item exists
    const item = await this.getOrCreateItemByIsbn(cleanIsbn);

    // Compute per-level caps and free space
    const caps = levelCapsForLocation(loc);
    const usedLvl = usedOnLevel(loc.location_id, lvl);

    // Soft cap unless operator explicitly overfills
    const cap = (caps[lvl] || LEVEL_SOFT_CAP);
    const freeLvl = allow_overfill ? qty : (cap - usedLvl);

    if (!allow_overfill && freeLvl <= 0) {
      return {
        success: true,
        placed: 0,
        remaining: qty,
        location_id: loc.location_id,
        location_code: loc.location_code,
        row: loc.row,
        bay: loc.bay,
        side: loc.side,
        level: lvl,
        message: 'This level is at the 40-book soft cap; use another level/shelf or hold SHIFT to overfill intentionally.',
      };
    }

    const toPlace = allow_overfill ? qty : Math.min(freeLvl, qty);

    let rec = stockLevels.find(
      (s) => s.item_id === item.item_id && s.location_id === loc.location_id && (s.level || 1) === lvl
    );
    if (!rec) {
      rec = { item_id: item.item_id, location_id: loc.location_id, level: lvl, quantity: 0 };
      stockLevels.push(rec);
    }

    rec.quantity += toPlace;

    // Keep used in sync
    recomputeUsed();

    return {
      success: true,
      placed: toPlace,
      remaining: Math.max(0, qty - toPlace),
      location_id: loc.location_id,
      location_code: loc.location_code,
      row: loc.row,
      bay: loc.bay,
      side: loc.side,
      level: lvl,
      message: allow_overfill
        ? 'Placed (overfill recorded).'
        : ((qty - toPlace) > 0 ? 'Placed what fits (40-cap); scan another shelf label for the rest.' : 'Placed successfully.'),
    };
  },

  // SHIPPING: remove a total quantity for an item across shelves.
  // Returns { success, allocations, totalAvailable, remaining }
  async shipStockSplit({ itemId, totalQty }) {
    recomputeUsed();

    // First, make sure we HAVE enough stock
    const existing = stockLevels.filter(
      (s) => s.item_id === itemId && s.quantity > 0
    );
    const totalAvailable = existing.reduce((sum, s) => sum + s.quantity, 0);

    if (totalAvailable < totalQty) {
      return {
        success: false,
        allocations: [],
        totalAvailable,
        remaining: totalQty - totalAvailable,
      };
    }

    let remaining = totalQty;
    const allocations = [];
    const sorted = getSortedLocations();

    // Simple rule: remove from shelves in the same walking order used for placing
    for (const loc of sorted) {
      if (remaining <= 0) break;

      for (const level of NORMAL_LEVELS) {
        if (remaining <= 0) break;

        const rec = stockLevels.find(
          (s) =>
            s.item_id === itemId &&
            s.location_id === loc.location_id &&
            (s.level || 1) === level
        );
        if (!rec || rec.quantity <= 0) continue;

        const canTake = Math.min(rec.quantity, remaining);
        rec.quantity -= canTake;

        allocations.push({
          location_id: loc.location_id,
          location_code: loc.location_code,
          quantity: canTake,
          level,
        });

        remaining -= canTake;
      }
    }

    recomputeUsed();

    return {
      success: true,
      allocations,
      totalAvailable,
      remaining: 0,
    };
  },

  // SHIPPING from a specific shelf: remove quantity only from one location.
  // Returns { success, shipped, available, remaining }
  async shipFromShelf({ itemId, locationId, quantity }) {
    recomputeUsed();

    const locId = Number(locationId);

    // Total available on this shelf face across levels 1–4
    const faceRecs = stockLevels.filter(
      (s) => s.item_id === itemId && s.location_id === locId && (s.quantity || 0) > 0
    );

    const available = faceRecs.reduce((sum, s) => sum + (s.quantity || 0), 0);

    if (!available || available <= 0) {
      return { success: false, shipped: 0, available: 0, remaining: quantity };
    }

    if (quantity > available) {
      return {
        success: false,
        shipped: 0,
        available,
        remaining: quantity - available,
      };
    }

    let remainingToShip = quantity;

    // Remove in level order 1 → 4
    for (const level of NORMAL_LEVELS) {
      if (remainingToShip <= 0) break;

      const rec = stockLevels.find(
        (s) =>
          s.item_id === itemId &&
          s.location_id === locId &&
          (s.level || 1) === level
      );
      if (!rec || rec.quantity <= 0) continue;

      const take = Math.min(rec.quantity, remainingToShip);
      rec.quantity -= take;
      remainingToShip -= take;
    }

    recomputeUsed();

    const remainingAfter = stockLevels
      .filter((s) => s.item_id === itemId && s.location_id === locId)
      .reduce((sum, s) => sum + (s.quantity || 0), 0);

    return {
      success: true,
      shipped: quantity,
      available,
      remaining: remainingAfter,
    };
  },

  // “Where is this ISBN and how many on each shelf?”
  async getItemLocationsByIsbn(isbn) {
    const item = itemsByIsbn.get(isbn);
    if (!item) return [];

    recomputeUsed();

    const result = [];
    for (const s of stockLevels) {
      if (s.item_id !== item.item_id || s.quantity <= 0) continue;

      const loc = locations.find((l) => l.location_id === s.location_id);
      if (!loc) continue;

      result.push({
        location_id: loc.location_id,
        location_code: loc.location_code,
        row: loc.row,
        bay: loc.bay,
        side: loc.side,
        quantity: s.quantity,
      });
    }

    // sort by physical order
    result.sort((a, b) => {
      if (a.row !== b.row) return a.row.localeCompare(b.row);
      if (a.bay !== b.bay) return a.bay - b.bay;
      return a.side.localeCompare(b.side);
    });

    return result;
  },

  // Get all ISBNs and quantities on a specific shelf (row + bay + side)
  async getShelfContents({ row, bay, side }) {
    recomputeUsed();

    // Normalize bay to number and side to single-letter F/B
    const bayNum = Number(bay);
    const normalizedSide =
      typeof side === "string" ? side.toUpperCase().charAt(0) : side;

    const loc = locations.find(
      (l) => l.row === row && l.bay === bayNum && l.side === normalizedSide
    );

    if (!loc) {
      return {
        location: null,
        items: [],
        blowout_items: [],
        blowout_total: 0,
        total: 0,
      };
    }

    // Build a map of item_id -> isbn for quick lookup
    const itemIdToIsbn = new Map();
    for (const [isbn, item] of itemsByIsbn.entries()) {
      itemIdToIsbn.set(item.item_id, isbn);
    }

    const byIsbn = new Map();
    const blowoutByIsbn = new Map();
    // Per-level breakdown for normal shelves (Levels 1–4): isbn -> { 1:qty, 2:qty, 3:qty, 4:qty }
    const byIsbnByLevel = new Map();

    // Normal (Levels 1–4) inventory
    for (const s of stockLevels) {
      if (s.location_id !== loc.location_id || (s.quantity || 0) <= 0) continue;
      const isbn = itemIdToIsbn.get(s.item_id);
      if (!isbn) continue;

      const prev = byIsbn.get(isbn) || 0;
      byIsbn.set(isbn, prev + s.quantity);

      const lvl = Number(s.level || 1);
      if (lvl >= 1 && lvl <= 4) {
        const levelsObj = byIsbnByLevel.get(isbn) || { 1: 0, 2: 0, 3: 0, 4: 0 };
        levelsObj[lvl] = (levelsObj[lvl] || 0) + s.quantity;
        byIsbnByLevel.set(isbn, levelsObj);
      }
    }

    // Blowout (Level 5) inventory – manual-only overflow
    for (const s of blowoutLevels) {
      if (s.location_id !== loc.location_id || s.quantity <= 0) continue;
      const isbn = itemIdToIsbn.get(s.item_id);
      if (!isbn) continue;

      const prev = blowoutByIsbn.get(isbn) || 0;
      blowoutByIsbn.set(isbn, prev + s.quantity);
    }

    const items = [];
    for (const [isbn, qty] of byIsbn.entries()) {
      items.push({ isbn, quantity: qty });
    }
    items.sort((a, b) => a.isbn.localeCompare(b.isbn));

    // Per-level breakdown rows for the shelf modal (UI can optionally render this)
    const level_items = [];
    for (const [isbn, qty] of byIsbn.entries()) {
      const levels = byIsbnByLevel.get(isbn) || { 1: 0, 2: 0, 3: 0, 4: 0 };
      level_items.push({
        isbn,
        total: qty,
        level1: levels[1] || 0,
        level2: levels[2] || 0,
        level3: levels[3] || 0,
        level4: levels[4] || 0,
      });
    }
    level_items.sort((a, b) => a.isbn.localeCompare(b.isbn));

    const blowout_items = [];
    for (const [isbn, qty] of blowoutByIsbn.entries()) {
      blowout_items.push({ isbn, quantity: qty });
    }
    blowout_items.sort((a, b) => a.isbn.localeCompare(b.isbn));

    const total = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
    const blowout_total = blowout_items.reduce((sum, it) => sum + (it.quantity || 0), 0);

    return {
      location: {
        location_id: loc.location_id,
        row: loc.row,
        bay: loc.bay,
        side: loc.side,
        location_code: loc.location_code,
      },
      items,
      level_items,
      blowout_items,
      blowout_total,
      total,
    };
  },

  // Manual ONLY: assign copies to Blowout (Level 5) for a specific shelf face.
  // NOTE: Blowout does NOT affect capacity/usage and is NOT shippable.
  async assignToBlowout({ itemId, row, bay, side, quantity }) {
    
    // Normalize bay to number and side to single-letter F/B
    const bayNum = Number(bay);
    const normalizedSide =
      typeof side === "string" ? side.toUpperCase().charAt(0) : side;

    const loc = locations.find(
      (l) => l.row === row && l.bay === bayNum && l.side === normalizedSide
    );

    if (!loc) {
      return {
        success: false,
        message: "Shelf not found.",
      };
    }

    const qty = Number(quantity);
    if (!qty || Number.isNaN(qty) || qty <= 0) {
      return {
        success: false,
        message: "Quantity must be a positive number.",
      };
    }

    // Find existing blowout record for this item/location
    let rec = blowoutLevels.find(
      (s) => s.item_id === itemId && s.location_id === loc.location_id
    );
    if (!rec) {
      rec = { item_id: itemId, location_id: loc.location_id, quantity: 0 };
      blowoutLevels.push(rec);
    }

    rec.quantity += qty;

    return {
      success: true,
      location_id: loc.location_id,
      location_code: loc.location_code,
      added: qty,
      new_total_on_blowout: rec.quantity,
    };
  },

  // Manual helper: move UNASSIGNED overflow into Blowout (Level 5) for a specific shelf face.
  // This subtracts from globalOverflow for the ISBN and then calls assignToBlowout to place it.
  // Returns { success, moved, remaining_overflow, location_code, new_total_on_blowout }
  async assignOverflowToBlowout({ isbn, row, bay, side, quantity }) {
    const cleanIsbn = String(isbn || '').trim();
    if (!cleanIsbn) {
      return { success: false, message: 'ISBN is required.' };
    }

    const qty = Number(quantity);
    if (!qty || Number.isNaN(qty) || qty <= 0) {
      return { success: false, message: 'Quantity must be a positive number.' };
    }

    const item = itemsByIsbn.get(cleanIsbn);
    if (!item) {
      return { success: false, message: 'ISBN not found.' };
    }

    const ov = globalOverflow.find((o) => o.item_id === item.item_id);
    const availableOverflow = ov ? Number(ov.quantity || 0) : 0;

    if (availableOverflow <= 0) {
      return { success: false, message: 'No unassigned overflow available for this ISBN.' };
    }

    const moved = Math.min(qty, availableOverflow);

    // Subtract from global overflow first
    ov.quantity = Math.max(0, availableOverflow - moved);

    // Clean up empty overflow rows
    if (ov.quantity <= 0) {
      const idx = globalOverflow.indexOf(ov);
      if (idx >= 0) globalOverflow.splice(idx, 1);
    }

    // Add to blowout at the requested shelf face
    const res = await this.assignToBlowout({
      itemId: item.item_id,
      row,
      bay,
      side,
      quantity: moved,
    });

    if (!res || !res.success) {
      // Roll back overflow so we never "lose" inventory
      let rec = globalOverflow.find((o) => o.item_id === item.item_id);
      if (!rec) {
        rec = { item_id: item.item_id, quantity: 0 };
        globalOverflow.push(rec);
      }
      rec.quantity += moved;

      return {
        success: false,
        message: (res && res.message) ? res.message : 'Failed to assign overflow to blowout.',
      };
    }

    const remaining_overflow =
      globalOverflow.find((o) => o.item_id === item.item_id)?.quantity || 0;

    return {
      success: true,
      moved,
      remaining_overflow,
      location_code: res.location_code,
      new_total_on_blowout: res.new_total_on_blowout,
    };
  },

  // Get UNASSIGNED overflow as { isbn, quantity } for operator UI
  async getGlobalOverflow() {
    // item_id -> isbn map
    const itemIdToIsbn = new Map();
    for (const [isbn, item] of itemsByIsbn.entries()) {
      itemIdToIsbn.set(item.item_id, isbn);
    }

    const out = [];
    for (const o of globalOverflow) {
      const isbn = itemIdToIsbn.get(o.item_id);
      if (!isbn) continue;
      const qty = Number(o.quantity || 0);
      if (qty <= 0) continue;
      out.push({ isbn, quantity: qty });
    }

    out.sort((a, b) => (b.quantity || 0) - (a.quantity || 0) || String(a.isbn).localeCompare(String(b.isbn)));
    return out;
  },

  // Summary for dashboards / sidebar
  async getSummary() {
    recomputeUsed();

    const rows = ["A", "B", "C", "D"];

    // Total inventory (all stock in all locations)
    const totalCopies = stockLevels.reduce((sum, s) => sum + (s.quantity || 0), 0);

    // Row aggregates
    const perRow = {};
    for (const r of rows) {
      const rowLocs = locations.filter((l) => l.row === r);
      const capacity = rowLocs.reduce((sum, l) => sum + (l.capacity || 0), 0);
      const used = rowLocs.reduce((sum, l) => sum + (l.used || 0), 0);
      const ratio = capacity > 0 ? used / capacity : 0;
      perRow[r] = {
        row: r,
        used,
        capacity,
        percent_full: Math.round(ratio * 100),
      };
    }

    // Alerts: shelves over 95% full (ignore capacity 0 shelves)
    const alerts = locations
      .filter((l) => (l.capacity || 0) > 0)
      .map((l) => ({
        location_id: l.location_id,
        location_code: l.location_code,
        row: l.row,
        bay: l.bay,
        side: l.side,
        used: l.used,
        capacity: l.capacity,
        percent_full: l.capacity > 0 ? Math.round((l.used / l.capacity) * 100) : 0,
      }))
      .filter((a) => a.percent_full >= 95)
      .sort((a, b) => b.percent_full - a.percent_full);

    // --- Chronic Full Detection ---
    // Record one "sample" per summary generation (this is what the UI polls).
    for (const loc of locations.filter((l) => (l.capacity || 0) > 0)) {
      noteChronicSampleForLocation(loc);
    }

    const chronic_full = locations
      .filter((l) => (l.capacity || 0) > 0)
      .map((l) => {
        const st = chronicShelfStats.get(l.location_id) || { samples: 0, hits: 0, last_seen: null };
        const pct = l.capacity > 0 ? Math.round((l.used / l.capacity) * 100) : 0;
        return {
          location_id: l.location_id,
          location_code: l.location_code,
          row: l.row,
          bay: l.bay,
          side: l.side,
          used: l.used,
          capacity: l.capacity,
          percent_full: pct,
          samples: st.samples,
          hits: st.hits,
          hit_rate: st.samples > 0 ? Math.round((st.hits / st.samples) * 100) : 0,
          last_seen: st.last_seen,
        };
      })
      .filter((x) => (x.hits || 0) >= CHRONIC_MIN_HITS)
      .sort((a, b) => (b.hits || 0) - (a.hits || 0));

    return {
      total_copies: totalCopies,
      rows: perRow,
      alerts,
      chronic_full,
      updated_at: new Date().toISOString(),
    };
  },

  async getLayout() {
    recomputeUsed();
    return locations.map((loc) => ({
      location_id: loc.location_id,
      row: loc.row,
      bay: loc.bay,
      side: loc.side,
      location_code: loc.location_code,
      capacity: loc.capacity,
      used: loc.used,
      free: loc.capacity - loc.used,
    }));
  },

  // Inventory that could not be placed anywhere
  async getGlobalOverflow() {
    const result = [];
    for (const rec of globalOverflow) {
      const item = [...itemsByIsbn.entries()].find(([, it]) => it.item_id === rec.item_id);
      if (!item) continue;
      result.push({ isbn: item[0], quantity: rec.quantity });
    }
    return result;
  },

  // Build a guided pick plan for an order.
  // Input: lines = [{ isbn, quantity }]
  // Output: { steps: [{ isbn, quantity, location_id, location_code, row, bay, side, level }], missing: [{ isbn, requested, available, short }], totals: { requested, available } }
  // IMPORTANT: Only Levels 1–4 are pickable. Blowout (Level 5) is excluded.
  async buildPickPlan(lines) {
    recomputeUsed();

    const normalized = Array.isArray(lines)
      ? lines
          .map((l) => ({
            isbn: String(l?.isbn || '').trim(),
            quantity: Number(l?.quantity || 0),
          }))
          .filter((l) => l.isbn && l.quantity > 0 && !Number.isNaN(l.quantity))
      : [];

    const missing = [];
    const steps = [];

    // Build a serpentine walking route to avoid backtracking.
    // Row order is A → B → C (D exists but is capacity 0 for books).
    const aisleOrder = ['A', 'B', 'C', 'D'];

    function rowDir(row) {
      const idx = aisleOrder.indexOf(row);
      return idx % 2 === 0 ? 'ASC' : 'DESC';
    }

    // Route locations in the exact walking order we want pickers to follow.
    const sortedLocs = [...locations]
      .filter((l) => (l.capacity || 0) > 0) // ignore capacity 0 faces
      .sort((a, b) => {
        const ra = aisleOrder.indexOf(a.row);
        const rb = aisleOrder.indexOf(b.row);
        if (ra !== rb) return ra - rb;

        const dir = rowDir(a.row);
        if (a.bay !== b.bay) {
          return dir === 'ASC' ? (a.bay - b.bay) : (b.bay - a.bay);
        }

        // Prefer Front then Back (keeps picker on one side first)
        const sa = a.side === 'F' ? 0 : 1;
        const sb = b.side === 'F' ? 0 : 1;
        return sa - sb;
      });

    let totalRequested = 0;
    let totalAvailable = 0;

    for (const line of normalized) {
      const item = itemsByIsbn.get(line.isbn);
      const requested = Math.floor(line.quantity);
      totalRequested += requested;

      if (!item) {
        missing.push({ isbn: line.isbn, requested, available: 0, short: requested });
        continue;
      }

      const available = stockLevels
        .filter((s) => s.item_id === item.item_id && (s.quantity || 0) > 0)
        .reduce((sum, s) => sum + (s.quantity || 0), 0);

      totalAvailable += available;

      if (available <= 0) {
        missing.push({ isbn: line.isbn, requested, available: 0, short: requested });
        continue;
      }

      let remaining = requested;

      for (const loc of sortedLocs) {
        if (remaining <= 0) break;

        for (const level of NORMAL_LEVELS) {
          if (remaining <= 0) break;

          const rec = stockLevels.find(
            (s) =>
              s.item_id === item.item_id &&
              s.location_id === loc.location_id &&
              (s.level || 1) === level &&
              (s.quantity || 0) > 0
          );
          if (!rec) continue;

          const take = Math.min(rec.quantity, remaining);
          if (take <= 0) continue;

          steps.push({
            isbn: line.isbn,
            quantity: take,
            location_id: loc.location_id,
            location_code: loc.location_code,
            row: loc.row,
            bay: loc.bay,
            side: loc.side,
            level,
          });

          remaining -= take;
        }
      }

      if (remaining > 0) {
        missing.push({ isbn: line.isbn, requested, available, short: remaining });
      }
    }

    // --- Group raw steps into physical STOPS (one stop per shelf face) ---
    // This matches how a picker actually works: stop once, grab all ISBNs there.
    const stopMap = new Map();

    function stopKey(s) {
      return `${s.row}-${String(s.bay).padStart(2, '0')}-${s.side}`;
    }

    for (const s of steps) {
      const key = stopKey(s);
      if (!stopMap.has(key)) {
        stopMap.set(key, {
          key,
          row: s.row,
          bay: s.bay,
          side: s.side,
          location_id: s.location_id,
          location_code: s.location_code,
          picks: [],
        });
      }
      stopMap.get(key).picks.push({ isbn: s.isbn, quantity: s.quantity, level: s.level });
    }

    // Aggregate within each stop by ISBN (keep level detail for shelf finding)
    for (const stop of stopMap.values()) {
      const byIsbn = new Map();
      for (const p of stop.picks) {
        const prev = byIsbn.get(p.isbn) || { isbn: p.isbn, quantity: 0, levels: [] };
        prev.quantity += p.quantity;
        prev.levels.push({ level: p.level, quantity: p.quantity });
        byIsbn.set(p.isbn, prev);
      }
      stop.picks = Array.from(byIsbn.values()).sort((a, b) => a.isbn.localeCompare(b.isbn));
    }

    // Order stops using the same serpentine rule used to generate steps
    // (repeat aisleOrder/rowDir helpers)
    // already defined above
    function sideOrder(side) {
      return String(side || '').toUpperCase().charAt(0) === 'F' ? 0 : 1;
    }

    const stops = Array.from(stopMap.values()).sort((a, b) => {
      const ra = aisleOrder.indexOf(a.row);
      const rb = aisleOrder.indexOf(b.row);
      if (ra !== rb) return ra - rb;

      const dir = rowDir(a.row);
      if (a.bay !== b.bay) {
        return dir === 'ASC' ? (a.bay - b.bay) : (b.bay - a.bay);
      }

      return sideOrder(a.side) - sideOrder(b.side);
    });

    // Build a simple UI diagram model: rows with bays visited in order.
    const diagram = {
      aisle_order: aisleOrder,
      rows: [],
    };

    for (const r of aisleOrder) {
      const rowStops = stops.filter((s) => s.row === r);
      if (!rowStops.length) continue;
      const baysInOrder = [];
      for (const s of rowStops) {
        const label = `${r}-${String(s.bay).padStart(2, '0')}-${s.side}`;
        if (!baysInOrder.includes(label)) baysInOrder.push(label);
      }
      diagram.rows.push({ row: r, direction: rowDir(r), path: baysInOrder });
    }

    return {
      // Fine-grained picks (still useful for debugging)
      steps,

      // What the warehouse actually needs: stop once, grab multiple ISBNs
      stops,

      // Simple diagram data for the UI
      diagram,

      missing,
      totals: { requested: totalRequested, available: totalAvailable },
      generated_at: new Date().toISOString(),
    };
  }
};