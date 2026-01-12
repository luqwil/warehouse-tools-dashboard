// src/controllers/inventory.js
import { db } from "../services/db.js";

// GET /inventory/inventory-index?query=978...
export async function getInventoryIndex(c) {
  const query = c.req.query('query') || '';
  const items = await db.getInventoryIndex({ query });

  // Keep responses small for UI
  const limited = items.slice(0, 200);
  return c.json({
    count: limited.length,
    items: limited,
  });
}

// POST /inventory/suggest-location
export async function suggestLocation(c) {
  const body = await c.req.json();
  const isbn = body?.isbn;
  const quantity = Number(body?.quantity);

  if (!isbn || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: "isbn and positive quantity are required" }, 400);
  }

  await db.getOrCreateItemByIsbn(isbn);

  const loc = await db.findLocationWithFreeSpace(quantity);
  if (!loc) {
    return c.json({ message: "No single shelf has enough free space" }, 409);
  }

  return c.json({
    location_code: loc.location_code,
    location_id: loc.location_id,
  });
}

// POST /inventory/receive
export async function receiveStock(c) {
  const body = await c.req.json();
  const isbn = body?.isbn;
  const quantity = Number(body?.quantity);

  if (!isbn || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: "isbn and positive quantity are required" }, 400);
  }

  const item = await db.getOrCreateItemByIsbn(isbn);

  const allocations = await db.addStockSplit({
    itemId: item.item_id,
    totalQty: quantity,
  });

  if (!allocations || !allocations.length) {
    return c.json({ message: "No shelves have free space for this item" }, 409);
  }

  return c.json({
    ok: true,
    isbn,
    received: quantity,
    allocations: allocations.map((a) => ({
      location_id: a.location_id,
      location_code: a.location_code,
      quantity: a.quantity,
      level: a.level,
      blowout: a.blowout,
      // Present only on the UNASSIGNED-OVERFLOW allocation
      blowout_suggestions: Array.isArray(a.blowout_suggestions) ? a.blowout_suggestions : undefined,
    })),
  });
}

// GET /inventory/layout
export async function getLayout(c) {
  const layout = await db.getLayout();
  return c.json(layout);
}

// GET /inventory/item-locations?isbn=...
export async function getItemLocations(c) {
  const isbn = c.req.query("isbn");
  if (!isbn) {
    return c.json({ message: "isbn query param is required" }, 400);
  }

  const locations = await db.getItemLocationsByIsbn(isbn);
  const total = locations.reduce((sum, l) => sum + (Number(l.quantity) || 0), 0);

  return c.json({ isbn, total, locations });
}

// POST /inventory/ship
export async function shipStock(c) {
  const body = await c.req.json();
  const isbn = body?.isbn;
  const quantity = Number(body?.quantity);

  if (!isbn || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: "isbn and positive quantity are required" }, 400);
  }

  const item = await db.findItemByIsbn(isbn);
  if (!item) {
    return c.json({ message: "No stock exists for this ISBN" }, 404);
  }

  const result = await db.shipStockSplit({
    itemId: item.item_id,
    totalQty: quantity,
  });

  if (!result?.success) {
    return c.json(
      {
        message: "Not enough stock to ship requested quantity",
        requested: quantity,
        totalAvailable: result?.totalAvailable ?? 0,
      },
      409
    );
  }

  return c.json({
    ok: true,
    isbn,
    totalShipped: quantity,
    allocations: result.allocations || [],
  });
}

// GET /inventory/shelf?row=...&bay=...&side=...
export async function getShelfContents(c) {
  const row = c.req.query("row");
  const bay = c.req.query("bay");
  const sideParam = c.req.query("side");

  if (!row || !bay || !sideParam) {
    return c.json({ message: "row, bay, and side query params are required" }, 400);
  }

  const side = String(sideParam).toUpperCase().charAt(0); // 'F' or 'B'
  const shelf = await db.getShelfContents({ row, bay, side });

  if (!shelf?.location) {
    return c.json({ message: "Shelf not found for given row/bay/side" }, 404);
  }

  return c.json(shelf);
}

// POST /inventory/ship-from-shelf
export async function shipFromShelf(c) {
  const body = await c.req.json();
  const isbn = body?.isbn;
  const locationId = body?.location_id;
  const quantity = Number(body?.quantity);

  if (!isbn || !locationId || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: "isbn, location_id, and positive quantity are required" }, 400);
  }

  const item = await db.findItemByIsbn(isbn);
  if (!item) {
    return c.json({ message: "No stock exists for this ISBN" }, 404);
  }

  const result = await db.shipFromShelf({
    itemId: item.item_id,
    locationId,
    quantity,
  });

  if (!result?.success) {
    return c.json(
      {
        message: "Not enough stock on this shelf to ship requested quantity",
        requested: quantity,
        available: result?.available ?? 0,
      },
      409
    );
  }

  return c.json({
    ok: true,
    isbn,
    location_id: locationId,
    shipped: result.shipped,
    remaining_on_shelf: result.remaining,
  });
}

