import katex from "katex";
import "katex/dist/katex.min.css";
import "./markdown.css";
import "./codemirror.css";
import MarkdownIt from "markdown-it";
import { basicSetup, EditorView } from "codemirror";
import { javascript, jsxLanguage } from "@codemirror/lang-javascript";
import { markdown } from "@codemirror/lang-markdown";
import { Compartment } from "@codemirror/state";
import {
  findGraphSXFences,
  graphsxCodeMirrorLivePreview
} from "./codemirror.js";
import {
  GRAPHSX_FENCE,
  graphSXDocumentSummary,
  graphsxMarkdownIt,
  parseGraphSXDocument,
  renderGraphSXDocument,
  renderGraphSXBlocks
} from "./index.js";

const graphExamples = [
  {
    name: "Basic",
    source: `<Graph>
  <Style id="blueBox" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />
  <Style id="violetEdge" stroke="#7c3aed" strokeWidth={3} />

  <Rect id="A" at={[100, 100]} size={[100, 60]} label="$\\alpha$" useStyle="blueBox">
    <Port id="out" right label="xy" style={{ fill: "#f97316" }} />
  </Rect>

  <Circle id="B" at={[300, 100]} r={40} label="B">
    <Port id="in" left />
  </Circle>

  <Link headArrow from="A.out" to="B.in" useStyle="violetEdge" />
</Graph>`
  },
  {
    name: "MPS",
    source: `<Graph route="straight">
  <Style id="tensor" fill="#6aa4d8" stroke="#111111" strokeWidth={3} />
  <Style id="wire" stroke="#111111" strokeWidth={2.5} />
  <Style id="hidden" fill="transparent" stroke="transparent" strokeWidth={0} />

  <Shape id="Tensor" groupBox={false}>
    <Rect id="box" at={[0, 0]} size={[56, 56]} corner={8} useStyle="tensor" label={\`$A^{[\${site}]}$\`}>
      <Port id="left" left r={0} useStyle="hidden" />
      <Port id="right" right r={0} useStyle="hidden" />
      <Port id="phys" bottom r={0} useStyle="hidden" />
    </Rect>

    <Port id="left" target="box.left" />
    <Port id="right" target="box.right" />
    <Port id="phys" target="box.phys" />
  </Shape>

  <Repeat count={6} as="i" step={[110, 0]}>
    <Tensor id={\`A\${i}\`} at={[100, 100]} site={i} />
    <Point id={\`p\${i}\`} at={[128, 210]} />
    <Link from={\`A\${i}.phys\`} to={\`p\${i}.center\`} useStyle="wire" />
  </Repeat>

  <Repeat count={5} as="i">
    <Link from={\`A\${i}.right\`} to={\`A\${i+1}.left\`} useStyle="wire" />
  </Repeat>
</Graph>`
  },
  {
    name: "Auto Routing",
    source: `<Graph route="auto" grid={20} padding={18} corner={8}>
  <Style id="block" fill="#f1f3f5" stroke="#9aa3af" strokeWidth={2} />
  <Style id="edge" stroke="#2d6cdf" strokeWidth={3} />

  <Rect id="A" at={[60, 150]} size={[100, 60]} label="A" />
  <Rect id="Block" at={[230, 95]} size={[110, 170]} label="block" useStyle="block" />
  <Rect id="B" at={[470, 150]} size={[100, 60]} label="B" />

  <Link from="A.right" to="B.left" useStyle="edge" />
</Graph>`
  },
  {
    name: "Layout",
    source: `<Graph layout="dag" direction="right" rankGap={210} nodeGap={95} route="orthogonal" corner={8}>
  <Rect id="A" size={[100, 60]} label="A" />
  <Rect id="B" size={[100, 60]} label="B" />
  <Rect id="C" size={[100, 60]} label="C" />
  <Rect id="D" size={[100, 60]} label="D" />

  <Link headArrow from="A.right" to="B.left" />
  <Link headArrow from="A.right" to="C.left" />
  <Link headArrow from="B.right" to="D.left" />
  <Link headArrow from="C.right" to="D.left" />
</Graph>`
  },
  {
    name: "Grouped Shape",
    source: `<Graph route="orthogonal" corner={6}>
  <Style id="leftBox" fill="#fff7ed" stroke="#c2410c" strokeWidth={2} />
  <Style id="rightBox" fill="#ecfdf5" stroke="#047857" strokeWidth={2} />

  <Shape id="Pair" groupBox={true}>
    <Rect id="left" at={[0, 0]} size={[80, 50]} label={\`$L_{\${k}}$\`} useStyle="leftBox" />
    <Circle id="right" at={[170, 25]} r={28} label={\`$R_{\${k}}$\`} useStyle="rightBox" />
    <Link headArrow from="left.right" to="right.left" />
    <Port id="in" target="left.left" />
    <Port id="out" target="right.right" />
  </Shape>

  <Pair id="P0" at={[90, 120]} k={0} label="visible group box" />
  <Pair id="P1" at={[430, 120]} k={1} groupBox={false} />

  <Link headArrow from="P0.out" to="P1.in" />
</Graph>`
  },
  {
    name: "Plot Annotation",
    source: `<Plot width={620} height={380} padding={[58, 64, 64, 70]} xDomain={[0, 5]} yDomain={[0, 10]} box>
  <Data id="fit" points={[[0, 1], [1, 2], [2, 4], [3, 7], [4, 8], [5, 9]]} />

  <Axis x label="$x$" ticks grid />
  <Axis y label="$f(x)$" ticks grid />

  <Line data="fit" stroke="#2563eb" strokeWidth={2} />

  <Circle id="peak" at={[3, 7]} r={5} fill="#ef4444" />
  <Rect
    id="note"
    at={[3.35, 8.2]}
    size={[92, 30]}
    label="peak"
    corner={5}
    fill="#ffffff"
    stroke="#111111"
  >
    <Port id="tip" left />
  </Rect>

  <Link from="note.tip" to="peak.top" headArrow arrowSize={8} stroke="#111111" />
  <Path points={[[0.5, 8.8], [1.2, 8.8], [1.2, 7.6]]} corner={6} headArrow stroke="#16a34a" strokeWidth={2} />
  <Rect id="screenNote" at={[430, 86]} atUnit="screen" size={[106, 28]} label="screen pos" fill="#f8fafc" stroke="#64748b" />
</Plot>`
  },
  {
    name: "Function Plot",
    source: `<Plot width={620} height={380} padding={[54, 64, 70, 74]} xDomain={[0, 2*pi]} yDomain={[-1.2, 1.2]} frame box>
  <Data id="sin" y="sin(x)" domain={[0, 2*pi]} samples={180} />
  <Data id="cos" y="cos(x)" domain={[0, 2*pi]} samples={180} />

  <Axis x label="$x$">
    <Ticks values={[0, pi/2, pi, 3*pi/2, 2*pi]} labels={["$0$", "$\\pi/2$", "$\\pi$", "$3\\pi/2$", "$2\\pi$"]} grid />
  </Axis>
  <Axis y label="$f(x)$" ticks grid />

  <Line data="sin" stroke="#2563eb" strokeWidth={2} label="$\\sin(x)$" />
  <Line data="cos" stroke="#dc2626" strokeWidth={2} strokeDasharray="7 5" label="$\\cos(x)$" />
  <Text at={[1.2, 0.82]} label="$\\alpha$" fontSize={22} />
  <Legend position="top-right" />
</Plot>`
  },
  {
    name: "Animated Wave",
    source: `<Plot width={620} height={360} padding={[54, 64, 70, 74]} xDomain={[0, 2*pi]} yDomain={[-1.2, 1.2]} frame box>
  <Data
    id="wave"
    y="sin(x - phase)"
    params={{ phase: 0 }}
    domain={[0, 2*pi]}
    samples={180}
  />

  <Axis x label="$x$">
    <Ticks values={[0, pi/2, pi, 3*pi/2, 2*pi]} labels={["$0$", "$\\pi/2$", "$\\pi$", "$3\\pi/2$", "$2\\pi$"]} grid />
  </Axis>
  <Axis y label="$\\sin(x-\\phi)$" ticks grid />

  <Line
    data="wave"
    stroke="#2563eb"
    strokeWidth={2.5}
    label="wave"
    animate={{ phase: [0, 2*pi] }}
    duration={2600}
  />
  <Text at={[pi, 0.82]} label="$\\phi: 0 \\to 2\\pi$" fontSize={18} />
  <Legend position="top-right" />
</Plot>`
  },
  {
    name: "Heart Curve",
    source: `<Plot width={500} height={460} padding={[38, 44, 54, 58]} xDomain={[-18, 18]} yDomain={[-18, 14]} frame box>
  <Data
    id="heart"
    x="16 * pow(sin(t), 3)"
    y="13*cos(t) - 5*cos(2*t) - 2*cos(3*t) - cos(4*t)"
    domain={[0, 2*pi]}
    samples={420}
  />

  <Axis x label="$x$" ticks grid />
  <Axis y label="$y$" ticks grid />

  <Line data="heart" stroke="#e11d48" strokeWidth={2.8} label="heart" />
  <Text at={[0, 10.8]} label="$x(t), y(t)$" fontSize={22} />
  <Legend position="bottom-right" />
</Plot>`
  },
  {
    name: "Plot + Diagram",
    source: `<Graph route="orthogonal" corner={8}>
  <Plot id="loss" at={[0, 0]} width={380} height={250} xDomain={[0, 10]} yDomain={[0, 3]} frame box>
    <Port id="out" right />
    <Axis x label="epoch" ticks grid />
    <Axis y label="loss" ticks grid />
    <Data id="curve" y="2.6*exp(-0.28*x)+0.25" domain={[0, 10]} samples={120} />
    <Line data="curve" stroke="#2563eb" strokeWidth={2.5} label="train" />
    <Legend />
  </Plot>

  <Rect id="note" at={loss.out + [70, -38]} size={[150, 76]} corner={8} label="converged" style={{ fill: "#fff7ed", stroke: "#c2410c", strokeWidth: 2 }}>
    <Port id="in" left />
  </Rect>

  <Link from="loss.out" to="note.in" headArrow />
  <Point id="caption" at={[190, 300]} label="training summary" r={0} />
</Graph>`
  },
  {
    name: "Graph Subplots",
    source: `<Graph>
  <Plot id="left" at={[0, 0]} width={320} height={220} xDomain={[0, 4]} yDomain={[0, 8]} frame box>
    <Port id="out" right />
    <Axis x label="$x$" ticks grid />
    <Axis y label="$f(x)$" ticks grid />
    <Line points={[[0, 1], [1, 2], [2, 4], [3, 7], [4, 8]]} stroke="#2563eb" strokeWidth={2} label="fit" />
    <Legend />
  </Plot>

  <Plot id="right" at={left.right + [90, 0]} width={320} height={220} xDomain={[0, 4]} yDomain={[-1, 1]} frame box>
    <Port id="in" left />
    <Axis x label="$x$" ticks grid />
    <Axis y label="$g(x)$" ticks grid />
    <Data id="wave" y="sin(2*x)" domain={[0, 4]} samples={120} />
    <Line data="wave" stroke="#dc2626" strokeWidth={2} label="$\\sin(2x)$" />
    <Legend />
  </Plot>

  <Point id="a" at={[160, 265]} label="(a)" r={0} />
  <Point id="b" at={right.bottom + [0, 45]} label="(b)" r={0} />
  <Link from="left.out" to="right.in" route="orthogonal" headArrow />
</Graph>`
  }
];

