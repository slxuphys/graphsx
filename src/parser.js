import { GraphDslError } from "./errors.js";
import {
  ADDRESS_LITERAL,
  EXPRESSION_LITERAL,
  POINT_LITERAL,
  REF_LITERAL,
  TEMPLATE_LITERAL,
  evaluateExpression,
  isAddress,
  isAddressLiteral,
  isExpressionLiteral,
  isPointLiteral,
  isRefLiteral,
  isTemplateLiteral,
  pointLiteral,
  pointExpressionNumber,
  substitutePointExpression,
  templateLiteral
} from "./literals.js";
import { parseMarkup } from "./markup.js";
import { buildPlotModel } from "./plot.js";

const BUILTIN_SHAPE_TAGS = new Map([
  ["Rect", "rect"],
  ["rect", "rect"],
  ["Rec", "rect"],
  ["rec", "rect"],
  ["Circle", "circle"],
  ["circle", "circle"],
  ["Circ", "circle"],
  ["circ", "circle"],
  ["Point", "point"],
  ["point", "point"],
  ["Anchor", "point"],
  ["anchor", "point"]
]);
const PLOT_TAGS = new Set(["Plot"]);
const EDGE_TAGS = new Set(["Link"]);
const PATH_TAGS = new Set(["Path", "path"]);
const PORT_TAGS = new Set(["Port", "Leg"]);
const STYLE_TAGS = new Set(["Style"]);
const REPEAT_TAGS = new Set(["Repeat"]);
const SIDE_ATTRS = ["left", "right", "top", "bottom"];
const SIDE_ANGLES = {
  left: 180,
  right: 0,
  top: -90,
  bottom: 90
};
export { GraphDslError, parseMarkup };

export function parseGraphs(source) {
  const roots = parseMarkup(source).filter((node) => node.type === "element");
  const graphs = roots.filter((node) => node.name === "Graph");

  if (graphs.length !== roots.length) {
    throw new GraphDslError("Top-level elements must be <Graph>");
  }

  return graphs.map(buildGraphModel);
}

export function parseGraph(source) {
  const graphs = parseGraphs(source);

  if (graphs.length !== 1) {
    throw new GraphDslError(`Expected exactly one <Graph>, found ${graphs.length}`);
  }

  return graphs[0];
}

export function buildGraphModel(graphElement) {
  assertElement(graphElement, "Graph");
  graphElement = expandRepeats(graphElement);

  const shapeElements = graphElement.children.filter(isElementNamed("Shape"));
  assertUniqueShapeIds(shapeElements);
  const shapes = resolveShapeDefinitions(shapeElements);
  const styles = buildStyles(graphElement.children.filter(isStyleElement));
  assertKnownChildren(graphElement, shapes, { allowStyle: true });
  for (const shape of shapes.values()) {
    assertKnownChildren(shape, shapes);
    validateShapeDefinitionIds(shape, shapes);
  }

  const nodes = graphElement.children.filter((node) => isNodeElement(node, shapes)).map((node) => {
    return buildNode(node, shapes, styles, { x: 0, y: 0, namespace: "" });
  });

  const edges = graphElement.children.filter(isEdgeElement).map((edge) => buildEdge(edge, styles));
  const paths = graphElement.children.filter(isPathElement).map((path) => buildPath(path, styles, { x: 0, y: 0 }));
  const graph = {
    type: "graph",
    attrs: { ...graphElement.attrs },
    styles: Object.fromEntries(styles),
    shapes: Object.fromEntries([...shapes].map(([id, shape]) => [id, describeShape(shape)])),
    nodes,
    edges,
    paths
  };

  validateUniqueIds(graph);
  applyLayout(graph);
  resolveGraphAddresses(graph, { assertEdges: false });
  applyTransforms(graph);
  applyPlacements(graph);
  resolveGraphAddresses(graph);
  return graph;
}

function buildNode(nodeElement, shapes, styles, context) {
  const normalized = normalizeNodeElement(nodeElement, shapes, styles);
  const id = requiredAttr(nodeElement, "id");
  const positioned = hasExplicitPosition(nodeElement.attrs);
  const x = coordinateAttr(normalized.attrs, "x", 0) + context.x;
  const y = coordinateAttr(normalized.attrs, "y", 0) + context.y;
  const base = {
    id: context.namespace ? `${context.namespace}.${id}` : id,
    localId: id,
    shape: normalized.shape,
    x,
    y,
    positioned,
    attrs: normalized.attrs,
    legs: {},
    children: [],
    edges: [],
    paths: [],
    plot: normalized.plot ?? null
  };

  if (shapes.has(normalized.shape)) {
    return buildGroupedNode(base, shapes.get(normalized.shape), shapes, styles);
  }

  assertUniqueChildIds(nodeElement.children.filter(isPortElement), "port", ` on "${base.id}"`);
  for (const legElement of nodeElement.children.filter(isPortElement)) {
    const leg = buildLeg(legElement, base, styles);
    base.legs[leg.id] = leg;
  }
  addDefaultPorts(base);

  return base;
}

