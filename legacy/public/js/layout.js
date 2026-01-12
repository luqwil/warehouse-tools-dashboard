import { initLayout } from "./layout.events.js";

// Load Pick Lists workflow (kept separate from layout grid for stability)
(function loadPickListsModule() {
  if (window.__wms_picklists_loader_ran) return;
  window.__wms_picklists_loader_ran = true;

  const existing = Array.from(document.scripts || []).some((s) => (s.src || "").includes("/js/picklists.js"));
  if (existing) return;

  const script = document.createElement("script");
  script.src = "/js/picklists.js";
  script.defer = true;
  document.head.appendChild(script);
})();

initLayout();
