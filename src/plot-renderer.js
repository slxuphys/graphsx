import { regeneratePlotData } from "./plot.js";
import { applyPointMaps } from "./plot-math.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MATH_LABEL_HEIGHT = 34;
const MATH_HANGING_INSET = 8;
let plotClipIdCounter = 0;

export function renderPlot(svg, plot, options = {}) {
  const displayList = buildPlotDisplayList(plot, options);
  renderPlotDisplayListToSvg(svg, displayList, options);
  return { width: displayList.width, height: displayList.height, bounds: displayList.bounds };
}

export function buildPlotDisplayList(plot, options = {}) {
  const width = Number(plot.attrs.width ?? plot.attrs.w ?? options.minWidth ?? 720);
  const height = Number(plot.attrs.height ?? plot.attrs.h ?? options.minHeight ?? 420);
  const padding = normalizePadding(plot.attrs.padding ?? options.padding ?? 56);
  const bounds = plotBounds(plot);
  const xDomain = domainAttr(plot.attrs.xDomain ?? plot.attrs.xdomain, [bounds.minX, bounds.maxX]);
  const yDomain = domainAttr(plot.attrs.yDomain ?? plot.attrs.ydomain, [bounds.minY, bounds.maxY]);
  const context = {
    plot,
    width,
    height,
    padding,
    frame: options.frame ?? {},
    xDomain: expandDomain(xDomain),
    yDomain: expandDomain(yDomain),
    arrowMarkerPrefix: `graphsx-plot-arrow-${plotClipIdCounter + 1}`
  };

  const clip = plotClipShape(context, `graphsx-plot-clip-${plotClipIdCounter += 1}`);
  const defs = el(context, "defs");
  appendArrowMarkers(context, defs);
  const frameLayer = el(context, "g", { class: "plot-frame-layer" });
  const axisLayer = el(context, "g", { class: "plot-axes" });
  const dataLayer = el(context, "g", { class: "plot-data", clip });
  const annotationLayer = el(context, "g", { class: "plot-annotations" });
  const labelLayer = el(context, "g", { class: "plot-labels" });
  const legendLayer = el(context, "g", { class: "plot-legends" });

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

  return {
    type: "plot",
    width,
    height,
    bounds,
    xDomain: context.xDomain,
    yDomain: context.yDomain,
    padding,
    clips: [clip],
    arrowMarkerPrefix: context.arrowMarkerPrefix,
    items: [defs, frameLayer, axisLayer, dataLayer, annotationLayer, labelLayer, legendLayer]
  };
}

export function renderPlotDisplayListToSvg(svg, displayList, options = {}) {
  const documentRef = options.document ?? svg.ownerDocument ?? document;
  const context = {
    document: documentRef,
    katex: options.katex ?? null,
    arrowMarkerPrefix: displayList.arrowMarkerPrefix
  };

  svg.setAttribute("viewBox", `0 0 ${displayList.width} ${displayList.height}`);
  svg.replaceChildren();
  svg.append(...[
    ...clipDefs(context, displayList.clips ?? []),
    ...displayList.items
  ].map((item) => renderDisplayItem(context, item)).filter(Boolean));
  return { width: displayList.width, height: displayList.height, bounds: displayList.bounds };
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

function plotClipShape(context, id) {
  return {
    id,
    type: "rect",
    x: context.padding.left,
    y: context.padding.top,
    width: plotWidth(context),
    height: plotHeight(context)
  };
}

function clipDefs(context, clips) {
  if (!clips.length) return [];
  const defs = el(context, "defs");
  for (const clip of clips) {
    if (clip.type !== "rect") continue;
    const clipPath = el(context, "clipPath", { id: clip.id });
    clipPath.append(el(context, "rect", {
      x: clip.x,
      y: clip.y,
      width: clip.width,
      height: clip.height
    }));
    defs.append(clipPath);
  }
  return [defs];
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
    ...(rotate ? { transform: [rotateTransform(rotate, x, y)] } : {})
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
      commands: pathCommands(points)
    }));
  }

  if (markerVisible) {
    for (const point of points) {
      appendMaybe(group, drawMarker(context, point, series.attrs, `${options.className}-marker`));
    }
  }

  return group;
}