function buildGroupedNode(instance, shapeElement, shapes, styles) {
  shapeElement = substituteShapeProps(shapeElement, instance.attrs);
  assertUniqueChildIds(shapeElement.children.filter(isPortElement), "port", ` on "${instance.id}"`);

  const childContext = {
    x: instance.x,
    y: instance.y,
    namespace: instance.id
  };

  instance.children = shapeElement.children
    .filter((child) => isNodeElement(child, shapes))
    .map((child) => buildNode(child, shapes, styles, childContext));

  instance.edges = shapeElement.children
    .filter(isEdgeElement)
    .map((edge) => prefixGroupedEdge(buildEdge(edge, styles), instance.id));

  instance.paths = shapeElement.children
    .filter(isPathElement)
    .map((path) => buildPath(path, styles, childContext));

  for (const legElement of shapeElement.children.filter(isPortElement)) {
    const leg = buildLeg(legElement, instance, styles);
    if (legElement.attrs.target) {
      leg.target = `${instance.id}.${legElement.attrs.target}`;
    }
    instance.legs[leg.id] = leg;
  }

  return instance;
}

function buildLeg(legElement, node, styles) {
  const id = requiredAttr(legElement, "id");
  const side = resolveSide(legElement.attrs);
  const [explicitX, explicitY] = resolvePortCoordinates(legElement.attrs);
  const relative = resolveLegPosition(node, side, explicitX, explicitY);

  return {
    id,
    side,
    angle: resolvePortAngle(legElement.attrs, side),
    x: node.x + relative.x,
    y: node.y + relative.y,
    relative,
    attrs: resolveStyledAttrs(legElement.attrs, styles)
  };
}

function addDefaultPorts(node) {
  if (node.shape === "point") {
    if (!node.legs.center) {
      node.legs.center = {
        id: "center",
        side: null,
        angle: 0,
        x: node.x,
        y: node.y,
        relative: { x: 0, y: 0 },
        auto: true,
        attrs: { id: "center" }
      };
    }
    return;
  }

  if (node.shape !== "rect" && node.shape !== "circle" && node.shape !== "plot") return;

  for (const side of SIDE_ATTRS) {
    if (node.legs[side]) continue;
    const relative = resolveLegPosition(node, side, null, null);
    node.legs[side] = {
      id: side,
      side,
      angle: SIDE_ANGLES[side],
      x: node.x + relative.x,
      y: node.y + relative.y,
      relative,
      auto: true,
      attrs: { id: side, [side]: true }
    };
  }
}

function resolveLegPosition(node, side, explicitX, explicitY) {
  if (explicitX != null || explicitY != null) {
    return { x: explicitX ?? 0, y: explicitY ?? 0 };
  }

  if (node.shape === "point") {
    return { x: 0, y: 0 };
  }

  if (node.shape === "circle") {
    const r = numberAttr({ attrs: node.attrs }, "r", 0);
    const circle = {
      left: { x: -r, y: 0 },
      right: { x: r, y: 0 },
      top: { x: 0, y: -r },
      bottom: { x: 0, y: r }
    };
    return circle[side] ?? { x: 0, y: 0 };
  }

  const w = numberAttr({ attrs: node.attrs }, "w", 0);
  const h = numberAttr({ attrs: node.attrs }, "h", 0);
  const rect = {
    left: { x: 0, y: h / 2 },
    right: { x: w, y: h / 2 },
    top: { x: w / 2, y: 0 },
    bottom: { x: w / 2, y: h }
  };

  return rect[side] ?? { x: w / 2, y: h / 2 };
}

function buildEdge(edgeElement, styles) {
  return {
    from: endpointAttr(edgeElement, "from"),
    to: endpointAttr(edgeElement, "to"),
    attrs: resolveStyledAttrs(edgeElement.attrs, styles)
  };
}

function buildPath(pathElement, styles, context) {
  const attrs = resolveStyledAttrs(pathElement.attrs, styles);
  return {
    id: attrs.id ?? null,
    x: attrs.points == null ? context.x : 0,
    y: attrs.points == null ? context.y : 0,
    points: normalizePathPoints(attrs.points, context),
    attrs
  };
}

function normalizePathPoints(points, context) {
  if (points == null) return null;
  if (!Array.isArray(points)) {
    throw new GraphDslError("\"points\" must be an array of [x, y] pairs");
  }
  return points.map((point) => {
    if (!Array.isArray(point) || point.length < 2) {
      throw new GraphDslError("\"points\" must be an array of [x, y] pairs");
    }
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new GraphDslError("Path points must be numbers");
    }
    return { x: x + context.x, y: y + context.y };
  });
}

function prefixGroupedEdge(edge, namespace) {
  return {
    ...edge,
    from: `${namespace}.${edge.from}`,
    to: `${namespace}.${edge.to}`
  };
}

function applyLayout(graph) {
  const layout = graph.attrs.layout;
  if (!layout || layout === "manual") return;

  if (layout === "row" || layout === "column") {
    applyFlowLayout(graph, layout);
    return;
  }

  if (layout === "dag" || layout === "auto") {
    applyDagLayout(graph);
  }
}

function applyFlowLayout(graph, layout) {
  const gap = numberFromAttrs(graph.attrs, "gap", 120);
  const originX = numberFromAttrs(graph.attrs, "x", 100);
  const originY = numberFromAttrs(graph.attrs, "y", 100);
  let cursor = 0;

  for (const node of graph.nodes) {
    if (!node.positioned) {
      moveNodeTo(node, layout === "row" ? originX + cursor : originX, layout === "column" ? originY + cursor : originY);
    }
    const size = nodeSize(node);
    cursor += (layout === "row" ? size.w : size.h) + gap;
  }
}

