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
    katex: options.katex ?? null,
    graph,
    nodes,
    routing: routingDefaults(graph.attrs)
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
    edgeLayer.append(drawEdge(context, resolveEdgeRouting(edge, context.routing), from, to, offsetX, offsetY));
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

export function edgePathData(edge, from, to, offsetX = 0, offsetY = 0, routingContext = null) {
  const route = edge.attrs.route ?? "curve";
  if (route === "straight") {
    return pathData([
      { x: from.x + offsetX, y: from.y + offsetY },
      { x: to.x + offsetX, y: to.y + offsetY }
    ]);
  }
  if (route === "orthogonal") {
    return routedPathData(edge, orthogonalPoints(edge, from, to, offsetX, offsetY));
  }
  if (route === "auto") {
    return routedPathData(edge, autoRoutePoints(edge, from, to, offsetX, offsetY, routingContext));
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

  appendMaybe(group, drawShape(context, node, offsetX, offsetY));
  appendMaybe(group, drawNodeLabel(context, node, offsetX, offsetY));
  for (const leg of Object.values(node.legs)) {
    appendMaybe(group, drawLeg(context, leg, offsetX, offsetY));
  }
  return group;
}

function drawShape(context, node, offsetX, offsetY) {
  if (node.shape === "point") {
    return null;
  }

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
    rx: Number(node.attrs.corner ?? node.attrs.rx ?? 6)
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
    d: edgePathData(edge, from, to, offsetX, offsetY, context)
  });
}

function routingDefaults(attrs) {
  const routing = attrs.routing && typeof attrs.routing === "object" ? attrs.routing : {};
  return {
    route: attrs.route,
    grid: attrs.grid,
    padding: attrs.padding,
    stub: attrs.stub,
    corner: attrs.corner,
    ...routing
  };
}