function seriesPoints(context, series) {
  const animate = series.attrs.animate;
  if (!animate || !series.dataId) return series.points;
  const source = context.plot.dataSources?.[series.dataId];
  if (!source?.generated) return series.points;
  return applyPointMaps(regeneratePlotData(source, animatedParamValues(animate, context.frame)), series.attrs, "animated series");
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
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
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
    ...annotationArrowDisplayProps(link.attrs),
    commands: pathCommands([from, to])
  });
}

function drawAnnotationPath(context, path) {
  const attrs = {
    class: "plot-annotation-path",
    fill: "none",
    stroke: "#111111",
    strokeWidth: 1.5,
    ...annotationArrowDisplayProps(path.attrs),
    commands: annotationPathCommands(context, path)
  };
  return styledEl(context, "path", path.attrs.style, attrs);
}

function annotationPathData(context, path) {
  return commandsToPathData(annotationPathCommands(context, path));
}

function annotationPathCommands(context, path) {
  if (Array.isArray(path.points)) {
    const points = path.points.map((point) => (path.atUnit === "screen" ? point : project(context, point)));
    const commands = routedAnnotationPathCommands(points, Number(path.attrs.corner ?? 0));
    return booleanAttr(path.attrs.closed, false) ? [...commands, { op: "closePath" }] : commands;
  }
  return parsePathCommands(path.attrs.d ?? "");
}

function routedAnnotationPathData(points, corner) {
  return commandsToPathData(routedAnnotationPathCommands(points, corner));
}

function routedAnnotationPathCommands(points, corner) {
  if (!corner || points.length < 3) return pathCommands(points);
  return roundedPathCommands(points, corner);
}

function roundedPathData(points, radius) {
  return commandsToPathData(roundedPathCommands(points, radius));
}

function roundedPathCommands(points, radius) {
  if (points.length < 3) return pathCommands(points);
  const commands = [{ op: "moveTo", x: points[0].x, y: points[0].y }];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const inLength = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outLength = Math.hypot(next.x - current.x, next.y - current.y);
    const cut = Math.min(Number(radius), inLength / 2, outLength / 2);
    if (!Number.isFinite(cut) || cut <= 0) {
      commands.push({ op: "lineTo", x: current.x, y: current.y });
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
    commands.push({ op: "lineTo", x: before.x, y: before.y }, { op: "quadraticTo", x1: current.x, y1: current.y, x: after.x, y: after.y });
  }
  const last = points[points.length - 1];
  commands.push({ op: "lineTo", x: last.x, y: last.y });
  return commands;
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
    transform: [translateTransform(position.x, position.y)]
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
  const fontSize = labelFontSize(style);
  if (math) {
    return drawMathLabel(context, math, x, y, className, anchor, rotate, baseline, style, fontSize);
  }

  return drawPlainLabel(context, math ?? label, x, y, className, anchor, style, rotate, baseline);
}

function drawMathLabel(context, source, x, y, className, anchor, rotate = 0, baseline = null, style = null, fontSize = 12) {
  const width = estimateMathWidth(source, fontSize);
  const height = mathLabelHeight(fontSize);
  const left = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  const top = baseline === "hanging" ? y - mathHangingInset(fontSize) : y - height / 2;
  return {
    type: "math",
    source,
    fallback: source,
    className,
    x,
    y,
    left,
    top,
    width,
    height,
    anchor,
    rotate,
    baseline,
    fontSize,
    style,
    props: {
      className,
      x: left,
      y: top,
      width,
      height,
      ...(rotate ? { transform: [rotateTransform(rotate, x, y)] } : {})
    }
  };
}

