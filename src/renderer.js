const SVG_NS = "http://www.w3.org/2000/svg";

export function renderGraph(svg, graph, options = {}) {
  const nodes = flattenNodes(graph.nodes);
  const edges = flattenEdges(graph);
  const legs = indexLegs(nodes);
  const bounds = getBounds(nodes, edges, legs);
  const width = Math.max(options.minWidth ?? 720, bounds.maxX - bounds.minX + 160);
  const height = Math.max(options.minHeight ?? 520, bounds.maxY - bounds.minY + 160);
  const offsetX = 80 - bounds.minX;
  const offsetY = 80 - bounds.minY;
  const context = {
    document: options.document ?? svg.ownerDocument ?? document,
    katex: options.katex ?? null
  };

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.replaceChildren();
  svg.append(defs(context));

  const edgeLayer = el(context, "g");
  const nodeLayer = el(context, "g");
  svg.append(edgeLayer, nodeLayer);

  for (const edge of edges) {
    const from = legs.get(edge.from);
    const to = legs.get(edge.to);
    if (!from || !to) continue;
    edgeLayer.append(drawEdge(context, edge, from, to, offsetX, offsetY));
  }

  for (const node of graph.nodes) {
    nodeLayer.append(drawNodeTree(context, node, offsetX, offsetY));
  }

  return { width, height, bounds };
}

export function graphSummary(graph) {
  const nodeCount = flattenNodes(graph.nodes).length;
  const edgeCount = flattenEdges(graph).length;
  return {
    nodeCount,
    edgeCount,
    text: `${nodeCount} ${plural(nodeCount, "node")}, ${edgeCount} ${plural(edgeCount, "edge")}`
  };
}