function applyDagLayout(graph) {
  const direction = graph.attrs.direction ?? "right";
  const rankGap = numberFromAttrs(graph.attrs, "rankGap", numberFromAttrs(graph.attrs, "gap", 180));
  const nodeGap = numberFromAttrs(graph.attrs, "nodeGap", 90);
  const originX = numberFromAttrs(graph.attrs, "x", 100);
  const originY = numberFromAttrs(graph.attrs, "y", 100);
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const ids = new Set(graph.nodes.map((node) => node.id));
  const outgoing = new Map([...ids].map((id) => [id, []]));
  const indegree = new Map([...ids].map((id) => [id, 0]));

  for (const edge of graph.edges) {
    const from = rootAddress(edge.from);
    const to = rootAddress(edge.to);
    if (!ids.has(from) || !ids.has(to) || from === to) continue;
    outgoing.get(from).push(to);
    indegree.set(to, indegree.get(to) + 1);
  }

  const queue = [...ids]
    .filter((id) => indegree.get(id) === 0)
    .sort((a, b) => order.get(a) - order.get(b));
  const layer = new Map([...ids].map((id) => [id, 0]));

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    for (const next of outgoing.get(id)) {
      layer.set(next, Math.max(layer.get(next), layer.get(id) + 1));
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        queue.push(next);
      }
    }
  }

  const layers = new Map();
  for (const node of graph.nodes) {
    const rank = layer.get(node.id) ?? 0;
    if (!layers.has(rank)) layers.set(rank, []);
    layers.get(rank).push(node);
  }

  for (const [rank, nodes] of layers) {
    nodes.sort((a, b) => order.get(a.id) - order.get(b.id));
    nodes.forEach((node, index) => {
      if (node.positioned) return;
      const point = orientedPoint(direction, originX, originY, rank * rankGap, index * nodeGap);
      moveNodeTo(node, point.x, point.y);
    });
  }
}

function orientedPoint(direction, originX, originY, main, cross) {
  if (direction === "left") return { x: originX - main, y: originY + cross };
  if (direction === "down") return { x: originX + cross, y: originY + main };
  if (direction === "up") return { x: originX + cross, y: originY - main };
  return { x: originX + main, y: originY + cross };
}

function moveNodeTo(node, x, y) {
  moveNodeBy(node, x - node.x, y - node.y);
}

function moveNodeBy(node, dx, dy) {
  if (node.transform) {
    node.transform.e += dx;
    node.transform.f += dy;
  } else {
    node.x += dx;
    node.y += dy;
  }
  for (const leg of Object.values(node.legs)) {
    leg.x += dx;
    leg.y += dy;
  }
  for (const child of node.children) {
    moveNodeBy(child, dx, dy);
  }
  for (const path of node.paths ?? []) {
    movePathBy(path, dx, dy);
  }
}

function movePathBy(path, dx, dy) {
  if (path.transform) {
    path.transform.e += dx;
    path.transform.f += dy;
    return;
  }
  if (Array.isArray(path.points)) {
    for (const point of path.points) {
      point.x += dx;
      point.y += dy;
    }
    return;
  }
  path.x = (path.x ?? 0) + dx;
  path.y = (path.y ?? 0) + dy;
}

function applyTransforms(graph) {
  for (const node of graph.nodes) {
    applyNodeTransforms(node);
  }
  for (const path of graph.paths ?? []) {
    applyPathOwnTransform(path);
  }
}

function applyNodeTransforms(node) {
  for (const child of node.children) {
    applyNodeTransforms(child);
  }
  for (const path of node.paths ?? []) {
    applyPathOwnTransform(path);
  }

  const matrix = nodeTransformMatrix(node);
  if (!matrix) return;

  if (node.children.length > 0 || (node.paths?.length ?? 0) > 0) {
    transformNodeContents(node, matrix);
  } else {
    node.transform = composeMatrix(matrix, node.transform);
    transformNodeLegs(node, matrix);
  }
}

function transformNodeContents(node, matrix) {
  for (const child of node.children) {
    transformNodeTree(child, matrix);
  }
  for (const path of node.paths ?? []) {
    transformPath(path, matrix);
  }
  transformNodeLegs(node, matrix);
}

function transformNodeTree(node, matrix) {
  node.transform = composeMatrix(matrix, node.transform);
  transformNodeLegs(node, matrix);
  for (const path of node.paths ?? []) {
    transformPath(path, matrix);
  }
  for (const child of node.children) {
    transformNodeTree(child, matrix);
  }
}

function transformNodeLegs(node, matrix) {
  for (const leg of Object.values(node.legs)) {
    const point = transformPoint(matrix, leg);
    leg.x = point.x;
    leg.y = point.y;
    leg.angle = transformAngle(matrix, leg.angle ?? 0);
    leg.relative = {
      x: leg.x - node.x,
      y: leg.y - node.y
    };
  }
}

function applyPathOwnTransform(path) {
  const matrix = attrsTransformMatrix(path.attrs, pathOrigin(path));
  if (matrix) {
    transformPath(path, matrix);
  }
}

function transformPath(path, matrix) {
  if (Array.isArray(path.points)) {
    path.points = path.points.map((point) => transformPoint(matrix, point));
    return;
  }
  path.transform = composeMatrix(matrix, path.transform);
}

function nodeTransformMatrix(node) {
  return attrsTransformMatrix(node.attrs, nodeTransformOrigin(node));
}

