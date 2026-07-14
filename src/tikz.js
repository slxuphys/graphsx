import { GraphDslError } from "./errors.js";
import { normalizeDisplayDefaults } from "./display-defaults.js";
import { mathLabelBox, normalizeDisplayMeasure, textLabelBox } from "./measure.js";
import { renderGraphDisplayListToSvg } from "./renderer.js";

const DEFAULT_CM_TO_PX = 80;
const DEFAULT_NODE_WIDTH = 72;
const DEFAULT_NODE_HEIGHT = 42;
const DEFAULT_CIRCLE_R = 18;
const DEFAULT_INNER_SEP = 4;
const DEFAULT_TIKZ_UNITS = {
  cm: DEFAULT_CM_TO_PX,
  pt: 1.3333333333
};
const TIKZ_LINE_WIDTHS = {
  "ultra thin": 0.1,
  "very thin": 0.2,
  thin: 0.4,
  semithick: 0.6,
  thick: 0.8,
  "very thick": 1.2,
  "ultra thick": 1.6
};

export function parseTikz(source, options = {}) {
  const clean = stripComments(source);
  const definitions = parseTikzDefinitions(clean);
  const body = stripTikzSetBlocks(tikzBody(clean));
  const units = normalizeTikzUnits(options);
  const model = {
    type: "tikz",
    units,
    styles: definitions.styles,
    pics: definitions.pics,
    elements: [],
    nodes: [],
    coordinates: [],
    paths: [],
    marks: []
  };
  const state = {
    model,
    anchors: new Map(),
    picSerial: 0,
    defaults: normalizeDisplayDefaults(options.defaults)
  };

  for (const command of parseCommands(body)) {
    if (command.name === "node") parseNodeCommand(state, command.body);
    else if (command.name === "coordinate") parseCoordinateCommand(state, command.body);
    else if (command.name === "draw") parseDrawCommand(state, command.body);
    else if (command.name === "filldraw") parseFillDrawCommand(state, command.body);
    else if (command.name === "pic") parsePicCommand(state, command.body);
  }

  return model;
}

export function buildTikzDisplayList(model, options = {}) {
  const defaults = normalizeDisplayDefaults(options.defaults);
  const measure = normalizeDisplayMeasure(options);
  const resolvedModel = resolveTikzLayout(model, options);
  const items = [];
  for (const path of resolvedModel.paths) {
    items.push({
      layer: "path",
      type: "path",
      props: {
        className: "tikz-path",
        fill: "none",
        stroke: "#111111",
        strokeWidth: 2,
        ...path.props
      },
      style: path.style
    });
  }
  for (const mark of resolvedModel.marks) {
    items.push({
      layer: "node",
      type: "circle",
      props: {
        className: "tikz-mark",
        cx: mark.x,
        cy: mark.y,
        r: mark.r,
        fill: mark.fill ?? "#111111",
        stroke: mark.stroke ?? mark.fill ?? "#111111",
        strokeWidth: mark.strokeWidth ?? 1
      },
      style: mark.style
    });
  }
  for (const node of resolvedModel.nodes) {
    if (node.shape === "circle") {
      items.push({
        layer: "node",
        type: "circle",
        props: {
          className: "tikz-node",
          cx: node.x,
          cy: node.y,
          r: node.r,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth
        },
        style: node.style
      });
    } else if (node.draw) {
      items.push({
        layer: "node",
        type: "rect",
        props: {
          className: "tikz-node",
          x: node.x - node.width / 2,
          y: node.y - node.height / 2,
          width: node.width,
          height: node.height,
          rx: node.corner ?? 0,
          fill: node.fill,
          stroke: node.stroke,
          strokeWidth: node.strokeWidth
        },
        style: node.style
      });
    }
    if (node.label != null && node.label !== "") {
      const math = parseMath(node.label);
      const textStyle = {
        ...(math ? defaults.math : defaults.text),
        ...(node.textStyle ?? {})
      };
      const box = math
        ? (node.labelBox ?? mathLabelBox(math, textStyle, measure, {
          x: node.x,
          y: node.y,
          anchor: "middle",
          fontSize: textStyle.fontSize
        }))
        : (node.labelBox ?? textLabelBox(node.label, textStyle, measure, {
          x: node.x,
          y: node.y,
          anchor: "middle",
          fontSize: textStyle.fontSize
        }));
      items.push(math
        ? {
          layer: "node",
          type: "math",
          source: math,
          x: node.x,
          y: node.y,
          className: "tikz-label",
          anchor: "middle",
          fontSize: textStyle.fontSize,
          box,
          textStyle
        }
        : {
          layer: "node",
          type: "text",
          text: node.label,
          x: node.x,
          y: node.y,
          className: "tikz-label",
          anchor: "middle",
          box,
          textStyle
        });
    }
  }

  const bounds = displayBounds(items);
  const viewportPadding = Number(options.viewportPadding ?? 28);
  const width = Math.max(options.minWidth ?? 0, bounds.maxX - bounds.minX + viewportPadding * 2);
  const height = Math.max(options.minHeight ?? 0, bounds.maxY - bounds.minY + viewportPadding * 2);
  const dx = viewportPadding - bounds.minX;
  const dy = viewportPadding - bounds.minY;
  const shifted = items.map((item) => shiftItem(item, dx, dy));

  return {
    type: "tikz",
    width,
    height,
    bounds,
    arrowMarkers: collectDisplayArrowMarkers(shifted),
    items: shifted
  };
}