function parseMathLabel(label) {
  const trimmed = label.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("$") && trimmed.endsWith("$")) {
    return trimmed.slice(1, -1);
  }
  return null;
}

function labelFontSize(style) {
  if (!style || typeof style !== "object") return 12;
  const raw = style.fontSize ?? style.fontsize;
  if (raw == null) return 12;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? raw : 12;
}

function estimateMathWidth(source, fontSize = 12) {
  const size = Number.parseFloat(fontSize);
  const scale = Number.isFinite(size) ? size / 12 : 1;
  return Math.max(34, Math.min(260, source.length * 12 * scale + 28));
}

function mathLabelHeight(fontSize = 12) {
  const size = Number.parseFloat(fontSize);
  return Number.isFinite(size) ? Math.max(24, size * 2.1) : MATH_LABEL_HEIGHT;
}

function mathHangingInset(fontSize = 12) {
  const size = Number.parseFloat(fontSize);
  return Number.isFinite(size) ? Math.max(6, size * 0.66) : MATH_HANGING_INSET;
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
  const finitePoints = points
    .map((point) => ({ x: plotNumber(point.x), y: plotNumber(point.y) }))
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (finitePoints.length === 0) {
    return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  }
  return {
    minX: Math.min(...finitePoints.map((point) => point.x)),
    minY: Math.min(...finitePoints.map((point) => point.y)),
    maxX: Math.max(...finitePoints.map((point) => point.x)),
    maxY: Math.max(...finitePoints.map((point) => point.y))
  };
}

function project(context, point) {
  const innerWidth = plotWidth(context);
  const innerHeight = plotHeight(context);
  const xValue = plotNumber(point.x);
  const yValue = plotNumber(point.y);
  const xT = (xValue - context.xDomain[0]) / (context.xDomain[1] - context.xDomain[0]);
  const yT = (yValue - context.yDomain[0]) / (context.yDomain[1] - context.yDomain[0]);
  return {
    x: context.padding.left + xT * innerWidth,
    y: context.height - context.padding.bottom - yT * innerHeight
  };
}

function plotNumber(value) {
  if (value && typeof value === "object" && Object.hasOwn(value, "re") && Object.hasOwn(value, "im")) {
    return Number(value.re);
  }
  return Number(value);
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
  return commandsToPathData(pathCommands(points));
}

function pathCommands(points) {
  const commands = [];
  let open = false;
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      open = false;
      continue;
    }
    commands.push({
      op: open ? "lineTo" : "moveTo",
      x: point.x,
      y: point.y
    });
    open = true;
  }
  return commands;
}

function commandsToPathData(commands = []) {
  return commands.map((command) => {
    if (!command || typeof command !== "object") return "";
    if (command.op === "moveTo") return `M ${formatNumber(command.x)} ${formatNumber(command.y)}`;
    if (command.op === "lineTo") return `L ${formatNumber(command.x)} ${formatNumber(command.y)}`;
    if (command.op === "quadraticTo") {
      return `Q ${formatNumber(command.x1)} ${formatNumber(command.y1)} ${formatNumber(command.x)} ${formatNumber(command.y)}`;
    }
    if (command.op === "cubicTo") {
      return `C ${formatNumber(command.x1)} ${formatNumber(command.y1)} ${formatNumber(command.x2)} ${formatNumber(command.y2)} ${formatNumber(command.x)} ${formatNumber(command.y)}`;
    }
    if (command.op === "closePath") return "Z";
    return "";
  }).filter(Boolean).join(" ");
}