function attrsTransformMatrix(attrs, origin) {
  const rotate = attrs.rotate ?? attrs.rotation;
  const hasRotate = rotate != null && Number(rotate) !== 0;
  const hasFlipX = booleanAttr(attrs.flipX ?? attrs.flipx, false);
  const hasFlipY = booleanAttr(attrs.flipY ?? attrs.flipy, false);
  if (!hasRotate && !hasFlipX && !hasFlipY) return null;

  const angle = rotate == null ? 0 : Number(rotate);
  if (!Number.isFinite(angle)) {
    throw new GraphDslError("\"rotate\" must be a number");
  }
  return transformMatrix(origin.x, origin.y, angle, hasFlipX, hasFlipY);
}

function nodeTransformOrigin(node) {
  if (Array.isArray(node.attrs.origin)) {
    return {
      x: node.x + (optionalNumber(node.attrs.origin[0]) ?? 0),
      y: node.y + (optionalNumber(node.attrs.origin[1]) ?? 0)
    };
  }

  const anchor = transformAnchor(node);
  if (anchor) {
    return { x: anchor.x, y: anchor.y };
  }

  if (node.children.length > 0 || (node.paths?.length ?? 0) > 0) {
    return { x: node.x, y: node.y };
  }

  const box = untransformedNodeBox(node);
  return { x: box.cx, y: box.cy };
}

function transformAnchor(node) {
  if (node.attrs.anchor == null) return null;
  return findPortInNode(node, String(node.attrs.anchor));
}

function pathOrigin(path) {
  if (Array.isArray(path.attrs.origin)) {
    return {
      x: (path.x ?? 0) + (optionalNumber(path.attrs.origin[0]) ?? 0),
      y: (path.y ?? 0) + (optionalNumber(path.attrs.origin[1]) ?? 0)
    };
  }
  return { x: path.x ?? 0, y: path.y ?? 0 };
}

function transformMatrix(ox, oy, rotate, flipX, flipY) {
  const radians = rotate * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const sx = flipX ? -1 : 1;
  const sy = flipY ? -1 : 1;
  const a = cos * sx;
  const b = sin * sx;
  const c = -sin * sy;
  const d = cos * sy;
  return {
    a,
    b,
    c,
    d,
    e: ox - a * ox - c * oy,
    f: oy - b * ox - d * oy
  };
}

function composeMatrix(outer, inner) {
  if (!inner) return { ...outer };
  return {
    a: outer.a * inner.a + outer.c * inner.b,
    b: outer.b * inner.a + outer.d * inner.b,
    c: outer.a * inner.c + outer.c * inner.d,
    d: outer.b * inner.c + outer.d * inner.d,
    e: outer.a * inner.e + outer.c * inner.f + outer.e,
    f: outer.b * inner.e + outer.d * inner.f + outer.f
  };
}

function transformPoint(matrix, point) {
  return {
    x: matrix.a * point.x + matrix.c * point.y + matrix.e,
    y: matrix.b * point.x + matrix.d * point.y + matrix.f
  };
}

function transformAngle(matrix, angle) {
  const radians = Number(angle) * Math.PI / 180;
  const x = Math.cos(radians);
  const y = Math.sin(radians);
  const tx = matrix.a * x + matrix.c * y;
  const ty = matrix.b * x + matrix.d * y;
  return normalizeAngle(Math.atan2(ty, tx) * 180 / Math.PI);
}

function normalizeAngle(angle) {
  const normalized = ((angle % 360) + 360) % 360;
  return Math.abs(normalized - 360) < 1e-9 ? 0 : normalized;
}

function untransformedNodeBox(node) {
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
    const r = numberFromAttrs(node.attrs, "r", 28);
    return {
      minX: node.x - r,
      minY: node.y - r,
      maxX: node.x + r,
      maxY: node.y + r,
      cx: node.x,
      cy: node.y
    };
  }

  const w = numberFromAttrs(node.attrs, "w", 100);
  const h = numberFromAttrs(node.attrs, "h", 60);
  return {
    minX: node.x,
    minY: node.y,
    maxX: node.x + w,
    maxY: node.y + h,
    cx: node.x + w / 2,
    cy: node.y + h / 2
  };
}

function nodeSize(node) {
  if (node.shape === "point") {
    return { w: 0, h: 0 };
  }

  if (node.shape === "circle") {
    const r = numberFromAttrs(node.attrs, "r", 28);
    return { w: r * 2, h: r * 2 };
  }
  return {
    w: numberFromAttrs(node.attrs, "w", 100),
    h: numberFromAttrs(node.attrs, "h", 60)
  };
}

function rootAddress(address) {
  return String(address).split(".")[0];
}

function nodeAddress(address) {
  return String(address).split(".").slice(0, -1).join(".");
}

function resolveGraphAddresses(graph, options = {}) {
  const ports = indexPorts(graph.nodes);

  for (const node of flattenNodes(graph.nodes)) {
    for (const leg of Object.values(node.legs)) {
      if (!leg.target) continue;
      const target = ports.get(leg.target);
      if (!target) {
        throw new GraphDslError(`Unknown port address "${leg.target}"`);
      }
      leg.x = target.x;
      leg.y = target.y;
      leg.side = leg.side ?? target.side;
      if (leg.attrs.angle == null && leg.attrs.side == null && !SIDE_ATTRS.some((side) => leg.attrs[side] === true)) {
        leg.angle = target.angle;
      }
      leg.relative = {
        x: target.x - node.x,
        y: target.y - node.y
      };
      leg.attrs = inheritTargetPortAttrs(target.attrs, leg.attrs, leg.id);
    }
  }

  if (options.assertEdges !== false) {
    for (const edge of allEdges(graph)) {
      assertPortAddress(edge.from, ports);
      assertPortAddress(edge.to, ports);
    }
  }
}