export function resolveTikzLayout(model, options = {}) {
  const defaults = normalizeDisplayDefaults(options.defaults);
  const measure = normalizeDisplayMeasure(options);
  const resolved = {
    ...model,
    nodes: [],
    coordinates: [],
    paths: [],
    marks: []
  };
  const state = {
    model,
    anchors: new Map()
  };
  const elements = model.elements?.length
    ? model.elements
    : [
      ...model.nodes.map((item) => ({ type: "node", item })),
      ...model.coordinates.map((item) => ({ type: "coordinate", item }))
    ];

  for (const element of elements) {
    if (element.type === "node") {
      const node = resolveNodeLayout(state, element.item, defaults, measure);
      resolved.nodes.push(node);
      if (!node.anonymous) registerNodeAnchors(state, node);
    } else if (element.type === "coordinate") {
      const coordinate = {
        ...element.item,
        ...resolveCoordinate(stateWithScope(state, element.item.scope), element.item.rawAt ?? `${element.item.x},${element.item.y}`)
      };
      resolved.coordinates.push(coordinate);
      state.anchors.set(coordinate.id, { x: coordinate.x, y: coordinate.y });
      state.anchors.set(`${coordinate.id}.center`, { x: coordinate.x, y: coordinate.y });
    }
  }

  for (const mark of model.marks) {
    const point = resolveCoordinate(stateWithScope(state, mark.scope), mark.rawAt ?? `${mark.x},${mark.y}`);
    resolved.marks.push({
      ...mark,
      ...point,
      r: mark.rawR != null ? lengthToPx(mark.rawR, model.units) : mark.r
    });
  }
  for (const path of model.paths) {
    resolved.paths.push(resolvePathLayout(state, path));
  }
  return resolved;
}

export function parseTikzDocument(source, options = {}) {
  return parseTikz(source, options);
}

export function renderTikz(svg, sourceOrModel, options = {}) {
  const model = typeof sourceOrModel === "string" ? parseTikz(sourceOrModel, options) : sourceOrModel;
  const displayList = buildTikzDisplayList(model, options);
  return renderTikzDisplayListToSvg(svg, displayList, options);
}

export function renderTikzDisplayListToSvg(svg, displayList, options = {}) {
  return renderGraphDisplayListToSvg(svg, displayList, options);
}

export function tikzSummary(model) {
  return {
    nodeCount: model.nodes.length,
    pathCount: model.paths.length,
    coordinateCount: model.coordinates.length,
    text: `${model.nodes.length} ${plural(model.nodes.length, "node")}, ${model.paths.length} ${plural(model.paths.length, "path")}`
  };
}

