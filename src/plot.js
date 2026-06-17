import { GraphDslError } from "./errors.js";
import { parseMarkup } from "./markup.js";

const STYLE_TAGS = new Set(["Style"]);
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
  const axes = plotElement.children.filter((child) => AXIS_TAGS.has(child.name)).map((child) => buildAxis(child, styles));
  const curves = plotElement.children.filter((child) => CURVE_TAGS.has(child.name)).map((child) => buildCurve(child, styles));
  const lines = plotElement.children.filter((child) => LINE_TAGS.has(child.name)).map((child) => buildLine(child, styles));
  const marks = plotElement.children.filter((child) => POINT_TAGS.has(child.name)).map((child) => buildMark(child, styles));
  const labels = plotElement.children.filter((child) => TEXT_TAGS.has(child.name)).map((child) => buildText(child, styles));
  const legends = plotElement.children.filter((child) => LEGEND_TAGS.has(child.name)).map((child) => buildLegend(child, styles));

  return {
    type: "plot",
    attrs: { ...plotElement.attrs },
    styles: Object.fromEntries(styles),
    axes,
    curves,
    lines,
    marks,
    labels,
    legends
  };
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
    attrs: { ...axisElement.attrs, dim },
    ticks: axisElement.children.filter((child) => TICK_TAGS.has(child.name)).map((child) => buildTicks(child, styles))
  };
}

function buildTicks(tickElement, styles) {
  return {
    attrs: resolveStyledAttrs(tickElement.attrs, styles)
  };
}

function buildCurve(curveElement, styles) {
  const points = resolvePoints(curveElement);
  return {
    id: curveElement.attrs.id,
    points,
    attrs: resolveStyledAttrs(curveElement.attrs, styles)
  };
}

function buildLine(lineElement, styles) {
  if (hasPoints(lineElement)) {
    return {
      id: lineElement.attrs.id,
      points: resolvePoints(lineElement),
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

function buildMark(markElement, styles) {
  if (hasPoints(markElement)) {
    return {
      id: markElement.attrs.id,
      points: resolvePoints(markElement),
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

function resolvePoints(element) {
  if (Array.isArray(element.attrs.points)) {
    return element.attrs.points.map((point) => normalizePoint(point, "points"));
  }

  if (Array.isArray(element.attrs.x) && Array.isArray(element.attrs.y)) {
    if (element.attrs.x.length !== element.attrs.y.length) {
      throw new GraphDslError(`<${element.name}> x and y arrays must have the same length`);
    }
    return element.attrs.x.map((x, index) => normalizePoint([x, element.attrs.y[index]], "x/y"));
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
  const x = Number(point[0]);
  const y = Number(point[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new GraphDslError(`Plot ${propName} values must be finite numbers`);
  }
  return { x, y };
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

function requiredAttr(element, name) {
  if (element.attrs[name] == null || element.attrs[name] === "") {
    throw new GraphDslError(`<${element.name}> requires ${name}`);
  }
  return element.attrs[name];
}
