import { GraphDslError } from "./errors.js";
import { EXPRESSION_LITERAL, REF_LITERAL, isExpressionLiteral, isRefLiteral } from "./literals.js";
import { parseMarkup } from "./markup.js";

const STYLE_TAGS = new Set(["Style"]);
const DATA_TAGS = new Set(["Data", "Dataset"]);
const AXIS_TAGS = new Set(["Axis", "XAxis", "YAxis"]);
const TICK_TAGS = new Set(["Ticks", "ticks"]);
const CURVE_TAGS = new Set(["Curve", "Series"]);
const LINE_TAGS = new Set(["Line"]);
const POINT_TAGS = new Set(["Point", "Mark", "Scatter"]);
const TEXT_TAGS = new Set(["Text", "Label"]);
const LEGEND_TAGS = new Set(["Legend", "legend"]);
const ANNOTATION_NODE_TAGS = new Set(["Rect", "rect", "Circle", "circle", "Anchor", "anchor"]);
const ANNOTATION_LINK_TAGS = new Set(["Link"]);
const ANNOTATION_PATH_TAGS = new Set(["Path", "path"]);
const PORT_TAGS = new Set(["Port"]);
const SIDE_ATTRS = ["left", "right", "top", "bottom"];
const SIDE_ANGLES = {
  left: 180,
  right: 0,
  top: -90,
  bottom: 90
};
const STYLE_ATTRS = new Set([
  "fill",
  "fillOpacity",
  "opacity",
  "stroke",
  "strokeDasharray",
  "strokeLinecap",
  "strokeLinejoin",
  "strokeOpacity",
  "strokeWidth",
  "fontFamily",
  "fontSize",
  "fontStyle",
  "fontWeight"
]);

export function parsePlots(source) {
  const roots = parseMarkup(source).filter((node) => node.type === "element");
  const plots = roots.filter((node) => node.name === "Plot");

  if (plots.length !== roots.length) {
    throw new GraphDslError("Top-level elements must be <Plot>");
  }

  return plots.map(buildPlotModel);
}

export function parsePlot(source) {
  const plots = parsePlots(source);

  if (plots.length !== 1) {
    throw new GraphDslError(`Expected exactly one <Plot>, found ${plots.length}`);
  }

  return plots[0];
}

export function buildPlotModel(plotElement) {
  assertElement(plotElement, "Plot");
  assertKnownPlotChildren(plotElement);

  const styles = buildStyles(plotElement.children.filter((child) => STYLE_TAGS.has(child.name)));
  const dataRecords = buildData(plotElement.children.filter((child) => DATA_TAGS.has(child.name)));
  const axes = plotElement.children.filter((child) => AXIS_TAGS.has(child.name)).map((child) => buildAxis(child, styles));
  const curves = plotElement.children.filter((child) => CURVE_TAGS.has(child.name)).map((child) => buildCurve(child, styles, dataRecords));
  const lines = plotElement.children.filter((child) => LINE_TAGS.has(child.name)).map((child) => buildLine(child, styles, dataRecords));
  const marks = plotElement.children.filter((child) => POINT_TAGS.has(child.name)).map((child) => buildMark(child, styles, dataRecords));
  const labels = plotElement.children.filter((child) => TEXT_TAGS.has(child.name)).map((child) => buildText(child, styles));
  const legends = plotElement.children.filter((child) => LEGEND_TAGS.has(child.name)).map((child) => buildLegend(child, styles));
  const annotations = buildAnnotations(plotElement, styles);

  return {
    type: "plot",
    attrs: normalizePlotAttrs(plotElement.attrs),
    styles: Object.fromEntries(styles),
    data: Object.fromEntries([...dataRecords].map(([id, record]) => [id, record.points])),
    dataSources: Object.fromEntries(dataRecords),
    axes,
    curves,
    lines,
    marks,
    labels,
    legends,
    annotations
  };
}

