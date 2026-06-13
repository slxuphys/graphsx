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
const EDGE_TAGS = new Set(["Edge", "Arrow", "Link"]);
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
const REF_LITERAL = "__graphDslRef";
const TEMPLATE_LITERAL = "__graphDslTemplate";

export class GraphDslError extends Error {
  constructor(message, position = null) {
    super(position == null ? message : `${message} at ${position}`);
    this.name = "GraphDslError";
    this.position = position;
  }
}

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

export function parseMarkup(source) {
  const parser = new MarkupParser(source);
  return parser.parseDocument();
}

export function buildGraphModel(graphElement) {
  assertElement(graphElement, "Graph");
  graphElement = expandRepeats(graphElement);

  const shapeElements = graphElement.children.filter(isElementNamed("Shape"));
  const shapes = new Map(shapeElements.map((shape) => [requiredAttr(shape, "id"), shape]));
  const styles = buildStyles(graphElement.children.filter(isStyleElement));
  assertKnownChildren(graphElement, shapes, { allowStyle: true });
  for (const shape of shapeElements) {
    assertKnownChildren(shape, shapes);
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

  applyLayout(graph);
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
    paths: []
  };

  if (shapes.has(normalized.shape)) {
    return buildGroupedNode(base, shapes.get(normalized.shape), shapes, styles);
  }

  for (const legElement of nodeElement.children.filter(isPortElement)) {
    const leg = buildLeg(legElement, base, styles);
    base.legs[leg.id] = leg;
  }
  addDefaultPorts(base);

  return base;
}

