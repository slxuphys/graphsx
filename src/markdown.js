import { buildGraphModel, parseGraph, parseMarkup } from "./parser.js";
import { renderGraph } from "./renderer.js";

export const GRAPHSX_FENCE = "graphsx";
export const GRAPHSX_DEFS_FENCE = "graphsx-defs";

export function graphsxMarkdownIt(md, options = {}) {
  const fenceName = options.fenceName ?? GRAPHSX_FENCE;
  const defsFenceName = options.defsFenceName ?? GRAPHSX_DEFS_FENCE;
  const markerClass = options.markerClass ?? "graphsx-block";
  const defsClass = options.defsClass ?? "graphsx-defs";
  const previousFence = md.renderer.rules.fence;

  md.renderer.rules.fence = (tokens, index, renderOptions, env, self) => {
    const token = tokens[index];
    const info = parseFenceInfo(token.info);

    if (info.name === defsFenceName) {
      const name = info.attrs.name ?? info.attrs.id ?? info.args[0] ?? "default";
      const source = md.utils.escapeHtml(token.content);
      return `<div class="${defsClass}" data-graphsx-defs="${md.utils.escapeHtml(name)}" hidden><template class="graphsx-source">${source}</template></div>\n`;
    }

    if (info.name !== fenceName) {
      if (previousFence) {
        return previousFence(tokens, index, renderOptions, env, self);
      }
      return self.renderToken(tokens, index, renderOptions);
    }

    const source = md.utils.escapeHtml(token.content);
    const use = info.attrs.use ? ` data-graphsx-use="${md.utils.escapeHtml(info.attrs.use)}"` : "";
    return `<div class="${markerClass}" data-graphsx="true"${use}><template class="graphsx-source">${source}</template></div>\n`;
  };
}

export function renderGraphSXBlocks(root, options = {}) {
  const libraries = collectGraphSXLibraries(root);
  const blocks = [
    ...root.querySelectorAll(".graphsx-block[data-graphsx]"),
    ...root.querySelectorAll("pre > code.language-graphsx")
  ];

  for (const block of blocks) {
    const host = block.matches("code") ? block.closest("pre") : block;
    const source = block.matches("code") ? block.textContent : block.querySelector("template.graphsx-source")?.content.textContent;
    const use = block.matches("code") ? "" : block.getAttribute("data-graphsx-use") ?? "";
    if (!host || source == null) continue;

    host.replaceChildren();
    host.classList.add("graphsx-rendered");

    try {
      const graph = use ? parseGraphWithLibraries(source, libraries, use) : parseGraph(source);
      const documentRef = options.document ?? host.ownerDocument ?? document;
      const svg = documentRef.createElementNS("http://www.w3.org/2000/svg", "svg");
      const renderOptions = {
        minWidth: 0,
        minHeight: 0,
        viewportPadding: 24,
        ...options
      };
      const size = renderGraph(svg, graph, renderOptions);
      svg.setAttribute("width", size.width);
      svg.setAttribute("height", size.height);
      host.append(svg);
    } catch (error) {
      host.classList.add("graphsx-error");
      const pre = (options.document ?? host.ownerDocument ?? document).createElement("pre");
      pre.textContent = error.message;
      host.append(pre);
    }
  }
}

export function parseGraphWithLibraries(source, libraries, use) {
  const defs = resolveUsedLibraries(libraries, use);
  if (defs.length === 0) {
    return parseGraph(source);
  }

  const roots = parseMarkup(source).filter((node) => node.type === "element");
  if (roots.length !== 1 || roots[0].name !== "Graph") {
    return parseGraph(source);
  }

  const graph = roots[0];
  return buildGraphModel({
    ...graph,
    children: [
      ...defs.flatMap((item) => parseMarkup(item.source).filter((node) => node.type === "element")),
      ...graph.children
    ]
  });
}

export function parseFenceInfo(rawInfo = "") {
  const source = rawInfo.trim();
  const nameMatch = source.match(/^(\S+)/);
  const name = nameMatch?.[1] ?? "";
  const rest = name ? source.slice(name.length).trim() : "";
  const args = [];
  const attrs = {};

  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)=("([^"]*)"|'([^']*)'|[^\s]+)|"([^"]*)"|'([^']*)'|(\S+)/g;
  let match = pattern.exec(rest);
  while (match) {
    if (match[1]) {
      attrs[match[1]] = match[3] ?? match[4] ?? match[2];
    } else {
      args.push(match[5] ?? match[6] ?? match[7]);
    }
    match = pattern.exec(rest);
  }

  return { name, args, attrs };
}

function collectGraphSXLibraries(root) {
  const libraries = new Map();
  for (const block of root.querySelectorAll(".graphsx-defs[data-graphsx-defs]")) {
    const name = block.getAttribute("data-graphsx-defs");
    const source = block.querySelector("template.graphsx-source")?.content.textContent;
    if (!name || source == null) continue;
    libraries.set(name, { name, source });
  }
  return libraries;
}

function resolveUsedLibraries(libraries, use) {
  return splitUseList(use).map((name) => {
    const library = libraries instanceof Map ? libraries.get(name) : libraries?.[name];
    if (!library) {
      throw new Error(`Unknown GraphSX library "${name}"`);
    }
    return typeof library === "string" ? { name, source: library } : library;
  });
}

function splitUseList(use) {
  return String(use).split(/[\s,]+/).map((name) => name.trim()).filter(Boolean);
}