function parseNodeCommand(state, body) {
  const match = body.match(/^\s*(\[[\s\S]*?\])?\s*(?:\(([^)]*)\)\s*)?at\s*\(([\s\S]+?)\)\s*\{([\s\S]*)\}\s*$/);
  if (!match) throw new GraphDslError(`Unsupported TikZ node command: \\node${body};`);
  const options = parseOptionList(trimBrackets(match[1] ?? ""));
  const rawId = match[2];
  if (rawId != null && rawId.trim() === "") {
    throw new GraphDslError(`Unsupported TikZ node command: \\node${body};`);
  }
  const anonymous = rawId == null;
  const id = anonymous ? `__tikz_node_${state.model.nodes.length + 1}` : scopedName(state, rawId);
  const point = resolveCoordinate(state, match[3]);
  const style = resolveTikzStyle(state.model.styles, options, state.model.units);
  const label = match[4].trim();
  const width = style.width ?? DEFAULT_NODE_WIDTH;
  const height = style.height ?? DEFAULT_NODE_HEIGHT;
  const node = {
    id,
    anonymous,
    rawAt: match[3],
    scope: cloneScope(state.scope),
    x: point.x,
    y: point.y,
    width,
    height,
    minWidth: style.width,
    minHeight: style.height,
    r: style.r ?? Math.max(width, height) / 2,
    shape: style.shape ?? "rect",
    label,
    draw: style.draw,
    fill: style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    corner: style.corner,
    innerSep: style.innerSep,
    textStyle: style.textStyle,
    style: style.extraStyle
  };
  hideInternal(node, ["rawAt", "scope"]);
  state.model.nodes.push(node);
  state.model.elements.push({ type: "node", item: node });
  if (!anonymous) registerNodeAnchors(state, node);
}

function parseCoordinateCommand(state, body) {
  const match = body.match(/^\s*\(([^)]+)\)\s*at\s*\(([\s\S]+?)\)\s*$/);
  if (!match) throw new GraphDslError(`Unsupported TikZ coordinate command: \\coordinate${body};`);
  const id = scopedName(state, match[1]);
  const point = resolveCoordinate(state, match[2]);
  const coordinate = { id, rawAt: match[2], scope: cloneScope(state.scope), ...point };
  hideInternal(coordinate, ["rawAt", "scope"]);
  state.model.coordinates.push(coordinate);
  state.model.elements.push({ type: "coordinate", item: coordinate });
  state.anchors.set(id, point);
  state.anchors.set(`${id}.center`, point);
}

function parseDrawCommand(state, body) {
  const { options, rest } = splitCommandOptions(body);
  const style = resolveTikzStyle(state.model.styles, parseOptionList(options), state.model.units);
  const tokens = pathTokens(rest);
  if (tokens.length < 1 || tokens[0].type !== "coord") {
    throw new GraphDslError(`Unsupported TikZ draw path: \\draw${body};`);
  }
  const path = {
    tokens,
    scope: cloneScope(state.scope),
    props: {
      commands: resolvePathCommands(state, tokens),
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      strokeDasharray: style.strokeDasharray,
      headArrow: style.headArrow,
      tailArrow: style.tailArrow,
      arrowSize: style.arrowSize
    },
    style: style.extraStyle
  };
  hideInternal(path, ["tokens", "scope"]);
  state.model.paths.push(path);
}

function parseFillDrawCommand(state, body) {
  const { options, rest } = splitCommandOptions(body);
  const style = resolveTikzStyle(state.model.styles, parseOptionList(options), state.model.units);
  const match = rest.match(/^\s*\(([\s\S]+?)\)\s+circle\s+\(([\s\S]+?)\)/);
  if (!match) throw new GraphDslError(`Unsupported TikZ filldraw command: \\filldraw${body};`);
  const point = resolveCoordinate(state, match[1]);
  const mark = {
    ...point,
    rawAt: match[1],
    rawR: match[2],
    scope: cloneScope(state.scope),
    r: lengthToPx(match[2], state.model.units),
    fill: style.fill === "none" ? style.stroke : style.fill,
    stroke: style.stroke,
    strokeWidth: style.strokeWidth,
    style: style.extraStyle
  };
  hideInternal(mark, ["rawAt", "rawR", "scope"]);
  state.model.marks.push(mark);
}