function applyPlacements(graph) {
  const pending = new Set(flattenNodes(graph.nodes).filter(hasPlacementRef));

  while (pending.size > 0) {
    const ports = indexPorts(graph.nodes);
    let progressed = false;

    for (const node of [...pending]) {
      const targetAddress = placementDependency(node.attrs.at);
      const dependency = targetAddress ? nodeAddress(targetAddress) : null;
      if (dependency && isPendingDependency(dependency, pending, node)) {
        continue;
      }

      placeNodeAtReference(node, ports);
      pending.delete(node);
      progressed = true;
    }

    if (!progressed) {
      const ids = [...pending].map((node) => node.id).join(", ");
      throw new GraphDslError(`Cyclic or unresolved placement reference involving ${ids}`);
    }
  }
}

function hasPlacementRef(node) {
  return placementAddress(node.attrs.at) != null;
}

function isPendingDependency(dependency, pending, node) {
  if (dependency === node.id || node.id.startsWith(`${dependency}.`)) {
    return false;
  }
  for (const pendingNode of pending) {
    if (pendingNode === node) continue;
    if (pendingNode.id === dependency || dependency.startsWith(`${pendingNode.id}.`)) {
      return true;
    }
  }
  return false;
}

function placeNodeAtReference(node, ports) {
  const target = placementPoint(node.attrs.at, ports);
  if (!target) return;

  const anchor = placementAnchor(node, ports);
  moveNodeBy(node, target.x - anchor.x, target.y - anchor.y);
}

function placementDependency(value) {
  const expression = placementExpression(value);
  return expression?.address ?? null;
}

function placementPoint(value, ports) {
  const expression = placementExpression(value);
  if (!expression) return null;

  const port = ports.get(expression.address);
  if (!port) {
    throw new GraphDslError(`Unknown placement port "${expression.address}"`);
  }

  return expression.offsets.reduce((point, offset) => {
    const x = pointExpressionNumber(offset.x, expression);
    const y = pointExpressionNumber(offset.y, expression);
    return {
      x: point.x + x,
      y: point.y + y
    };
  }, { x: port.x, y: port.y });
}

function placementExpression(value) {
  if (isPointLiteral(value)) return value[POINT_LITERAL];
  if (isAddressLiteral(value)) return { address: value[ADDRESS_LITERAL], offsets: [] };
  if (typeof value === "string" && isAddress(value)) return { address: value, offsets: [] };
  return null;
}

function placementAnchor(node, ports) {
  if (node.attrs.anchor == null) {
    return { x: node.x, y: node.y };
  }

  const anchor = String(node.attrs.anchor);
  const port = findPortInNode(node, anchor, ports);
  if (!port) {
    throw new GraphDslError(`Unknown anchor port "${anchor}" on "${node.id}"`);
  }
  return port;
}

function findPortInNode(node, anchor, ports = null) {
  if (!anchor.includes(".") && node.legs[anchor]) {
    return node.legs[anchor];
  }

  const address = `${node.id}.${anchor}`;
  if (ports) {
    return ports.get(address) ?? null;
  }

  for (const candidate of flattenNodes([node])) {
    for (const [id, leg] of Object.entries(candidate.legs)) {
      if (`${candidate.id}.${id}` === address) {
        return leg;
      }
    }
  }
  return null;
}

function placementAddress(value) {
  return placementDependency(value);
}

function indexPorts(nodes) {
  const ports = new Map();
  for (const node of flattenNodes(nodes)) {
    for (const [id, leg] of Object.entries(node.legs)) {
      ports.set(`${node.id}.${id}`, leg);
    }
  }
  return ports;
}

function inheritTargetPortAttrs(targetAttrs, publicAttrs, publicId) {
  const attrs = {
    ...targetAttrs,
    ...publicAttrs,
    id: publicId
  };
  if (targetAttrs.style || publicAttrs.style) {
    attrs.style = {
      ...(targetAttrs.style ?? {}),
      ...(publicAttrs.style ?? {})
    };
  }
  return attrs;
}

function flattenNodes(nodes) {
  return nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);
}

function allEdges(graph) {
  return [
    ...graph.edges,
    ...graph.nodes.flatMap((node) => nodeEdges(node))
  ];
}

function nodeEdges(node) {
  return [
    ...node.edges,
    ...node.children.flatMap((child) => nodeEdges(child))
  ];
}

function assertPortAddress(address, ports) {
  if (!ports.has(address)) {
    throw new GraphDslError(`Unknown port address "${address}"`);
  }
}

function assertUniqueShapeIds(shapeElements) {
  const seen = new Set();
  for (const shape of shapeElements) {
    const id = requiredAttr(shape, "id");
    if (seen.has(id)) {
      throw new GraphDslError(`Duplicate shape id "${id}"`);
    }
    seen.add(id);
  }
}

function resolveShapeDefinitions(shapeElements) {
  const rawShapes = new Map(shapeElements.map((shape) => [requiredAttr(shape, "id"), shape]));
  const resolved = new Map();
  const resolving = new Set();

  const resolve = (id) => {
    if (resolved.has(id)) return resolved.get(id);
    const shape = rawShapes.get(id);
    if (!shape) {
      throw new GraphDslError(`Unknown parent shape "${id}"`);
    }
    if (resolving.has(id)) {
      throw new GraphDslError(`Cyclic shape inheritance involving "${id}"`);
    }

    resolving.add(id);
    const parentId = shape.attrs.from;
    let result = shape;
    if (parentId != null) {
      if (!rawShapes.has(parentId)) {
        throw new GraphDslError(`Unknown parent shape "${parentId}"`);
      }
      const parent = resolve(parentId);
      result = mergeShapeDefinition(parent, shape);
    }
    resolving.delete(id);
    resolved.set(id, result);
    return result;
  };

  for (const id of rawShapes.keys()) {
    resolve(id);
  }
  return resolved;
}