const markdownExamples = [
  {
    name: "Article",
    source: `# Tensor Chain

This Markdown preview renders \`graphsx\` fences inline, so the code block can live beside normal notes.

\`\`\`graphsx
<Graph route="straight">
  <Style id="tensor" fill="#6aa4d8" stroke="#111111" strokeWidth={3} />
  <Style id="wire" stroke="#111111" strokeWidth={2.5} />
  <Style id="hidden" fill="transparent" stroke="transparent" strokeWidth={0} />

  <Shape id="Tensor" groupBox={false}>
    <Rect id="box" at={[0, 0]} size={[54, 54]} corner={8} useStyle="tensor" label={\`$A^{[\${site}]}$\`}>
      <Port id="left" left r={0} useStyle="hidden" />
      <Port id="right" right r={0} useStyle="hidden" />
      <Port id="phys" bottom r={0} useStyle="hidden" />
    </Rect>
    <Port id="left" target="box.left" />
    <Port id="right" target="box.right" />
    <Port id="phys" target="box.phys" />
  </Shape>

  <Repeat count={5} as="i" step={[105, 0]}>
    <Tensor id={\`A\${i}\`} at={[90, 90]} site={i} />
    <Point id={\`p\${i}\`} at={[117, 190]} />
    <Link from={\`A\${i}.phys\`} to={\`p\${i}.center\`} useStyle="wire" />
  </Repeat>

  <Repeat count={4} as="i">
    <Link from={\`A\${i}.right\`} to={\`A\${i+1}.left\`} useStyle="wire" />
  </Repeat>
</Graph>
\`\`\`

The rest is ordinary Markdown, which means this can eventually plug into a note preview or documentation site.`
  },
  {
    name: "Two Graphs",
    source: `# Two GraphSX Blocks

\`\`\`graphsx
<Graph layout="dag" direction="right" route="orthogonal" corner={8}>
  <Rect id="A" size={[90, 52]} label="A" />
  <Rect id="B" size={[90, 52]} label="B" />
  <Rect id="C" size={[90, 52]} label="C" />
  <Link headArrow from="A.right" to="B.left" />
  <Link headArrow from="A.right" to="C.left" />
</Graph>
\`\`\`

Normal fenced code still stays as code:

\`\`\`js
console.log("not GraphSX");
\`\`\`

\`\`\`graphsx
<Graph route="auto" grid={20} padding={18}>
  <Rect id="A" at={[60, 120]} size={[100, 56]} label="A" />
  <Rect id="Block" at={[230, 80]} size={[100, 150]} label="block" style={{ fill: "#f1f3f5", stroke: "#9aa3af" }} />
  <Rect id="B" at={[450, 120]} size={[100, 56]} label="B" />
  <Link from="A.right" to="B.left" />
</Graph>
\`\`\``
  },
  {
    name: "Library Reuse",
    source: `# Matrix Product States and Operators

Tensor network diagrams are a compact way to draw structured many-body objects. In a matrix product state (MPS), each site tensor has two virtual bonds connecting neighboring sites and one physical leg pointing to the local Hilbert space.

The first hidden fence defines reusable visual styles. The second hidden fence defines two reusable tensor shapes. Both diagrams below import those libraries with \`use="theme tensors"\`.

\`\`\`graphsx-defs theme
<Style id="tensor" fill="#6aa4d8" stroke="#111111" strokeWidth={3} />
<Style id="operator" fill="#f7c66f" stroke="#111111" strokeWidth={3} />
<Style id="wire" stroke="#111111" strokeWidth={2.5} />
<Style id="hiddenPort" fill="transparent" stroke="transparent" strokeWidth={0} />
\`\`\`

\`\`\`graphsx-defs tensors
<Shape id="MpsTensor" groupBox={false}>
  <Rect id="box" at={[0, 0]} size={[56, 56]} corner={8} useStyle="tensor" label={\`$A^{[\${site}]}$\`}>
    <Port id="left" left r={0} useStyle="hiddenPort" />
    <Port id="right" right r={0} useStyle="hiddenPort" />
    <Port id="phys" bottom r={0} useStyle="hiddenPort" />
  </Rect>
  <Port id="left" target="box.left" />
  <Port id="right" target="box.right" />
  <Port id="phys" target="box.phys" />
</Shape>

<Shape id="MpoTensor" groupBox={false}>
  <Rect id="box" at={[0, 0]} size={[62, 62]} corner={8} useStyle="operator" label={\`$W^{[\${site}]}$\`}>
    <Port id="left" left r={0} useStyle="hiddenPort" />
    <Port id="right" right r={0} useStyle="hiddenPort" />
    <Port id="in" top r={0} useStyle="hiddenPort" />
    <Port id="out" bottom r={0} useStyle="hiddenPort" />
  </Rect>
  <Port id="left" target="box.left" />
  <Port id="right" target="box.right" />
  <Port id="in" target="box.in" />
  <Port id="out" target="box.out" />
</Shape>
\`\`\`

## Matrix product state

An MPS represents a vector by chaining local tensors. The horizontal wires are contracted virtual indices; the dangling vertical wires are physical indices.

\`\`\`graphsx use="theme tensors"
<Graph route="straight">
  <Repeat count={5} as="i" step={[104, 0]}>
    <MpsTensor id={\`A\${i}\`} at={[80, 70]} site={i} />
    <Point id={\`p\${i}\`} at={[108, 166]} />
    <Link from={\`A\${i}.phys\`} to={\`p\${i}.center\`} useStyle="wire" />
  </Repeat>

  <Repeat count={4} as="i">
    <Link from={\`A\${i}.right\`} to={\`A\${i+1}.left\`} useStyle="wire" />
  </Repeat>
</Graph>
\`\`\`

## Matrix product operator

An MPO represents an operator. Each site tensor carries two physical legs: an input index above and an output index below, while the horizontal virtual bonds connect neighboring operator tensors.

\`\`\`graphsx use="theme tensors"
<Graph route="straight">
  <Repeat count={5} as="i" step={[112, 0]}>
    <MpoTensor id={\`W\${i}\`} at={[80, 96]} site={i} />
    <Point id={\`in\${i}\`} at={[111, 38]} />
    <Point id={\`out\${i}\`} at={[111, 205]} />
    <Link from={\`in\${i}.center\`} to={\`W\${i}.in\`} useStyle="wire" />
    <Link from={\`W\${i}.out\`} to={\`out\${i}.center\`} useStyle="wire" />
  </Repeat>

  <Repeat count={4} as="i">
    <Link from={\`W\${i}.right\`} to={\`W\${i+1}.left\`} useStyle="wire" />
  </Repeat>
</Graph>
\`\`\`

The diagrams share the same style and shape libraries, but each rendered graph remains explicit about that dependency.`
  },
  {
    name: "Brickwork Circuit",
    source: `# Brickwork Quantum Circuit

A brickwork circuit alternates layers of local two-qubit gates. One layer acts on pairs \`(0,1)\` and \`(2,3)\`; the next layer shifts over and acts on \`(1,2)\`. Repeating that staggered pattern creates a shallow circuit with local entangling structure.

The reusable library below defines the wire style, invisible ports, and a two-qubit gate shape with four public connection ports.

\`\`\`graphsx-defs circuit-theme
<Style id="wire" stroke="#111111" strokeWidth={2.5} />
<Style id="gate" fill="#c7dcff" stroke="#111111" strokeWidth={3} />
<Style id="hiddenPort" fill="transparent" stroke="transparent" strokeWidth={0} />
\`\`\`

\`\`\`graphsx-defs circuit-shapes
<Shape id="TwoQGate" groupBox={false}>
  <Rect id="box" at={[0, 0]} size={[64, 106]} corner={8} useStyle="gate" label={gateLabel}>
    <Port id="q0l" at={[0, 18]} angle={180} r={0} useStyle="hiddenPort" />
    <Port id="q0r" at={[64, 18]} angle={0} r={0} useStyle="hiddenPort" />
    <Port id="q1l" at={[0, 88]} angle={180} r={0} useStyle="hiddenPort" />
    <Port id="q1r" at={[64, 88]} angle={0} r={0} useStyle="hiddenPort" />
  </Rect>
  <Port id="q0l" target="box.q0l" />
  <Port id="q0r" target="box.q0r" />
  <Port id="q1l" target="box.q1l" />
  <Port id="q1r" target="box.q1r" />
</Shape>
\`\`\`

## Four-qubit brickwork layer pattern

Each horizontal line is a qubit worldline. The rectangular blocks are two-qubit gates; their ports are hidden, so only the gates and wires remain visible.

\`\`\`graphsx use="circuit-theme circuit-shapes"
<Graph route="straight">
  <Repeat count={2} as="pair" step={[0, 140]}>
    <Point id={\`pair\${pair}topIn\`} at={[50, 80]} />
    <Point id={\`pair\${pair}botIn\`} at={[50, 150]} />
    <Point id={\`pair\${pair}topOut\`} at={[820, 80]} />
    <Point id={\`pair\${pair}botOut\`} at={[820, 150]} />
  </Repeat>

  <Repeat count={3} as="col" step={[260, 0]}>
    <Repeat count={2} as="pair" step={[0, 140]}>
      <TwoQGate id={\`E\${col}_\${pair}\`} at={[130, 62]} gateLabel={\`$U_{\${col}}$\`} />
    </Repeat>
  </Repeat>

  <Repeat count={2} as="col" step={[260, 0]}>
    <Repeat count={1} as="pair">
      <TwoQGate id={\`O\${col}_\${pair}\`} at={[260, 132]} gateLabel={\`$V_{\${col}}$\`} />
    </Repeat>
  </Repeat>

  <Repeat count={2} as="pair">
    <Link from={\`pair\${pair}topIn.center\`} to={\`E0_\${pair}.q0l\`} useStyle="wire" />
    <Link from={\`pair\${pair}botIn.center\`} to={\`E0_\${pair}.q1l\`} useStyle="wire" />
    <Link from={\`E2_\${pair}.q0r\`} to={\`pair\${pair}topOut.center\`} useStyle="wire" />
    <Link from={\`E2_\${pair}.q1r\`} to={\`pair\${pair}botOut.center\`} useStyle="wire" />
  </Repeat>

  <Repeat count={2} as="col">
    <Link from={\`E\${col}_0.q0r\`} to={\`E\${col+1}_0.q0l\`} useStyle="wire" />
    <Link from={\`E\${col}_1.q1r\`} to={\`E\${col+1}_1.q1l\`} useStyle="wire" />
  </Repeat>

  <Repeat count={2} as="col">
    <Repeat count={1} as="pair">
      <Link from={\`E\${col}_\${pair}.q1r\`} to={\`O\${col}_\${pair}.q0l\`} useStyle="wire" />
      <Link from={\`E\${col}_\${pair+1}.q0r\`} to={\`O\${col}_\${pair}.q1l\`} useStyle="wire" />
      <Link from={\`O\${col}_\${pair}.q0r\`} to={\`E\${col+1}_\${pair}.q1l\`} useStyle="wire" />
      <Link from={\`O\${col}_\${pair}.q1r\`} to={\`E\${col+1}_\${pair+1}.q0l\`} useStyle="wire" />
    </Repeat>
  </Repeat>
</Graph>
\`\`\`

The same shape library can be reused for longer circuits by increasing the even and odd column repeat counts.`
  }
];

