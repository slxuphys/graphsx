import { regeneratePlotData } from "./plot.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_LABEL_HEIGHT = 34;
const MATH_HANGING_INSET = 8;
let plotClipIdCounter = 0;

export function renderPlot(svg, plot, options = {}) {
  const width = Number(plot.attrs.width ?? plot.attrs.w ?? options.minWidth ?? 720);
  const height = Number(plot.attrs.height ?? plot.attrs.h ?? options.minHeight ?? 420);
  const padding = normalizePadding(plot.attrs.padding ?? options.padding ?? 56);
  const bounds = plotBounds(plot);
  const xDomain = domainAttr(plot.attrs.xDomain ?? plot.attrs.xdomain, [bounds.minX, bounds.maxX]);
  const yDomain = domainAttr(plot.attrs.yDomain ?? plot.attrs.ydomain, [bounds.minY, bounds.maxY]);
  const context = {
    document: options.document ?? svg.ownerDocument ?? document,
    katex: options.katex ?? null,
    plot,
    width,
    height,
    padding,
    frame: options.frame ?? {},
    xDomain: expandDomain(xDomain),
    yDomain: expandDomain(yDomain),
    arrowMarkerPrefix: `graphsx-plot-arrow-${plotClipIdCounter + 1}`
  };

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();

  const clipId = `graphsx-plot-clip-${plotClipIdCounter += 1}`;
  const defs = el(context, "defs");
  defs.append(drawPlotClipPath(context, clipId));
  appendArrowMarkers(context, defs);
  const frameLayer = el(context, "g", { class: "plot-frame-layer" });
  const axisLayer = el(context, "g", { class: "plot-axes" });
  const dataLayer = el(context, "g", { class: "plot-data", clipPath: `url(#${clipId})` });
  const annotationLayer = el(context, "g", { class: "plot-annotations" });
  const labelLayer = el(context, "g", { class: "plot-labels" });
  const legendLayer = el(context, "g", { class: "plot-legends" });
  svg.append(defs, frameLayer, axisLayer, dataLayer, annotationLayer, labelLayer, legendLayer);

  if (booleanAttr(plot.attrs.frame, false)) {
    frameLayer.append(drawPlotFrame(context));
  }
  if (booleanAttr(plot.attrs.box, false)) {
    axisLayer.append(drawPlotBox(context));
  }
  drawAxes(context, axisLayer);
  for (const line of plot.lines) dataLayer.append(drawLine(context, line));
  for (const curve of plot.curves) dataLayer.append(drawCurve(context, curve));
  for (const mark of plot.marks) dataLayer.append(drawMark(context, mark));
  drawAnnotations(context, annotationLayer);
  for (const label of plot.labels) labelLayer.append(drawText(context, label));
  for (const legend of plot.legends ?? []) appendMaybe(legendLayer, drawLegend(context, legend));

  return { width, height, bounds };
}

export function plotSummary(plot) {
  const curveCount = plot.curves.length;
  const lineCount = plot.lines.length;
  const markCount = plot.marks.length;
  return {
    curveCount,
    lineCount,
    markCount,
    text: `${curveCount} ${plural(curveCount, "curve")}, ${lineCount} ${plural(lineCount, "line")}, ${markCount} ${plural(markCount, "mark")}`
  };
}

function drawAxes(context, layer) {
  const axes = context.plot.axes.length > 0
    ? context.plot.axes
    : [{ dim: "x", attrs: { dim: "x" } }, { dim: "y", attrs: { dim: "y" } }];

  for (const axis of axes) {
    const labelGap = Number(axis.attrs.labelGap ?? axis.attrs.labelgap ?? 40);
    if (axis.dim === "x") {
      const y = context.height - context.padding.bottom;
      layer.append(styledEl(context, "line", axis.attrs.style, {
        class: "plot-axis plot-axis-x",
        stroke: "#26312d",
        strokeWidth: 1.5,
        x1: context.padding.left,
        y1: y,
        x2: context.width - context.padding.right,
        y2: y
      }));
      drawTicks(context, layer, axis);
      appendMaybe(layer, axisLabel(context, axis, plotCenterX(context), y + labelGap, "middle"));
    } else {
      const x = context.padding.left;
      layer.append(styledEl(context, "line", axis.attrs.style, {
        class: "plot-axis plot-axis-y",
        stroke: "#26312d",
        strokeWidth: 1.5,
        x1: x,
        y1: context.padding.top,
        x2: x,
        y2: context.height - context.padding.bottom
      }));
      drawTicks(context, layer, axis);
      appendMaybe(layer, axisLabel(context, axis, x - labelGap, plotCenterY(context), "middle", -90));
    }
  }
}

