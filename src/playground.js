import katex from "katex";
import "katex/dist/katex.min.css";
import { basicSetup, EditorView } from "codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { graphSummary, parseGraph, renderGraph } from "./index.js";

const examples = [
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

  <Arrow from="A.out" to="B.in" useStyle="violetEdge" />
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
    <Tensor id="A{i}" at={[100, 100]} site={i} />
    <Point id="p{i}" at={[128, 210]} />
    <Edge from="A{i}.phys" to="p{i}.center" useStyle="wire" />
  </Repeat>

  <Repeat count={5} as="i">
    <Edge from="A{i}.right" to="A{i+1}.left" useStyle="wire" />
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

  <Edge from="A.right" to="B.left" useStyle="edge" />
</Graph>`
  },
  {
    name: "Layout",
    source: `<Graph layout="dag" direction="right" rankGap={210} nodeGap={95} route="orthogonal" corner={8}>
  <Rect id="A" size={[100, 60]} label="A" />
  <Rect id="B" size={[100, 60]} label="B" />
  <Rect id="C" size={[100, 60]} label="C" />
  <Rect id="D" size={[100, 60]} label="D" />

  <Arrow from="A.right" to="B.left" />
  <Arrow from="A.right" to="C.left" />
  <Arrow from="B.right" to="D.left" />
  <Arrow from="C.right" to="D.left" />
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
    <Arrow from="left.right" to="right.left" />
    <Port id="in" target="left.left" />
    <Port id="out" target="right.right" />
  </Shape>

  <Pair id="P0" at={[90, 120]} k={0} label="visible group box" />
  <Pair id="P1" at={[430, 120]} k={1} groupBox={false} />

  <Arrow from="P0.out" to="P1.in" />
</Graph>`
  }
];

const editorHost = document.querySelector("#editor");
const example = document.querySelector("#example");
const status = document.querySelector("#status");
const summary = document.querySelector("#summary");
const svg = document.querySelector("#graph");
const canvas = document.querySelector(".canvas-wrap");
const zoomOut = document.querySelector("#zoomOut");
const zoomIn = document.querySelector("#zoomIn");
const zoomReset = document.querySelector("#zoomReset");
const zoomFit = document.querySelector("#zoomFit");
const zoomValue = document.querySelector("#zoomValue");
const zoomStep = 1.2;
const minZoom = 0.25;
const maxZoom = 4;

let zoom = 1;
let pan = { x: 0, y: 0 };
let renderedSize = { width: 720, height: 520 };
let panStart = null;
let editor = null;

for (const item of examples) {
  const option = document.createElement("option");
  option.value = item.name;
  option.textContent = item.name;
  example.append(option);
}

editor = new EditorView({
  doc: examples[0].source,
  extensions: [
    basicSetup,
    javascript({ jsx: true }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        render();
      }
    })
  ],
  parent: editorHost
});
zoomOut.addEventListener("click", () => setZoom(zoom / zoomStep, canvasCenter()));
zoomIn.addEventListener("click", () => setZoom(zoom * zoomStep, canvasCenter()));
zoomReset.addEventListener("click", () => {
  zoom = 1;
  pan = { x: 0, y: 0 };
  applyViewport();
});
zoomFit.addEventListener("click", fitToView);
canvas.addEventListener("wheel", (event) => {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  const next = event.deltaY > 0 ? zoom / zoomStep : zoom * zoomStep;
  setZoom(next, {
    x: event.clientX - canvas.getBoundingClientRect().left,
    y: event.clientY - canvas.getBoundingClientRect().top
  });
}, { passive: false });
canvas.addEventListener("pointerdown", (event) => {
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
example.addEventListener("change", () => {
  const item = examples.find((candidate) => candidate.name === example.value);
  if (!item) return;
  setEditorText(item.source);
  render();
  fitToView();
});
window.addEventListener("resize", () => {
  if (!status.classList.contains("error")) {
    fitToView();
  }
});

render();
fitToView();

function render() {
  try {
    const graph = parseGraph(editorText());
    renderedSize = renderGraph(svg, graph, { katex });
    applyViewport();
    status.textContent = "Parsed";
    status.classList.remove("error");
    summary.textContent = graphSummary(graph).text;
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
  }
}

function editorText() {
  return editor.state.doc.toString();
}

function setEditorText(value) {
  editor.dispatch({
    changes: {
      from: 0,
      to: editor.state.doc.length,
      insert: value
    }
  });
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
  svg.style.width = `${renderedSize.width}px`;
  svg.style.height = `${renderedSize.height}px`;
  svg.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  zoomValue.textContent = `${Math.round(zoom * 100)}%`;
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