function normalizePlotAttrs(attrs) {
  const normalized = { ...attrs };
  if (Array.isArray(normalized.xDomain)) {
    normalized.xDomain = numericPair(normalized.xDomain, "<Plot> xDomain");
  }
  if (Array.isArray(normalized.xdomain)) {
    normalized.xdomain = numericPair(normalized.xdomain, "<Plot> xDomain");
  }
  if (Array.isArray(normalized.yDomain)) {
    normalized.yDomain = numericPair(normalized.yDomain, "<Plot> yDomain");
  }
  if (Array.isArray(normalized.ydomain)) {
    normalized.ydomain = numericPair(normalized.ydomain, "<Plot> yDomain");
  }
  return normalized;
}

function buildAxis(axisElement, styles) {
  assertKnownAxisChildren(axisElement);
  const dim = axisElement.name === "XAxis" || axisElement.attrs.x ? "x"
    : axisElement.name === "YAxis" || axisElement.attrs.y ? "y"
      : axisElement.attrs.dim ?? axisElement.attrs.axis ?? "x";
  if (dim !== "x" && dim !== "y") {
    throw new GraphDslError(`Axis dim must be "x" or "y"`);
  }
  return {
    dim,
    attrs: normalizeTickAttrs({ ...axisElement.attrs, dim }, axisElement.name),
    ticks: axisElement.children.filter((child) => TICK_TAGS.has(child.name)).map((child) => buildTicks(child, styles))
  };
}

function buildTicks(tickElement, styles) {
  return {
    attrs: normalizeTickAttrs(resolveStyledAttrs(tickElement.attrs, styles), tickElement.name)
  };
}

function normalizeTickAttrs(attrs, elementName) {
  const normalized = { ...attrs };
  if (Array.isArray(normalized.values)) {
    normalized.values = normalized.values.map((value) => numberValue(value, `<${elementName}> value`));
  }
  if (Array.isArray(normalized.ticks)) {
    normalized.ticks = normalized.ticks.map((value) => numberValue(value, `<${elementName}> tick`));
  }
  return normalized;
}

function buildCurve(curveElement, styles, data) {
  const points = resolvePoints(curveElement, data);
  const dataId = dataIdAttr(curveElement);
  validateSeriesAnimation(curveElement, dataId, data);
  const attrs = resolveStyledAttrs(curveElement.attrs, styles);
  return {
    id: curveElement.attrs.id,
    dataId,
    points,
    attrs: normalizeSeriesAttrs(attrs, curveElement.name)
  };
}

function buildLine(lineElement, styles, data) {
  if (hasPoints(lineElement) || lineElement.attrs.data) {
    const dataId = dataIdAttr(lineElement);
    validateSeriesAnimation(lineElement, dataId, data);
    const attrs = resolveStyledAttrs(lineElement.attrs, styles);
    return {
      id: lineElement.attrs.id,
      dataId,
      points: resolvePoints(lineElement, data),
      attrs: normalizeSeriesAttrs(attrs, lineElement.name)
    };
  }

  const attrs = resolveStyledAttrs(lineElement.attrs, styles);
  return {
    id: lineElement.attrs.id,
    from: pointAttr(lineElement, "from"),
    to: pointAttr(lineElement, "to"),
    attrs: normalizeSeriesAttrs(attrs, lineElement.name)
  };
}

function buildMark(markElement, styles, data) {
  if (hasPoints(markElement) || markElement.attrs.data) {
    const dataId = dataIdAttr(markElement);
    validateSeriesAnimation(markElement, dataId, data);
    const attrs = resolveStyledAttrs(markElement.attrs, styles);
    return {
      id: markElement.attrs.id,
      dataId,
      points: resolvePoints(markElement, data),
      attrs: normalizeSeriesAttrs(attrs, markElement.name)
    };
  }

  const attrs = resolveStyledAttrs(markElement.attrs, styles);
  return {
    id: markElement.attrs.id,
    at: pointAttr(markElement, "at"),
    attrs: normalizeSeriesAttrs(attrs, markElement.name)
  };
}

function hasPoints(element) {
  return Array.isArray(element.attrs.points) || (Array.isArray(element.attrs.x) && Array.isArray(element.attrs.y));
}

function buildText(textElement, styles) {
  return {
    id: textElement.attrs.id,
    at: pointAttr(textElement, "at"),
    text: textElement.attrs.label ?? textElement.attrs.text ?? "",
    attrs: resolveStyledAttrs(textElement.attrs, styles)
  };
}

