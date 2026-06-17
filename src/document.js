import { buildGraphModel, parseGraph, parseMarkup } from "./parser.js";
import { buildPlotModel } from "./plot.js";
import { renderGraph, graphSummary } from "./renderer.js";
import { renderPlot, plotSummary } from "./plot-renderer.js";
import { GraphDslError } from "./errors.js";

export function parseGraphSXDocument(source, options = {}) {
  const roots = parseMarkup(source).filter((node) => node.type === "element");
  if (roots.length !== 1) {
    throw new GraphDslError(`Expected exactly one top-level element, found ${roots.length}`);
  }

  const root = roots[0];
  if (root.name === "Graph") {
    return options.libraries && options.use
      ? buildGraphWithLibraries(root, options.libraries, options.use)
      : parseGraph(source);
  }
  if (root.name === "Plot") {
    if (options.use) {
      throw new GraphDslError(`Libraries are currently only supported for <Graph> documents`);
    }
    return buildPlotModel(root);
  }
  throw new GraphDslError(`Top-level element must be <Graph> or <Plot>`);
}

export function renderGraphSXDocument(svg, documentModel, options = {}) {
  if (documentModel.type === "graph") {
    return renderGraph(svg, documentModel, options);
  }
  if (documentModel.type === "plot") {
    return renderPlot(svg, documentModel, options);
  }
  throw new GraphDslError(`Unknown document model type "${documentModel.type}"`);
}

export function graphSXDocumentSummary(documentModel) {
  if (documentModel.type === "graph") return graphSummary(documentModel);
  if (documentModel.type === "plot") return plotSummary(documentModel);
  throw new GraphDslError(`Unknown document model type "${documentModel.type}"`);
}

function buildGraphWithLibraries(graph, libraries, use) {
  const defs = resolveUsedLibraries(libraries, use);
  if (defs.length === 0) {
    return buildGraphModel(graph);
  }

  return buildGraphModel({
    ...graph,
    children: [
      ...defs.flatMap((item) => parseMarkup(item.source).filter((node) => node.type === "element")),
      ...graph.children
    ]
  });
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