export function flattenNodes(nodes) {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

export function flattenEdges(graph) {
  return [
    ...graph.edges,
    ...graph.nodes.flatMap((node) => collectNodeEdges(node))
  ];
}

export function edgePathData(edge, from, to, offsetX = 0, offsetY = 0) {
  const route = edge.attrs.route ?? "curve";
  if (route === "straight") {
    return pathData([
      { x: from.x + offsetX, y: from.y + offsetY },
      { x: to.x + offsetX, y: to.y + offsetY }
    ]);
  }
  if (route === "orthogonal") {
    return pathData(orthogonalPoints(edge, from, to, offsetX, offsetY));
  }

  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const handle = Math.max(48, distance * 0.35);
  const fromDir = angleVector(from.angle ?? 0);
  const toDir = angleVector(to.angle ?? 180);
  return `M ${from.x + offsetX} ${from.y + offsetY} C ${from.x + offsetX + fromDir.x * handle} ${from.y + offsetY + fromDir.y * handle}, ${to.x + offsetX + toDir.x * handle} ${to.y + offsetY + toDir.y * handle}, ${to.x + offsetX} ${to.y + offsetY}`;
}

function drawNodeTree(context, node, offsetX, offsetY) {
  const group = el(context, "g");
  if (node.children.length > 0) {
    group.append(drawGroupBox(context, node, offsetX, offsetY));
    for (const child of node.children) {
      group.append(drawNodeTree(context, child, offsetX, offsetY));
    }
    for (const leg of Object.values(node.legs)) {
      appendMaybe(group, drawLeg(context, leg, offsetX, offsetY));
    }
    return group;
  }

  group.append(drawShape(context, node, offsetX, offsetY));
  appendMaybe(group, drawNodeLabel(context, node, offsetX, offsetY));
  for (const leg of Object.values(node.legs)) {
    appendMaybe(group, drawLeg(context, leg, offsetX, offsetY));
  }
  return group;
}

function drawShape(context, node, offsetX, offsetY) {
  if (node.shape === "circle") {
    const r = Number(node.attrs.r ?? 28);
    return styledEl(context, "circle", node.attrs.style, {
      class: "shape",
      cx: node.x + offsetX,
      cy: node.y + offsetY,
      r
    });
  }

  return styledEl(context, "rect", node.attrs.style, {
    class: "shape",
    x: node.x + offsetX,
    y: node.y + offsetY,
    width: Number(node.attrs.w ?? 100),
    height: Number(node.attrs.h ?? 60),
    rx: 6
  });
}

function drawGroupBox(context, node, offsetX, offsetY) {
  const nestedNodes = flattenNodes([node]);
  const bounds = getBounds(nestedNodes, [], indexLegs(nestedNodes));
  const padding = 22;
  const box = el(context, "g");
  box.append(el(context, "rect", {
    class: "group-box",
    x: bounds.minX + offsetX - padding,
    y: bounds.minY + offsetY - padding,
    width: Math.max(80, bounds.maxX - bounds.minX + padding * 2),
    height: Math.max(54, bounds.maxY - bounds.minY + padding * 2),
    rx: 8
  }));
  appendMaybe(box, drawNodeLabel(context, node, offsetX, offsetY, {
    x: node.x,
    y: bounds.minY - 30
  }));
  return box;
}

function drawNodeLabel(context, node, offsetX, offsetY, position = null) {
  if (node.attrs.label == null) {
    return null;
  }
  const box = nodeBox(node);
  const x = position?.x ?? box.cx;
  const y = position?.y ?? box.cy;
  return drawLabel(context, node.attrs.label, x + offsetX, y + offsetY, "node-label");
}

function drawLeg(context, leg, offsetX, offsetY) {
  if (leg.auto && leg.attrs.label == null && leg.attrs.style == null) {
    return null;
  }
  const group = el(context, "g");
  group.append(styledEl(context, "circle", leg.attrs.style, {
    class: "leg-dot",
    cx: leg.x + offsetX,
    cy: leg.y + offsetY,
    r: Number(leg.attrs.r ?? 5)
  }));
  if (leg.attrs.label != null) {
    group.append(drawLabel(context, leg.attrs.label, leg.x + offsetX + 10, leg.y + offsetY - 10, "leg-label", "start"));
  }
  return group;
}

function drawEdge(context, edge, from, to, offsetX, offsetY) {
  return styledEl(context, "path", edge.attrs.style, {
    class: "edge",
    markerEnd: "url(#arrow)",
    d: edgePathData(edge, from, to, offsetX, offsetY)
  });
}

function orthogonalPoints(edge, from, to, offsetX, offsetY) {
  const stub = Number(edge.attrs.stub ?? 32);
  const fromDir = cardinalVector(from.angle ?? 0);
  const toDir = cardinalVector(to.angle ?? 180);
  const start = { x: from.x + offsetX, y: from.y + offsetY };
  const end = { x: to.x + offsetX, y: to.y + offsetY };
  const startStub = {
    x: start.x + fromDir.x * stub,
    y: start.y + fromDir.y * stub
  };
  const endStub = {
    x: end.x + toDir.x * stub,
    y: end.y + toDir.y * stub
  };

  if (fromDir.x !== 0) {
    const midX = (startStub.x + endStub.x) / 2;
    return compactPoints([
      start,
      startStub,
      { x: midX, y: startStub.y },
      { x: midX, y: endStub.y },
      endStub,
      end
    ]);
  }

  const midY = (startStub.y + endStub.y) / 2;
  return compactPoints([
    start,
    startStub,
    { x: startStub.x, y: midY },
    { x: endStub.x, y: midY },
    endStub,
    end
  ]);
}

function pathData(points) {
  return points.map((point, index) => {
    return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
  }).join(" ");
}

function compactPoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return point.x !== previous.x || point.y !== previous.y;
  });
}

function angleVector(angle) {
  const radians = Number(angle) * Math.PI / 180;
  return {
    x: Math.cos(radians),
    y: Math.sin(radians)
  };
}

function cardinalVector(angle) {
  const normalized = ((Number(angle) % 360) + 360) % 360;
  const directions = [
    { angle: 0, x: 1, y: 0 },
    { angle: 90, x: 0, y: 1 },
    { angle: 180, x: -1, y: 0 },
    { angle: 270, x: 0, y: -1 }
  ];
  return directions.reduce((best, direction) => {
    const delta = Math.abs(((normalized - direction.angle + 540) % 360) - 180);
    return delta < best.delta ? { ...direction, delta } : best;
  }, { ...directions[0], delta: Infinity });
}