function buildLegend(legendElement, styles) {
  return {
    id: legendElement.attrs.id,
    attrs: resolveStyledAttrs(legendElement.attrs, styles)
  };
}

function buildAnnotations(plotElement, styles) {
  const nodes = plotElement.children
    .filter((child) => ANNOTATION_NODE_TAGS.has(child.name))
    .map((child) => buildAnnotationNode(child, styles));
  assertUniqueAnnotationIds(nodes);
  const ports = new Set(nodes.flatMap((node) => Object.keys(node.ports).map((portId) => `${node.id}.${portId}`)));
  const links = plotElement.children
    .filter((child) => ANNOTATION_LINK_TAGS.has(child.name))
    .map((child) => buildAnnotationLink(child, styles, ports));
  const paths = plotElement.children
    .filter((child) => ANNOTATION_PATH_TAGS.has(child.name))
    .map((child) => buildAnnotationPath(child, styles));
  return { nodes, links, paths };
}

function buildAnnotationNode(nodeElement, styles) {
  assertKnownAnnotationChildren(nodeElement);
  const id = requiredAttr(nodeElement, "id");
  const shape = annotationShape(nodeElement.name);
  const attrs = normalizeAnnotationNodeAttrs(resolveStyledAttrs(nodeElement.attrs, styles), nodeElement.name);
  const node = {
    id,
    shape,
    at: annotationPointAttr(nodeElement, "at", [0, 0]),
    atUnit: coordinateUnit(attrs.atUnit ?? attrs.atunit ?? attrs.unit),
    attrs,
    ports: {}
  };

  for (const portElement of nodeElement.children.filter((child) => PORT_TAGS.has(child.name))) {
    const port = buildAnnotationPort(portElement, node, styles);
    if (node.ports[port.id]) {
      throw new GraphDslError(`Duplicate port id "${port.id}" on "${id}"`);
    }
    node.ports[port.id] = port;
  }
  addDefaultAnnotationPorts(node);
  return node;
}

function annotationShape(name) {
  if (name === "Circle" || name === "circle") return "circle";
  if (name === "Anchor" || name === "anchor") return "anchor";
  return "rect";
}

function normalizeAnnotationNodeAttrs(attrs, elementName) {
  const normalized = { ...attrs };
  if (Array.isArray(normalized.size)) {
    normalized.w = numberValue(normalized.size[0], `<${elementName}> size width`);
    normalized.h = numberValue(normalized.size[1], `<${elementName}> size height`);
  }
  if (normalized.w != null) normalized.w = numberValue(normalized.w, `<${elementName}> w`);
  if (normalized.h != null) normalized.h = numberValue(normalized.h, `<${elementName}> h`);
  if (normalized.r != null) normalized.r = numberValue(normalized.r, `<${elementName}> r`);
  if (normalized.corner != null) normalized.corner = numberValue(normalized.corner, `<${elementName}> corner`);
  return normalized;
}

function buildAnnotationPort(portElement, node, styles) {
  const id = requiredAttr(portElement, "id");
  const attrs = resolveStyledAttrs(portElement.attrs, styles);
  const side = resolvePortSide(attrs);
  const position = Array.isArray(attrs.at)
    ? annotationPoint(attrs.at, `<Port> at`)
    : defaultAnnotationPortPosition(node, side);
  return {
    id,
    side,
    angle: attrs.angle == null ? (SIDE_ANGLES[side] ?? 0) : numberValue(attrs.angle, `<Port> angle`),
    x: position.x,
    y: position.y,
    attrs
  };
}

function addDefaultAnnotationPorts(node) {
  if (node.shape === "anchor") {
    if (!node.ports.center) {
      node.ports.center = {
        id: "center",
        side: null,
        angle: 0,
        x: 0,
        y: 0,
        auto: true,
        attrs: { id: "center" }
      };
    }
    return;
  }

  for (const side of SIDE_ATTRS) {
    if (node.ports[side]) continue;
    const point = defaultAnnotationPortPosition(node, side);
    node.ports[side] = {
      id: side,
      side,
      angle: SIDE_ANGLES[side],
      x: point.x,
      y: point.y,
      auto: true,
      attrs: { id: side, [side]: true }
    };
  }
}