// POST /inventory/assign-to-blowout
export async function assignToBlowout(c) {
  const body = await c.req.json();
  const isbn = body?.isbn;
  const quantity = Number(body?.quantity);
  const row = body?.row;
  const bay = body?.bay;
  const sideParam = body?.side;

  if (!isbn || !row || !bay || !sideParam || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: "isbn, row, bay, side, and positive quantity are required" }, 400);
  }

  const side = String(sideParam).toUpperCase().charAt(0);
  const item = await db.getOrCreateItemByIsbn(isbn);

  const result = await db.assignToBlowout({
    itemId: item.item_id,
    row,
    bay,
    side,
    quantity,
  });

  if (!result?.success) {
    return c.json({ message: result?.message || "Unable to assign to blowout" }, 400);
  }

  const shelf = await db.getShelfContents({ row, bay, side });
  return c.json({ ok: true, shelf });
}

// GET /inventory/global-overflow
export async function getGlobalOverflow(c) {
  const items = await db.getGlobalOverflow();
  const total = items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);
  return c.json({ total, items });
}

// POST /inventory/assign-overflow-to-blowout
// Moves quantity from UNASSIGNED overflow into Blowout (Level 5) at a specific shelf face.
export async function assignOverflowToBlowout(c) {
  const body = await c.req.json().catch(() => ({}));
  const isbn = body?.isbn;
  const quantity = Number(body?.quantity);
  const row = body?.row;
  const bay = body?.bay;
  const sideParam = body?.side;

  if (!isbn || !row || bay == null || !sideParam || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: "isbn, row, bay, side, and positive quantity are required" }, 400);
  }

  const side = String(sideParam).toUpperCase().charAt(0);

  const result = await db.assignOverflowToBlowout({
    isbn,
    row,
    bay,
    side,
    quantity,
  });

  if (!result?.success) {
    return c.json({ message: result?.message || "Unable to assign overflow to blowout" }, 400);
  }

  // Return fresh shelf + fresh overflow list for UI refresh
  const shelf = await db.getShelfContents({ row, bay, side });
  const overflowItems = await db.getGlobalOverflow();
  const overflowTotal = overflowItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0);

  return c.json({
    ok: true,
    moved: result.moved,
    remaining_overflow: result.remaining_overflow,
    location_code: result.location_code,
    new_total_on_blowout: result.new_total_on_blowout,
    shelf,
    global_overflow: { total: overflowTotal, items: overflowItems },
  });
}

// POST /inventory/pick-plan
export async function getPickPlan(c) {
  const body = await c.req.json().catch(() => ({}));
  const lines = Array.isArray(body?.lines) ? body.lines : [];

  if (!lines.length) {
    return c.json({ message: "lines[] is required (e.g., [{isbn, quantity}])" }, 400);
  }

  const plan = await db.buildPickPlan(lines);
  return c.json(plan);
}

// POST /inventory/put-to-shelf
// Barcode receiving: body supports either { isbn, quantity, shelf_barcode }
// where shelf_barcode looks like "B-02-F-L1", or explicit { row, bay, side, level }.
export async function putToShelf(c) {
  const body = await c.req.json().catch(() => ({}));

  const isbn = String(body?.isbn || '').trim();
  const quantity = Number(body?.quantity);

  if (!isbn || !quantity || Number.isNaN(quantity) || quantity <= 0) {
    return c.json({ message: 'isbn and positive quantity are required' }, 400);
  }

  let row = body?.row;
  let bay = body?.bay;
  let side = body?.side;
  let level = body?.level;

  const shelfBarcode = String(body?.shelf_barcode || '').trim().toUpperCase();
  if (shelfBarcode) {
    // Expected: A-01-F-L1
    const m = shelfBarcode.match(/^([A-D])-(\d{1,2})-(F|B)-L([1-4])$/);
    if (!m) {
      return c.json({ message: 'Invalid shelf barcode. Use format like B-02-F-L1' }, 400);
    }
    row = m[1];
    bay = Number(m[2]);
    side = m[3];
    level = Number(m[4]);
  }

  if (!row || bay == null || !side || level == null) {
    return c.json({ message: 'Shelf is required (shelf_barcode or row/bay/side/level).' }, 400);
  }

  const res = await db.putToExactShelfLevel({
    isbn,
    row,
    bay,
    side,
    level,
    quantity,
  });

  if (!res?.success) {
    return c.json({ message: res?.message || 'Unable to place on shelf.' }, 400);
  }

  // Return fresh shelf contents for immediate UI feedback
  const shelf = await db.getShelfContents({ row: String(row).toUpperCase(), bay, side: String(side).toUpperCase().charAt(0) });

  return c.json({
    ok: true,
    isbn,
    requested: quantity,
    placed: res.placed || 0,
    remaining: res.remaining || 0,
    location_code: res.location_code,
    level: res.level,
    shelf,
    message: res.message,
  });
}