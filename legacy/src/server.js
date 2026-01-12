// src/server.js
import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { inventoryRouter } from "./routes/inventory.js";

const app = new Hono();

// Serve static assets from ./public
app.get("/css/*", serveStatic({ root: "./public" }));
app.get("/js/*", serveStatic({ root: "./public" }));

// Simple shared HTML shell
function layoutPage({ title, body }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <link rel="stylesheet" href="/css/app.css" />
</head>
<body>
  <div class="app-shell">
    <main class="main">
      ${body}
    </main>
  </div>
</body>
</html>`;
}

// Home → Unified Warehouse page
app.get("/", (c) => c.redirect("/warehouse"));

// Backwards-compatible redirects
app.get("/receive-demo", (c) => c.redirect("/warehouse"));
app.get("/layout", (c) => c.redirect("/warehouse"));

// Unified Warehouse page (Receive + Lookup + Layout)
app.get("/warehouse", (c) =>
  c.html(
    layoutPage({
      title: "Micromarketing Warehouse",
      body: `
      <div class="card">
        <h1>Warehouse</h1>
        <p class="subtitle">
          Receive inventory, lookup ISBNs, and view the live warehouse layout — all on one screen.
        </p>
      </div>


      <div class="card" style="margin-top:24px;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
          <h1>Warehouse Layout</h1>
          <button type="button" id="layout-info-open" class="btn secondary">ℹ️ Layout Guide</button>
        </div>
        <p class="subtitle">
        <div class="legend">
          <div class="legend-item">
            <span class="legend-swatch heat-low"></span>
            <span>Green (0–13 of 40)</span>
          </div>
          <div class="legend-item">
            <span class="legend-swatch heat-mid"></span>
            <span>Yellow (14–26 of 40)</span>
          </div>
          <div class="legend-item">
            <span class="legend-swatch heat-crit"></span>
            <span>Red (27+ of 40)</span>
          </div>
          <div class="legend-item">
            <span class="legend-swatch"></span>
            <span>Level 5 is Blowout</span>
          </div>
        </div>
        <div class="layout-rows" id="rows">Loading…</div>
      </div>


      <div id="shelf-modal" class="modal">
        <div class="modal-backdrop"></div>
        <div class="modal-card">
          <button id="shelf-close" class="modal-close" aria-label="Close shelf details">×</button>
          <div id="shelf-detail" class="result" style="margin-top:0;"></div>
          <div id="shelf-table-container"></div>
        </div>
      </div>

      <div id="layout-info-modal" class="modal">
        <div class="modal-backdrop"></div>
        <div class="modal-card">
          <button id="layout-info-close" class="modal-close" aria-label="Close layout info">×</button>
          <h2 style="margin-top:0;font-size:16px;">Warehouse Layout Guide</h2>
          <p style="font-size:13px;color:#4b5563;margin-bottom:8px;">
            Quick overview of how the shelves are arranged in the warehouse.
          </p>
          <div class="layout-guide-diagram">
            <div class="lg-row">
              <div class="lg-row-label">Row A</div>
              <div class="lg-bays">
                <div class="lg-bay">A-01</div>
                <div class="lg-bay">A-02</div>
                <div class="lg-bay">A-03</div>
                <div class="lg-bay endcap">A-04<span>Endcap</span></div>
              </div>
            </div>
            <div class="lg-row">
              <div class="lg-row-label">Row B</div>
              <div class="lg-bays">
                <div class="lg-bay">B-01</div>
                <div class="lg-bay">B-02</div>
                <div class="lg-bay">B-03</div>
                <div class="lg-bay">B-04</div>
              </div>
            </div>
            <div class="lg-row">
              <div class="lg-row-label">Row C</div>
              <div class="lg-bays">
                <div class="lg-bay">C-01</div>
                <div class="lg-bay">C-02</div>
                <div class="lg-bay">C-03</div>
                <div class="lg-bay">C-04</div>
                <div class="lg-bay endcap">C-05<span>Endcap</span></div>
              </div>
            </div>
            <div class="lg-row">
              <div class="lg-row-label">Row D</div>
              <div class="lg-bays">
                <div class="lg-bay audio">D-01<span>Audio</span></div>
                <div class="lg-bay audio">D-02<span>Audio</span></div>
                <div class="lg-bay audio">D-03<span>Audio</span></div>
                <div class="lg-bay endcap audio">D-04<span>Endcap · Audio</span></div>
              </div>
            </div>
          </div>
          <ul style="font-size:13px;color:#4b5563;padding-left:18px;margin-top:10px;">
            <li>Each box on the layout is a <strong>shelf face</strong> (Front or Back) on a bay.</li>
            <li>Click a shelf face to view contents.</li>
            <li>Faces are split into <strong>Levels 1–4</strong> for normal inventory.</li>
            <li><strong>Level 5</strong> is <strong>Blowout</strong> – manual overflow only, never auto-assigned.</li>
            <li><strong>Row D</strong> is used for <strong>audio/CDs</strong> only and not used for auto receiving.</li>
          </ul>
        </div>
      </div>

      <script src="/js/receive.js"></script>
      <script type="module" src="/js/layout.js"></script>
    `,
    })
  )
);

// Mount inventory routes
app.route("/inventory", inventoryRouter);

export default app;