function parsePicCommand(state, body) {
  const match = body.match(/^\s*(?:\(([^)]+)\)\s*)?at\s*\(([\s\S]+?)\)\s*\{([\s\S]+?)\}\s*$/);
  if (!match) throw new GraphDslError(`Unsupported TikZ pic command: \\pic${body};`);
  const prefix = match[1] ? normalizeName(match[1]) : `pic${++state.picSerial}`;
  const origin = resolveCoordinate(state, match[2]);
  const name = match[3].trim();
  const source = state.model.pics.get(name);
  if (source == null) {
    throw new GraphDslError(`Unknown TikZ pic "${name}"`);
  }
  const scoped = {
    ...state,
    scope: {
      prefix,
      origin
    }
  };
  for (const command of parseCommands(source)) {
    if (command.name === "node") parseNodeCommand(scoped, command.body);
    else if (command.name === "coordinate") parseCoordinateCommand(scoped, command.body);
    else if (command.name === "draw") parseDrawCommand(scoped, command.body);
    else if (command.name === "filldraw") parseFillDrawCommand(scoped, command.body);
    else if (command.name === "pic") parsePicCommand(scoped, command.body);
  }
}

function parseTikzDefinitions(source) {
  const styles = new Map();
  const pics = new Map();
  const begin = source.match(/\\begin\{tikzpicture\}\s*(\[[\s\S]*?\])?/);
  if (begin?.[1]) {
    parseDefinitionEntries(trimBrackets(begin[1]), styles, pics);
  }
  for (const block of tikzSetBlocks(source)) {
    parseDefinitionEntries(block, styles, pics);
  }
  return { styles, pics };
}

function parseDefinitionEntries(source, styles, pics) {
  for (const entry of splitTopLevel(source, ",")) {
    const match = entry.match(/^\s*(.+?)\s*\/\.(style|pic)\s*=\s*\{([\s\S]*)\}\s*$/);
    if (!match) continue;
    const name = match[1].trim();
    if (match[2] === "style") {
      styles.set(name, parseOptionList(match[3]));
    } else {
      pics.set(name, match[3].trim());
    }
  }
}

function tikzBody(source) {
  const begin = source.match(/\\begin\{tikzpicture\}(?:\[[\s\S]*?\])?/);
  const end = source.match(/\\end\{tikzpicture\}/);
  if (!begin || !end || end.index < begin.index) {
    return source;
  }
  return source.slice(begin.index + begin[0].length, end.index);
}