function mergeShapeDefinition(parent, child) {
  return {
    ...child,
    attrs: {
      ...parent.attrs,
      ...child.attrs,
      id: child.attrs.id
    },
    children: [
      ...parent.children,
      ...child.children
    ]
  };
}

function validateShapeDefinitionIds(shape, shapes) {
  const id = requiredAttr(shape, "id");
  assertUniqueChildIds(shape.children.filter((child) => isNodeElement(child, shapes)), "child node", ` in shape "${id}"`);
  assertUniqueChildIds(shape.children.filter(isPortElement), "port", ` in shape "${id}"`);
  assertUniqueChildIds(shape.children.filter((child) => isPathElement(child) && child.attrs.id != null), "path", ` in shape "${id}"`);
}

function assertUniqueChildIds(elements, label, suffix = "") {
  const seen = new Set();
  for (const element of elements) {
    const id = requiredAttr(element, "id");
    if (seen.has(id)) {
      throw new GraphDslError(`Duplicate ${label} id "${id}"${suffix}`);
    }
    seen.add(id);
  }
}

function validateUniqueIds(graph) {
  assertUniqueNodeIds(graph.nodes);
  for (const node of flattenNodes(graph.nodes)) {
    assertUniquePortIds(node);
  }
  assertUniquePathIds(flattenModelPaths(graph));
}

function assertUniqueNodeIds(nodes) {
  const seen = new Set();
  for (const node of flattenNodes(nodes)) {
    if (seen.has(node.id)) {
      throw new GraphDslError(`Duplicate node id "${node.id}"`);
    }
    seen.add(node.id);
  }
}

function assertUniquePortIds(node) {
  const seen = new Set();
  for (const id of Object.keys(node.legs)) {
    if (seen.has(id)) {
      throw new GraphDslError(`Duplicate port id "${id}" on "${node.id}"`);
    }
    seen.add(id);
  }
}

function assertUniquePathIds(paths) {
  const seen = new Set();
  for (const path of paths) {
    if (path.id == null) continue;
    if (seen.has(path.id)) {
      throw new GraphDslError(`Duplicate path id "${path.id}"`);
    }
    seen.add(path.id);
  }
}

function flattenModelPaths(graph) {
  return [
    ...(graph.paths ?? []),
    ...(graph.nodes ?? []).flatMap((node) => flattenNodePaths(node))
  ];
}

function flattenNodePaths(node) {
  return [
    ...(node.paths ?? []),
    ...node.children.flatMap((child) => flattenNodePaths(child))
  ];
}

function describeShape(shapeElement) {
  return {
    id: requiredAttr(shapeElement, "id"),
    attrs: { ...shapeElement.attrs },
    nodes: shapeElement.children
      .filter((node) => node.type === "element" && !isEdgeElement(node) && !isPathElement(node) && !isPortElement(node))
      .map((node) => node.attrs.id),
    paths: shapeElement.children.filter(isPathElement).map((path) => path.attrs.id).filter(Boolean),
    legs: shapeElement.children.filter(isPortElement).map((leg) => leg.attrs.id)
  };
}

function assertElement(node, name) {
  if (!node || node.type !== "element" || node.name !== name) {
    throw new GraphDslError(`Expected <${name}>`);
  }
}

function isElementNamed(name) {
  return (node) => node.type === "element" && node.name === name;
}

function isNodeElement(node, shapes) {
  return node.type === "element" && (BUILTIN_SHAPE_TAGS.has(node.name) || shapes.has(node.name) || isPlotElement(node));
}

function isEdgeElement(node) {
  return node.type === "element" && EDGE_TAGS.has(node.name);
}

function isPathElement(node) {
  return node.type === "element" && PATH_TAGS.has(node.name);
}

function isPortElement(node) {
  return node.type === "element" && PORT_TAGS.has(node.name);
}

function isPlotElement(node) {
  return node.type === "element" && PLOT_TAGS.has(node.name);
}

function isStyleElement(node) {
  return node.type === "element" && STYLE_TAGS.has(node.name);
}

function isRepeatElement(node) {
  return node.type === "element" && REPEAT_TAGS.has(node.name);
}

function normalizeNodeElement(nodeElement, shapes, styles) {
  if (isPlotElement(nodeElement)) {
    const attrs = resolveStyledAttrs({ ...nodeElement.attrs, shape: "plot" }, styles);
    normalizeBoxAttrs(attrs);
    return {
      shape: "plot",
      attrs,
      plot: buildPlotModel({
        ...nodeElement,
        attrs,
        children: nodeElement.children.filter((child) => !isPortElement(child))
      })
    };
  }

  const shape = BUILTIN_SHAPE_TAGS.get(nodeElement.name) ?? nodeElement.name;
  if (!BUILTIN_SHAPE_TAGS.has(nodeElement.name) && !shapes.has(nodeElement.name)) {
    throw new GraphDslError(`Unknown shape tag <${nodeElement.name}>`);
  }

  const defaults = shapes.get(nodeElement.name)?.attrs ?? {};
  const attrs = resolveStyledAttrs({ ...defaults, ...nodeElement.attrs, shape }, styles);
  normalizeBoxAttrs(attrs);

  return { shape, attrs };
}