function drawTicks(context, layer, axis) {
  const tickSets = axis.ticks?.length > 0
    ? axis.ticks.map((tickSet) => ({ attrs: tickSet.attrs, axisShortcut: false }))
    : [{ attrs: axis.attrs, axisShortcut: true }];
  for (const tickSet of tickSets) {
    drawTickSet(context, layer, axis, tickSet.attrs, tickSet.axisShortcut);
  }
}

function drawTickSet(context, layer, axis, attrs, axisShortcut) {
  const values = tickValues(context, axis, attrs);
  if (values.length === 0) return;

  const labels = tickLabels(attrs, values);
  const length = Number(attrs.size ?? attrs.tickSize ?? attrs.ticksize ?? 6);
  const labelGap = Number(axisShortcut
    ? attrs.tickLabelGap ?? attrs.ticklabelgap ?? 8
    : attrs.labelGap ?? attrs.labelgap ?? attrs.tickLabelGap ?? attrs.ticklabelgap ?? 8);
  const style = attrs.style;
  const labelStyle = attrs.labelStyle ?? attrs.labelstyle ?? tickLabelStyle(style);
  const showGrid = booleanAttr(attrs.grid, false);

  for (const [index, value] of values.entries()) {
    if (axis.dim === "x") {
      const point = project(context, { x: value, y: context.yDomain[0] });
      if (showGrid) {
        layer.append(drawGridLine(context, axis, attrs, point.x, null));
      }
      layer.append(styledEl(context, "line", style, {
        class: "plot-tick plot-tick-x",
        stroke: "#26312d",
        strokeWidth: 1,
        x1: point.x,
        y1: context.height - context.padding.bottom,
        x2: point.x,
        y2: context.height - context.padding.bottom + length
      }));
      appendMaybe(layer, drawTickLabel(context, labels?.[index], point.x, context.height - context.padding.bottom + length + labelGap, "middle", "hanging", labelStyle));
    } else {
      const point = project(context, { x: context.xDomain[0], y: value });
      if (showGrid) {
        layer.append(drawGridLine(context, axis, attrs, null, point.y));
      }
      layer.append(styledEl(context, "line", style, {
        class: "plot-tick plot-tick-y",
        stroke: "#26312d",
        strokeWidth: 1,
        x1: context.padding.left,
        y1: point.y,
        x2: context.padding.left - length,
        y2: point.y
      }));
      appendMaybe(layer, drawTickLabel(context, labels?.[index], context.padding.left - length - labelGap, point.y, "end", "middle", labelStyle));
    }
  }
}

function drawGridLine(context, axis, attrs, x, y) {
  const gridStyle = attrs.gridStyle && typeof attrs.gridStyle === "object" ? attrs.gridStyle : {};
  if (axis.dim === "x") {
    return styledEl(context, "line", gridStyle, {
      class: "plot-grid plot-grid-x",
      stroke: "#d8ded8",
      strokeWidth: 1,
      x1: x,
      y1: context.padding.top,
      x2: x,
      y2: context.height - context.padding.bottom
    });
  }
  return styledEl(context, "line", gridStyle, {
    class: "plot-grid plot-grid-y",
    stroke: "#d8ded8",
    strokeWidth: 1,
    x1: context.padding.left,
    y1: y,
    x2: context.width - context.padding.right,
    y2: y
  });
}

function drawTickLabel(context, label, x, y, anchor, baseline, style) {
  if (label == null) return null;
  return drawPlotLabel(context, label, x, y, "plot-tick-label", anchor, style, 0, baseline);
}

function tickValues(context, axis, attrs) {
  const ticks = attrs.values ?? attrs.ticks;
  if (ticks == null || ticks === false || ticks === "false") return [];
  if (Array.isArray(ticks)) return ticks.map(Number).filter(Number.isFinite);

  const domain = axis.dim === "x" ? context.xDomain : context.yDomain;
  const count = typeof ticks === "number" ? ticks : Number(ticks);
  return niceTicks(domain, Number.isFinite(count) && count > 1 ? count : 5);
}