const modes = {
  graph: {
    title: "Rendered Graph",
    examples: graphExamples,
    extension: javascript({ jsx: true })
  },
  markdown: {
    title: "Markdown Preview",
    examples: markdownExamples,
    extension: markdown({
      codeLanguages: (info) => {
        const name = info.trim().split(/\s+/)[0];
        return name === "graphsx" || name === "graphsx-defs" ? jsxLanguage : null;
      }
    })
  },
  liveMarkdown: {
    title: "Live Preview",
    examples: markdownExamples,
    extension: [
      markdown({
        codeLanguages: (info) => {
          const name = info.trim().split(/\s+/)[0];
          return name === "graphsx" || name === "graphsx-defs" ? jsxLanguage : null;
        }
      }),
      graphsxCodeMirrorLivePreview({ katex })
    ]
  },
  docs: {
    title: "Documentation",
    examples: [],
    extension: javascript({ jsx: true })
  }
};

const md = new MarkdownIt({ html: false, linkify: true, typographer: true }).use(graphsxMarkdownIt);
const language = new Compartment();
const app = document.querySelector(".app");
const editorHost = document.querySelector("#editor");
const editorTab = document.querySelector("#editorTab");
const docsTab = document.querySelector("#docsTab");
const mode = document.querySelector("#mode");
const example = document.querySelector("#example");
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const svg = document.querySelector("#graph");
const canvas = document.querySelector(".canvas-wrap");
const markdownPreview = document.querySelector("#markdownPreview");
const renderTitle = document.querySelector("#renderTitle");
const docsPane = document.querySelector(".docs-pane");
const zoomControls = document.querySelector(".zoom-controls");
const syntaxToggle = document.querySelector("#syntaxToggle");
const zoomOut = document.querySelector("#zoomOut");
const zoomIn = document.querySelector("#zoomIn");
const zoomReset = document.querySelector("#zoomReset");
const zoomFit = document.querySelector("#zoomFit");
const zoomValue = document.querySelector("#zoomValue");
const zoomStep = 1.2;
const minZoom = 0.25;
const maxZoom = 4;
const storagePrefix = "graphsx-playground:v1:";
const draftOptionValue = "__draft__";

