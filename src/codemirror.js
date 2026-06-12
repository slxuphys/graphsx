import { StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { GRAPHSX_DEFS_FENCE, GRAPHSX_FENCE, parseFenceInfo, parseGraphWithLibraries } from "./markdown.js";
import { renderGraph } from "./renderer.js";

export function graphsxCodeMirrorLivePreview(options = {}) {
  const config = {
    katex: options.katex,
    renderOptions: {
      minWidth: 0,
      minHeight: 0,
      viewportPadding: 24,
      ...options.renderOptions
    },
    classNames: {
      graph: "graphsx-live-widget",
      definition: "graphsx-live-def",
      error: "graphsx-live-error",
      ...options.classNames
    }
  };

  return StateField.define({
    create(state) {
      return buildLiveMarkdownDecorations(state.doc.toString(), state.selection, config);
    },

    update(value, transaction) {
      return transaction.docChanged || transaction.selection
        ? buildLiveMarkdownDecorations(transaction.state.doc.toString(), transaction.state.selection, config)
        : value;
    },

    provide(field) {
      return EditorView.decorations.from(field);
    }
  });
}

function buildLiveMarkdownDecorations(source, selection, config) {
  const blocks = findGraphSXFences(source);
  const libraries = collectFenceLibraries(blocks);
  const ranges = [];

  for (const block of blocks) {
    if (selectionTouchesBlock(selection, block)) {
      continue;
    }

    if (block.info.name === GRAPHSX_DEFS_FENCE) {
      ranges.push(Decoration.replace({
        block: true,
        widget: new GraphSXDefinitionWidget(block, config)
      }).range(block.from, block.to));
      continue;
    }

    if (block.info.name === GRAPHSX_FENCE) {
      ranges.push(Decoration.replace({
        block: true,
        widget: new GraphSXPreviewWidget(block, libraries, config)
      }).range(block.from, block.to));
    }
  }

  return Decoration.set(ranges, true);
}

class GraphSXDefinitionWidget extends WidgetType {
  constructor(block, config) {
    super();
    this.from = block.from;
    this.name = block.info.attrs.name ?? block.info.attrs.id ?? block.info.args[0] ?? "default";
    this.className = config.classNames.definition;
    this.key = `${block.info.raw}\n${block.source}`;
  }

  eq(other) {
    return other.key === this.key && other.name === this.name && other.className === this.className;
  }

  toDOM(view) {
    const element = document.createElement("button");
    element.type = "button";
    element.className = this.className;
    element.title = "Click to edit this GraphSX library";
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.from },
        scrollIntoView: true
      });
      view.focus();
    });

    const label = document.createElement("span");
    label.textContent = "GraphSX library";
    const name = document.createElement("code");
    name.textContent = this.name;
    element.append(label, name);
    return element;
  }

  ignoreEvent() {
    return false;
  }
}

class GraphSXPreviewWidget extends WidgetType {
  constructor(block, libraries, config) {
    super();
    this.from = block.from;
    this.source = block.source;
    this.use = block.info.attrs.use ?? "";
    this.libraryMap = new Map(libraries);
    this.libraryKey = [...libraries.entries()].map(([name, library]) => `${name}:${library.source}`).join("\n---\n");
    this.config = config;
  }

  eq(other) {
    return other.source === this.source
      && other.use === this.use
      && other.libraryKey === this.libraryKey
      && other.config === this.config;
  }

  toDOM(view) {
    const element = document.createElement("div");
    element.className = this.config.classNames.graph;
    element.title = "Click to edit this GraphSX block";
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({
        selection: { anchor: this.from },
        scrollIntoView: true
      });
      view.focus();
    });

    try {
      const graph = parseGraphWithLibraries(this.source, this.libraryMap, this.use);
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      const size = renderGraph(svg, graph, {
        ...this.config.renderOptions,
        katex: this.config.katex
      });
      svg.setAttribute("width", size.width);
      svg.setAttribute("height", size.height);
      element.append(svg);
    } catch (error) {
      element.className = this.config.classNames.error;
      element.textContent = error.message;
    }

    return element;
  }

  ignoreEvent() {
    return false;
  }
}

export function findGraphSXFences(source) {
  const blocks = [];
  const lines = source.split(/(?<=\n)/);
  let offset = 0;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = line.match(/^```([^\r\n`]*)\r?\n?$/);
    if (!match) {
      offset += line.length;
      index += 1;
      continue;
    }

    const info = parseFenceInfo(match[1]);
    const start = offset;
    const contentStart = offset + line.length;
    offset += line.length;
    index += 1;

    let contentEnd = offset;
    while (index < lines.length && !/^```\s*(?:\r?\n)?$/.test(lines[index])) {
      contentEnd += lines[index].length;
      offset += lines[index].length;
      index += 1;
    }

    if (index >= lines.length) break;

    const closingLine = lines[index];
    const end = offset + closingLine.length;
    const sourceText = source.slice(contentStart, contentEnd);
    blocks.push({
      from: start,
      to: end,
      source: sourceText.replace(/\r?\n$/, ""),
      info: { ...info, raw: match[1].trim() }
    });

    offset = end;
    index += 1;
  }

  return blocks.filter((block) => block.info.name === GRAPHSX_FENCE || block.info.name === GRAPHSX_DEFS_FENCE);
}

function collectFenceLibraries(blocks) {
  const libraries = new Map();

  for (const block of blocks) {
    if (block.info.name !== GRAPHSX_DEFS_FENCE) continue;
    const name = block.info.attrs.name ?? block.info.attrs.id ?? block.info.args[0] ?? "default";
    libraries.set(name, { name, source: block.source });
  }

  return libraries;
}

function selectionTouchesBlock(selection, block) {
  if (!selection) return false;
  return selection.ranges.some((range) => range.from <= block.to && range.to >= block.from);
}