function defaultAnnotationPortPosition(node, side) {
  if (node.shape === "circle") {
    const r = Number(node.attrs.r ?? 5);
    const positions = {
      left: { x: -r, y: 0 },
      right: { x: r, y: 0 },
      top: { x: 0, y: -r },
      bottom: { x: 0, y: r }
    };
    return positions[side] ?? { x: 0, y: 0 };
  }

  const w = Number(node.attrs.w ?? 80);
  const h = Number(node.attrs.h ?? 28);
  const positions = {
    left: { x: 0, y: h / 2 },
    right: { x: w, y: h / 2 },
    top: { x: w / 2, y: 0 },
    bottom: { x: w / 2, y: h }
  };
  return positions[side] ?? { x: w / 2, y: h / 2 };
}

function resolvePortSide(attrs) {
  return SIDE_ATTRS.find((side) => attrs[side]) ?? null;
}

function buildAnnotationLink(linkElement, styles, ports) {
  const from = annotationEndpointAttr(linkElement, "from");
  const to = annotationEndpointAttr(linkElement, "to");
  if (!ports.has(from)) throw new GraphDslError(`Unknown annotation port "${from}"`);
  if (!ports.has(to)) throw new GraphDslError(`Unknown annotation port "${to}"`);
  return {
    id: linkElement.attrs.id,
    from,
    to,
    attrs: resolveStyledAttrs(linkElement.attrs, styles)
  };
}

function buildAnnotationPath(pathElement, styles) {
  const attrs = resolveStyledAttrs(pathElement.attrs, styles);
  return {
    id: attrs.id ?? null,
    points: Array.isArray(attrs.points) ? attrs.points.map((point) => annotationPoint(point, `<Path> points`)) : null,
    atUnit: coordinateUnit(attrs.atUnit ?? attrs.atunit ?? attrs.unit),
    attrs
  };
}

function annotationPointAttr(element, name, fallback = null) {
  const value = element.attrs[name];
  if (value == null && fallback) return annotationPoint(fallback, `<${element.name}> ${name}`);
  if (!Array.isArray(value)) {
    throw new GraphDslError(`<${element.name}> requires ${name}={[x, y]}`);
  }
  return annotationPoint(value, `<${element.name}> ${name}`);
}

function annotationPoint(value, label) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new GraphDslError(`${label} must be [x, y]`);
  }
  return {
    x: numberValue(value[0], `${label} x`),
    y: numberValue(value[1], `${label} y`)
  };
}

function coordinateUnit(value) {
  const unit = String(value ?? "data").toLowerCase();
  if (unit !== "data" && unit !== "screen") {
    throw new GraphDslError(`Plot annotation unit must be "data" or "screen"`);
  }
  return unit;
}

function annotationEndpointAttr(element, name) {
  const value = element.attrs[name];
  if (typeof value === "string") return value;
  throw new GraphDslError(`<${element.name}> "${name}" must be a quoted port address like "note.left"`);
}

function resolvePoints(element, data = new Map()) {
  if (element.attrs.data) {
    const record = data.get(element.attrs.data);
    if (!record) {
      throw new GraphDslError(`Unknown data "${element.attrs.data}"`);
    }
    return clonePoints(record.points);
  }

  if (Array.isArray(element.attrs.points)) {
    return element.attrs.points.map((point) => normalizePoint(point, "points"));
  }

  if (Array.isArray(element.attrs.x) && Array.isArray(element.attrs.y)) {
    if (element.attrs.x.length !== element.attrs.y.length) {
      throw new GraphDslError(`<${element.name}> x and y arrays must have the same length`);
    }
    return element.attrs.x.map((x, index) => normalizePoint([x, element.attrs.y[index]], "x/y"));
  }

  if (Array.isArray(element.attrs.x) && isMathSource(element.attrs.y)) {
    return generatePointsFromX(element);
  }

  if (isMathSource(element.attrs.y)) {
    return generatePointsFromDomain(element);
  }

  throw new GraphDslError(`<${element.name}> requires points={[[x, y], ...]} or x/y arrays`);
}

