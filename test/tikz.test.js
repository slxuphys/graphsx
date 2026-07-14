import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTikzDisplayList,
  parseTikz,
  renderTikz,
  resolveTikzLayout,
  tikzSummary
} from "../src/index.js";

test("parses TikZ subset nodes, coordinates, paths, and marks", () => {
  const model = parseTikz(`
    \\begin{tikzpicture}[
      unitary/.style={rectangle, draw=black, fill=white!5, very thick, minimum width=1.5cm, minimum height=.5cm}
    ]
      \\node[unitary] (u1) at (0,0) {$U$};
      \\coordinate (u1-tl) at ([xshift=-.5cm]u1.north);
      \\coordinate (u1-tr) at ([xshift=.5cm]u1.north);
      \\filldraw[black] (u1-tl) circle (2pt);
      \\draw[->, thick] (u1-tl) -| (u1-tr);
    \\end{tikzpicture}
  `);

  assert.equal(model.type, "tikz");
  assert.equal(model.nodes.length, 1);
  assert.equal(model.coordinates.length, 2);
  assert.equal(model.marks.length, 1);
  assert.equal(model.paths.length, 1);
  assert.equal(model.nodes[0].label, "$U$");
  assert.equal(model.paths[0].props.headArrow, true);
  assert.equal(tikzSummary(model).text, "1 node, 1 path");
});

test("builds a TikZ display list renderable by the SVG backend", () => {
  const model = parseTikz(`
    \\node[rectangle, draw=black, fill=white!5, thick, minimum width=1cm, minimum height=.5cm] (A) at (0,0) {A};
    \\node[rectangle, draw=black, thick, minimum width=1cm, minimum height=.5cm] (B) at (2,0) {B};
    \\draw[->, thick] (A.east) -- (B.west);
  `);
  const displayList = buildTikzDisplayList(model, { minWidth: 0, minHeight: 0, viewportPadding: 10 });

  assert.equal(displayList.type, "tikz");
  assert.ok(displayList.items.some((item) => item.type === "rect"));
  assert.ok(displayList.items.some((item) => item.type === "path" && item.props.headArrow));
  assert.ok(displayList.arrowMarkers.has("12"));
});

test("supports anonymous TikZ nodes without registering source anchors", () => {
  const model = parseTikz(`
    \\node at (0,0) {$A$};
    \\node[rectangle, draw=black] at (1,0) {B};
  `);
  const displayList = buildTikzDisplayList(model, { minWidth: 0, minHeight: 0, viewportPadding: 0 });

  assert.equal(model.nodes.length, 2);
  assert.equal(model.nodes[0].anonymous, true);
  assert.equal(model.nodes[0].id, "__tikz_node_1");
  assert.equal(model.nodes[1].anonymous, true);
  assert.equal(model.nodes[1].id, "__tikz_node_2");
  assert.ok(displayList.items.some((item) => item.type === "math" && item.source === "A"));
  assert.ok(displayList.items.some((item) => item.type === "rect"));
  assert.throws(
    () => parseTikz(`
      \\node at (0,0) {$A$};
      \\draw (__tikz_node_1.east) -- (1,0);
    `),
    /Unknown TikZ coordinate "__tikz_node_1\.east"/
  );
});

test("rejects empty TikZ node names", () => {
  assert.throws(
    () => parseTikz(`\\node () at (0,0) {$A$};`),
    /Unsupported TikZ node command/
  );
});