function tickLabels(attrs, values) {
  const explicit = attrs.labels ?? attrs.tickLabels ?? attrs.ticklabels;
  if (explicit === false || explicit === "false") return null;
  if (Array.isArray(explicit)) {
    return values.map((value, index) => explicit[index] ?? mathTickLabel(value));
  }
  return values.map(mathTickLabel);
}

function mathTickLabel(value) {
  return `$${formatTick(value)}$`;
}

function niceTicks(domain, targetIntervals) {
  const [min, max] = domain;
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min].filter(Number.isFinite);
  const low = Math.min(min, max);
  const high = Math.max(min, max);
  const step = niceStep((high - low) / targetIntervals);
  const first = Math.ceil(low / step - 1e-10) * step;
  const last = Math.floor(high / step + 1e-10) * step;
  const ticks = [];
  for (let value = first; value <= last + step * 1e-10; value += step) {
    ticks.push(cleanNumber(value));
  }
  return ticks;
}

function niceStep(roughStep) {
  const exponent = Math.floor(Math.log10(Math.abs(roughStep)));
  const power = 10 ** exponent;
  const fraction = roughStep / power;
  const niceFraction = closestNiceFraction(fraction);
  return niceFraction * power;
}

function closestNiceFraction(fraction) {
  return [1, 2, 2.5, 5, 10].reduce((best, candidate) => (
    Math.abs(candidate - fraction) < Math.abs(best - fraction) ? candidate : best
  ), 1);
}

function cleanNumber(value) {
  return Number(value.toPrecision(12));
}

function formatTick(value) {
  const clean = cleanNumber(value);
  if (Math.abs(clean) >= 1000 || (Math.abs(clean) > 0 && Math.abs(clean) < 0.001)) {
    return clean.toExponential(2);
  }
  return String(clean);
}

function tickLabelStyle(style) {
  if (!style || typeof style !== "object") return null;
  const { stroke, strokeWidth, strokeDasharray, strokeLinecap, strokeLinejoin, ...textStyle } = style;
  return textStyle;
}

function drawPlotBox(context) {
  return el(context, "rect", {
    class: "plot-box",
    x: context.padding.left,
    y: context.padding.top,
    width: plotWidth(context),
    height: plotHeight(context),
    fill: "none",
    stroke: "#26312d",
    strokeWidth: 1.5
  });
}

function drawPlotFrame(context) {
  return styledEl(context, "rect", context.plot.attrs.frameStyle ?? context.plot.attrs.framestyle, {
    class: "plot-frame",
    x: 0,
    y: 0,
    width: context.width,
    height: context.height,
    fill: "none",
    stroke: "#cbd5d0",
    strokeWidth: 1
  });
}

function drawPlotClipPath(context, id) {
  const clipPath = el(context, "clipPath", { id });
  clipPath.append(el(context, "rect", {
    x: context.padding.left,
    y: context.padding.top,
    width: plotWidth(context),
    height: plotHeight(context)
  }));
  return clipPath;
}

function appendArrowMarkers(context, defs) {
  const keys = annotationArrowMarkerKeys(context.plot.annotations);
  for (const key of keys) {
    const size = Number(key.replace(/_/g, "."));
    defs.append(annotationArrowMarker(context, "head", key, size), annotationArrowMarker(context, "tail", key, size));
  }
}

function annotationArrowMarkerKeys(annotations) {
  const keys = new Set();
  for (const item of [...(annotations?.links ?? []), ...(annotations?.paths ?? [])]) {
    if (hasArrow(item.attrs)) {
      keys.add(arrowMarkerKey(arrowSize(item.attrs)));
    }
  }
  return keys;
}