function pointAttr(element, name) {
  if (!Array.isArray(element.attrs[name])) {
    throw new GraphDslError(`<${element.name}> requires ${name}={[x, y]}`);
  }
  return normalizePoint(element.attrs[name], name);
}

function normalizePoint(point, propName) {
  if (!Array.isArray(point) || point.length < 2) {
    throw new GraphDslError(`Plot ${propName} values must be [x, y] pairs`);
  }
  const x = numberValue(point[0], `${propName} x`);
  const y = numberValue(point[1], `${propName} y`);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new GraphDslError(`Plot ${propName} values must be finite numbers`);
  }
  return { x, y };
}

function generatePointsFromX(element) {
  const variable = String(element.attrs.var ?? "x");
  const expression = String(element.attrs.y);
  const params = paramsScope(element);

  return element.attrs.x.map((rawX) => {
    const x = numberValue(rawX, `${element.name} x`);
    return {
      x,
      y: evaluateMathExpression(expression, new Map([...params, [variable, x]]), `<${element.name}> y`)
    };
  });
}

function generatePointsFromDomain(element) {
  const variable = String(element.attrs.var ?? "x");
  const expression = String(element.attrs.y);
  const domain = numericPair(element.attrs.domain, `<${element.name}> domain`);
  const samples = Math.max(2, Math.floor(Number(element.attrs.samples ?? 100)));
  if (!Number.isFinite(samples)) {
    throw new GraphDslError(`<${element.name}> samples must be a finite number`);
  }
  const params = paramsScope(element);
  const [min, max] = domain;
  const step = samples === 1 ? 0 : (max - min) / (samples - 1);

  return Array.from({ length: samples }, (_unused, index) => {
    const x = min + step * index;
    return {
      x,
      y: evaluateMathExpression(expression, new Map([...params, [variable, x]]), `<${element.name}> y`)
    };
  });
}

export function regeneratePlotData(source, overrides = {}) {
  if (!source?.generated) {
    throw new GraphDslError(`Only generated <Data> can be animated`);
  }
  const params = new Map(Object.entries(source.params ?? {}));
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (!params.has(key)) {
      throw new GraphDslError(`Animation variable "${key}" is not declared in <Data id="${source.id}"> params`);
    }
    params.set(key, numberValue(value, `animation param "${key}"`));
  }

  if (Array.isArray(source.x)) {
    return source.x.map((rawX) => {
      const x = numberValue(rawX, `${source.id} x`);
      return {
        x,
        y: evaluateMathExpression(source.expression, new Map([...params, [source.variable, x]]), `<Data id="${source.id}"> y`)
      };
    });
  }

  const [min, max] = source.domain;
  const step = source.samples === 1 ? 0 : (max - min) / (source.samples - 1);
  return Array.from({ length: source.samples }, (_unused, index) => {
    const x = min + step * index;
    return {
      x,
      y: evaluateMathExpression(source.expression, new Map([...params, [source.variable, x]]), `<Data id="${source.id}"> y`)
    };
  });
}

function paramsScope(element) {
  const params = new Map();
  const source = element.attrs.params;
  if (source == null) return params;
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new GraphDslError(`<${element.name}> params must be an object`);
  }
  for (const [key, value] of Object.entries(source)) {
    params.set(key, numberValue(value, `param "${key}"`));
  }
  return params;
}

function numericPair(value, propName) {
  if (!Array.isArray(value) || value.length < 2) {
    throw new GraphDslError(`${propName} must be [min, max]`);
  }
  const min = numberValue(value[0], `${propName} min`);
  const max = numberValue(value[1], `${propName} max`);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new GraphDslError(`${propName} values must be finite numbers`);
  }
  return [min, max];
}

function numberValue(value, label) {
  if (isExpressionLiteral(value)) {
    return evaluateMathExpression(value[EXPRESSION_LITERAL], new Map(), label);
  }
  if (isRefLiteral(value) && MATH_CONSTANTS.has(value[REF_LITERAL])) {
    return MATH_CONSTANTS.get(value[REF_LITERAL]);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GraphDslError(`${label} must be a finite number`);
  }
  return number;
}