test("expands reusable TikZ pics with local coordinates", () => {
  const model = parseTikz(`
    \\tikzset{
      gate/.style={rectangle, draw=black, fill=white!5, thick, minimum width=1cm, minimum height=.5cm},
      one gate/.pic={
        \\node[gate] (-body) at (0,0) {$U$};
        \\coordinate (-left) at (-body.west);
        \\coordinate (-right) at (-body.east);
      }
    }

    \\begin{tikzpicture}
      \\pic (u1) at (0,0) {one gate};
      \\pic (u2) at (2,0) {one gate};
      \\draw[->, thick] (u1-right) -- (u2-left);
    \\end{tikzpicture}
  `);

  assert.equal(model.nodes.length, 2);
  assert.equal(model.coordinates.length, 4);
  assert.equal(model.paths.length, 1);
  assert.equal(model.nodes[0].id, "u1-body");
  assert.equal(model.nodes[1].id, "u2-body");
  assert.ok(model.coordinates.some((point) => point.id === "u1-right"));
  assert.ok(model.coordinates.some((point) => point.id === "u2-left"));
  assert.equal(model.paths[0].props.headArrow, true);
});

test("supports nested coordinates inside reusable TikZ pics", () => {
  const model = parseTikz(`
    \\tikzset{
      brace/.pic={
        \\coordinate (-a) at (0,0);
        \\coordinate (-b) at (1,0);
        \\draw[thick] (-a) -- (-b);
      }
    }

    \\pic (p) at (3,2) {brace};
  `);

  assert.deepEqual(
    model.coordinates.map((point) => [point.id, point.x, point.y]),
    [
      ["p-a", 240, -160],
      ["p-b", 320, -160]
    ]
  );
  assert.deepEqual(model.paths[0].props.commands, [
    { op: "moveTo", x: 240, y: -160 },
    { op: "lineTo", x: 320, y: -160 }
  ]);
});

test("applies TikZ unit scales to coordinates, shifts, and style lengths", () => {
  const model = parseTikz(`
    \\begin{tikzpicture}[
      process/.style={rectangle, draw=black, fill=white, thick, rounded corners=.08cm, minimum width=1.2cm, minimum height=.6cm}
    ]
      \\node[process] (A) at (1,1) {A};
      \\coordinate (B) at ([xshift=.5cm,yshift=.25cm]A.east);
    \\end{tikzpicture}
  `, { units: { cm: 40 } });

  assert.equal(model.units.cm, 40);
  assert.equal(model.nodes[0].x, 40);
  assert.equal(model.nodes[0].y, -40);
  assert.equal(model.nodes[0].width, 48);
  assert.equal(model.nodes[0].height, 24);
  assert.equal(model.nodes[0].corner, 3.2);
  assert.deepEqual(model.coordinates[0], { id: "B", x: 84, y: -50 });
});

test("maps TikZ line thickness keywords", () => {
  const model = parseTikz(`
    \\draw (0,0) -- (1,0);
    \\draw[ultra thin] (0,0) -- (1,0);
    \\draw[very thin] (0,0) -- (1,0);
    \\draw[thin] (0,0) -- (1,0);
    \\draw[semithick] (0,0) -- (1,0);
    \\draw[thick] (0,0) -- (1,0);
    \\draw[very thick] (0,0) -- (1,0);
    \\draw[ultra thick] (0,0) -- (1,0);
  `);

  assert.deepEqual(model.paths.map((path) => path.props.strokeWidth), [
    0.4,
    0.1,
    0.2,
    0.4,
    0.6,
    0.8,
    1.2,
    1.6
  ]);
});

test("maps TikZ line colors and dash appearance keywords", () => {
  const model = parseTikz(`
    \\draw[blue, dotted, thick] (0,0) -- (1,0);
    \\draw[loosely dotted] (0,0) -- (1,0);
    \\draw[densely dotted] (0,0) -- (1,0);
    \\draw[dashed] (0,0) -- (1,0);
    \\draw[loosely dashed] (0,0) -- (1,0);
    \\draw[densely dashed] (0,0) -- (1,0);
  `, {
    units: {
      pt: 2
    }
  });

  assert.equal(model.paths[0].props.stroke, "#2563eb");
  assert.equal(model.paths[0].props.strokeWidth, 0.8);
  assert.deepEqual(model.paths.map((path) => path.props.strokeDasharray), [
    "2 4",
    "2 8",
    "2 2",
    "6 6",
    "6 12",
    "6 3"
  ]);
});