function buildGroupedNode(instance, shapeElement, shapes, styles) {
  shapeElement = substituteShapeProps(shapeElement, instance.attrs);

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

  if (node.shape !== "rect" && node.shape !== "circle") return;

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
    from: requiredAttr(edgeElement, "from"),
    to: requiredAttr(edgeElement, "to"),
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
  node.x += dx;
  node.y += dy;
  for (const leg of Object.values(node.legs)) {
    leg.x += dx;
    leg.y += dy;
  }
  for (const child of node.children) {
    moveNodeBy(child, dx, dy);
  }
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

function resolveGraphAddresses(graph) {
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

  for (const edge of allEdges(graph)) {
    assertPortAddress(edge.from, ports);
    assertPortAddress(edge.to, ports);
  }
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
  return node.type === "element" && (BUILTIN_SHAPE_TAGS.has(node.name) || shapes.has(node.name));
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

function isStyleElement(node) {
  return node.type === "element" && STYLE_TAGS.has(node.name);
}

function isRepeatElement(node) {
  return node.type === "element" && REPEAT_TAGS.has(node.name);
}

function normalizeNodeElement(nodeElement, shapes, styles) {
  const shape = BUILTIN_SHAPE_TAGS.get(nodeElement.name) ?? nodeElement.name;
  if (!BUILTIN_SHAPE_TAGS.has(nodeElement.name) && !shapes.has(nodeElement.name)) {
    throw new GraphDslError(`Unknown shape tag <${nodeElement.name}>`);
  }

  const defaults = shapes.get(nodeElement.name)?.attrs ?? {};
  const attrs = resolveStyledAttrs({ ...defaults, ...nodeElement.attrs, shape }, styles);
  if (Array.isArray(attrs.at)) {
    attrs.x = attrs.at[0] ?? 0;
    attrs.y = attrs.at[1] ?? 0;
  }
  if (Array.isArray(attrs.size)) {
    attrs.w = attrs.size[0] ?? attrs.w;
    attrs.h = attrs.size[1] ?? attrs.h;
  }

  return { shape, attrs };
}

function hasExplicitPosition(attrs) {
  return Array.isArray(attrs.at) || attrs.x != null || attrs.y != null;
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
    const result = evaluateTemplateTerm(expression.trim(), scope);
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

function evaluateTemplateTerm(term, scope) {
  const match = term.match(/^([A-Za-z_][A-Za-z0-9_]*)([+-]\d+)?$/);
  if (!match || !scope.has(match[1])) return { resolved: false };
  const [, name, offset] = match;
  const value = scope.get(name);
  if (offset == null) {
    return { resolved: true, name, value };
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return { resolved: false };
  }
  return { resolved: true, name, value: number + Number(offset) };
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

class MarkupParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parseDocument() {
    const nodes = [];
    while (!this.isDone()) {
      this.skipWhitespace();
      if (this.isDone()) break;
      nodes.push(this.parseElement());
    }
    return nodes;
  }

  parseElement() {
    this.expect("<");
    if (this.peek() === "/") {
      throw new GraphDslError("Unexpected closing tag", this.index);
    }

    const name = this.readName();
    const attrs = this.readAttrs();

    if (this.consume("/>")) {
      return { type: "element", name, attrs, children: [] };
    }

    this.expect(">");
    const children = [];

    while (!this.isDone()) {
      this.skipWhitespace();
      if (this.consume(`</${name}>`)) {
        return { type: "element", name, attrs, children };
      }
      if (this.peek() === "<") {
        children.push(this.parseElement());
      } else {
        const text = this.readText();
        if (text.trim()) {
          children.push({ type: "text", value: text });
        }
      }
    }

    throw new GraphDslError(`Missing closing tag for <${name}>`, this.index);
  }

  readAttrs() {
    const attrs = {};

    while (!this.isDone()) {
      this.skipWhitespace({ comments: false });
      const char = this.peek();
      if (char === ">" || (char === "/" && this.source[this.index + 1] === ">")) {
        return attrs;
      }

      const name = this.readName();
      this.skipWhitespace({ comments: false });

      if (!this.consume("=")) {
        attrs[name] = true;
        continue;
      }

      this.skipWhitespace({ comments: false });
      attrs[name] = this.readAttrValue();
    }

    return attrs;
  }

  readAttrValue() {
    const quote = this.peek();
    if (quote === '"' || quote === "'") {
      this.index += 1;
      const start = this.index;
      while (!this.isDone() && this.peek() !== quote) this.index += 1;
      const value = this.source.slice(start, this.index);
      this.expect(quote);
      return value;
    }

    if (quote === "{") {
      return parseBraceLiteral(this.readBraced());
    }

    throw new GraphDslError("Attribute values must be quoted or braced", this.index);
  }

  readBraced() {
    this.expect("{");
    const start = this.index;
    let depth = 1;

    while (!this.isDone()) {
      const char = this.peek();
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) {
        const value = this.source.slice(start, this.index);
        this.index += 1;
        return value;
      }
      this.index += 1;
    }

    throw new GraphDslError("Unclosed braced value", start);
  }

  readName() {
    const start = this.index;
    while (!this.isDone() && /[A-Za-z0-9_.:-]/.test(this.peek())) {
      this.index += 1;
    }

    if (start === this.index) {
      throw new GraphDslError("Expected name", this.index);
    }

    return this.source.slice(start, this.index);
  }

  readText() {
    const start = this.index;
    while (!this.isDone() && this.peek() !== "<") {
      this.index += 1;
    }
    return this.source.slice(start, this.index);
  }

  skipWhitespace(options = {}) {
    const comments = options.comments !== false;

    while (!this.isDone()) {
      if (/\s/.test(this.peek())) {
        this.index += 1;
        continue;
      }
      if (comments && this.skipComment()) {
        continue;
      }
      break;
    }
  }

  skipComment() {
    if (this.consume("{/*")) {
      const end = this.source.indexOf("*/}", this.index);
      if (end === -1) {
        throw new GraphDslError("Unclosed JSX comment", this.index);
      }
      this.index = end + 3;
      return true;
    }

    if (this.consume("<!--")) {
      const end = this.source.indexOf("-->", this.index);
      if (end === -1) {
        throw new GraphDslError("Unclosed HTML comment", this.index);
      }
      this.index = end + 3;
      return true;
    }

    if (this.consume("{")) {
      this.skipBracedComment();
      return true;
    }

    return false;
  }

  skipBracedComment() {
    const start = this.index;
    let depth = 1;

    while (!this.isDone()) {
      const char = this.peek();
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      this.index += 1;
      if (depth === 0) return;
    }

    throw new GraphDslError("Unclosed braced comment", start);
  }

  consume(value) {
    if (!this.source.startsWith(value, this.index)) return false;
    this.index += value.length;
    return true;
  }

  expect(value) {
    if (!this.consume(value)) {
      throw new GraphDslError(`Expected "${value}"`, this.index);
    }
  }

  peek() {
    return this.source[this.index];
  }

  isDone() {
    return this.index >= this.source.length;
  }
}

function parseBraceLiteral(source) {
  const value = source.trim();
  if (/^`[\s\S]*`$/.test(value)) {
    return templateLiteral(value.slice(1, -1));
  }
  if (/^\{.*\}$/.test(value)) {
    return parseObjectLiteral(value);
  }
  if (/^\[.*\]$/.test(value)) {
    return parseArrayLiteral(value);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;

  const quoted = value.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value)) {
    return refLiteral(value);
  }

  throw new GraphDslError(`Unsupported braced literal "{${source}}"`);
}

function parseArrayLiteral(source) {
  const inner = source.slice(1, -1).trim();
  if (!inner) return [];

  return splitTopLevel(inner, ",").map((part) => parseObjectValue(part.trim()));
}

function parseObjectLiteral(source) {
  const inner = source.slice(1, -1).trim();
  if (!inner) return {};

  return Object.fromEntries(splitTopLevel(inner, ",").map((entry) => {
    const [rawKey, ...rawValueParts] = splitTopLevel(entry, ":");
    if (rawValueParts.length === 0) {
      throw new GraphDslError(`Invalid object entry "${entry}"`);
    }
    const key = parseObjectKey(rawKey.trim());
    const value = parseObjectValue(rawValueParts.join(":").trim());
    return [key, value];
  }));
}

function parseObjectKey(source) {
  const quoted = source.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  if (/^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(source)) return source;
  throw new GraphDslError(`Invalid object key "${source}"`);
}

function parseObjectValue(source) {
  if (/^`[\s\S]*`$/.test(source)) return templateLiteral(source.slice(1, -1));
  if (/^-?\d+(\.\d+)?$/.test(source)) return Number(source);
  if (source === "true") return true;
  if (source === "false") return false;
  if (source === "null") return null;
  if (/^\[.*\]$/.test(source)) return parseArrayLiteral(source);
  if (/^\{.*\}$/.test(source)) return parseObjectLiteral(source);

  const quoted = source.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(source)) {
    return refLiteral(source);
  }

  throw new GraphDslError(`Unsupported object value "${source}"`);
}

function refLiteral(name) {
  return { [REF_LITERAL]: name };
}

function templateLiteral(source) {
  return { [TEMPLATE_LITERAL]: source };
}

function isRefLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, REF_LITERAL);
}

function isTemplateLiteral(value) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.hasOwn(value, TEMPLATE_LITERAL);
}

function splitTopLevel(source, delimiter) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote && source[index - 1] !== "\\") {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{" || char === "[") depth += 1;
    if (char === "}" || char === "]") depth -= 1;
    if (char === delimiter && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(source.slice(start).trim());
  return parts.filter(Boolean);
}