function parsePathCommands(data) {
  if (typeof data !== "string" || data.trim() === "") return [];
  const commands = [];
  const parts = data.match(/[MLQCZmlqcz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let index = 0;
  let op = null;
  while (index < parts.length) {
    const token = parts[index];
    if (/^[MLQCZ]$/i.test(token)) {
      op = token.toUpperCase();
      index += 1;
      if (op === "Z") {
        commands.push({ op: "closePath" });
        op = null;
      }
      continue;
    }
    if (op === "M" || op === "L") {
      const x = Number(parts[index]);
      const y = Number(parts[index + 1]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        commands.push({ op: op === "M" ? "moveTo" : "lineTo", x, y });
      }
      index += 2;
      continue;
    }
    if (op === "Q") {
      const x1 = Number(parts[index]);
      const y1 = Number(parts[index + 1]);
      const x = Number(parts[index + 2]);
      const y = Number(parts[index + 3]);
      if ([x1, y1, x, y].every(Number.isFinite)) {
        commands.push({ op: "quadraticTo", x1, y1, x, y });
      }
      index += 4;
      continue;
    }
    if (op === "C") {
      const x1 = Number(parts[index]);
      const y1 = Number(parts[index + 1]);
      const x2 = Number(parts[index + 2]);
      const y2 = Number(parts[index + 3]);
      const x = Number(parts[index + 4]);
      const y = Number(parts[index + 5]);
      if ([x1, y1, x2, y2, x, y].every(Number.isFinite)) {
        commands.push({ op: "cubicTo", x1, y1, x2, y2, x, y });
      }
      index += 6;
      continue;
    }
    index += 1;
  }
  return commands;
}

function translateTransform(x, y) {
  return { type: "translate", x, y };
}

function rotateTransform(angle, cx, cy) {
  return { type: "rotate", angle, cx, cy };
}

function transformsToSvgTransform(value) {
  const transforms = Array.isArray(value) ? value : [value];
  return transforms.map(transformToSvgTransform).filter(Boolean).join(" ");
}

function transformToSvgTransform(transform) {
  if (!transform || typeof transform !== "object") return "";
  if (transform.type === "translate") return `translate(${formatNumber(transform.x)} ${formatNumber(transform.y)})`;
  if (transform.type === "rotate") {
    const base = `rotate(${formatNumber(transform.angle)}`;
    return transform.cx == null || transform.cy == null
      ? `${base})`
      : `${base} ${formatNumber(transform.cx)} ${formatNumber(transform.cy)})`;
  }
  if (transform.type === "matrix") {
    return `matrix(${formatNumber(transform.a)} ${formatNumber(transform.b)} ${formatNumber(transform.c)} ${formatNumber(transform.d)} ${formatNumber(transform.e)} ${formatNumber(transform.f)})`;
  }
  return "";
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(6)) : 0;
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
  return Object.fromEntries(Object.entries(style).map(([key, value]) => [displayPropName(key), value]));
}

function lineStyle(style) {
  if (!style || typeof style !== "object") return style;
  const { fill, r, ...lineOnly } = style;
  return lineOnly;
}

function linkStyle(style) {
  return lineStyle(style);
}

function displayPropName(key) {
  const names = {
    class: "className",
    d: "path",
    "clip-path": "clipPath",
    "stroke-width": "strokeWidth",
    "stroke-dasharray": "strokeDasharray",
    "stroke-linecap": "strokeLinecap",
    "stroke-linejoin": "strokeLinejoin",
    "fill-opacity": "fillOpacity",
    "text-anchor": "textAnchor",
    "dominant-baseline": "dominantBaseline",
    "marker-start": "markerStart",
    "marker-end": "markerEnd"
  };
  return names[key] ?? key;
}

function annotationArrowDisplayProps(attrs) {
  const size = arrowSize(attrs);
  return {
    ...(booleanAttr(attrs.tailArrow ?? attrs.tailarrow, false) ? { tailArrow: true, arrowSize: size } : {}),
    ...(booleanAttr(attrs.headArrow ?? attrs.headarrow, false) ? { headArrow: true, arrowSize: size } : {})
  };
}

function displayPropsToSvgAttrs(context, props = {}) {
  const attrs = {};
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false || key === "headArrow" || key === "tailArrow" || key === "arrowSize") continue;
    if (key === "commands") {
      attrs.d = commandsToPathData(value);
    } else if (key === "transform") {
      attrs.transform = transformsToSvgTransform(value);
    } else if (key === "clip") {
      attrs["clip-path"] = `url(#${value.id})`;
    } else {
      attrs[displayPropSvgName(key)] = value;
    }
  }
  if (props.tailArrow || props.headArrow) {
    const key = arrowMarkerKey(arrowSize(props));
    if (props.tailArrow) attrs["marker-start"] = `url(#${arrowMarkerId(context, "tail", key)})`;
    if (props.headArrow) attrs["marker-end"] = `url(#${arrowMarkerId(context, "head", key)})`;
  }
  return attrs;
}

