import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildTikzDisplayList,
  parseTikz,
  renderTikz,
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

test("applies cmToPx to TikZ coordinates, shifts, and style lengths", () => {
  const model = parseTikz(`
    \\begin{tikzpicture}[
      process/.style={rectangle, draw=black, fill=white, thick, rounded corners=.08cm, minimum width=1.2cm, minimum height=.6cm}
    ]
      \\node[process] (A) at (1,1) {A};
      \\coordinate (B) at ([xshift=.5cm,yshift=.25cm]A.east);
    \\end{tikzpicture}
  `, { cmToPx: 40 });

  assert.equal(model.cmToPx, 40);
  assert.equal(model.nodes[0].x, 40);
  assert.equal(model.nodes[0].y, -40);
  assert.equal(model.nodes[0].width, 48);
  assert.equal(model.nodes[0].height, 24);
  assert.equal(model.nodes[0].corner, 3.2);
  assert.deepEqual(model.coordinates[0], { id: "B", x: 84, y: -50 });
});

test("keeps unit as a backwards-compatible TikZ cm scale alias", () => {
  const model = parseTikz(`\\node[rectangle, draw=black, minimum width=1cm] (A) at (2,0) {A};`, { unit: 50 });

  assert.equal(model.cmToPx, 50);
  assert.equal(model.nodes[0].x, 100);
  assert.equal(model.nodes[0].width, 50);
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
