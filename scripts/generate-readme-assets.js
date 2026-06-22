import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseGraphSXDocument,
  renderGraphSXDocument
} from "../src/index.js";

const assetsDir = join("docs", "assets");

const examples = [
  {
    file: "basic-graph.svg",
    source: `<Graph>
  <Style id="box" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />
  <Style id="wire" stroke="#7c3aed" strokeWidth={3} />

  <Rect id="A" at={[70, 82]} size={[100, 60]} label="alpha" useStyle="box">
    <Port id="out" right label="xy" />
  </Rect>

  <Circle id="B" at={[280, 112]} r={40} label="B">
    <Port id="in" left />
  </Circle>

  <Link headArrow from="A.out" to="B.in" useStyle="wire" />
</Graph>`
  },
  {
    file: "plot-heart.svg",
    source: `<Plot width={430} height={330} padding={[30, 38, 40, 46]} xDomain={[-18, 18]} yDomain={[-18, 14]} frame box>
  <Data
    id="heart"
    x="16 * pow(sin(t), 3)"
    y="13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t)"
    domain={[0, 2*pi]}
    samples={360}
  />

  <Axis x label="x" ticks grid />
  <Axis y label="y" ticks grid />
  <Line data="heart" stroke="#e11d48" strokeWidth={2.6} />
</Plot>`
  },
  {
    file: "tensor-repeat.svg",
    source: `<Graph route="straight">
  <Style id="tensor" fill="#6aa4d8" stroke="#111111" strokeWidth={3} />
  <Style id="wire" stroke="#111111" strokeWidth={2.5} />
  <Style id="hidden" fill="transparent" stroke="transparent" strokeWidth={0} />

  <Shape id="Tensor" groupBox={false}>
    <Rect id="box" at={[0, 0]} size={[54, 54]} corner={8} useStyle="tensor" label={tensorLabel}>
      <Port id="left" left r={0} useStyle="hidden" />
      <Port id="right" right r={0} useStyle="hidden" />
      <Port id="phys" bottom r={0} useStyle="hidden" />
    </Rect>
    <Port id="left" target="box.left" />
    <Port id="right" target="box.right" />
    <Port id="phys" target="box.phys" />
  </Shape>

  <Repeat count={4} as="i" step={[96, 0]}>
    <Tensor id={\`A\${i}\`} at={[70, 60]} tensorLabel={\`A\${i}\`} />
    <Point id={\`p\${i}\`} at={[97, 150]} r={0} />
    <Link from={\`A\${i}.phys\`} to={\`p\${i}.center\`} useStyle="wire" />
  </Repeat>

  <Repeat count={3} as="i">
    <Link from={\`A\${i}.right\`} to={\`A\${i+1}.left\`} useStyle="wire" />
  </Repeat>
</Graph>`
  }
];

await mkdir(assetsDir, { recursive: true });