function annotationArrowMarker(context, kind, key, size) {
  const marker = el(context, "marker", {
    id: arrowMarkerId(context, kind, key),
    markerWidth: size,
    markerHeight: size,
    refX: kind === "head" ? size * 5 / 6 : size / 6,
    refY: size / 2,
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  marker.append(el(context, "path", {
    d: kind === "head"
      ? `M ${size / 6} ${size / 6} L ${size * 5 / 6} ${size / 2} L ${size / 6} ${size * 5 / 6} z`
      : `M ${size * 5 / 6} ${size / 6} L ${size / 6} ${size / 2} L ${size * 5 / 6} ${size * 5 / 6} z`,
    fill: "context-stroke"
  }));
  return marker;
}

function arrowMarkerAttrs(context, attrs) {
  const key = arrowMarkerKey(arrowSize(attrs));
  return {
    ...(booleanAttr(attrs.tailArrow ?? attrs.tailarrow, false) ? { markerStart: `url(#${arrowMarkerId(context, "tail", key)})` } : {}),
    ...(booleanAttr(attrs.headArrow ?? attrs.headarrow, false) ? { markerEnd: `url(#${arrowMarkerId(context, "head", key)})` } : {})
  };
}

function hasArrow(attrs = {}) {
  return booleanAttr(attrs.headArrow ?? attrs.headarrow, false) || booleanAttr(attrs.tailArrow ?? attrs.tailarrow, false);
}

function arrowSize(attrs = {}) {
  const size = Number(attrs.arrowSize ?? attrs.arrowsize ?? 12);
  return Number.isFinite(size) && size > 0 ? size : 12;
}

function arrowMarkerKey(size) {
  return String(Number(size.toFixed(3))).replace(/[^0-9A-Za-z_-]/g, "_");
}

function arrowMarkerId(context, kind, key) {
  const suffix = key === "12" ? "" : `-${key}`;
  return `${context.arrowMarkerPrefix}-${kind}${suffix}`;
}

function axisLabel(context, axis, x, y, anchor, rotate = 0) {
  const label = axis.attrs.label;
  if (label == null) return null;
  return drawPlotLabel(context, label, x, y, "plot-axis-label", anchor, null, rotate);
}

function drawPlainLabel(context, label, x, y, className, anchor, style = null, rotate = 0, baseline = null) {
  return styledEl(context, "text", style, {
    class: className,
    fill: "#111111",
    fontSize: 12,
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    x,
    y,
    textAnchor: anchor,
    ...(baseline ? { dominantBaseline: baseline } : {}),
    ...(rotate ? { transform: `rotate(${rotate} ${x} ${y})` } : {})
  }, String(label));
}

function drawCurve(context, curve) {
  return drawSeries(context, curve, { className: "plot-curve", defaultLine: true, defaultMarkers: false });
}

function drawLine(context, line) {
  if (Array.isArray(line.points)) {
    return drawSeries(context, line, { className: "plot-line", defaultLine: true, defaultMarkers: false });
  }

  const from = project(context, line.from);
  const to = project(context, line.to);
  const fmt = parseFmt(line.attrs.fmt);
  return styledEl(context, "line", lineStyle(line.attrs.style), {
    class: "plot-line",
    stroke: "#111111",
    strokeWidth: 1.5,
    ...(fmt.dash ? { strokeDasharray: fmt.dash } : {}),
    x1: from.x,
    y1: from.y,
    x2: to.x,
    y2: to.y
  });
}

function drawMark(context, mark) {
  if (Array.isArray(mark.points)) {
    return drawSeries(context, mark, { className: "plot-scatter", defaultLine: false, defaultMarkers: true });
  }

  const point = project(context, mark.at);
  return drawMarker(context, point, mark.attrs, "plot-mark");
}

function drawSeries(context, series, options) {
  const fmt = parseFmt(series.attrs.fmt);
  const lineVisible = fmt.hasLine ?? options.defaultLine;
  const markerVisible = fmt.hasMarker ?? options.defaultMarkers;
  const points = seriesPoints(context, series).map((point) => project(context, point));
  const group = el(context, "g", { class: options.className });

  if (lineVisible) {
    group.append(styledEl(context, "path", lineStyle(series.attrs.style), {
      class: options.className,
      fill: "none",
      stroke: "#2d6cdf",
      strokeWidth: 2,
      ...(fmt.dash ? { strokeDasharray: fmt.dash } : {}),
      d: pathData(points)
    }));
  }

  if (markerVisible) {
    for (const point of points) {
      group.append(drawMarker(context, point, series.attrs, `${options.className}-marker`));
    }
  }

  return group;
}

function seriesPoints(context, series) {
  const animate = series.attrs.animate;
  if (!animate || !series.dataId) return series.points;
  const source = context.plot.dataSources?.[series.dataId];
  if (!source?.generated) return series.points;
  return regeneratePlotData(source, animatedParamValues(animate, context.frame));
}

function animatedParamValues(animate, frame = {}) {
  const values = {};
  const duration = positiveNumber(animate.duration, 1);
  const rawTime = Number(frame.time ?? 0);
  const loop = booleanAttr(animate.loop, true);
  const progress = loop
    ? positiveModulo(rawTime / duration, 1)
    : clamp(rawTime / duration, 0, 1);

  for (const [key, range] of Object.entries(animate)) {
    if (key === "duration" || key === "loop" || !Array.isArray(range)) continue;
    if (Object.hasOwn(frame, key)) {
      values[key] = Number(frame[key]);
      continue;
    }
    const from = Number(range[0]);
    const to = Number(range[1]);
    values[key] = from + (to - from) * progress;
  }

  return values;
}

function drawMarker(context, point, attrs, className) {
  return styledEl(context, "circle", attrs.style, {
    class: className,
    fill: "#111111",
    stroke: "none",
    cx: point.x,
    cy: point.y,
    r: Number(attrs.r ?? 4)
  });
}

function drawText(context, label) {
  const point = project(context, label.at);
  return drawPlotLabel(
    context,
    label.text,
    point.x + Number(label.attrs.dx ?? 0),
    point.y + Number(label.attrs.dy ?? -8),
    "plot-text",
    label.attrs.anchor ?? "middle",
    label.attrs.style,
    Number(label.attrs.rotate ?? 0)
  );
}

function drawAnnotations(context, layer) {
  const annotations = context.plot.annotations ?? { nodes: [], links: [], paths: [] };
  const nodePositions = new Map(annotations.nodes.map((node) => [node.id, annotationNodePosition(context, node)]));
  const ports = annotationPorts(annotations.nodes, nodePositions);

  for (const path of annotations.paths) {
    layer.append(drawAnnotationPath(context, path));
  }
  for (const link of annotations.links) {
    const from = ports.get(link.from);
    const to = ports.get(link.to);
    if (from && to) {
      layer.append(drawAnnotationLink(context, link, from, to));
    }
  }
  for (const node of annotations.nodes) {
    appendMaybe(layer, drawAnnotationNode(context, node, nodePositions.get(node.id)));
  }
}

function annotationNodePosition(context, node) {
  return node.atUnit === "screen" ? { ...node.at } : project(context, node.at);
}

function annotationPorts(nodes, positions) {
  const ports = new Map();
  for (const node of nodes) {
    const origin = positions.get(node.id);
    if (!origin) continue;
    for (const [id, port] of Object.entries(node.ports ?? {})) {
      ports.set(`${node.id}.${id}`, {
        x: origin.x + port.x,
        y: origin.y + port.y,
        angle: port.angle ?? 0
      });
    }
  }
  return ports;
}

function drawAnnotationNode(context, node, at) {
  if (node.shape === "anchor") return null;
  if (node.shape === "circle") {
    const group = el(context, "g", { class: "plot-annotation-node plot-annotation-circle" });
    const r = Number(node.attrs.r ?? 5);
    group.append(styledEl(context, "circle", node.attrs.style, {
      class: "plot-annotation-shape",
      fill: "#ffffff",
      stroke: "#111111",
      strokeWidth: 1.5,
      cx: at.x,
      cy: at.y,
      r
    }));
    appendMaybe(group, annotationNodeLabel(context, node, at.x, at.y));
    return group;
  }

  const w = Number(node.attrs.w ?? 80);
  const h = Number(node.attrs.h ?? 28);
  const group = el(context, "g", { class: "plot-annotation-node plot-annotation-rect" });
  group.append(styledEl(context, "rect", node.attrs.style, {
    class: "plot-annotation-shape",
    fill: "#ffffff",
    stroke: "#111111",
    strokeWidth: 1.5,
    x: at.x,
    y: at.y,
    width: w,
    height: h,
    rx: Number(node.attrs.corner ?? node.attrs.rx ?? 4)
  }));
  appendMaybe(group, annotationNodeLabel(context, node, at.x + w / 2, at.y + h / 2));
  return group;
}

function annotationNodeLabel(context, node, x, y) {
  if (node.attrs.label == null) return null;
  return drawPlotLabel(context, node.attrs.label, x, y, "plot-annotation-label", "middle", node.attrs.labelStyle ?? null, 0, "middle");
}

function drawAnnotationLink(context, link, from, to) {
  return styledEl(context, "path", linkStyle(link.attrs.style), {
    class: "plot-annotation-link",
    fill: "none",
    stroke: "#111111",
    strokeWidth: 1.5,
    ...arrowMarkerAttrs(context, link.attrs),
    d: `M ${from.x} ${from.y} L ${to.x} ${to.y}`
  });
}

function drawAnnotationPath(context, path) {
  const attrs = {
    class: "plot-annotation-path",
    fill: "none",
    stroke: "#111111",
    strokeWidth: 1.5,
    ...arrowMarkerAttrs(context, path.attrs),
    d: annotationPathData(context, path)
  };
  return styledEl(context, "path", path.attrs.style, attrs);
}

function annotationPathData(context, path) {
  if (Array.isArray(path.points)) {
    const points = path.points.map((point) => (path.atUnit === "screen" ? point : project(context, point)));
    const data = routedAnnotationPathData(points, Number(path.attrs.corner ?? 0));
    return booleanAttr(path.attrs.closed, false) ? `${data} Z` : data;
  }
  return path.attrs.d ?? "";
}

function routedAnnotationPathData(points, corner) {
  if (!corner || points.length < 3) return pathData(points);
  return roundedPathData(points, corner);
}

function roundedPathData(points, radius) {
  if (points.length < 3) return pathData(points);
  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const inLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outLength = Math.hypot(next.x - current.x, next.y - current.y);
    const cut = Math.min(Number(radius), inLength / 2, outLength / 2);
    if (!Number.isFinite(cut) || cut <= 0) {
      commands.push(`L ${current.x} ${current.y}`);
      continue;
    }
    const before = {
      x: current.x - (current.x - previous.x) / inLength * cut,
      y: current.y - (current.y - previous.y) / inLength * cut
    };
    const after = {
      x: current.x + (next.x - current.x) / outLength * cut,
      y: current.y + (next.y - current.y) / outLength * cut
    };
    commands.push(`L ${before.x} ${before.y}`, `Q ${current.x} ${current.y} ${after.x} ${after.y}`);
  }
  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

function drawLegend(context, legend) {
  const entries = legendEntries(context.plot);
  if (entries.length === 0) return null;

  const fontSize = Number(legend.attrs.fontSize ?? legend.attrs.fontsize ?? legend.attrs.textStyle?.fontSize ?? 12);
  const padding = Number(legend.attrs.padding ?? 10);
  const gap = Number(legend.attrs.gap ?? 8);
  const swatchWidth = Number(legend.attrs.swatchWidth ?? legend.attrs.swatchwidth ?? 26);
  const rowHeight = Number(legend.attrs.rowHeight ?? legend.attrs.rowheight ?? Math.max(18, fontSize + 6));
  const textWidth = Math.max(...entries.map((entry) => estimateTextWidth(entry.label, fontSize)));
  const width = padding * 2 + swatchWidth + gap + textWidth;
  const height = padding * 2 + rowHeight * entries.length;
  const position = legendPosition(context, legend, width, height);
  const group = el(context, "g", {
    class: "plot-legend",
    transform: `translate(${position.x} ${position.y})`
  });

  if (booleanAttr(legend.attrs.box, true)) {
    group.append(styledEl(context, "rect", legendBoxStyle(legend.attrs), {
      class: "plot-legend-box",
      x: 0,
      y: 0,
      width,
      height,
      rx: Number(legend.attrs.corner ?? 4),
      fill: legend.attrs.fill ?? "#ffffff",
      fillOpacity: Number(legend.attrs.fillOpacity ?? legend.attrs.fillopacity ?? 0.88),
      stroke: legend.attrs.stroke ?? "#c9d1cc",
      strokeWidth: Number(legend.attrs.strokeWidth ?? legend.attrs.strokewidth ?? 1)
    }));
  }

  entries.forEach((entry, index) => {
    const y = padding + rowHeight * index + rowHeight / 2;
    const swatch = drawLegendSwatch(context, entry, padding, y, swatchWidth);
    group.append(swatch);
    group.append(drawPlotLabel(
      context,
      entry.label,
      padding + swatchWidth + gap,
      y,
      "plot-legend-label",
      "start",
      legendTextStyle(legend.attrs),
      0,
      "middle"
    ));
  });

  return group;
}

function legendEntries(plot) {
  return [
    ...plot.lines.map((line) => ({ type: "line", item: line })),
    ...plot.curves.map((curve) => ({ type: "curve", item: curve })),
    ...plot.marks.map((mark) => ({ type: "mark", item: mark }))
  ].filter((entry) => entry.item.attrs.label != null && entry.item.attrs.label !== "")
    .map((entry) => ({
      ...entry,
      label: String(entry.item.attrs.label),
      fmt: parseFmt(entry.item.attrs.fmt),
      style: entry.item.attrs.style
    }));
}

function drawLegendSwatch(context, entry, x, y, width) {
  const group = el(context, "g", { class: `plot-legend-swatch plot-legend-swatch-${entry.type}` });
  const lineVisible = entry.type === "mark" ? false : (entry.fmt.hasLine ?? true);
  const markerVisible = entry.type === "mark" ? true : (entry.fmt.hasMarker ?? false);

  if (lineVisible) {
    group.append(styledEl(context, "line", lineStyle(entry.style), {
      class: "plot-legend-line",
      fill: "none",
      stroke: "#2d6cdf",
      strokeWidth: 2,
      ...(entry.fmt.dash ? { strokeDasharray: entry.fmt.dash } : {}),
      x1: x,
      y1: y,
      x2: x + width,
      y2: y
    }));
  }

  if (markerVisible) {
    group.append(drawMarker(context, { x: x + width / 2, y }, entry.item.attrs, "plot-legend-marker"));
  }

  if (!lineVisible && !markerVisible) {
    group.append(styledEl(context, "line", lineStyle(entry.style), {
      class: "plot-legend-line",
      fill: "none",
      stroke: "#2d6cdf",
      strokeWidth: 2,
      x1: x,
      y1: y,
      x2: x + width,
      y2: y
    }));
  }

  return group;
}

function legendPosition(context, legend, width, height) {
  if (Array.isArray(legend.attrs.at)) {
    return { x: Number(legend.attrs.at[0]), y: Number(legend.attrs.at[1]) };
  }

  const margin = Number(legend.attrs.margin ?? 12);
  const position = String(legend.attrs.position ?? legend.attrs.pos ?? "top-right").toLowerCase().replace(/\s+/g, "-");
  const left = context.padding.left + margin;
  const right = context.width - context.padding.right - width - margin;
  const top = context.padding.top + margin;
  const bottom = context.height - context.padding.bottom - height - margin;

  if (position === "top-left" || position === "left-top") return { x: left, y: top };
  if (position === "bottom-left" || position === "left-bottom") return { x: left, y: bottom };
  if (position === "bottom-right" || position === "right-bottom") return { x: right, y: bottom };
  return { x: right, y: top };
}

function legendBoxStyle(attrs) {
  const dedicated = attrs.boxStyle && typeof attrs.boxStyle === "object" ? attrs.boxStyle : {};
  return dedicated;
}

function legendTextStyle(attrs) {
  if (!attrs.textStyle || typeof attrs.textStyle !== "object") return null;
  return attrs.textStyle;
}

function estimateTextWidth(value, fontSize) {
  return String(value).length * fontSize * 0.58;
}

function drawPlotLabel(context, value, x, y, className, anchor = "middle", style = null, rotate = 0, baseline = null) {
  const label = String(value);
  const math = parseMathLabel(label);
  if (math && context.katex) {
    return drawMathLabel(context, math, x, y, className, anchor, rotate, baseline);
  }

  return drawPlainLabel(context, math ?? label, x, y, className, anchor, style, rotate, baseline);
}

function drawMathLabel(context, source, x, y, className, anchor, rotate = 0, baseline = null) {
  const width = estimateMathWidth(source);
  const height = MATH_LABEL_HEIGHT;
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const top = baseline === "hanging" ? y - MATH_HANGING_INSET : y - height / 2;
  const foreignObject = el(context, "foreignObject", {
    class: className,
    x: left,
    y: top,
    width,
    height,
    ...(rotate ? { transform: `rotate(${rotate} ${x} ${y})` } : {})
  });
  const host = context.document.createElement("div");
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.display = "flex";
  host.style.alignItems = "center";
  host.style.justifyContent = anchor === "middle" ? "center" : anchor === "end" ? "flex-end" : "flex-start";
  host.style.color = "#1e2724";
  context.katex.render(source, host, { throwOnError: false });
  foreignObject.append(host);
  return foreignObject;
}

function parseMathLabel(label) {
  const trimmed = label.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("$") && trimmed.endsWith("$")) {
    return trimmed.slice(1, -1);
  }
  return null;
}

function estimateMathWidth(source) {
  return Math.max(34, Math.min(220, source.length * 12 + 28));
}

function plotBounds(plot) {
  const points = [
    ...plot.curves.flatMap((curve) => curve.points),
    ...plot.lines.flatMap((line) => line.points ?? [line.from, line.to]),
    ...plot.marks.flatMap((mark) => mark.points ?? [mark.at]),
    ...plot.labels.map((label) => label.at),
    ...(plot.annotations?.nodes ?? []).filter((node) => node.atUnit !== "screen").map((node) => node.at),
    ...(plot.annotations?.paths ?? []).filter((path) => path.atUnit !== "screen").flatMap((path) => path.points ?? [])
  ];
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y))
  };
}