function tikzSetBlocks(source) {
  const blocks = [];
  const pattern = /\\tikzset\s*\{/g;
  let match = pattern.exec(source);
  while (match) {
    const open = pattern.lastIndex - 1;
    const close = findMatching(source, open, "{", "}");
    if (close < 0) throw new GraphDslError(`Unclosed TikZ \\tikzset block`);
    blocks.push(source.slice(open + 1, close));
    pattern.lastIndex = close + 1;
    match = pattern.exec(source);
  }
  return blocks;
}

function stripTikzSetBlocks(source) {
  let result = "";
  let cursor = 0;
  const pattern = /\\tikzset\s*\{/g;
  let match = pattern.exec(source);
  while (match) {
    const open = pattern.lastIndex - 1;
    const close = findMatching(source, open, "{", "}");
    if (close < 0) throw new GraphDslError(`Unclosed TikZ \\tikzset block`);
    result += source.slice(cursor, match.index);
    cursor = close + 1;
    pattern.lastIndex = close + 1;
    match = pattern.exec(source);
  }
  return result + source.slice(cursor);
}

function parseCommands(source) {
  const commands = [];
  const pattern = /\\(node|coordinate|draw|filldraw|pic)\b/g;
  let match = pattern.exec(source);
  while (match) {
    const start = pattern.lastIndex;
    const end = findCommandEnd(source, start);
    if (end < 0) throw new GraphDslError(`Unclosed TikZ command \\${match[1]}`);
    commands.push({ name: match[1], body: source.slice(start, end).trim() });
    pattern.lastIndex = end + 1;
    match = pattern.exec(source);
  }
  return commands;
}

function findCommandEnd(source, start) {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let i = start; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth -= 1;
    else if (char === ";" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) return i;
  }
  return -1;
}

function resolveTikzStyle(styles, options, units = DEFAULT_TIKZ_UNITS) {
  const merged = [];
  for (const option of options) {
    if (styles.has(option.key)) {
      merged.push(...styles.get(option.key));
    }
    merged.push(option);
  }
  const style = {
    shape: "rect",
    draw: false,
    fill: "none",
    stroke: "#111111",
    strokeWidth: TIKZ_LINE_WIDTHS.thin,
    textStyle: {}
  };
  for (const option of merged) {
    const key = option.key;
    const value = option.value;
    if (key === "rectangle") style.shape = "rect";
    else if (key === "circle") style.shape = "circle";
    else if (key === "draw") {
      style.draw = true;
      if (value) style.stroke = tikzColor(value);
    } else if (key === "fill") {
      style.fill = tikzColor(value ?? "black");
    } else if (Object.hasOwn(TIKZ_LINE_WIDTHS, key)) style.strokeWidth = TIKZ_LINE_WIDTHS[key];
    else if (key === "dashed") style.strokeDasharray = "6 5";
    else if (key === "->" || key === "stealth") style.headArrow = true;
    else if (key === "<-") style.tailArrow = true;
    else if (key === "<->") {
      style.headArrow = true;
      style.tailArrow = true;
    } else if (key === "minimum width") style.width = lengthToPx(value, units);
    else if (key === "minimum height") style.height = lengthToPx(value, units);
    else if (key === "minimum size") {
      style.width = lengthToPx(value, units);
      style.height = lengthToPx(value, units);
    } else if (key === "inner sep") style.innerSep = lengthToPx(value ?? "3pt", units);
    else if (key === "rounded corners") style.corner = value ? lengthToPx(value, units) : 6;
    else if (isColorKeyword(key)) style.textStyle.fill = tikzColor(key);
  }
  if (style.shape === "circle" && (style.width || style.height)) {
    style.r = Math.max(style.width ?? 0, style.height ?? 0, DEFAULT_CIRCLE_R * 2) / 2;
  }
  if (style.draw && style.fill === "none") style.fill = "#ffffff";
  return style;
}

function resolveCoordinate(state, raw) {
  const source = raw.trim();
  const shifted = source.match(/^\s*\[([\s\S]*?)\]\s*([\s\S]+)$/);
  if (shifted) {
    const base = resolveCoordinate(state, shifted[2]);
    const shifts = parseOptionList(shifted[1]);
    const xShift = shifts.find((item) => item.key === "xshift")?.value;
    const yShift = shifts.find((item) => item.key === "yshift")?.value;
    return {
      x: base.x + lengthToPx(xShift ?? 0, state.model.units),
      y: base.y - lengthToPx(yShift ?? 0, state.model.units)
    };
  }
  const pair = source.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+))$/);
  if (pair) {
    const origin = state.scope?.origin ?? { x: 0, y: 0 };
    return {
      x: origin.x + Number(pair[1]) * state.model.units.cm,
      y: origin.y - Number(pair[2]) * state.model.units.cm
    };
  }
  const name = scopedReferenceName(state, source);
  const point = state.anchors.get(name);
  if (!point) throw new GraphDslError(`Unknown TikZ coordinate "${source}"`);
  return { x: point.x, y: point.y };
}

function scopedName(state, raw) {
  const name = normalizeName(raw);
  if (!state.scope || !name.startsWith("-")) return name;
  return `${state.scope.prefix}${name}`;
}