for (const example of examples) {
  const svg = renderToSvg(example.source);
  const outputPath = join(assetsDir, example.file);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${svg}\n`, "utf8");
}

function renderToSvg(source) {
  const documentRef = createDocument();
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;
  renderGraphSXDocument(svg, parseGraphSXDocument(source), { document: documentRef });
  trimSvg(svg);
  svg.attrs.xmlns = "http://www.w3.org/2000/svg";
  svg.children.unshift(createStyleNode());
  return serializeNode(svg);
}

function createDocument() {
  return {
    createElementNS(_namespace, tag) {
      return createMockNode(tag);
    },
    createElement(tag) {
      return createMockNode(tag);
    }
  };
}

function createMockNode(tag) {
  return {
    tag,
    attrs: {},
    children: [],
    style: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    set textContent(value) {
      this.text = value;
    },
    get textContent() {
      return this.text ?? "";
    }
  };
}

function createStyleNode() {
  const style = createMockNode("style");
  style.textContent = `
    .shape { fill: #ffffff; stroke: #26312d; stroke-width: 2; }
    .node-label { font: 700 14px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1e2724; pointer-events: none; }
    .leg-label { font: 11px ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #52605a; pointer-events: none; }
    .edge { fill: none; stroke: #2d6cdf; stroke-width: 2.5; }
    .path { fill: none; stroke: #111111; stroke-width: 2; }
    .leg-dot { fill: #16846f; stroke: #ffffff; stroke-width: 2; }
    .plot-frame, .plot-box { fill: none; stroke: #26312d; stroke-width: 1.8; }
    .plot-axis { stroke: #26312d; stroke-width: 1.8; }
    .plot-tick { stroke: #26312d; stroke-width: 1.3; }
    .plot-grid { stroke: #d8ded8; stroke-width: 1; }
    .plot-line, .plot-curve { fill: none; stroke: #2563eb; stroke-width: 2; }
    .plot-line-marker { fill: #ffffff; stroke: #2563eb; stroke-width: 2; }
    .plot-axis-label, .plot-tick-label, .plot-label { font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; fill: #1e2724; }
  `;
  return style;
}

function trimSvg(svg, padding = 18) {
  const bbox = nodeBBox(svg);
  if (!bbox) return;
  const x = Math.floor(bbox.minX - padding);
  const y = Math.floor(bbox.minY - padding);
  const width = Math.ceil(bbox.maxX - bbox.minX + padding * 2);
  const height = Math.ceil(bbox.maxY - bbox.minY + padding * 2);
  svg.attrs.viewBox = `${x} ${y} ${width} ${height}`;
  svg.attrs.width = width;
  svg.attrs.height = height;
}

function nodeBBox(node) {
  if (["defs", "marker", "style"].includes(node.tag)) return null;

  let bbox = primitiveBBox(node);
  for (const child of node.children ?? []) {
    bbox = mergeBBox(bbox, nodeBBox(child));
  }
  return bbox;
}

function primitiveBBox(node) {
  switch (node.tag) {
    case "rect":
      return rectBBox(node);
    case "circle":
      return circleBBox(node);
    case "line":
      return lineBBox(node);
    case "path":
      return pathBBox(node);
    case "text":
      return textBBox(node);
    default:
      return null;
  }
}

function rectBBox(node) {
  const x = numberAttr(node, "x", 0);
  const y = numberAttr(node, "y", 0);
  const width = numberAttr(node, "width", 0);
  const height = numberAttr(node, "height", 0);
  if (width <= 0 || height <= 0) return null;
  return makeBBox(x, y, x + width, y + height);
}

function circleBBox(node) {
  const cx = numberAttr(node, "cx", 0);
  const cy = numberAttr(node, "cy", 0);
  const r = numberAttr(node, "r", 0);
  return makeBBox(cx - r, cy - r, cx + r, cy + r);
}

function lineBBox(node) {
  return makeBBox(
    Math.min(numberAttr(node, "x1", 0), numberAttr(node, "x2", 0)),
    Math.min(numberAttr(node, "y1", 0), numberAttr(node, "y2", 0)),
    Math.max(numberAttr(node, "x1", 0), numberAttr(node, "x2", 0)),
    Math.max(numberAttr(node, "y1", 0), numberAttr(node, "y2", 0))
  );
}

function pathBBox(node) {
  const numbers = String(node.attrs.d ?? "").match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) ?? [];
  if (numbers.length < 2) return null;
  const xs = [];
  const ys = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    xs.push(numbers[index]);
    ys.push(numbers[index + 1]);
  }
  return makeBBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
}

function textBBox(node) {
  const x = Number(node.attrs.x);
  const y = Number(node.attrs.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const text = String(node.text ?? "");
  const width = Math.max(8, text.length * 8);
  const height = 16;
  const anchor = node.attrs["text-anchor"];
  const minX = anchor === "middle" ? x - width / 2 : anchor === "end" ? x - width : x;
  return makeBBox(minX, y - height, minX + width, y + 4);
}

function numberAttr(node, name, fallback) {
  const value = Number(node.attrs[name]);
  return Number.isFinite(value) ? value : fallback;
}

function makeBBox(minX, minY, maxX, maxY) {
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return { minX, minY, maxX, maxY };
}

function mergeBBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY)
  };
}

function serializeNode(node) {
  const attrs = serializeAttrs(node);
  const children = node.children.map(serializeNode).join("");
  const text = node.text == null ? "" : escapeText(node.text);
  return `<${node.tag}${attrs}>${text}${children}</${node.tag}>`;
}

function serializeAttrs(node) {
  const attrs = { ...node.attrs };
  const style = serializeStyle(node.style);
  if (style) attrs.style = attrs.style ? `${attrs.style}; ${style}` : style;
  return Object.entries(attrs)
    .filter(([, value]) => value != null && value !== false)
    .map(([key, value]) => ` ${key}="${escapeAttr(String(value))}"`)
    .join("");
}

function serializeStyle(style) {
  return Object.entries(style ?? {})
    .filter(([, value]) => value != null && value !== "")
    .map(([key, value]) => `${kebabCase(key)}: ${value}`)
    .join("; ");
}

function kebabCase(value) {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}

function escapeText(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeAttr(value) {
  return escapeText(value).replaceAll('"', "&quot;");
}