let zoom = 1;
let pan = { x: 0, y: 0 };
let renderedSize = { width: 720, height: 520 };
let panStart = null;
let editor = null;
let applyingEditorChange = false;
let animationFrameId = null;
let currentMode = loadStoredValue("mode", "graph");
let editorMode = loadStoredValue("editorMode", currentMode === "docs" ? "graph" : currentMode);
let syntaxCollapsed = loadStoredValue("syntaxCollapsed", "false") === "true";
const modeContent = {
  graph: loadStoredValue("content:graph", loadDraft("graph", graphExamples[0].source)),
  markdown: loadStoredValue("content:markdown", loadDraft("markdown", markdownExamples[0].source)),
  docs: ""
};
const selectedExample = {
  graph: loadStoredValue("example:graph", draftOptionValue),
  markdown: loadStoredValue("example:markdown", draftOptionValue),
  docs: draftOptionValue
};

if (!modes[currentMode]) {
  currentMode = "graph";
}
if (!modes[editorMode] || editorMode === "docs") {
  editorMode = "graph";
}
mode.value = editorMode;
applySyntaxPaneState();

populateExamples();

editor = new EditorView({
  doc: modeContent[contentKey(editorMode)],
  extensions: [
    basicSetup,
    language.of(modes[editorMode].extension),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        if (applyingEditorChange) return;
        if (currentMode === "docs") return;
        const key = contentKey(currentMode);
        if (selectedExample[key] !== draftOptionValue) {
          selectedExample[key] = draftOptionValue;
          storeValue(`example:${key}`, draftOptionValue);
          populateExamples();
        }
        modeContent[contentKey(currentMode)] = editorText();
        saveModeContent(contentKey(currentMode));
        saveDraft(contentKey(currentMode));
        render();
      }
    })
  ],
  parent: editorHost
});
editorTab.addEventListener("click", () => {
  if (currentMode !== "docs") return;
  currentMode = editorMode;
  storeValue("mode", currentMode);
  editor.dispatch({
    effects: language.reconfigure(modes[currentMode].extension)
  });
  populateExamples();
  setEditorText(modeContent[contentKey(currentMode)]);
  render();
  if (currentMode === "graph") {
    fitToView();
  }
});
docsTab.addEventListener("click", () => {
  if (currentMode !== "docs") {
    const key = contentKey(currentMode);
    modeContent[key] = editorText();
    saveModeContent(key);
    saveDraft(key);
    editorMode = currentMode;
    storeValue("editorMode", editorMode);
  }
  currentMode = "docs";
  storeValue("mode", currentMode);
  render();
});
zoomOut.addEventListener("click", () => setZoom(zoom / zoomStep, canvasCenter()));
zoomIn.addEventListener("click", () => setZoom(zoom * zoomStep, canvasCenter()));
zoomReset.addEventListener("click", () => {
  if (currentMode !== "graph") return;
  zoom = 1;
  pan = { x: 0, y: 0 };
  applyViewport();
});
zoomFit.addEventListener("click", fitToView);
syntaxToggle.addEventListener("click", () => {
  syntaxCollapsed = !syntaxCollapsed;
  storeValue("syntaxCollapsed", String(syntaxCollapsed));
  applySyntaxPaneState();
  requestAnimationFrame(() => {
    if (currentMode === "graph") {
      fitToView();
    }
  });
});
canvas.addEventListener("wheel", (event) => {
  if (currentMode !== "graph") return;
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const next = event.deltaY > 0 ? zoom / zoomStep : zoom * zoomStep;
  setZoom(next, {
    x: event.clientX - canvas.getBoundingClientRect().left,
    y: event.clientY - canvas.getBoundingClientRect().top
  });
}, { passive: false });
canvas.addEventListener("pointerdown", (event) => {
  if (currentMode !== "graph") return;
  if (event.button !== 0) return;
  event.preventDefault();
  panStart = {
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    panX: pan.x,
    panY: pan.y
  };
  canvas.classList.add("is-panning");
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener("pointermove", (event) => {
  if (!panStart || event.pointerId !== panStart.pointerId) return;
  event.preventDefault();
  pan = {
    x: panStart.panX + event.clientX - panStart.x,
    y: panStart.panY + event.clientY - panStart.y
  };
  applyViewport();
});
canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);
mode.addEventListener("change", () => {
  modeContent[contentKey(currentMode)] = editorText();
  saveModeContent(contentKey(currentMode));
  currentMode = mode.value;
  editorMode = currentMode;
  storeValue("mode", currentMode);
  storeValue("editorMode", editorMode);
  editor.dispatch({
    effects: language.reconfigure(modes[currentMode].extension)
  });
  populateExamples();
  setEditorText(modeContent[contentKey(currentMode)]);
  render();
  if (currentMode === "graph") {
    fitToView();
  }
});
example.addEventListener("change", () => {
  const key = contentKey(currentMode);
  if (selectedExample[key] === draftOptionValue) {
    modeContent[key] = editorText();
    saveDraft(key);
  }

  if (example.value === draftOptionValue) {
    selectedExample[key] = draftOptionValue;
    modeContent[key] = loadDraft(key, modeContent[key]);
    storeValue(`example:${key}`, draftOptionValue);
    saveModeContent(key);
    setEditorText(modeContent[key]);
    render();
    if (currentMode === "graph") {
      fitToView();
    }
    return;
  }

  const item = modes[currentMode].examples.find((candidate) => candidate.name === example.value);
  if (!item) return;
  selectedExample[key] = item.name;
  modeContent[key] = item.source;
  storeValue(`example:${key}`, item.name);
  saveModeContent(key);
  setEditorText(item.source);
  render();
  if (currentMode === "graph") {
    fitToView();
  }
});
window.addEventListener("resize", () => {
  if (currentMode === "graph" && !status.classList.contains("error")) {
    fitToView();
  }
});

render();
fitToView();

function render() {
  stopAnimation();
  updateHeaderTabs();
  if (currentMode === "docs") {
    renderDocsMode();
    return;
  }
  if (currentMode === "markdown") {
    renderMarkdownMode();
    return;
  }
  if (currentMode === "liveMarkdown") {
    renderLiveMarkdownMode();
    return;
  }
  renderGraphMode();
}

function renderGraphMode() {
  const timingLabel = "GraphSX playground parse+render";
  const parseTimingLabel = "GraphSX playground parse";
  const renderTimingLabel = "GraphSX playground render";
  let parseTimerActive = false;
  let renderTimerActive = false;
  console.time(timingLabel);
  try {
    app.classList.remove("live-preview-mode");
    app.classList.remove("docs-mode");
    canvas.classList.remove("markdown-mode");
    docsPane.hidden = true;
    svg.hidden = false;
    markdownPreview.hidden = true;
    zoomControls.hidden = false;
    renderTitle.textContent = modes.graph.title;
    console.time(parseTimingLabel);
    parseTimerActive = true;
    const graph = parseGraphSXDocument(editorText());
    console.timeEnd(parseTimingLabel);
    parseTimerActive = false;
    console.time(renderTimingLabel);
    renderTimerActive = true;
    renderedSize = renderGraphSXDocument(svg, graph, { katex });
    console.timeEnd(renderTimingLabel);
    renderTimerActive = false;
    applyViewport();
    status.textContent = "Parsed successfully";
    status.classList.remove("error");
    renderTitle.textContent = graph.type === "plot" ? "Rendered Plot" : modes.graph.title;
    summary.textContent = graphSXDocumentSummary(graph).text;
    if (hasAnimation(graph)) {
      startAnimation(graph);
    }
  } catch (error) {
    if (parseTimerActive) {
      console.timeEnd(parseTimingLabel);
    }
    if (renderTimerActive) {
      console.timeEnd(renderTimingLabel);
    }
    status.textContent = error.message;
    status.classList.add("error");
  } finally {
    console.timeEnd(timingLabel);
  }
}

function startAnimation(graph) {
  const startedAt = performance.now();
  const step = (now) => {
    renderedSize = renderGraphSXDocument(svg, graph, {
      katex,
      frame: { time: (now - startedAt) / 1000 }
    });
    applyViewport();
    animationFrameId = requestAnimationFrame(step);
  };
  animationFrameId = requestAnimationFrame(step);
}

function stopAnimation() {
  if (animationFrameId == null) return;
  cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
}

function hasAnimation(documentModel) {
  if (documentModel.type !== "plot") return false;
  return [...documentModel.lines, ...documentModel.curves, ...documentModel.marks]
    .some((series) => series.attrs.animate);
}

function renderMarkdownMode() {
  try {
    app.classList.remove("live-preview-mode");
    app.classList.remove("docs-mode");
    canvas.classList.add("markdown-mode");
    docsPane.hidden = true;
    svg.hidden = true;
    svg.replaceChildren();
    svg.removeAttribute("viewBox");
    svg.removeAttribute("style");
    markdownPreview.hidden = false;
    zoomControls.hidden = true;
    renderTitle.textContent = modes.markdown.title;
    markdownPreview.innerHTML = md.render(editorText());
    renderGraphSXBlocks(markdownPreview, { katex });
    status.textContent = "Markdown preview rendered";
    status.classList.remove("error");
    summary.textContent = `${markdownPreview.querySelectorAll(".graphsx-block svg").length} GraphSX block(s)`;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function renderLiveMarkdownMode() {
  try {
    app.classList.add("live-preview-mode");
    app.classList.remove("docs-mode");
    canvas.classList.add("markdown-mode");
    docsPane.hidden = true;
    svg.hidden = true;
    svg.replaceChildren();
    svg.removeAttribute("viewBox");
    svg.removeAttribute("style");
    markdownPreview.hidden = true;
    zoomControls.hidden = true;
    renderTitle.textContent = modes.liveMarkdown.title;
    const count = findGraphSXFences(editorText()).filter((block) => block.info.name === GRAPHSX_FENCE).length;
    status.textContent = "Live preview rendered in editor";
    status.classList.remove("error");
    summary.textContent = `${count} GraphSX widget(s)`;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function renderDocsMode() {
  app.classList.remove("live-preview-mode");
  app.classList.add("docs-mode");
  canvas.classList.add("markdown-mode");
  docsPane.hidden = false;
  svg.hidden = true;
  svg.replaceChildren();
  svg.removeAttribute("viewBox");
  svg.removeAttribute("style");
  markdownPreview.hidden = true;
  zoomControls.hidden = true;
  example.hidden = true;
  status.textContent = "Docs ready";
  status.classList.remove("error");
}

function updateHeaderTabs() {
  const docsActive = currentMode === "docs";
  editorTab.setAttribute("aria-selected", String(!docsActive));
  docsTab.setAttribute("aria-selected", String(docsActive));
}

function editorText() {
  return editor.state.doc.toString();
}

function setEditorText(value) {
  applyingEditorChange = true;
  try {
    editor.dispatch({
      changes: {
        from: 0,
        to: editor.state.doc.length,
        insert: value
      }
    });
  } finally {
    applyingEditorChange = false;
  }
}

function setZoom(value, focus = null) {
  const previous = zoom;
  zoom = clamp(value, minZoom, maxZoom);

  if (focus && previous !== zoom) {
    const factor = zoom / previous;
    pan = {
      x: focus.x - (focus.x - pan.x) * factor,
      y: focus.y - (focus.y - pan.y) * factor
    };
  }
  applyViewport();
}

function fitToView() {
  if (currentMode !== "graph") return;
  const availableWidth = Math.max(1, canvas.clientWidth - 48);
  const availableHeight = Math.max(1, canvas.clientHeight - 48);
  zoom = clamp(
    Math.min(availableWidth / renderedSize.width, availableHeight / renderedSize.height),
    minZoom,
    maxZoom
  );
  pan = {
    x: (canvas.clientWidth - renderedSize.width * zoom) / 2,
    y: (canvas.clientHeight - renderedSize.height * zoom) / 2
  };
  applyViewport();
}

function applyViewport() {
  if (currentMode !== "graph") return;
  svg.style.width = `${renderedSize.width}px`;
  svg.style.height = `${renderedSize.height}px`;
  svg.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomValue.textContent = `${Math.round(zoom * 100)}%`;
}

function applySyntaxPaneState() {
  app.classList.toggle("syntax-collapsed", syntaxCollapsed);
  syntaxToggle.setAttribute("aria-expanded", String(!syntaxCollapsed));
  syntaxToggle.setAttribute("aria-pressed", String(!syntaxCollapsed));
  syntaxToggle.textContent = syntaxCollapsed ? "Syntax" : "Hide Syntax";
}

function populateExamples() {
  example.hidden = currentMode === "docs";
  example.textContent = "";
  if (currentMode === "docs") return;
  const draftOption = document.createElement("option");
  draftOption.value = draftOptionValue;
  draftOption.textContent = "Draft";
  example.append(draftOption);

  for (const item of modes[currentMode].examples) {
    const option = document.createElement("option");
    option.value = item.name;
    option.textContent = item.name;
    example.append(option);
  }
  const selected = selectedExample[contentKey(currentMode)];
  example.value = modes[currentMode].examples.some((item) => item.name === selected) ? selected : draftOptionValue;
}

function contentKey(modeName) {
  return modeName === "liveMarkdown" ? "markdown" : modeName;
}

function saveModeContent(key) {
  storeValue(`content:${key}`, modeContent[key]);
}

function saveDraft(key) {
  storeValue(`draft:${key}`, modeContent[key]);
}

function loadDraft(key, fallback) {
  return loadStoredValue(`draft:${key}`, fallback);
}

function loadStoredValue(key, fallback) {
  try {
    return localStorage.getItem(`${storagePrefix}${key}`) ?? fallback;
  } catch {
    return fallback;
  }
}

function storeValue(key, value) {
  try {
    localStorage.setItem(`${storagePrefix}${key}`, value);
  } catch {
    // Storage can be unavailable in hardened/private contexts; the playground still works in memory.
  }
}

function canvasCenter() {
  return {
    x: canvas.clientWidth / 2,
    y: canvas.clientHeight / 2
  };
}

function endPan(event) {
  if (!panStart || event.pointerId !== panStart.pointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  panStart = null;
  canvas.classList.remove("is-panning");
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