function defs(context) {
  const marker = el(context, "marker", {
    id: "arrow",
    markerWidth: 12,
    markerHeight: 12,
    refX: 10,
    refY: 6,
    orient: "auto",
    markerUnits: "strokeWidth"
  });
  marker.append(el(context, "path", { d: "M 2 2 L 10 6 L 2 10 z", fill: "#2d6cdf" }));
  const defs = el(context, "defs");
  defs.append(marker);
  return defs;
}

function collectNodeEdges(node) {
  return [
    ...node.edges,
    ...node.children.flatMap((child) => collectNodeEdges(child))
  ];
}

function indexLegs(nodes) {
  const legs = new Map();
  for (const node of nodes) {
    for (const [id, leg] of Object.entries(node.legs)) {
      legs.set(`${node.id}.${id}`, leg);
    }
  }
  return legs;
}

function getBounds(nodes, edges, legs) {
  const points = [];
  for (const node of nodes) {
    const box = nodeBox(node);
    points.push({ x: box.minX, y: box.minY }, { x: box.maxX, y: box.maxY });
  }
  for (const edge of edges) {
    const from = legs.get(edge.from);
    const to = legs.get(edge.to);
    if (from) points.push(from);
    if (to) points.push(to);
  }
  if (points.length === 0) {
    return { minX: 0, minY: 0, maxX: 640, maxY: 360 };
  }
  return {
    minX: Math.min(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxX: Math.max(...points.map((point) => point.x)),
    maxY: Math.max(...points.map((point) => point.y))
  };
}

function nodeBox(node) {
  if (node.children.length > 0) {
    const nodes = flattenNodes(node.children);
    return getBounds(nodes, node.edges, indexLegs(nodes));
  }
  if (node.shape === "circle") {
    const r = Number(node.attrs.r ?? 28);
    return {
      minX: node.x - r,
      minY: node.y - r,
      maxX: node.x + r,
      maxY: node.y + r,
      cx: node.x,
      cy: node.y
    };
  }
  const w = Number(node.attrs.w ?? 100);
  const h = Number(node.attrs.h ?? 60);
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + w,
    maxY: node.y + h,
    cx: node.x + w / 2,
    cy: node.y + h / 2
  };
}

function el(context, name, attrs = {}, text = null) {
  const node = context.document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  if (text != null) {
    node.textContent = text;
  }
  return node;
}

function styledEl(context, name, style, attrs = {}, text = null) {
  return el(context, name, { ...attrs, ...svgStyleAttrs(style) }, text);
}

function svgStyleAttrs(style) {
  if (!style || typeof style !== "object") {
    return {};
  }
  const declarations = Object.entries(style).map(([key, value]) => {
    const name = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    return `${name}: ${value}`;
  });
  return { style: declarations.join("; ") };
}

function drawLabel(context, value, x, y, className, anchor = "middle") {
  const label = String(value);
  const math = parseMathLabel(label);
  if (math && context.katex) {
    return drawMathLabel(context, math, x, y, className, anchor);
  }

  return el(context, "text", {
    class: className,
    x,
    y: y + 4,
    "text-anchor": anchor
  }, math ?? label);
}

function drawMathLabel(context, source, x, y, className, anchor) {
  const width = estimateMathWidth(source);
  const height = 34;
  const left = anchor === "middle" ? x - width / 2 : x;
  const foreignObject = el(context, "foreignObject", {
    class: className,
    x: left,
    y: y - height / 2,
    width,
    height
  });
  const host = context.document.createElement("div");
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.style.display = "flex";
  host.style.alignItems = "center";
  host.style.justifyContent = anchor === "middle" ? "center" : "flex-start";
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

function appendMaybe(parent, child) {
  if (child) {
    parent.append(child);
  }
}

function plural(count, label) {
  return count === 1 ? label : `${label}s`;
}