function project(context, point) {
  const innerWidth = plotWidth(context);
  const innerHeight = plotHeight(context);
  const xT = (point.x - context.xDomain[0]) / (context.xDomain[1] - context.xDomain[0]);
  const yT = (point.y - context.yDomain[0]) / (context.yDomain[1] - context.yDomain[0]);
  return {
    x: context.padding.left + xT * innerWidth,
    y: context.height - context.padding.bottom - yT * innerHeight
  };
}

function plotWidth(context) {
  return context.width - context.padding.left - context.padding.right;
}

function plotHeight(context) {
  return context.height - context.padding.top - context.padding.bottom;
}

function plotCenterX(context) {
  return context.padding.left + plotWidth(context) / 2;
}

function plotCenterY(context) {
  return context.padding.top + plotHeight(context) / 2;
}

function domainAttr(value, fallback) {
  if (!Array.isArray(value)) return fallback;
  const min = Number(value[0]);
  const max = Number(value[1]);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return fallback;
  return [min, max];
}

function expandDomain(domain) {
  if (domain[0] !== domain[1]) return domain;
  const delta = Math.abs(domain[0]) * 0.1 || 1;
  return [domain[0] - delta, domain[1] + delta];
}

function normalizePadding(value) {
  if (Array.isArray(value)) {
    if (value.length === 2) {
      return {
        top: Number(value[1]),
        right: Number(value[0]),
        bottom: Number(value[1]),
        left: Number(value[0])
      };
    }
    if (value.length === 4) {
      return {
        top: Number(value[0]),
        right: Number(value[1]),
        bottom: Number(value[2]),
        left: Number(value[3])
      };
    }
  }
  const number = Number(value);
  return { top: number, right: number, bottom: number, left: number };
}

