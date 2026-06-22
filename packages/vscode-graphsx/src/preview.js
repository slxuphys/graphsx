import katex from "katex";
import { renderGraphSXBlocks } from "../../../src/index.js";

let renderQueued = false;

function renderGraphSXPreview() {
  renderQueued = false;
  renderGraphSXBlocks(document.body, { katex });
}

function queueRenderGraphSXPreview() {
  if (renderQueued) {
    return;
  }

  renderQueued = true;
  requestAnimationFrame(renderGraphSXPreview);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", renderGraphSXPreview, { once: true });
} else {
  renderGraphSXPreview();
}

new MutationObserver(queueRenderGraphSXPreview).observe(document.body, {
  childList: true,
  subtree: true
});