test("supports TikZ unit scales for cm and pt", () => {
  const model = parseTikz(`
    \\node[rectangle, draw=black, minimum width=1cm, inner sep=3pt] (A) at (2,0) {A};
    \\coordinate (B) at ([xshift=10pt]A.east);
  `, {
    units: {
      cm: 50,
      pt: 2
    }
  });
  const resolved = resolveTikzLayout(model, {
    measure: {
      text() {
        return { width: 10, height: 10 };
      }
    }
  });

  assert.deepEqual(model.units, { cm: 50, mm: 5, pt: 2, px: 1 });
  assert.equal(resolved.nodes[0].width, 50);
  assert.equal(resolved.nodes[0].innerSep, 6);
  assert.deepEqual(resolved.coordinates[0], { id: "B", x: 145, y: 0 });
});

test("uses host math measurements for TikZ display bounds", () => {
  const model = parseTikz(`\\node (A) at (0,0) {$abcdefghij$};`);
  const display = buildTikzDisplayList(model, {
    minWidth: 0,
    minHeight: 0,
    viewportPadding: 0,
    measure: {
      math(source) {
        assert.equal(source, "abcdefghij");
        return { width: 200, height: 40 };
      }
    }
  });
  const label = display.items.find((item) => item.type === "math");

  assert.equal(display.width, 200);
  assert.equal(display.height, 40);
  assert.deepEqual(label.box, { x: 0, y: 0, width: 200, height: 40 });
});

test("uses measured TikZ node boxes for anchors and paths", () => {
  const model = parseTikz(`
    \\node (T) at (0,0) {$A$};
    \\draw (T.east) -- (2,0);
  `);
  const resolved = resolveTikzLayout(model, {
    measure: {
      math(source) {
        assert.equal(source, "A");
        return { width: 40, height: 20 };
      }
    }
  });
  const node = resolved.nodes[0];
  const commands = resolved.paths[0].props.commands;

  assert.equal(node.width, 48);
  assert.equal(node.height, 28);
  assert.deepEqual(commands[0], { op: "moveTo", x: 24, y: 0 });
  assert.deepEqual(commands[1], { op: "lineTo", x: 160, y: 0 });
});

test("parses TikZ inner sep for measured node anchors", () => {
  const model = parseTikz(`
    \\node[inner sep=10pt] (T) at (0,0) {$A$};
    \\draw (T.east) -- (2,0);
  `);
  const resolved = resolveTikzLayout(model, {
    measure: {
      math() {
        return { width: 40, height: 20 };
      }
    }
  });

  assert.equal(Math.round(resolved.nodes[0].innerSep * 1000) / 1000, 13.333);
  assert.equal(Math.round(resolved.nodes[0].width * 1000) / 1000, 66.667);
  assert.equal(Math.round(resolved.paths[0].props.commands[0].x * 1000) / 1000, 33.333);
});

test("renders TikZ subset to SVG", () => {
  const calls = [];
  const document = {
    createElementNS(_ns, name) {
      return fakeElement(name);
    }
  };
  const svg = fakeElement("svg", document, calls);

  const size = renderTikz(svg, `
    \\node[rectangle, draw=black, minimum width=1cm, minimum height=.5cm] (A) at (0,0) {$A$};
  `, { document, minWidth: 0, minHeight: 0, viewportPadding: 10 });

  assert.ok(size.width > 0);
  assert.ok(calls.some((call) => call[0] === "setAttribute" && call[1] === "viewBox"));
});

function fakeElement(name, ownerDocument = null, calls = []) {
  const element = {
    name,
    ownerDocument: ownerDocument ?? { createElementNS: (_ns, childName) => fakeElement(childName, ownerDocument, calls) },
    attributes: {},
    children: [],
    style: {},
    setAttribute(key, value) {
      this.attributes[key] = String(value);
      calls.push(["setAttribute", key, String(value)]);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    append(...children) {
      this.children.push(...children);
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    removeAttribute(key) {
      delete this.attributes[key];
    },
    textContent: ""
  };
  return element;
}