function pathData(points) {
  return points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
}

function parseFmt(fmt) {
  if (fmt == null || fmt === "") return {};
  const source = String(fmt);
  const hasDashed = source.includes("--");
  const hasDashDot = source.includes("-.");
  const hasDotted = !hasDashDot && source.includes(":");
  const hasSolid = source.includes("-") && !hasDashed && !hasDashDot;
  const hasMarker = /[.o]/.test(source);
  const hasLine = hasDashed || hasDashDot || hasDotted || hasSolid;
  return {
    hasLine,
    hasMarker,
    dash: hasDashed ? "6 4" : hasDashDot ? "8 4 2 4" : hasDotted ? "2 4" : null
  };
}

function styledEl(context, tag, style, attrs, text = null) {
  return el(context, tag, { ...attrs, ...(styleAttrs(style)) }, text);
}

function styleAttrs(style) {
  if (!style || typeof style !== "object") return {};
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [svgAttrName(key), value]));
}

function lineStyle(style) {
  if (!style || typeof style !== "object") return style;
  const { fill, r, ...lineOnly } = style;
  return lineOnly;
}

function linkStyle(style) {
  return lineStyle(style);
}

function svgAttrName(key) {
  const rawSvgAttrs = new Set(["markerWidth", "markerHeight", "refX", "refY", "markerUnits"]);
  if (rawSvgAttrs.has(key)) return key;
  return key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function el(context, tag, attrs = {}, text = null) {
  const node = context.document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    node.setAttribute(svgAttrName(key), String(value));
  }
  if (text != null) node.textContent = text;
  return node;
}

function appendMaybe(parent, child) {
  if (child) parent.append(child);
}

function booleanAttr(value, fallback) {
  if (value == null) return fallback;
  if (value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  return Boolean(value);
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function plural(count, singular) {
  return count === 1 ? singular : `${singular}s`;
}