function isMathSource(value) {
  return typeof value === "string" && value.trim() !== "";
}

function evaluateMathExpression(source, scope, label) {
  const parser = new PlotMathParser(source, scope, label);
  return parser.parse();
}

const MATH_CONSTANTS = new Map([
  ["pi", Math.PI],
  ["PI", Math.PI],
  ["e", Math.E],
  ["E", Math.E]
]);

const MATH_FUNCTIONS = new Map([
  ["abs", Math.abs],
  ["acos", Math.acos],
  ["asin", Math.asin],
  ["atan", Math.atan],
  ["atan2", Math.atan2],
  ["ceil", Math.ceil],
  ["cos", Math.cos],
  ["exp", Math.exp],
  ["floor", Math.floor],
  ["log", Math.log],
  ["log10", Math.log10],
  ["max", Math.max],
  ["min", Math.min],
  ["pow", Math.pow],
  ["round", Math.round],
  ["sin", Math.sin],
  ["sqrt", Math.sqrt],
  ["tan", Math.tan]
]);

class PlotMathParser {
  constructor(source, scope, label) {
    this.source = String(source);
    this.scope = scope;
    this.label = label;
    this.index = 0;
  }

  parse() {
    const value = this.parseExpression();
    this.skipWhitespace();
    if (!this.isDone()) {
      throw new GraphDslError(`Unsupported expression "${this.source}" in ${this.label}`);
    }
    if (!Number.isFinite(value)) {
      throw new GraphDslError(`Expression "${this.source}" in ${this.label} did not evaluate to a finite number`);
    }
    return value;
  }

  parseExpression() {
    let value = this.parseTerm();
    while (true) {
      this.skipWhitespace();
      if (this.consume("+")) {
        value += this.parseTerm();
      } else if (this.consume("-")) {
        value -= this.parseTerm();
      } else {
        return value;
      }
    }
  }

  parseTerm() {
    let value = this.parsePower();
    while (true) {
      this.skipWhitespace();
      if (this.consume("*")) {
        value *= this.parsePower();
      } else if (this.consume("/")) {
        value /= this.parsePower();
      } else {
        return value;
      }
    }
  }

  parsePower() {
    let value = this.parseFactor();
    this.skipWhitespace();
    if (this.consume("^")) {
      value **= this.parsePower();
    }
    return value;
  }

  parseFactor() {
    this.skipWhitespace();
    if (this.consume("+")) return this.parseFactor();
    if (this.consume("-")) return -this.parseFactor();
    if (this.consume("(")) {
      const value = this.parseExpression();
      this.skipWhitespace();
      if (!this.consume(")")) {
        throw new GraphDslError(`Unclosed expression "${this.source}" in ${this.label}`);
      }
      return value;
    }
    if (isDigit(this.peek()) || this.peek() === ".") {
      return this.parseNumber();
    }
    if (isIdentifierStart(this.peek())) {
      return this.parseIdentifierOrCall();
    }
    throw new GraphDslError(`Unsupported expression "${this.source}" in ${this.label}`);
  }

