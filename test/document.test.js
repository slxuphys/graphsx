import assert from "node:assert/strict";
import { test } from "node:test";
import { graphSXDocumentSummary, parseGraphSXDocument } from "../src/index.js";

test("parses GraphSX documents by top-level tag", () => {
  const graph = parseGraphSXDocument(`<Graph><Rect id="A" /></Graph>`);
  const plot = parseGraphSXDocument(`<Plot><Curve points={[[0, 0], [1, 1]]} /></Plot>`);

  assert.equal(graph.type, "graph");
  assert.equal(plot.type, "plot");
  assert.equal(graphSXDocumentSummary(plot).text, "1 curve, 0 lines, 0 marks");
});

test("rejects unknown GraphSX document roots", () => {
  assert.throws(
    () => parseGraphSXDocument(`<Figure />`),
    /Top-level element must be <Graph> or <Plot>/
  );
});