function normalizeBoxAttrs(attrs) {
  if (Array.isArray(attrs.at)) {
    attrs.x = attrs.at[0] ?? 0;
    attrs.y = attrs.at[1] ?? 0;
  }
  if (Array.isArray(attrs.size)) {
    attrs.w = attrs.size[0] ?? attrs.w;
    attrs.h = attrs.size[1] ?? attrs.h;
  }
  if (attrs.width != null) attrs.w = attrs.width;
  if (attrs.height != null) attrs.h = attrs.height;
}

function hasExplicitPosition(attrs) {
  return attrs.at != null || attrs.x != null || attrs.y != null;
}

function coordinateAttr(attrs, name, fallback) {
  return numberAttr({ attrs }, name, fallback);
}

function resolveSide(attrs) {
  if (attrs.side) return attrs.side;
  return SIDE_ATTRS.find((side) => attrs[side] === true) ?? null;
}

function resolvePortAngle(attrs, side) {
  if (attrs.angle != null) {
    const angle = Number(attrs.angle);
    if (!Number.isFinite(angle)) {
      throw new GraphDslError("\"angle\" must be a number");
    }
    return angle;
  }
  return SIDE_ANGLES[side] ?? 0;
}

function resolvePortCoordinates(attrs) {
  if (Array.isArray(attrs.at)) {
    return [optionalNumber(attrs.at[0]), optionalNumber(attrs.at[1])];
  }
  return [optionalNumber(attrs.x), optionalNumber(attrs.y)];
}

function assertKnownChildren(element, shapes, options = {}) {
  for (const child of element.children) {
    if (child.type !== "element") continue;
    if (
      child.name === "Shape" ||
      (options.allowStyle && isStyleElement(child)) ||
      isNodeElement(child, shapes) ||
      isEdgeElement(child) ||
      isPathElement(child) ||
      isPortElement(child)
    ) {
      continue;
    }
    throw new GraphDslError(`Unknown tag <${child.name}>`);
  }
}

function expandRepeats(element) {
  return expandElement(element, new Map(), { x: 0, y: 0 });
}

function expandElement(element, scope, offset) {
  if (isRepeatElement(element)) {
    return expandRepeat(element, scope, offset);
  }

  const attrs = offsetPositionAttrs(substituteAttrs(element.attrs, scope), element.name, offset);
  const childOffset = isPositionableElementName(element.name) ? { x: 0, y: 0 } : offset;
  const children = element.children.flatMap((child) => {
    if (child.type !== "element") return child;
    const expanded = expandElement(child, scope, childOffset);
    return Array.isArray(expanded) ? expanded : [expanded];
  });

  return { ...element, attrs, children };
}

function expandRepeat(element, scope, offset) {
  const count = numberAttr(element, "count", numberAttr(element, "n", 0));
  const variable = element.attrs.as ?? "i";
  const step = Array.isArray(element.attrs.step) ? element.attrs.step : [0, 0];
  const dx = optionalNumber(step[0]) ?? 0;
  const dy = optionalNumber(step[1]) ?? 0;
  const expanded = [];

  for (let index = 0; index < count; index += 1) {
    const nextScope = new Map(scope);
    nextScope.set(variable, index);
    const nextOffset = {
      x: offset.x + dx * index,
      y: offset.y + dy * index
    };

    for (const child of element.children) {
      if (child.type !== "element") continue;
      const item = expandElement(child, nextScope, nextOffset);
      expanded.push(...(Array.isArray(item) ? item : [item]));
    }
  }

  return expanded;
}

function substituteAttrs(attrs, scope) {
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => {
    return [key, substituteValue(value, scope)];
  }));
}

function substituteValue(value, scope) {
  if (isRefLiteral(value)) {
    return scope.has(value[REF_LITERAL]) ? scope.get(value[REF_LITERAL]) : value;
  }
  if (isPointLiteral(value)) {
    return pointLiteral(substitutePointExpression(value[POINT_LITERAL], (item) => substituteValue(item, scope)));
  }
  if (isExpressionLiteral(value)) {
    const result = evaluateExpression(value[EXPRESSION_LITERAL], scope, { strict: false });
    return result.resolved ? result.value : value;
  }
  if (isTemplateLiteral(value)) {
    const rendered = renderTemplateLiteral(value[TEMPLATE_LITERAL], scope, { strict: false });
    return rendered.complete ? rendered.value : templateLiteral(rendered.value);
  }
  if (typeof value === "string") {
    return substituteTemplate(value, scope);
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteValue(item, scope));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      return [key, substituteValue(item, scope)];
    }));
  }
  return value;
}

function substituteShapeProps(element, attrs) {
  const scope = new Map(Object.entries(attrs));
  return substituteElementProps(element, scope);
}

function substituteElementProps(element, scope) {
  return {
    ...element,
    attrs: substitutePropAttrs(element.attrs, scope),
    children: element.children.map((child) => {
      if (child.type !== "element") return child;
      return substituteElementProps(child, scope);
    })
  };
}

function substitutePropAttrs(attrs, scope) {
  return Object.fromEntries(Object.entries(attrs).map(([key, value]) => {
    return [key, substitutePropValue(value, scope)];
  }));
}