function displayPropSvgName(key) {
  const names = {
    className: "class",
    path: "d",
    clipPath: "clip-path",
    strokeWidth: "stroke-width",
    strokeDasharray: "stroke-dasharray",
    strokeLinecap: "stroke-linecap",
    strokeLinejoin: "stroke-linejoin",
    fillOpacity: "fill-opacity",
    textAnchor: "text-anchor",
    dominantBaseline: "dominant-baseline",
    markerStart: "marker-start",
    markerEnd: "marker-end",
    markerWidth: "markerWidth",
    markerHeight: "markerHeight",
    markerUnits: "markerUnits",
    refX: "refX",
    refY: "refY",
    viewBox: "viewBox"
  };
  return names[key] ?? key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function el(context, tag, attrs = {}, text = null) {
  return {
    type: "element",
    tag,
    props: cleanProps(attrs),
    text,
    children: [],
    append(...children) {
      this.children.push(...children.filter(Boolean));
    }
  };
}

function cleanProps(attrs) {
  const clean = {};
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    clean[displayPropName(key)] = value;
  }
  return clean;
}

function renderDisplayItem(context, item) {
  if (!item) return null;
  if (item.type === "math") return renderMathItem(context, item);
  if (item.type !== "element") return null;

  const node = context.document.createElementNS(SVG_NS, item.tag);
  for (const [key, value] of Object.entries(displayPropsToSvgAttrs(context, item.props))) {
    node.setAttribute(key, String(value));
  }
  if (item.text != null) node.textContent = item.text;
  if (item.children?.length) {
    node.append(...item.children.map((child) => renderDisplayItem(context, child)).filter(Boolean));
  }
  return node;
}

function renderMathItem(context, item) {
  if (!context.katex) {
    return renderDisplayItem(context, el(context, "text", {
      class: item.className,
      fill: "#111111",
      fontSize: 12,
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      x: item.x,
      y: item.y,
      textAnchor: item.anchor,
      ...(item.baseline ? { dominantBaseline: item.baseline } : {}),
      ...(item.rotate ? { transform: [rotateTransform(item.rotate, item.x, item.y)] } : {})
    }, item.fallback));
  }

  const foreignObject = renderDisplayItem(context, el(context, "foreignObject", item.props));
  const host = context.document.createElement("div");
  host.style.width = `${item.width}px`;
  host.style.height = `${item.height}px`;
  host.style.display = "flex";
  host.style.alignItems = "center";
  host.style.justifyContent = item.anchor === "middle" ? "center" : item.anchor === "end" ? "flex-end" : "flex-start";
  host.style.color = "#1e2724";
  if (item.fontSize != null) host.style.fontSize = cssSize(item.fontSize);
  if (item.style && typeof item.style === "object") {
    for (const [key, value] of Object.entries(item.style)) {
      host.style[key] = key === "fontSize" || key === "fontsize" ? cssSize(value) : String(value);
    }
  }
  context.katex.render(item.source, host, { throwOnError: false });
  foreignObject.append(host);
  return foreignObject;
}

function cssSize(value) {
  return typeof value === "number" ? `${value}px` : String(value);
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
