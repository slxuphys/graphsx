import assert from "node:assert/strict";
import { test } from "node:test";
import { parsePlot, parsePlots, plotSummary, renderPlot } from "../src/index.js";

test("parses independent plot blocks", () => {
  const plot = parsePlot(`
    <Plot width={400} height={260} xDomain={[0, 3]} yDomain={[0, 9]}>
      <Axis x label="x" />
      <Axis y label="y" />
      <Curve id="sq" points={[[0, 0], [1, 1], [2, 4], [3, 9]]} />
      <Line from={[0, 0]} to={[3, 9]} />
      <Mark id="p" at={[2, 4]} r={5} />
      <Text at={[2, 4]} label="peak" />
    </Plot>
  `);

  assert.equal(plot.type, "plot");
  assert.equal(plot.attrs.width, 400);
  assert.equal(plot.axes.length, 2);
  assert.equal(plot.curves[0].points[2].y, 4);
  assert.deepEqual(plot.lines[0].to, { x: 3, y: 9 });
  assert.deepEqual(plot.marks[0].at, { x: 2, y: 4 });
  assert.equal(plot.labels[0].text, "peak");
  assert.equal(plotSummary(plot).text, "1 curve, 1 line, 1 mark");
});

test("parses multiple plot blocks", () => {
  const plots = parsePlots(`
    <Plot><Curve points={[[0, 0], [1, 1]]} /></Plot>
    <Plot><Mark at={[0, 0]} /></Plot>
  `);

  assert.equal(plots.length, 2);
});

test("keeps graph and plot top levels separate", () => {
  assert.throws(
    () => parsePlot(`<Graph><Rect id="A" /></Graph>`),
    /Top-level elements must be <Plot>/
  );

  assert.throws(
    () => parsePlot(`<Plot><Rect id="A" /></Plot>`),
    /Unknown tag <Rect> in <Plot>/
  );
});

test("resolves reusable plot styles", () => {
  const plot = parsePlot(`
    <Plot>
      <Style id="curve" stroke="red" strokeWidth={3} />
      <Curve points={[[0, 0], [1, 1]]} useStyle="curve" style={{opacity: 0.5}} />
    </Plot>
  `);

  assert.deepEqual(plot.curves[0].attrs.style, {
    stroke: "red",
    strokeWidth: 3,
    opacity: 0.5
  });
});

test("supports line series, scatter series, fmt, and direct style props", () => {
  const plot = parsePlot(`
    <Plot>
      <Style id="seriesA" stroke="#2d6cdf" strokeWidth={2} />
      <Line points={[[0, 0], [1, 1], [2, 1]]} fmt="o--" useStyle="seriesA" strokeWidth={4} style={{ opacity: 0.7 }} />
      <Scatter points={[[0, 1], [1, 2]]} r={3} fill="#ef4444" />
    </Plot>
  `);

  assert.equal(plot.lines.length, 1);
  assert.deepEqual(plot.lines[0].points[2], { x: 2, y: 1 });
  assert.deepEqual(plot.lines[0].attrs.style, {
    stroke: "#2d6cdf",
    strokeWidth: 4,
    opacity: 0.7
  });
  assert.equal(plot.marks.length, 1);
  assert.deepEqual(plot.marks[0].points[1], { x: 1, y: 2 });
  assert.deepEqual(plot.marks[0].attrs.style, { fill: "#ef4444" });
});

test("renders fmt line and marker shorthand", () => {
  const plot = parsePlot(`
    <Plot>
      <Line points={[[0, 0], [1, 1]]} fmt="o--" />
      <Line points={[[0, 1], [1, 2]]} fmt="." />
      <Scatter points={[[0, 2], [1, 3]]} />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, { document: documentRef });

  assert.ok(calls.some((node) => node.tag === "path" && node.attrs.class === "plot-line" && node.attrs["stroke-dasharray"] === "6 4"));
  assert.equal(calls.filter((node) => node.tag === "circle" && node.attrs.class === "plot-line-marker").length, 4);
  assert.equal(calls.filter((node) => node.tag === "circle" && node.attrs.class === "plot-scatter-marker").length, 2);
});

test("line marker fill does not fill the connected path", () => {
  const plot = parsePlot(`
    <Plot>
      <Line points={[[0, 0], [1, 1], [2, 2]]} fmt="o-" stroke="blue" fill="red" />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, { document: documentRef });

  const path = calls.find((node) => node.tag === "path" && node.attrs.class === "plot-line");
  const marker = calls.find((node) => node.tag === "circle" && node.attrs.class === "plot-line-marker");
  assert.equal(path.attrs.fill, "none");
  assert.equal(path.attrs.stroke, "blue");
  assert.equal(marker.attrs.fill, "red");
});