function substitutePropValue(value, scope) {
  if (isRefLiteral(value)) {
    const name = value[REF_LITERAL];
    if (!scope.has(name)) {
      throw new GraphDslError(`Unknown shape prop "${name}"`);
    }
    return scope.get(name);
  }
  if (isPointLiteral(value)) {
    return pointLiteral(substitutePointExpression(value[POINT_LITERAL], (item) => substitutePropValue(item, scope)));
  }
  if (isExpressionLiteral(value)) {
    return evaluateExpression(value[EXPRESSION_LITERAL], scope, { strict: true }).value;
  }
  if (isTemplateLiteral(value)) {
    const rendered = renderTemplateLiteral(value[TEMPLATE_LITERAL], scope, { strict: true });
    return rendered.value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substitutePropValue(item, scope));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      return [key, substitutePropValue(item, scope)];
    }));
  }
  return value;
}

function substituteTemplate(source, scope) {
  return source.replace(/\{([^{}]+)\}/g, (match, expression, offset) => {
    const values = expression.split(",").map((term) => evaluateTemplateTerm(term.trim(), scope));
    if (!values.every((value) => value.resolved)) return match;

    const replacement = values.map((value) => value.value).join(",");
    return source[offset - 1] === "_" || source[offset - 1] === "^" ? `{${replacement}}` : replacement;
  });
}

function renderTemplateLiteral(source, scope, options) {
  const consumed = new Set();
  let complete = true;
  const value = source.replace(/\$\{([^{}]+)\}/g, (match, expression) => {
    const result = evaluateTemplateTerm(expression.trim(), scope, options);
    if (!result.resolved) {
      if (options.strict) {
        throw new GraphDslError(`Unknown template variable "${expression.trim()}"`);
      }
      complete = false;
      return match;
    }
    consumed.add(result.name);
    return result.value;
  });

  return { value, consumed, complete };
}

function evaluateTemplateTerm(term, scope, options = {}) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(term)) {
    if (scope.has(term)) {
      return { resolved: true, value: scope.get(term) };
    }
    if (options.strict) {
      throw new GraphDslError(`Unknown template variable "${term}"`);
    }
    return { resolved: false };
  }
  return evaluateExpression(term, scope, options);
}

function offsetPositionAttrs(attrs, name, offset) {
  if (!isPositionableElementName(name) || (offset.x === 0 && offset.y === 0)) {
    return attrs;
  }

  if (Array.isArray(attrs.at)) {
    return {
      ...attrs,
      at: [
        offsetNumber(attrs.at[0], offset.x),
        offsetNumber(attrs.at[1], offset.y),
        ...attrs.at.slice(2)
      ]
    };
  }

  if (name === "Path" || name === "path") {
    return {
      ...attrs,
      points: offsetPathPoints(attrs.points, offset)
    };
  }

  return {
    ...attrs,
    x: offsetNumber(attrs.x, offset.x),
    y: offsetNumber(attrs.y, offset.y)
  };
}

function isPositionableElementName(name) {
  return (
    !STYLE_TAGS.has(name) &&
    !REPEAT_TAGS.has(name) &&
    name !== "Graph" &&
    name !== "Shape" &&
    !EDGE_TAGS.has(name)
  );
}

function offsetPathPoints(points, offset) {
  if (!Array.isArray(points)) return points;
  return points.map((point) => {
    if (!Array.isArray(point)) return point;
    return [
      offsetNumber(point[0], offset.x),
      offsetNumber(point[1], offset.y),
      ...point.slice(2)
    ];
  });
}

function offsetNumber(value, offset) {
  return (value == null ? 0 : Number(value)) + offset;
}

function buildStyles(styleElements) {
  return new Map(styleElements.map((element) => {
    const id = requiredAttr(element, "id");
    return [id, styleAttrs(element.attrs)];
  }));
}

function resolveStyledAttrs(attrs, styles) {
  const namedStyle = attrs.useStyle == null ? {} : lookupStyle(styles, attrs.useStyle);
  const style = {
    ...namedStyle,
    ...styleAttrs(attrs.style ?? {})
  };
  if (Object.keys(style).length === 0) {
    return { ...attrs };
  }
  return {
    ...attrs,
    style
  };
}

function lookupStyle(styles, id) {
  if (!styles.has(id)) {
    throw new GraphDslError(`Unknown style "${id}"`);
  }
  return styles.get(id);
}

function styleAttrs(attrs) {
  const { id, useStyle, style, ...rest } = attrs;
  return { ...rest, ...(style && typeof style === "object" ? style : {}) };
}

function requiredAttr(element, name) {
  if (element.attrs[name] == null || element.attrs[name] === "") {
    throw new GraphDslError(`<${element.name}> requires "${name}"`);
  }
  return element.attrs[name];
}

function endpointAttr(element, name) {
  const value = requiredAttr(element, name);
  if (typeof value === "string") return value;
  throw new GraphDslError(`<${element.name}> "${name}" must be a quoted port address like "A.right"`);
}

function numberAttr(element, name, fallback) {
  const value = element.attrs[name];
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GraphDslError(`"${name}" must be a number`);
  }
  return number;
}

function numberFromAttrs(attrs, name, fallback) {
  const value = attrs[name];
  if (value == null) return fallback;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GraphDslError(`"${name}" must be a number`);
  }
  return number;
}

function optionalNumber(value) {
  if (value == null) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new GraphDslError("Leg coordinates must be numbers");
  }
  return number;
}

function booleanAttr(value, fallback) {
  if (value == null) return fallback;
  if (value === false || value === "false") return false;
  if (value === true || value === "true") return true;
  return Boolean(value);
}
