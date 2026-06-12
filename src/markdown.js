import { parseGraph } from "./parser.js";
import { renderGraph } from "./renderer.js";

export const GRAPHSX_FENCE = "graphsx";

export function graphsxMarkdownIt(md, options = {}) {
  const fenceName = options.fenceName ?? GRAPHSX_FENCE;
  const markerClass = options.markerClass ?? "graphsx-block";
  const previousFence = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, index, renderOptions, env, self) => {
    const token = tokens[index];
    const info = token.info.trim().split(/\s+/)[0];

    if (info !== fenceName) {
      if (previousFence) {
        return previousFence(tokens, index, renderOptions, env, self);
      }
      return self.renderToken(tokens, index, renderOptions);
    }

    const source = md.utils.escapeHtml(token.content);
    return `<div class="${markerClass}" data-graphsx="true"><template class="graphsx-source">${source}</template></div>\n`;
  };
}

export function renderGraphSXBlocks(root, options = {}) {
  const blocks = [
    ...root.querySelectorAll(".graphsx-block[data-graphsx]"),
    ...root.querySelectorAll("pre > code.language-graphsx")
  ];

  for (const block of blocks) {
    const host = block.matches("code") ? block.closest("pre") : block;
    const source = block.matches("code") ? block.textContent : block.querySelector("template.graphsx-source")?.content.textContent;
    if (!host || source == null) continue;

    host.replaceChildren();
    host.classList.add("graphsx-rendered");

    try {
      const graph = parseGraph(source);
      const documentRef = options.document ?? host.ownerDocument ?? document;
      const svg = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
      renderGraph(svg, graph, options);
      host.append(svg);
    } catch (error) {
      host.classList.add("graphsx-error");
      const pre = (options.document ?? host.ownerDocument ?? document).createElement("pre");
      pre.textContent = error.message;
      host.append(pre);
    }
  }
}
