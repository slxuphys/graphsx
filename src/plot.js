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
  const data = buildData(plotElement.children.filter((child) => DATA_TAGS.has(child.name)));
  const axes = plotElement.children.filter((child) => AXIS_TAGS.has(child.name)).map((child) => buildAxis(child, styles));
  const curves = plotElement.children.filter((child) => CURVE_TAGS.has(child.name)).map((child) => buildCurve(child, styles, data));
  const lines = plotElement.children.filter((child) => LINE_TAGS.has(child.name)).map((child) => buildLine(child, styles, data));
  const marks = plotElement.children.filter((child) => POINT_TAGS.has(child.name)).map((child) => buildMark(child, styles, data));
  const labels = plotElement.children.filter((child) => TEXT_TAGS.has(child.name)).map((child) => buildText(child, styles));
  const legends = plotElement.children.filter((child) => LEGEND_TAGS.has(child.name)).map((child) => buildLegend(child, styles));

  return {
    type: "plot",
    attrs: normalizePlotAttrs(plotElement.attrs),
    styles: Object.fromEntries(styles),
    data: Object.fromEntries(data),
    axes,
    curves,
    lines,
    marks,
    labels,
    legends
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
  return {
    id: curveElement.attrs.id,
    points,
    attrs: resolveStyledAttrs(curveElement.attrs, styles)
  };
}

function buildLine(lineElement, styles, data) {
  if (hasPoints(lineElement) || lineElement.attrs.data) {
    return {
      id: lineElement.attrs.id,
      points: resolvePoints(lineElement, data),
      attrs: resolveStyledAttrs(lineElement.attrs, styles)
    };
  }

  return {
    id: lineElement.attrs.id,
    from: pointAttr(lineElement, "from"),
    to: pointAttr(lineElement, "to"),
    attrs: resolveStyledAttrs(lineElement.attrs, styles)
  };
}

function buildMark(markElement, styles, data) {
  if (hasPoints(markElement) || markElement.attrs.data) {
    return {
      id: markElement.attrs.id,
      points: resolvePoints(markElement, data),
      attrs: resolveStyledAttrs(markElement.attrs, styles)
    };
  }

  return {
    id: markElement.attrs.id,
    at: pointAttr(markElement, "at"),
    attrs: resolveStyledAttrs(markElement.attrs, styles)
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

function resolvePoints(element, data = new Map()) {
  if (element.attrs.data) {
    const points = data.get(element.attrs.data);
    if (!points) {
      throw new GraphDslError(`Unknown data "${element.attrs.data}"`);
    }
    return points.map((point) => ({ ...point }));
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
    data.set(id, resolvePoints(element));
  }
  return data;
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
    ) {
      continue;
    }
    throw new GraphDslError(`Unknown tag <${child.name}> in <Plot>`);
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