function resolveEdgeRouting(edge, defaults) {
  return {
    ...edge,
    attrs: {
      ...defaults,
      ...edge.attrs,
      style: edge.attrs.style
    }
  };
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

function autoRoutePoints(edge, from, to, offsetX, offsetY, context) {
  if (!context?.nodes) {
    return orthogonalPoints(edge, from, to, offsetX, offsetY);
  }

  const grid = Math.max(4, Number(edge.attrs.grid ?? 20));
  const padding = Number(edge.attrs.padding ?? 16);
  const stub = Number(edge.attrs.stub ?? 32);
  const fromDir = cardinalVector(from.angle ?? 0);
  const toDir = cardinalVector(to.angle ?? 180);
  const start = { x: from.x + offsetX, y: from.y + offsetY };
  const end = { x: to.x + offsetX, y: to.y + offsetY };
  const startStub = { x: start.x + fromDir.x * stub, y: start.y + fromDir.y * stub };
  const endStub = { x: end.x + toDir.x * stub, y: end.y + toDir.y * stub };
  const obstacles = obstacleBoxes(context.nodes, edge, offsetX, offsetY, padding);
  const routeBounds = routeSearchBounds(context.nodes, obstacles, [start, end, startStub, endStub], offsetX, offsetY, padding, grid);
  const middle = findGridPath(startStub, endStub, obstacles, routeBounds, grid);

  if (!middle) {
    return orthogonalPoints(edge, from, to, offsetX, offsetY);
  }

  const startBridge = orthogonalBridge(startStub, middle[0], fromDir.x !== 0 ? "horizontal" : "vertical");
  const endBridge = orthogonalBridge(middle[middle.length - 1], endStub, toDir.x !== 0 ? "vertical" : "horizontal");
  return compactCollinearPoints(compactPoints([
    start,
    startStub,
    ...startBridge,
    ...middle.slice(1, -1),
    middle[middle.length - 1],
    ...endBridge,
    endStub,
    end
  ]));
}

function orthogonalBridge(from, to, firstDirection) {
  if (from.x === to.x || from.y === to.y) {
    return [to];
  }
  const corner = firstDirection === "horizontal"
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
  return [corner, to];
}

function obstacleBoxes(nodes, edge, offsetX, offsetY, padding) {
  const sourceNode = nodeAddress(edge.from);
  return nodes
    .filter((node) => node.children.length === 0)
    .filter((node) => node.shape !== "point")
    .filter((node) => !isEndpointNode(node.id, sourceNode))
    .map((node) => {
      const box = nodeBox(node);
      return {
        minX: box.minX + offsetX - padding,
        minY: box.minY + offsetY - padding,
        maxX: box.maxX + offsetX + padding,
        maxY: box.maxY + offsetY + padding
      };
    });
}

function routeSearchBounds(nodes, obstacles, points, offsetX, offsetY, padding, grid) {
  const nodeBounds = getBounds(nodes, [], new Map());
  const xs = [
    nodeBounds.minX + offsetX,
    nodeBounds.maxX + offsetX,
    ...points.map((point) => point.x),
    ...obstacles.flatMap((box) => [box.minX, box.maxX])
  ];
  const ys = [
    nodeBounds.minY + offsetY,
    nodeBounds.maxY + offsetY,
    ...points.map((point) => point.y),
    ...obstacles.flatMap((box) => [box.minY, box.maxY])
  ];
  const margin = padding + grid * 3;
  return {
    minX: Math.floor((Math.min(...xs) - margin) / grid) * grid,
    minY: Math.floor((Math.min(...ys) - margin) / grid) * grid,
    maxX: Math.ceil((Math.max(...xs) + margin) / grid) * grid,
    maxY: Math.ceil((Math.max(...ys) + margin) / grid) * grid
  };
}

function findGridPath(start, end, obstacles, bounds, grid) {
  const tracks = buildTracks(bounds, grid, [start.x, end.x], [start.y, end.y]);
  const startCell = snapCell(start, tracks);
  const endCell = snapCell(end, tracks);
  const startKey = cellKey(startCell);
  const endKey = cellKey(endCell);
  const open = new Map([[startKey, { cell: startCell, g: 0, f: manhattan(startCell, endCell), parent: null, direction: null }]]);
  const closed = new Set();

  while (open.size > 0) {
    const current = lowestScore(open);
    const currentKey = cellKey(current.cell);
    open.delete(currentKey);
    if (currentKey === endKey) {
      return cellsToPoints(reconstructCells(current), tracks);
    }
    closed.add(currentKey);

    for (const next of neighborCells(current.cell)) {
      if (!cellInBounds(next, tracks)) continue;
      const nextKey = cellKey(next);
      if (closed.has(nextKey)) continue;
      const point = cellPoint(next, tracks);
      if (pointInBoxes(point, obstacles)) continue;

      const direction = {
        x: next.x - current.cell.x,
        y: next.y - current.cell.y
      };
      const turnPenalty = current.direction && (current.direction.x !== direction.x || current.direction.y !== direction.y) ? 0.35 : 0;
      const g = current.g + cellDistance(current.cell, next, tracks) / grid + turnPenalty;
      const known = open.get(nextKey);
      if (known && known.g <= g) continue;
      open.set(nextKey, {
        cell: next,
        g,
        f: g + manhattan(next, endCell),
        parent: current,
        direction
      });
    }
  }

  return null;
}

function lowestScore(open) {
  let best = null;
  for (const item of open.values()) {
    if (!best || item.f < best.f) {
      best = item;
    }
  }
  return best;
}

function reconstructCells(node) {
  const cells = [];
  for (let current = node; current; current = current.parent) {
    cells.push(current.cell);
  }
  return cells.reverse();
}

function cellsToPoints(cells, tracks) {
  return compactCollinearPoints(cells.map((cell) => cellPoint(cell, tracks)));
}

function buildTracks(bounds, grid, exactXs, exactYs) {
  return {
    xs: buildTrack(bounds.minX, bounds.maxX, grid, exactXs),
    ys: buildTrack(bounds.minY, bounds.maxY, grid, exactYs)
  };
}

function buildTrack(min, max, grid, exactValues) {
  const values = [];
  for (let value = min; value <= max; value += grid) {
    values.push(value);
  }
  values.push(...exactValues);
  return [...new Set(values.map((value) => Number(value.toFixed(6))))].sort((a, b) => a - b);
}

function snapCell(point, tracks) {
  return {
    x: nearestTrackIndex(tracks.xs, point.x),
    y: nearestTrackIndex(tracks.ys, point.y)
  };
}

function nearestTrackIndex(track, value) {
  let bestIndex = 0;
  let bestDelta = Infinity;
  for (let index = 0; index < track.length; index += 1) {
    const delta = Math.abs(track[index] - value);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function cellPoint(cell, tracks) {
  return {
    x: tracks.xs[cell.x],
    y: tracks.ys[cell.y]
  };
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function cellInBounds(cell, tracks) {
  return (
    cell.x >= 0 &&
    cell.y >= 0 &&
    cell.x < tracks.xs.length &&
    cell.y < tracks.ys.length
  );
}

function cellDistance(a, b, tracks) {
  return Math.abs(tracks.xs[a.x] - tracks.xs[b.x]) + Math.abs(tracks.ys[a.y] - tracks.ys[b.y]);
}

function neighborCells(cell) {
  return [
    { x: cell.x + 1, y: cell.y },
    { x: cell.x - 1, y: cell.y },
    { x: cell.x, y: cell.y + 1 },
    { x: cell.x, y: cell.y - 1 }
  ];
}

function manhattan(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function pointInBoxes(point, boxes) {
  return boxes.some((box) => (
    point.x >= box.minX &&
    point.x <= box.maxX &&
    point.y >= box.minY &&
    point.y <= box.maxY
  ));
}

function nodeAddress(portAddress) {
  return String(portAddress).split(".").slice(0, -1).join(".");
}

function isEndpointNode(nodeId, endpointId) {
  return nodeId === endpointId || nodeId.startsWith(`${endpointId}.`);
}

function pathData(points) {
  return points.map((point, index) => {
    return `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`;
  }).join(" ");
}

function routedPathData(edge, points) {
  const corner = Number(edge.attrs.corner ?? 0);
  if (corner <= 0) {
    return pathData(points);
  }
  return roundedPathData(points, corner);
}

function roundedPathData(points, radius) {
  if (points.length <= 2) {
    return pathData(points);
  }

  const commands = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const point = points[index];
    const next = points[index + 1];
    const inLength = distance(previous, point);
    const outLength = distance(point, next);
    const amount = Math.min(radius, inLength / 2, outLength / 2);

    if (amount <= 0 || isCollinear(previous, point, next)) {
      commands.push(`L ${point.x} ${point.y}`);
      continue;
    }

    const before = moveToward(point, previous, amount);
    const after = moveToward(point, next, amount);
    commands.push(`L ${before.x} ${before.y}`);
    commands.push(`Q ${point.x} ${point.y} ${after.x} ${after.y}`);
  }
  const last = points[points.length - 1];
  commands.push(`L ${last.x} ${last.y}`);
  return commands.join(" ");
}

function distance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function moveToward(from, to, amount) {
  const length = distance(from, to);
  if (length === 0) return from;
  return {
    x: from.x + (to.x - from.x) / length * amount,
    y: from.y + (to.y - from.y) / length * amount
  };
}

function isCollinear(a, b, c) {
  return (a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y);
}

function compactPoints(points) {
  return points.filter((point, index) => {
    if (index === 0) return true;
    const previous = points[index - 1];
    return point.x !== previous.x || point.y !== previous.y;
  });
}

function compactCollinearPoints(points) {
  if (points.length <= 2) return points;
  const compacted = [points[0]];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = compacted[compacted.length - 1];
    const point = points[index];
    const next = points[index + 1];
    if ((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y)) {
      continue;
    }
    compacted.push(point);
  }
  compacted.push(points[points.length - 1]);
  return compacted;
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
  if (node.shape === "point") {
    return {
      minX: node.x,
      minY: node.y,
      maxX: node.x,
      maxY: node.y,
      cx: node.x,
      cy: node.y
    };
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