test("renders visible plot defaults", () => {
  const plot = parsePlot(`
    <Plot>
      <Axis x />
      <Curve points={[[0, 0], [1, 1]]} />
      <Line from={[0, 0]} to={[1, 1]} />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = {
        tag,
        attrs: {},
        children: [],
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
        }
      };
      calls.push(node);
      return node;
    }
  };
  const svg = {
    ownerDocument: documentRef,
    attrs: {},
    children: [],
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    }
  };

  renderPlot(svg, plot, { document: documentRef });

  assert.ok(calls.some((node) => node.tag === "path" && node.attrs.class === "plot-curve" && node.attrs.stroke));
  assert.ok(calls.some((node) => node.tag === "line" && node.attrs.class === "plot-line" && node.attrs.stroke));
  assert.ok(calls.some((node) => node.tag === "line" && node.attrs.class?.includes("plot-axis") && node.attrs.stroke));
});

test("centers axis labels and supports a plot box", () => {
  const plot = parsePlot(`
    <Plot width={400} height={260} padding={50} box>
      <Axis x label="x" />
      <Axis y label="y" />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, { document: documentRef });

  const labels = calls.filter((node) => node.tag === "text" && node.attrs.class === "plot-axis-label");
  const box = calls.find((node) => node.tag === "rect" && node.attrs.class === "plot-box");

  assert.equal(box.attrs.x, "50");
  assert.equal(box.attrs.y, "50");
  assert.equal(box.attrs.width, "300");
  assert.equal(box.attrs.height, "160");
  assert.ok(labels.some((node) => node.text === "x" && node.attrs.x === "200" && node.attrs.y === "250"));
  assert.ok(labels.some((node) => (
    node.text === "y"
    && node.attrs.x === "10"
    && node.attrs.y === "130"
    && node.attrs.transform === "rotate(-90 10 130)"
  )));
});

test("renders nice automatic ticks and explicit tick values", () => {
  const plot = parsePlot(`
    <Plot width={400} height={260} padding={50} xDomain={[0, 3]} yDomain={[0, 9]}>
      <Axis x ticks />
      <Axis y ticks={[0, 3, 6, 9]} />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, { document: documentRef });

  const xTicks = calls.filter((node) => node.tag === "line" && node.attrs.class === "plot-tick plot-tick-x");
  const yTicks = calls.filter((node) => node.tag === "line" && node.attrs.class === "plot-tick plot-tick-y");
  const tickLabels = calls.filter((node) => node.tag === "text" && node.attrs.class === "plot-tick-label").map((node) => node.text);

  assert.deepEqual(xTicks.map((node) => node.attrs.x1), ["50", "100", "150", "200", "250", "300", "350"]);
  assert.equal(yTicks.length, 4);
  assert.ok(tickLabels.includes("0"));
  assert.ok(tickLabels.includes("0.5"));
  assert.ok(tickLabels.includes("3"));
  assert.ok(tickLabels.includes("9"));
  assert.ok(calls.some((node) => (
    node.tag === "text"
    && node.attrs.class === "plot-tick-label"
    && node.text === "0.5"
    && node.attrs["dominant-baseline"] === "hanging"
  )));
  assert.ok(calls.some((node) => (
    node.tag === "text"
    && node.attrs.class === "plot-tick-label"
    && node.text === "9"
    && node.attrs.x === "36"
    && node.attrs["dominant-baseline"] === "middle"
  )));
});

test("supports Ticks children with labels and math default tick labels", () => {
  const plot = parsePlot(`
    <Plot width={400} height={260} padding={50} xDomain={[0, 2]} yDomain={[0, 2]}>
      <Axis x>
        <Ticks values={[0, 1, 2]} labels={["$0$", "$\\\\pi$", "$2\\\\pi$"]} labelStyle={{ fill: "#334155" }} />
      </Axis>
      <Axis y>
        <Ticks values={[0, 1]} labels={["zero"]} />
      </Axis>
    </Plot>
  `);
  const calls = [];
  const rendered = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    },
    createElement(tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, {
    document: documentRef,
    katex: {
      render(source, host) {
        rendered.push(source);
        host.textContent = source;
      }
    }
  });

  const plainTickLabels = calls.filter((node) => node.tag === "text" && node.attrs.class === "plot-tick-label");
  const mathTickLabels = calls.filter((node) => node.tag === "foreignObject" && node.attrs.class === "plot-tick-label");

  assert.equal(plot.axes[0].ticks.length, 1);
  assert.deepEqual(rendered, ["0", "\\pi", "2\\pi", "1"]);
  assert.equal(plainTickLabels.length, 1);
  assert.equal(plainTickLabels[0].text, "zero");
  assert.equal(mathTickLabels.length, 4);
  assert.equal(mathTickLabels.filter((node) => node.attrs.y === "216").length, 3);
  assert.ok(rendered.includes("1"));
});

test("renders grid lines from axis ticks", () => {
  const plot = parsePlot(`
    <Plot width={400} height={260} padding={50} xDomain={[0, 2]} yDomain={[0, 4]}>
      <Axis x ticks={[0, 1, 2]} grid />
      <Axis y ticks={[0, 2, 4]} grid gridStyle={{ stroke: "#eeeeee", strokeDasharray: "2 2" }} />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, { document: documentRef });

  const xGrid = calls.filter((node) => node.tag === "line" && node.attrs.class === "plot-grid plot-grid-x");
  const yGrid = calls.filter((node) => node.tag === "line" && node.attrs.class === "plot-grid plot-grid-y");

  assert.equal(xGrid.length, 3);
  assert.deepEqual(xGrid.map((node) => [node.attrs.x1, node.attrs.y1, node.attrs.x2, node.attrs.y2]), [
    ["50", "50", "50", "210"],
    ["200", "50", "200", "210"],
    ["350", "50", "350", "210"]
  ]);
  assert.equal(yGrid.length, 3);
  assert.equal(yGrid[0].attrs.stroke, "#eeeeee");
  assert.equal(yGrid[0].attrs["stroke-dasharray"], "2 2");
});

