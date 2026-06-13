import assert from "node:assert/strict";
import { test } from "node:test";
import { edgePathData, graphSummary, parseGraph, parseGraphs } from "../src/index.js";

test("parses nodes, legs, and edges", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[100, 60]} label="$\\alpha$">
        <Port id="out" right label="xy" />
      </Rect>
      <Circle id="B" at={[300, 100]} r={40}>
        <Port id="in" left />
      </Circle>
      <Arrow from="A.out" to="B.in" />
    </Graph>
  `);

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes[0].attrs.label, "$\\alpha$");
  assert.equal(graph.nodes[0].legs.out.attrs.label, "xy");
  assert.equal(graph.nodes[1].attrs.label, undefined);
  assert.deepEqual(graph.nodes[0].legs.out.relative, { x: 100, y: 30 });
  assert.deepEqual(graph.nodes[0].legs.out.x, 200);
  assert.deepEqual(graph.nodes[1].legs.in.relative, { x: -40, y: 0 });
  assert.deepEqual(graph.edges[0], {
    from: "A.out",
    to: "B.in",
    attrs: { from: "A.out", to: "B.in" }
  });
});

test("parses multiple graph blocks", () => {
  const graphs = parseGraphs(`
    <Graph><Rect id="A" /></Graph>
    <Graph><Circle id="B" /></Graph>
  `);

  assert.equal(graphs.length, 2);
});

test("ignores JSX and HTML comments", () => {
  const graph = parseGraph(`
    {/* top-level graph note */}
    <Graph>
      <!-- shape note -->
      {standalone note}
      <Rect id="A" />
      {/* edge note */}
      <Rect id="B" at={[200, 0]} />
      <Arrow from="A.right" to="B.left" />
    </Graph>
  `);

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
});

test("rejects unclosed comments", () => {
  assert.throws(
    () => parseGraph(`<Graph>{/* missing end <Rect id="A" /></Graph>`),
    /Unclosed JSX comment/
  );
  assert.throws(
    () => parseGraph(`<Graph><!-- missing end <Rect id="A" /></Graph>`),
    /Unclosed HTML comment/
  );
  assert.throws(
    () => parseGraph(`<Graph>{missing end <Rect id="A" /></Graph>`),
    /Unclosed braced comment/
  );
});

test("supports grouped shape definitions", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="Pair" w={260} h={80}>
        <Rect id="left" at={[0, 0]} size={[80, 50]}>
          <Port id="in" left />
          <Port id="out" right />
        </Rect>
        <Circ id="right" at={[160, 0]} r={25}>
          <Port id="in" left />
        </Circ>
        <Arrow from="left.out" to="right.in" />
        <Port id="in" target="left.in" left />
        <Port id="out" target="right.in" right />
      </Shape>
      <Pair id="P1" at={[100, 100]} />
      <Pair id="P2" at={[500, 100]} />
      <Arrow from="P1.left.in" to="P2.in" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].children.length, 2);
  assert.equal(graph.nodes[0].children[0].id, "P1.left");
  assert.equal(graph.nodes[0].edges[0].from, "P1.left.out");
  assert.equal(graph.nodes[0].legs.in.target, "P1.left.in");
  assert.equal(graph.nodes[0].legs.in.x, graph.nodes[0].children[0].legs.in.x);
  assert.equal(graph.edges[0].from, "P1.left.in");
  assert.equal(graph.edges[0].to, "P2.in");
});

test("passes custom shape props into template labels", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="Tensor">
        <Rect id="box" at={[0, 0]} size={[56, 56]} label={\`$A^{[\${site}]}$\`} />
        <Port id="left" target="box.left" />
        <Port id="right" target="box.right" />
      </Shape>
      <Repeat count={2} as="i" step={[100, 0]}>
        <Tensor id="A{i}" at={[100, 100]} site={i} label="outer {i}" />
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes[0].attrs.label, "outer 0");
  assert.equal(graph.nodes[0].children[0].attrs.label, "$A^{[0]}$");
  assert.equal(graph.nodes[1].children[0].attrs.label, "$A^{[1]}$");
});

test("keeps forwarded props on grouped shape instances", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="Box">
        <Rect id="body" at={[0, 0]} size={[80, 50]} label={boxLabel} />
        <Port id="out" target="body.right" />
      </Shape>
      <Box id="B" at={[100, 100]} label="outer" boxLabel="$B$" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].attrs.label, "outer");
  assert.equal(graph.nodes[0].attrs.boxLabel, "$B$");
  assert.equal(graph.nodes[0].children[0].attrs.label, "$B$");
});

test("public target ports inherit target port visuals", () => {
  const graph = parseGraph(`
    <Graph>
      <Style id="hiddenPort" fill="transparent" stroke="transparent" strokeWidth={0} />
      <Shape id="Tile">
        <Rect id="box" at={[0, 0]} size={[55, 55]}>
          <Port id="br" at={[55, 55]} r={0} right useStyle="hiddenPort" label="inner" />
        </Rect>
        <Port id="br" target="box.br" label="public" />
      </Shape>
      <Tile id="T1" at={[40, 30]} />
    </Graph>
  `);

  const port = graph.nodes[0].legs.br;
  assert.equal(port.x, 95);
  assert.equal(port.y, 85);
  assert.equal(port.angle, 0);
  assert.equal(port.attrs.r, 0);
  assert.equal(port.attrs.label, "public");
  assert.deepEqual(port.attrs.style, {
    fill: "transparent",
    stroke: "transparent",
    strokeWidth: 0
  });
});

test("rejects generic Node syntax", () => {
  assert.throws(
    () => parseGraph(`<Graph><Node id="A" shape="rect" /></Graph>`),
    /Unknown tag <Node>/
  );
});

test("rejects unknown port addresses", () => {
  assert.throws(
    () => parseGraph(`
      <Graph>
        <Rect id="A">
          <Port id="out" right />
        </Rect>
        <Rect id="B" />
        <Arrow from="A.out" to="B.missing" />
      </Graph>
    `),
    /Unknown port address "B.missing"/
  );
});

test("supports at coordinates for custom port positions", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[120, 80]}>
        <Port id="tap" at={[60, 20]} x={1} y={2} />
      </Rect>
    </Graph>
  `);

  assert.deepEqual(graph.nodes[0].legs.tap.relative, { x: 60, y: 20 });
  assert.equal(graph.nodes[0].legs.tap.x, 160);
  assert.equal(graph.nodes[0].legs.tap.y, 120);
});

test("preserves rectangle corner radius props", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[120, 80]} rx={0} />
      <Rect id="B" at={[260, 100]} size={[120, 80]} corner={18} />
    </Graph>
  `);

  assert.equal(graph.nodes[0].attrs.rx, 0);
  assert.equal(graph.nodes[1].attrs.corner, 18);
});

test("adds default side ports for built-in shapes", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[120, 80]} />
      <Circle id="B" at={[320, 140]} r={40} />
      <Arrow from="A.right" to="B.left" />
      <Arrow from="A.top" to="B.bottom" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].legs.right.auto, true);
  assert.deepEqual(graph.nodes[0].legs.right.relative, { x: 120, y: 40 });
  assert.equal(graph.nodes[0].legs.right.angle, 0);
  assert.equal(graph.nodes[0].legs.top.angle, -90);
  assert.equal(graph.nodes[1].legs.left.auto, true);
  assert.deepEqual(graph.nodes[1].legs.left.relative, { x: -40, y: 0 });
  assert.equal(graph.nodes[1].legs.left.angle, 180);
  assert.equal(graph.nodes[1].legs.bottom.angle, 90);
  assert.equal(graph.edges[0].from, "A.right");
  assert.equal(graph.edges[1].to, "B.bottom");
});

test("supports shapeless point nodes with default center ports", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[120, 80]} />
      <Point id="J" at={[280, 140]} />
      <Anchor id="K" at={[360, 140]}>
        <Port id="in" at={[0, 0]} angle={180} />
      </Anchor>
      <Arrow from="A.right" to="J.center" />
      <Arrow from="J.center" to="K.in" />
    </Graph>
  `);

  assert.equal(graph.nodes[1].shape, "point");
  assert.equal(graph.nodes[2].shape, "point");
  assert.deepEqual(graph.nodes[1].legs.center.relative, { x: 0, y: 0 });
  assert.equal(graph.nodes[1].legs.center.x, 280);
  assert.equal(graph.nodes[1].legs.center.y, 140);
  assert.equal(graph.nodes[2].legs.in.angle, 180);
  assert.equal(graph.edges[0].to, "J.center");
  assert.equal(graph.edges[1].from, "J.center");
});

test("supports custom port angles", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[120, 80]}>
        <Port id="tap" at={[60, 20]} angle={35} />
        <Port id="exit" right angle={12} />
      </Rect>
    </Graph>
  `);

  assert.equal(graph.nodes[0].legs.tap.angle, 35);
  assert.equal(graph.nodes[0].legs.exit.angle, 12);
});

test("preserves edge route options", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" />
      <Rect id="B" at={[200, 0]} />
      <Arrow from="A.right" to="B.left" route="orthogonal" stub={40} />
    </Graph>
  `);

  assert.equal(graph.edges[0].attrs.route, "orthogonal");
  assert.equal(graph.edges[0].attrs.stub, 40);
});

test("preserves graph routing defaults", () => {
  const graph = parseGraph(`
    <Graph route="auto" grid={20} padding={16}>
      <Rect id="A" />
      <Rect id="B" at={[200, 0]} />
      <Arrow from="A.right" to="B.left" />
    </Graph>
  `);

  assert.equal(graph.attrs.route, "auto");
  assert.equal(graph.attrs.grid, 20);
  assert.equal(graph.attrs.padding, 16);
});

test("lays out dag siblings to the right by default", () => {
  const graph = parseGraph(`
    <Graph layout="dag" direction="right" x={100} y={100} rankGap={200} nodeGap={90}>
      <Rect id="A" size={[100, 60]} />
      <Rect id="B" size={[100, 60]} />
      <Rect id="C" size={[100, 60]} />
      <Arrow from="A.right" to="B.left" />
      <Arrow from="A.right" to="C.left" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].x, 100);
  assert.equal(graph.nodes[0].y, 100);
  assert.equal(graph.nodes[1].x, 300);
  assert.equal(graph.nodes[1].y, 100);
  assert.equal(graph.nodes[2].x, 300);
  assert.equal(graph.nodes[2].y, 190);
  assert.equal(graph.nodes[0].legs.right.x, 200);
  assert.equal(graph.nodes[1].legs.left.x, 300);
});

test("lays out nodes in source order for row layout", () => {
  const graph = parseGraph(`
    <Graph layout="row" x={50} y={70} gap={30}>
      <Rect id="A" size={[100, 60]} />
      <Rect id="B" at={[500, 500]} size={[80, 40]} />
      <Rect id="C" size={[60, 40]} />
      <Arrow from="A.right" to="C.left" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].x, 50);
  assert.equal(graph.nodes[0].y, 70);
  assert.equal(graph.nodes[1].x, 500);
  assert.equal(graph.nodes[1].y, 500);
  assert.equal(graph.nodes[2].x, 290);
  assert.equal(graph.nodes[2].y, 70);
});

test("summarizes rendered graph model", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" />
      <Rect id="B" at={[200, 0]} />
      <Arrow from="A.right" to="B.left" />
    </Graph>
  `);

  assert.deepEqual(graphSummary(graph), {
    nodeCount: 2,
    edgeCount: 1,
    pathCount: 0,
    text: "2 nodes, 1 edge"
  });
});

test("generates reusable orthogonal edge path data", () => {
  const path = edgePathData(
    { attrs: { route: "orthogonal", stub: 20 } },
    { x: 100, y: 100, angle: 0 },
    { x: 200, y: 160, angle: 90 }
  );

  assert.equal(path, "M 100 100 L 120 100 L 160 100 L 160 180 L 200 180 L 200 160");
});

test("rounds orthogonal edge corners", () => {
  const path = edgePathData(
    { attrs: { route: "orthogonal", stub: 20, corner: 8 } },
    { x: 100, y: 100, angle: 0 },
    { x: 200, y: 160, angle: 90 }
  );

  assert.match(path, /Q 160 100 160 108/);
  assert.match(path, /Q 160 180 168 180/);
});

test("generates obstacle avoiding auto edge path data", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[0, 40]} size={[60, 40]} />
      <Rect id="Block" at={[100, 20]} size={[80, 80]} />
      <Rect id="B" at={[240, 40]} size={[60, 40]} />
      <Arrow from="A.right" to="B.left" route="auto" grid={20} padding={0} stub={20} />
    </Graph>
  `);
  const nodes = graph.nodes;
  const edge = graph.edges[0];
  const from = nodes[0].legs.right;
  const to = nodes[2].legs.left;
  const path = edgePathData(edge, from, to, 0, 0, { nodes });

  assert.match(path, /^M 60 60 L 80 60 /);
  assert.doesNotMatch(path, /L 100 60 L 200 60/);
});

test("keeps auto edge path segments orthogonal after grid snapping", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[60, 130]} size={[90, 60]} />
      <Rect id="Block" at={[210, 85]} size={[100, 150]} />
      <Rect id="B" at={[400, 130]} size={[90, 60]} />
      <Arrow from="A.right" to="B.left" route="auto" grid={20} padding={18} stub={32} />
    </Graph>
  `);
  const edge = graph.edges[0];
  const from = graph.nodes[0].legs.right;
  const to = graph.nodes[2].legs.left;
  const path = edgePathData(edge, from, to, 0, 0, { nodes: graph.nodes });
  const points = path.match(/[ML] -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?/g).map((command) => {
    const [, x, y] = command.split(" ");
    return { x: Number(x), y: Number(y) };
  });

  for (let index = 1; index < points.length; index += 1) {
    assert.ok(
      points[index - 1].x === points[index].x || points[index - 1].y === points[index].y,
      `segment ${index} is diagonal in ${path}`
    );
  }
});

test("auto route avoids the target shape for same-side ports", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" size={[100, 60]} at={[0, 0]} />
      <Rect id="B" size={[100, 60]} at={[200, 0]} style={{ opacity: 0.5 }} />
      <Edge from="A.right" to="B.right" route="auto" grid={20} padding={20} />
    </Graph>
  `);
  const edge = graph.edges[0];
  const from = graph.nodes[0].legs.right;
  const to = graph.nodes[1].legs.right;
  const path = edgePathData(edge, from, to, 0, 0, { nodes: graph.nodes });
  const points = path.match(/[ML] -?\d+(?:\.\d+)? -?\d+(?:\.\d+)?/g).map((command) => {
    const [, x, y] = command.split(" ");
    return { x: Number(x), y: Number(y) };
  });

  assert.notEqual(path, "M 100 30 L 300 30");
  assert.match(path, /L 332 30 L 300 30$/);
  assert.ok(points.some((point) => point.y < -20 || point.y > 80), path);
});

test("explicit side ports override default side ports", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" at={[100, 100]} size={[120, 80]}>
        <Port id="right" at={[30, 20]} />
      </Rect>
    </Graph>
  `);

  assert.equal(graph.nodes[0].legs.right.auto, undefined);
  assert.deepEqual(graph.nodes[0].legs.right.relative, { x: 30, y: 20 });
});

test("parses style objects", () => {
  const graph = parseGraph(`
    <Graph>
      <Rect id="A" style={{ fill: "#eef6ff", strokeWidth: 3 }}>
        <Port id="out" right style={{ fill: "#f97316" }} />
      </Rect>
      <Rect id="B">
        <Port id="in" left />
      </Rect>
      <Arrow from="A.out" to="B.in" style={{ stroke: "#7c3aed", strokeWidth: 4 }} />
    </Graph>
  `);

  assert.deepEqual(graph.nodes[0].attrs.style, {
    fill: "#eef6ff",
    strokeWidth: 3
  });
  assert.deepEqual(graph.nodes[0].legs.out.attrs.style, {
    fill: "#f97316"
  });
  assert.deepEqual(graph.edges[0].attrs.style, {
    stroke: "#7c3aed",
    strokeWidth: 4
  });
});

test("resolves reusable style tags", () => {
  const graph = parseGraph(`
    <Graph>
      <Style id="blueBox" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />
      <Style id="softArrow" style={{ stroke: "#7c3aed", strokeWidth: 3, opacity: 0.6 }} />
      <Rect id="A" useStyle="blueBox" style={{ strokeWidth: 5 }}>
        <Port id="out" right useStyle="blueBox" style={{ fill: "#f97316" }} />
      </Rect>
      <Rect id="B">
        <Port id="in" left />
      </Rect>
      <Arrow from="A.out" to="B.in" useStyle="softArrow" />
    </Graph>
  `);

  assert.deepEqual(graph.styles.blueBox, {
    fill: "#eef6ff",
    stroke: "#1d4ed8",
    strokeWidth: 2
  });
  assert.deepEqual(graph.nodes[0].attrs.style, {
    fill: "#eef6ff",
    stroke: "#1d4ed8",
    strokeWidth: 5
  });
  assert.deepEqual(graph.nodes[0].legs.out.attrs.style, {
    fill: "#f97316",
    stroke: "#1d4ed8",
    strokeWidth: 2
  });
  assert.deepEqual(graph.edges[0].attrs.style, {
    stroke: "#7c3aed",
    strokeWidth: 3,
    opacity: 0.6
  });
});

test("parses explicit paths with points", () => {
  const graph = parseGraph(`
    <Graph>
      <Style id="wire" stroke="#111111" strokeWidth={2} />
      <Path id="bus" points={[[10, 20], [10, 80], [120, 80]]} useStyle="wire" corner={4} />
    </Graph>
  `);

  assert.equal(graph.paths.length, 1);
  assert.equal(graph.paths[0].id, "bus");
  assert.deepEqual(graph.paths[0].points, [
    { x: 10, y: 20 },
    { x: 10, y: 80 },
    { x: 120, y: 80 }
  ]);
  assert.deepEqual(graph.paths[0].attrs.style, {
    stroke: "#111111",
    strokeWidth: 2
  });
  assert.equal(graph.paths[0].attrs.corner, 4);
});

test("expands repeated paths", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={3} as="i" step={[0, 30]}>
        <Path id={\`wire-\${i}\`} points={[[0, 0], [80, 0]]} />
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.paths.length, 3);
  assert.equal(graph.paths[2].id, "wire-2");
  assert.deepEqual(graph.paths[2].points, [
    { x: 0, y: 60 },
    { x: 80, y: 60 }
  ]);
});

test("rejects unknown reusable styles", () => {
  assert.throws(
    () => parseGraph(`
      <Graph>
        <Rect id="A" useStyle="missing" />
      </Graph>
    `),
    /Unknown style "missing"/
  );
});

test("expands repeated nodes and edges", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={4} step={[80, 0]}>
        <Rect id="box{i}" at={[100, 100]} size={[60, 40]} label="$x_{i}$">
          <Port id="in" left />
          <Port id="out" right />
        </Rect>
      </Repeat>
      <Repeat count={3}>
        <Arrow from="box{i}.out" to="box{i+1}.in" />
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes.length, 4);
  assert.equal(graph.nodes[2].id, "box2");
  assert.equal(graph.nodes[2].x, 260);
  assert.equal(graph.nodes[2].attrs.label, "$x_{2}$");
  assert.equal(graph.nodes[2].legs.in.x, 260);
  assert.equal(graph.edges[2].from, "box2.out");
  assert.equal(graph.edges[2].to, "box3.in");
});

test("expands repeat variables in backtick templates", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={4} as="i" step={[80, 0]}>
        <Rect id={\`box\${i}\`} at={[100, 100]} size={[60, 40]} label={\`$x_{\${i+1}}$\`}>
          <Port id="in" left />
          <Port id="out" right />
        </Rect>
      </Repeat>
      <Repeat count={3} as="i">
        <Arrow from={\`box\${i}.out\`} to={\`box\${i+1}.in\`} />
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes[0].id, "box0");
  assert.equal(graph.nodes[0].attrs.label, "$x_{1}$");
  assert.equal(graph.nodes[3].attrs.label, "$x_{4}$");
  assert.equal(graph.edges[2].from, "box2.out");
  assert.equal(graph.edges[2].to, "box3.in");
});

test("keeps unresolved non-strict backtick templates for later shape prop substitution", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="Box">
        <Rect id="body" label={\`box-\${name}\`} />
      </Shape>
      <Box id="B" name="left" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].children[0].attrs.label, "box-left");
});

test("preserves latex label groups for multi-digit repeat indices", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={11} as="i" step={[80, 0]}>
        <Rect id="box{i}" at={[100, 100]} size={[60, 40]} label="$x_{i}$" />
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes[9].attrs.label, "$x_{9}$");
  assert.equal(graph.nodes[10].attrs.label, "$x_{10}$");
});

test("preserves latex label groups for nested repeat indices", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={2} as="row" step={[0, 90]}>
        <Repeat count={11} as="col" step={[100, 0]}>
          <Rect id="cell-{row}-{col}" at={[100, 100]} size={[70, 50]} label="$x_{row,col}$" />
        </Repeat>
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes[21].attrs.label, "$x_{1,10}$");
});

test("expands nested repeats for grids", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={2} as="row" step={[0, 90]}>
        <Repeat count={3} as="col" step={[100, 0]}>
          <Rect id="cell-{row}-{col}" at={[100, 100]} size={[70, 50]} label="$x_{row,col}$">
            <Port id="left" left />
            <Port id="right" right />
          </Rect>
        </Repeat>
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes.length, 6);
  assert.equal(graph.nodes[5].id, "cell-1-2");
  assert.equal(graph.nodes[5].x, 300);
  assert.equal(graph.nodes[5].y, 190);
  assert.equal(graph.nodes[5].attrs.label, "$x_{1,2}$");
});

test("expands repeats inside custom shapes", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="Row">
        <Repeat count={3} as="i" step={[80, 0]}>
          <Rect id="cell-{i}" at={[0, 0]} size={[60, 40]}>
            <Port id="left" left />
            <Port id="right" right />
          </Rect>
        </Repeat>
        <Repeat count={2} as="i">
          <Arrow from="cell-{i}.right" to="cell-{i+1}.left" />
        </Repeat>
        <Port id="in" target="cell-0.left" />
        <Port id="out" target="cell-2.right" />
      </Shape>
      <Row id="R1" at={[100, 100]} />
      <Row id="R2" at={[100, 220]} />
      <Arrow from="R1.out" to="R2.in" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].children.length, 3);
  assert.equal(graph.nodes[0].children[2].id, "R1.cell-2");
  assert.equal(graph.nodes[0].edges.length, 2);
  assert.equal(graph.nodes[0].edges[1].from, "R1.cell-1.right");
  assert.equal(graph.nodes[0].edges[1].to, "R1.cell-2.left");
  assert.equal(graph.nodes[0].legs.out.x, graph.nodes[0].children[2].legs.right.x);
  assert.equal(graph.edges[0].from, "R1.out");
  assert.equal(graph.edges[0].to, "R2.in");
});

test("expands paths inside custom shapes", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="WireBox" groupBox={false}>
        <Path id="wire" points={[[0, 20], [80, 20]]} />
        <Rect id="box" at={[20, 0]} size={[40, 40]} />
        <Port id="left" target="box.left" />
        <Port id="right" target="box.right" />
      </Shape>
      <WireBox id="W" at={[100, 50]} />
    </Graph>
  `);

  assert.equal(graph.nodes[0].paths.length, 1);
  assert.equal(graph.nodes[0].paths[0].id, "wire");
  assert.deepEqual(graph.nodes[0].paths[0].points, [
    { x: 100, y: 70 },
    { x: 180, y: 70 }
  ]);
});

test("offsets raw path data inside custom shapes", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="EPR" groupBox={false}>
        <Path d="M 0 0 L 0 20 L 100 20 L 100 0" />
      </Shape>

      <EPR id="P1" at={[10, 10]} />
      <EPR id="P2" at={[200, 10]} />
    </Graph>
  `);

  assert.equal(graph.nodes[0].paths[0].attrs.d, "M 0 0 L 0 20 L 100 20 L 100 0");
  assert.equal(graph.nodes[0].paths[0].x, 10);
  assert.equal(graph.nodes[0].paths[0].y, 10);
  assert.equal(graph.nodes[1].paths[0].x, 200);
  assert.equal(graph.nodes[1].paths[0].y, 10);
});

test("substitutes custom shape props in braced backtick path data", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="EPR" groupBox={false}>
        <Path d={\`M 0 0 L 0 20 L \${L} 20 L \${L} 0\`} />
      </Shape>

      <EPR id="P1" at={[10, 10]} L={100} />
      <EPR id="P2" at={[200, 10]} L={200} />
    </Graph>
  `);

  assert.equal(graph.nodes[0].paths[0].attrs.d, "M 0 0 L 0 20 L 100 20 L 100 0");
  assert.equal(graph.nodes[1].paths[0].attrs.d, "M 0 0 L 0 20 L 200 20 L 200 0");
});

test("evaluates arithmetic expressions in custom shape props", () => {
  const graph = parseGraph(`
    <Graph>
      <Shape id="EPR" groupBox={false}>
        <Path d={\`M 0 0 L 0 20 L \${L} 20 L \${L} 0\`} />
        <Circle id="C" at={[L / 2, 20]} r={5} />
      </Shape>

      <EPR id="P1" at={[10, 10]} L={100} />
      <EPR id="P2" at={[200, 10]} L={200} />
      <Edge from="P1.C.top" to="P2.C.top" route="auto" />
    </Graph>
  `);

  assert.equal(graph.nodes[0].children[0].x, 60);
  assert.equal(graph.nodes[0].children[0].y, 30);
  assert.equal(graph.nodes[1].children[0].x, 300);
  assert.equal(graph.nodes[1].children[0].y, 30);
  assert.equal(graph.edges[0].from, "P1.C.top");
});

test("evaluates arithmetic expressions in repeat scopes", () => {
  const graph = parseGraph(`
    <Graph>
      <Repeat count={3} as="i">
        <Point id={\`P\${i}\`} at={[i * 40 + 10, (i + 1) * 5]} />
      </Repeat>
    </Graph>
  `);

  assert.equal(graph.nodes[2].x, 90);
  assert.equal(graph.nodes[2].y, 15);
});

test("rejects non-arithmetic expressions", () => {
  assert.throws(
    () => parseGraph(`
      <Graph>
        <Shape id="Bad">
          <Circle id="C" at={[Math.random(), 20]} r={5} />
        </Shape>
        <Bad id="B" />
      </Graph>
    `),
    /Unknown template variable "Math"|Unsupported expression/
  );
});