function scopedReferenceName(state, raw) {
  const name = normalizeName(raw);
  if (!state.scope || !name.startsWith("-")) return name;
  return `${state.scope.prefix}${name}`;
}

function registerNodeAnchors(state, node) {
  const left = node.x - node.width / 2;
  const right = node.x + node.width / 2;
  const top = node.y - node.height / 2;
  const bottom = node.y + node.height / 2;
  const anchors = {
    center: { x: node.x, y: node.y },
    north: { x: node.x, y: top },
    south: { x: node.x, y: bottom },
    east: { x: right, y: node.y },
    west: { x: left, y: node.y },
    "north east": { x: right, y: top },
    "north west": { x: left, y: top },
    "south east": { x: right, y: bottom },
    "south west": { x: left, y: bottom }
  };
  state.anchors.set(node.id, anchors.center);
  for (const [name, point] of Object.entries(anchors)) {
    state.anchors.set(`${node.id}.${name}`, point);
  }
}

function resolveNodeLayout(state, node, defaults, measure) {
  const point = resolveCoordinate(stateWithScope(state, node.scope), node.rawAt ?? `${node.x},${node.y}`);
  const math = node.label ? parseMath(node.label) : null;
  const textStyle = {
    ...(math ? defaults.math : defaults.text),
    ...(node.textStyle ?? {})
  };
  const labelBox = node.label
    ? (math
      ? mathLabelBox(math, textStyle, measure, {
        x: point.x,
        y: point.y,
        anchor: "middle",
        fontSize: textStyle.fontSize
      })
      : textLabelBox(node.label, textStyle, measure, {
        x: point.x,
        y: point.y,
        anchor: "middle",
        fontSize: textStyle.fontSize
      }))
    : null;
  const innerSep = Number(node.innerSep ?? DEFAULT_INNER_SEP);
  const naturalWidth = labelBox ? labelBox.width + innerSep * 2 : DEFAULT_NODE_WIDTH;
  const naturalHeight = labelBox ? labelBox.height + innerSep * 2 : DEFAULT_NODE_HEIGHT;
  const width = Math.max(node.minWidth ?? 0, naturalWidth);
  const height = Math.max(node.minHeight ?? 0, naturalHeight);
  const r = node.shape === "circle" ? Math.max(width, height) / 2 : node.r;
  return {
    ...node,
    ...point,
    width,
    height,
    r,
    labelBox
  };
}

function resolvePathLayout(state, path) {
  return {
    ...path,
    props: {
      ...path.props,
      commands: resolvePathCommands(stateWithScope(state, path.scope), path.tokens)
    }
  };
}

function resolvePathCommands(state, tokens) {
  const commands = [];
  let current = resolveCoordinate(state, tokens[0].value);
  commands.push({ op: "moveTo", x: current.x, y: current.y });
  for (let index = 1; index < tokens.length; index += 2) {
    const op = tokens[index];
    const coord = tokens[index + 1];
    if (!op || !coord || op.type !== "op" || coord.type !== "coord") {
      throw new GraphDslError(`Unsupported TikZ draw path`);
    }
    const next = resolveCoordinate(state, coord.value);
    if (op.value === "--") {
      commands.push({ op: "lineTo", x: next.x, y: next.y });
    } else if (op.value === "-|") {
      commands.push({ op: "lineTo", x: next.x, y: current.y }, { op: "lineTo", x: next.x, y: next.y });
    } else if (op.value === "|-") {
      commands.push({ op: "lineTo", x: current.x, y: next.y }, { op: "lineTo", x: next.x, y: next.y });
    }
    current = next;
  }
  return commands;
}

function stateWithScope(state, scope) {
  return { ...state, scope };
}

function cloneScope(scope) {
  return scope ? { prefix: scope.prefix, origin: { ...scope.origin } } : null;
}

function hideInternal(object, keys) {
  for (const key of keys) {
    Object.defineProperty(object, key, {
      value: object[key],
      enumerable: false,
      configurable: true,
      writable: true
    });
  }
  return object;
}