test("renders plot legends from labeled series", () => {
  const plot = parsePlot(`
    <Plot width={400} height={260} padding={50} xDomain={[0, 2]} yDomain={[0, 2]}>
      <Line points={[[0, 0], [1, 1]]} fmt="o--" label="fit" stroke="#2563eb" fill="#facc15" />
      <Scatter points={[[0, 1], [1, 2]]} label="$data$" fill="#ef4444" />
      <Line from={[0, 2]} to={[2, 0]} />
      <legend position="top-left" textStyle={{fill: "#111111"}} boxStyle={{fill: "#f8fafc", stroke: "#64748b"}} />
    </Plot>
  `);
  const calls = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    },
    createElement(tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, {
    document: documentRef,
    katex: {
      render(source, host) {
        host.textContent = source;
      }
    }
  });

  const legend = calls.find((node) => node.tag === "g" && node.attrs.class === "plot-legend");
  const legendBox = calls.find((node) => node.tag === "rect" && node.attrs.class === "plot-legend-box");
  const legendLines = calls.filter((node) => node.tag === "line" && node.attrs.class === "plot-legend-line");
  const legendMarkers = calls.filter((node) => node.tag === "circle" && node.attrs.class === "plot-legend-marker");
  const legendLabels = calls.filter((node) => node.attrs.class === "plot-legend-label");

  assert.equal(plot.legends.length, 1);
  assert.equal(legend.attrs.transform, "translate(62 62)");
  assert.equal(legendBox.attrs.fill, "#f8fafc");
  assert.equal(legendBox.attrs.stroke, "#64748b");
  assert.equal(legendLines.length, 1);
  assert.equal(legendLines[0].attrs.stroke, "#2563eb");
  assert.equal(legendLines[0].attrs["stroke-dasharray"], "6 4");
  assert.equal(legendMarkers.length, 2);
  assert.equal(legendMarkers[0].attrs.fill, "#facc15");
  assert.equal(legendMarkers[1].attrs.fill, "#ef4444");
  assert.equal(legendLabels.length, 2);
  assert.ok(legendLabels.some((node) => (
    node.tag === "text"
    && node.text === "fit"
    && node.attrs.fill === "#111111"
    && node.attrs["dominant-baseline"] === "middle"
  )));
  assert.ok(legendLabels.some((node) => node.tag === "foreignObject"));
});

test("renders plot math labels with katex", () => {
  const plot = parsePlot(`
    <Plot>
      <Axis x label="$x_i$" />
      <Text at={[0, 0]} label="$\\alpha$" />
    </Plot>
  `);
  const calls = [];
  const rendered = [];
  const documentRef = {
    createElementNS(_namespace, tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    },
    createElement(tag) {
      const node = createMockNode(tag);
      calls.push(node);
      return node;
    }
  };
  const svg = createMockNode("svg");
  svg.ownerDocument = documentRef;

  renderPlot(svg, plot, {
    document: documentRef,
    katex: {
      render(source, host) {
        rendered.push(source);
        host.textContent = source;
      }
    }
  });

  assert.deepEqual(rendered, ["x_i", "\\alpha"]);
  assert.equal(calls.filter((node) => node.tag === "foreignObject").length, 2);
});

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
    }
  };
}
