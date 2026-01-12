import { Hono } from "hono";
import {
  suggestLocation,
  receiveStock,
  getLayout,
  getItemLocations,
  shipStock,
  getShelfContents,
  shipFromShelf,
  assignToBlowout,
  getGlobalOverflow,
  assignOverflowToBlowout,
  getPickPlan,
  getInventoryIndex,
  putToShelf,
} from "../controllers/inventory.js";

export const inventoryRouter = new Hono();

// POST /inventory/suggest-location
inventoryRouter.post("/suggest-location", suggestLocation);

// POST /inventory/receive
inventoryRouter.post("/receive", receiveStock);

// POST /inventory/put-to-shelf (barcode receiving)
inventoryRouter.post("/put-to-shelf", putToShelf);

// GET /inventory/layout
inventoryRouter.get("/layout", getLayout);

// GET /inventory/item-locations?isbn=...
inventoryRouter.get("/item-locations", getItemLocations);

// POST /inventory/ship
inventoryRouter.post("/ship", shipStock);

// GET /inventory/shelf?row=A&bay=1&side=F
inventoryRouter.get("/shelf", getShelfContents);

// POST /inventory/ship-from-shelf
inventoryRouter.post("/ship-from-shelf", shipFromShelf);

// POST /inventory/assign-to-blowout
inventoryRouter.post("/assign-to-blowout", assignToBlowout);

// GET /inventory/global-overflow
inventoryRouter.get("/global-overflow", getGlobalOverflow);

// POST /inventory/assign-overflow-to-blowout
inventoryRouter.post("/assign-overflow-to-blowout", assignOverflowToBlowout);

// POST /inventory/pick-plan
inventoryRouter.post("/pick-plan", getPickPlan);

// GET /inventory/inventory-index
inventoryRouter.get("/inventory-index", getInventoryIndex);