function pathTokens(source) {
  const tokens = [];
  let index = 0;
  while (index < source.length) {
    if (/\s/.test(source[index])) {
      index += 1;
      continue;
    }
    const op = source.slice(index).match(/^(--|\|--?|\|-|-\|)/);
    if (op) {
      const value = op[1] === "|--" ? "|-" : op[1];
      tokens.push({ type: "op", value });
      index += op[1].length;
      continue;
    }
    if (source[index] === "(") {
      const end = findMatching(source, index, "(", ")");
      if (end < 0) throw new GraphDslError(`Unclosed TikZ coordinate in path`);
      tokens.push({ type: "coord", value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return tokens;
}

function splitCommandOptions(body) {
  const trimmed = body.trim();
  if (!trimmed.startsWith("[")) return { options: "", rest: trimmed };
  const end = findMatching(trimmed, 0, "[", "]");
  if (end < 0) throw new GraphDslError(`Unclosed TikZ option list`);
  return {
    options: trimmed.slice(1, end),
    rest: trimmed.slice(end + 1).trim()
  };
}

function parseOptionList(source = "") {
  return splitTopLevel(source, ",").map((raw) => {
    const text = raw.trim();
    if (!text) return null;
    const eq = text.indexOf("=");
    if (eq >= 0) {
      return { key: text.slice(0, eq).trim(), value: text.slice(eq + 1).trim() };
    }
    return { key: text, value: true };
  }).filter(Boolean);
}

function splitTopLevel(source, separator) {
  const parts = [];
  let start = 0;
  let braceDepth = 0;
  let bracketDepth = 0;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth -= 1;
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth -= 1;
    else if (char === separator && braceDepth === 0 && bracketDepth === 0) {
      parts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(source.slice(start));
  return parts;
}

function displayBounds(items) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const item of items) {
    if (item.type === "rect") includeRect(bounds, item.props.x, item.props.y, item.props.width, item.props.height);
    else if (item.type === "circle") includeRect(bounds, item.props.cx - item.props.r, item.props.cy - item.props.r, item.props.r * 2, item.props.r * 2);
    else if (item.type === "path") {
      for (const command of item.props.commands ?? []) {
        if ("x" in command && "y" in command) includePoint(bounds, command.x, command.y);
        if ("x1" in command && "y1" in command) includePoint(bounds, command.x1, command.y1);
        if ("x2" in command && "y2" in command) includePoint(bounds, command.x2, command.y2);
      }
    } else if (item.type === "text" || item.type === "math") {
      if (item.box) includeRect(bounds, item.box.x, item.box.y, item.box.width, item.box.height);
      else includeRect(bounds, item.x - 24, item.y - 14, 48, 28);
    }
  }
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return bounds;
}

function shiftItem(item, dx, dy) {
  if (item.type === "rect") {
    return { ...item, props: { ...item.props, x: item.props.x + dx, y: item.props.y + dy } };
  }
  if (item.type === "circle") {
    return { ...item, props: { ...item.props, cx: item.props.cx + dx, cy: item.props.cy + dy } };
  }
  if (item.type === "path") {
    return {
      ...item,
      props: {
        ...item.props,
        commands: item.props.commands.map((command) => shiftCommand(command, dx, dy))
      }
    };
  }
  if (item.type === "text" || item.type === "math") {
    return {
      ...item,
      x: item.x + dx,
      y: item.y + dy,
      ...(item.box ? { box: { ...item.box, x: item.box.x + dx, y: item.box.y + dy } } : {})
    };
  }
  return item;
}

function shiftCommand(command, dx, dy) {
  const next = { ...command };
  if ("x" in next) next.x += dx;
  if ("y" in next) next.y += dy;
  if ("x1" in next) next.x1 += dx;
  if ("y1" in next) next.y1 += dy;
  if ("x2" in next) next.x2 += dx;
  if ("y2" in next) next.y2 += dy;
  return next;
}

function collectDisplayArrowMarkers(items) {
  const keys = new Set();
  for (const item of items) {
    const props = item.props ?? {};
    if (props.headArrow || props.tailArrow) {
      keys.add(String(Number(props.arrowSize ?? 12)).replace(/\./g, "_"));
    }
  }
  return keys;
}

function includeRect(bounds, x, y, width, height) {
  includePoint(bounds, x, y);
  includePoint(bounds, x + width, y + height);
}

function includePoint(bounds, x, y) {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function normalizeTikzUnits(options = {}) {
  const source = options.units && typeof options.units === "object" ? options.units : {};
  const cm = positiveNumber(source.cm, DEFAULT_TIKZ_UNITS.cm);
  const pt = positiveNumber(source.pt, DEFAULT_TIKZ_UNITS.pt);
  return {
    cm,
    mm: positiveNumber(source.mm, cm / 10),
    pt,
    px: positiveNumber(source.px, 1)
  };
}

function lengthToPx(value, units = DEFAULT_TIKZ_UNITS) {
  if (value == null || value === true || value === "") return 0;
  const scale = normalizeLengthUnits(units);
  if (typeof value === "number") return value * scale.cm;
  const text = String(value).trim();
  const match = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+))\s*(cm|mm|pt|px)?$/);
  if (!match) return Number(text) || 0;
  const number = Number(match[1]);
  const suffix = match[2] ?? "cm";
  return number * scale[suffix];
}

function normalizeLengthUnits(units) {
  if (typeof units === "number") {
    return { cm: units, mm: units / 10, pt: DEFAULT_TIKZ_UNITS.pt, px: 1 };
  }
  const cm = positiveNumber(units?.cm, DEFAULT_TIKZ_UNITS.cm);
  return {
    cm,
    mm: positiveNumber(units?.mm, cm / 10),
    pt: positiveNumber(units?.pt, DEFAULT_TIKZ_UNITS.pt),
    px: positiveNumber(units?.px, 1)
  };
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function tikzColor(value) {
  const text = String(value ?? "black").trim();
  const mix = text.match(/^([A-Za-z]+)!(\d+)$/);
  if (mix) {
    const color = namedColor(mix[1]);
    const amount = Number(mix[2]) / 100;
    return mixColor(color, "#ffffff", amount);
  }
  return namedColor(text);
}

function namedColor(name) {
  const colors = {
    black: "#111111",
    white: "#ffffff",
    blue: "#2563eb",
    red: "#dc2626",
    green: "#16a34a",
    gray: "#6b7280",
    grey: "#6b7280",
    yellow: "#facc15",
    orange: "#f97316",
    purple: "#7c3aed"
  };
  return colors[name] ?? name;
}

function mixColor(color, base, amount) {
  const a = hexToRgb(color);
  const b = hexToRgb(base);
  if (!a || !b) return color;
  const rgb = a.map((value, index) => Math.round(value * amount + b[index] * (1 - amount)));
  return `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function hexToRgb(value) {
  const match = String(value).match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  return [0, 2, 4].map((index) => parseInt(match[1].slice(index, index + 2), 16));
}

function isColorKeyword(key) {
  return ["black", "white", "blue", "red", "green", "gray", "grey", "yellow", "orange", "purple"].includes(key);
}

function parseMath(label) {
  const trimmed = label.trim();
  return trimmed.startsWith("$") && trimmed.endsWith("$") ? trimmed.slice(1, -1) : null;
}

function trimBrackets(value) {
  const text = String(value ?? "").trim();
  return text.startsWith("[") && text.endsWith("]") ? text.slice(1, -1) : text;
}

function normalizeName(value) {
  return String(value).trim().replace(/\s+/g, " ");
}

function findMatching(source, start, open, close) {
  let depth = 0;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === open) depth += 1;
    else if (source[i] === close) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function stripComments(source) {
  return String(source).split(/\r?\n/).map((line) => {
    const index = line.search(/(?<!\\)%/);
    return index >= 0 ? line.slice(0, index) : line;
  }).join("\n");
}

function plural(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}