  parseNumber() {
    const start = this.index;
    while (isDigit(this.peek())) this.index += 1;
    if (this.peek() === ".") {
      this.index += 1;
      while (isDigit(this.peek())) this.index += 1;
    }
    if (this.peek() === "e" || this.peek() === "E") {
      this.index += 1;
      if (this.peek() === "+" || this.peek() === "-") this.index += 1;
      while (isDigit(this.peek())) this.index += 1;
    }
    const raw = this.source.slice(start, this.index);
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      throw new GraphDslError(`Invalid number "${raw}" in ${this.label}`);
    }
    return value;
  }

  parseIdentifierOrCall() {
    const name = this.parseIdentifier();
    this.skipWhitespace();
    if (this.consume("(")) {
      const fn = MATH_FUNCTIONS.get(name);
      if (!fn) {
        throw new GraphDslError(`Unknown math function "${name}" in ${this.label}`);
      }
      const args = this.parseArguments();
      return fn(...args);
    }
    if (this.scope.has(name)) return this.scope.get(name);
    if (MATH_CONSTANTS.has(name)) return MATH_CONSTANTS.get(name);
    throw new GraphDslError(`Unknown variable "${name}" in ${this.label}`);
  }

  parseIdentifier() {
    const start = this.index;
    this.index += 1;
    while (isIdentifierPart(this.peek())) this.index += 1;
    return this.source.slice(start, this.index);
  }

  parseArguments() {
    const args = [];
    this.skipWhitespace();
    if (this.consume(")")) return args;
    while (!this.isDone()) {
      args.push(this.parseExpression());
      this.skipWhitespace();
      if (this.consume(")")) return args;
      if (!this.consume(",")) {
        throw new GraphDslError(`Expected "," in function call "${this.source}"`);
      }
    }
    throw new GraphDslError(`Unclosed function call "${this.source}"`);
  }

  skipWhitespace() {
    while (/\s/.test(this.peek() ?? "")) this.index += 1;
  }

  consume(value) {
    if (!this.source.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  peek() {
    return this.source[this.index];
  }

  isDone() {
    return this.index >= this.source.length;
  }
}

function buildStyles(styleElements) {
  const styles = new Map();
  for (const element of styleElements) {
    const id = requiredAttr(element, "id");
    if (styles.has(id)) {
      throw new GraphDslError(`Duplicate style id "${id}"`);
    }
    styles.set(id, styleAttrs(element.attrs));
  }
  return styles;
}

function buildData(dataElements) {
  const data = new Map();
  for (const element of dataElements) {
    const id = requiredAttr(element, "id");
    if (data.has(id)) {
      throw new GraphDslError(`Duplicate data id "${id}"`);
    }
    data.set(id, buildDataRecord(element, id));
  }
  return data;
}

function buildDataRecord(element, id) {
  if (Array.isArray(element.attrs.x) && isMathSource(element.attrs.y)) {
    const params = Object.fromEntries(paramsScope(element));
    return {
      id,
      generated: true,
      variable: String(element.attrs.var ?? "x"),
      expression: String(element.attrs.y),
      params,
      x: element.attrs.x.slice(),
      points: generatePointsFromX(element)
    };
  }

  if (isMathSource(element.attrs.y) && !Array.isArray(element.attrs.y)) {
    const domain = numericPair(element.attrs.domain, `<${element.name}> domain`);
    const samples = Math.max(2, Math.floor(Number(element.attrs.samples ?? 100)));
    if (!Number.isFinite(samples)) {
      throw new GraphDslError(`<${element.name}> samples must be a finite number`);
    }
    const params = Object.fromEntries(paramsScope(element));
    return {
      id,
      generated: true,
      variable: String(element.attrs.var ?? "x"),
      expression: String(element.attrs.y),
      params,
      domain,
      samples,
      points: generatePointsFromDomain(element)
    };
  }

  return {
    id,
    generated: false,
    points: resolvePoints(element)
  };
}

function validateSeriesAnimation(element, dataId, data) {
  const animate = element.attrs.animate;
  if (animate == null) return;
  if (!animate || typeof animate !== "object" || Array.isArray(animate)) {
    throw new GraphDslError(`<${element.name}> animate must be an object`);
  }
  if (!dataId) {
    throw new GraphDslError(`<${element.name}> animate requires data="..."`);
  }
  const record = data.get(dataId);
  if (!record?.generated) {
    throw new GraphDslError(`<${element.name}> animate requires generated <Data>`);
  }
  for (const key of Object.keys(animationVariableRanges(animate))) {
    if (!Object.hasOwn(record.params ?? {}, key)) {
      throw new GraphDslError(`Animation variable "${key}" is not declared in <Data id="${dataId}"> params`);
    }
  }
}

function animationVariableRanges(animate) {
  return Object.fromEntries(Object.entries(animate).filter(([key, value]) => (
    !ANIMATION_SETTING_KEYS.has(key) && Array.isArray(value)
  )));
}

const ANIMATION_SETTING_KEYS = new Set(["duration", "loop"]);

function dataIdAttr(element) {
  return element.attrs.data == null ? null : String(element.attrs.data);
}

function clonePoints(points) {
  return points.map((point) => ({ ...point }));
}

function resolveStyledAttrs(attrs, styles) {
  const resolved = { ...attrs };
  const direct = directStyleAttrs(attrs);
  if (attrs.useStyle) {
    const named = styles.get(attrs.useStyle);
    if (!named) {
      throw new GraphDslError(`Unknown style "${attrs.useStyle}"`);
    }
    resolved.style = { ...named, ...direct, ...(attrs.style ?? {}) };
  } else if (Object.keys(direct).length > 0 || attrs.style) {
    resolved.style = { ...direct, ...(attrs.style ?? {}) };
  }
  return resolved;
}

function normalizeSeriesAttrs(attrs, elementName) {
  if (attrs.animate == null) return attrs;
  return {
    ...attrs,
    animate: normalizeAnimateAttrs(attrs.animate, elementName)
  };
}

function normalizeAnimateAttrs(animate, elementName) {
  if (!animate || typeof animate !== "object" || Array.isArray(animate)) {
    throw new GraphDslError(`<${elementName}> animate must be an object`);
  }
  const normalized = { ...animate };
  if (normalized.duration != null) {
    normalized.duration = numberValue(normalized.duration, `<${elementName}> animate duration`);
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (ANIMATION_SETTING_KEYS.has(key)) continue;
    if (!Array.isArray(value)) continue;
    normalized[key] = numericPair(value, `<${elementName}> animate ${key}`);
  }
  return normalized;
}

function directStyleAttrs(attrs) {
  return Object.fromEntries(Object.entries(attrs).filter(([key]) => STYLE_ATTRS.has(key)));
}

function styleAttrs(attrs) {
  const { id, ...style } = attrs;
  return style;
}

function assertKnownPlotChildren(plotElement) {
  for (const child of plotElement.children.filter((node) => node.type === "element")) {
    if (
      STYLE_TAGS.has(child.name)
      || DATA_TAGS.has(child.name)
      || AXIS_TAGS.has(child.name)
      || CURVE_TAGS.has(child.name)
      || LINE_TAGS.has(child.name)
      || POINT_TAGS.has(child.name)
      || TEXT_TAGS.has(child.name)
      || LEGEND_TAGS.has(child.name)
      || ANNOTATION_NODE_TAGS.has(child.name)
      || ANNOTATION_LINK_TAGS.has(child.name)
      || ANNOTATION_PATH_TAGS.has(child.name)
    ) {
      continue;
    }
    throw new GraphDslError(`Unknown tag <${child.name}> in <Plot>`);
  }
}

function assertKnownAnnotationChildren(nodeElement) {
  for (const child of nodeElement.children.filter((node) => node.type === "element")) {
    if (PORT_TAGS.has(child.name)) continue;
    throw new GraphDslError(`Unknown tag <${child.name}> in <${nodeElement.name}>`);
  }
}

function assertKnownAxisChildren(axisElement) {
  for (const child of axisElement.children.filter((node) => node.type === "element")) {
    if (TICK_TAGS.has(child.name)) {
      continue;
    }
    throw new GraphDslError(`Unknown tag <${child.name}> in <${axisElement.name}>`);
  }
}

function assertElement(element, name) {
  if (!element || element.type !== "element" || element.name !== name) {
    throw new GraphDslError(`Expected <${name}>`);
  }
}

function isDigit(char) {
  return char != null && /[0-9]/.test(char);
}

function isIdentifierStart(char) {
  return char != null && /[A-Za-z_]/.test(char);
}

function isIdentifierPart(char) {
  return char != null && /[A-Za-z0-9_]/.test(char);
}

function requiredAttr(element, name) {
  if (element.attrs[name] == null || element.attrs[name] === "") {
    throw new GraphDslError(`<${element.name}> requires ${name}`);
  }
  return element.attrs[name];
}

function assertUniqueAnnotationIds(nodes) {
  const seen = new Set();
  for (const node of nodes) {
    if (seen.has(node.id)) {
      throw new GraphDslError(`Duplicate annotation id "${node.id}"`);
    }
    seen.add(node.id);
  }
}
