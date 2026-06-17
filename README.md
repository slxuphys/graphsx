# GraphSX

GraphSX is a React/JSX-like DSL for drawing SVG diagrams from inline markup. It supports reusable shapes, named ports, routing, Markdown fences, and CodeMirror live-preview widgets.

Try the playground: https://slxuphys.github.io/graphsx/

Current package name: `inline-graph-dsl`. The project/repo name is GraphSX.

```jsx
<Graph>
  <Rect id="A" at={[100, 100]} size={[100, 60]} label="$\alpha$">
    <Port id="out" right label="xy" />
  </Rect>

  <Circle id="B" at={[300, 100]} r={40} label="B">
    <Port id="in" left />
  </Circle>

  <Link headArrow from="A.out" to="B.in" />
</Graph>
```

The parser returns a plain JavaScript model:

- `nodes`: shape instances with computed `legs` maps for port coordinates
- `edges`: internal connection records created from `<Link>` tags
- `shapes`: reusable grouped shape definitions

The package exports reusable parser and renderer helpers:

```js
import { parseGraph, renderGraph } from "inline-graph-dsl";

const graph = parseGraph(source);
renderGraph(document.querySelector("svg"), graph, { katex });
```

Labels are opt-in. Use `label="xy"` for plain text and `label="$\alpha$"` for KaTeX math. If a node or port has no `label` prop, no label is rendered.

Rectangles use a small rounded corner by default. Set `corner` directly to tune it:

```jsx
<Rect id="square" at={[100, 100]} size={[120, 70]} corner={0} />
<Rect id="round" at={[260, 100]} size={[120, 70]} corner={18} />
```

`rx` is also supported as a lower-level SVG-style alias for rectangle corners.

Ports can use side shorthand or custom local coordinates:

```jsx
<Rect id="A" at={[100, 100]} size={[120, 80]}>
  <Port id="in" left />
  <Port id="tap" at={[60, 20]} angle={35} label="$t$" />
</Rect>
```

`at` on a port is relative to its shape. The `tap` port above lands at `[160, 120]` in graph coordinates.
`angle` controls the direction a routed link emits from or enters the port. `0` points right, `90` points down, `180` points left, and `-90` points up. Side shorthand sets this automatically, but `angle` can override it.

Built-in `Rect` and `Circle` shapes automatically expose `left`, `right`, `top`, and `bottom` ports, so simple connections do not need explicit port declarations:

```jsx
<Rect id="A" at={[100, 100]} size={[120, 80]} />
<Circle id="B" at={[320, 140]} r={40} />

<Link headArrow from="A.right" to="B.left" />
<Link headArrow from="A.top" to="B.bottom" />
```

If you define a port with one of those names yourself, your explicit port overrides the default.

Use `Point` or `Anchor` when you need a connection target without drawing a shape. A point has a default `center` port:

```jsx
<Rect id="A" at={[100, 100]} size={[120, 80]} />
<Point id="J" at={[280, 140]} />
<Anchor id="K" at={[360, 140]}>
  <Port id="in" angle={180} />
</Anchor>

<Link headArrow from="A.right" to="J.center" />
<Link headArrow from="J.center" to="K.in" />
```

Point nodes are not rendered as shape boxes and are not treated as obstacles by `route="auto"`.

Links use curved routing by default. Use `route="straight"` for a direct segment, `route="orthogonal"` for right-angle routing, or `route="auto"` for v1 obstacle-avoiding A* routing. Orthogonal and auto routing respect port angles by adding a short first and last segment in the port direction:

```jsx
<Rect id="A" at={[100, 120]} size={[100, 60]} />
<Rect id="B" at={[340, 60]} size={[100, 60]} />

<Link headArrow from="A.right" to="B.bottom" route="orthogonal" />
<Link headArrow from="A.top" to="B.left" route="straight" />
```

For orthogonal and auto routes, custom angles are snapped to the nearest cardinal direction. You can change the first and last segment length with `stub={40}`.

Set routing defaults on `<Graph>` when most links should use the same behavior. For links, `corner` rounds orthogonal and auto route bends:

```jsx
<Graph route="auto" grid={20} padding={16} corner={8}>
  <Rect id="A" at={[60, 100]} size={[90, 60]} />
  <Rect id="Block" at={[210, 70]} size={[90, 110]} />
  <Rect id="B" at={[380, 100]} size={[90, 60]} />

  <Link headArrow from="A.right" to="B.left" />
  <Link headArrow from="A.top" to="B.top" route="orthogonal" corner={0} />
</Graph>
```

`route="auto"` avoids shape boxes only in this first version. It does not try to avoid crossing other links yet. `grid` controls routing resolution and `padding` controls clearance around shapes.

Use `<Path>` when you want exact drawn geometry instead of a semantic connection between ports:

```jsx
<Graph>
  <Style id="wire" stroke="#111111" strokeWidth={2} />

  <Path points={[[90, 80], [90, 240], [180, 240]]} useStyle="wire" />
  <Path points={[[120, 80], [170, 80], [170, 160]]} corner={6} headArrow />
</Graph>
```

`Path` renders without arrowheads by default. Add `headArrow` and/or `tailArrow` to decorate endpoints, and tune them with `arrowSize={8}`. `points` is an array of graph coordinates; `corner` rounds bends. A raw SVG path string is also accepted with `d="M 90 80 L 90 240 L 180 240"`.

## Layout

Coordinates are optional when a graph layout is enabled. `layout="row"` and `layout="column"` place nodes in source order:

```jsx
<Graph layout="row" gap={120}>
  <Rect id="A" size={[100, 60]} />
  <Rect id="B" size={[100, 60]} />
  <Link headArrow from="A.right" to="B.left" />
</Graph>
```

`layout="dag"` reads links between top-level nodes and places related nodes in layers. With `direction="right"`, layers go left-to-right and siblings stack vertically:

```jsx
<Graph layout="dag" direction="right" rankGap={200} nodeGap={90}>
  <Rect id="A" size={[100, 60]} />
  <Rect id="B" size={[100, 60]} />
  <Rect id="C" size={[100, 60]} />

  <Link headArrow from="A.right" to="B.left" />
  <Link headArrow from="A.right" to="C.left" />
</Graph>
```

This places `A` in the first layer and `B`/`C` in a parallel layer to the right. Explicit coordinates still win, so a node with `at={[x, y]}` is not moved by layout.

Use `style={{ ... }}` for SVG styling on shapes, ports, paths, and links:

```jsx
<Style id="blueBox" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />

<Rect id="A" at={[100, 100]} size={[120, 80]} style={{ fill: "#eef6ff", stroke: "#1d4ed8" }}>
  <Port id="out" right style={{ fill: "#f97316" }} />
</Rect>

<Link headArrow from="A.out" to="B.in" style={{ stroke: "#7c3aed", strokeWidth: 3 }} />
```

Style keys can use camelCase, such as `strokeWidth`; the renderer maps them to SVG attributes. Reuse named styles with `useStyle`, and override them with inline `style`:

```jsx
<Rect id="A" useStyle="blueBox" style={{ strokeWidth: 5 }} />
```

Comments are ignored anywhere whitespace is allowed. Short braced notes, JSX-style comments, and HTML comments are accepted:

```jsx
<Graph>
  {quick note}
  {/* a note for readers */}
  <!-- also accepted -->
  <Rect id="A" />
</Graph>
```

## Run

```bash
npm install
npm test
npm run playground
```

The playground runs at the Vite URL printed in your terminal, usually `http://127.0.0.1:5173/`.

## Reusable Shapes

Grouped shapes are declared with `<Shape>` and can be instantiated by name:

```jsx
<Graph>
  <Shape id="Pair" w={260} h={80}>
    <Rect id="left" at={[0, 0]} size={[80, 50]}>
      <Port id="in" left />
      <Port id="out" right />
    </Rect>
    <Circle id="right" at={[170, 25]} r={25}>
      <Port id="in" left />
    </Circle>
    <Link headArrow from="left.out" to="right.in" />
    <Port id="in" target="left.in" left />
    <Port id="out" target="right.right" right />
  </Shape>

  <Pair id="P1" at={[100, 100]} />
  <Pair id="P2" at={[450, 100]} />
  <Link headArrow from="P1.out" to="P2.in" />
  <Link headArrow from="P1.left.in" to="P2.right.in" />
</Graph>
```

Address paths use IDs. `P1.left` is the child shape named `left` inside the custom shape instance `P1`; `P1.left.in` is the `in` port on that child. Public ports on the custom shape use the shorter form, such as `P1.in`.

Grouped shapes render a dashed group box by default. Set `groupBox={false}` on the shape definition or on an instance to hide it:

```jsx
<Shape id="Tensor" groupBox={false}>
  <Rect id="box" at={[0, 0]} size={[56, 56]} />
  <Port id="left" target="box.left" />
</Shape>

<Tensor id="A0" at={[100, 100]} />
<Tensor id="A1" at={[200, 100]} groupBox={true} />
```

Custom shape instances can pass arbitrary props into the shape body. Use a backtick template string when an internal label or attribute should substitute those props:

```jsx
<Graph>
  <Shape id="Tensor">
    <Rect id="box" at={[0, 0]} size={[56, 56]} label={`$A^{[${site}]}$`} />
    <Port id="left" target="box.left" />
    <Port id="right" target="box.right" />
  </Shape>

  <Repeat count={4} as="i" step={[100, 0]}>
    <Tensor id={`A${i}`} at={[100, 100]} site={i} />
  </Repeat>
</Graph>
```

Backtick strings use `${name}` for shape prop substitution and `${i+1}` / `${i-1}` for simple repeat-index offsets. Normal quoted strings do not read shape props. Legacy repeat shorthand such as `"A{i}"` still works, but new examples should prefer backtick templates because they are closer to JSX behavior. Props stay on the grouped shape instance even when children reference them. Use a custom prop such as `boxLabel`, `upperLabel`, or `site` when a value is meant only for internal children.

## Repeat

Use `<Repeat>` to expand repeated nodes or links before the graph is built:

```jsx
<Graph>
  <Repeat count={4} as="i" step={[80, 0]}>
    <Rect id={`box${i}`} at={[100, 100]} size={[60, 40]} label={`$x_{${i}}$`}>
      <Port id="in" left />
      <Port id="out" right />
    </Rect>
  </Repeat>

  <Repeat count={3} as="i">
    <Link headArrow from={`box${i}.out`} to={`box${i+1}.in`} />
  </Repeat>
</Graph>
```

`${i}` is replaced with the loop index inside backtick attributes. `${i+1}` and `${i-1}` are supported for neighboring links. `step` offsets repeated shapes; ports remain local to their shape.

Nested repeats can build grids:

```jsx
<Graph>
  <Repeat count={2} as="row" step={[0, 90]}>
    <Repeat count={3} as="col" step={[100, 0]}>
      <Rect id={`cell-${row}-${col}`} at={[100, 100]} size={[70, 50]} label={`cell ${row},${col}`}>
        <Port id="left" left />
        <Port id="right" right />
      </Rect>
    </Repeat>
  </Repeat>
</Graph>
```

Repeats also work inside `<Shape>` definitions, so a reusable shape can hide repeated internal structure behind public ports.

## Markdown

GraphSX can be used from Markdown by installing the `markdown-it` plugin and then upgrading the rendered placeholders in the browser:

```js
import MarkdownIt from "markdown-it";
import katex from "katex";
import { graphsxMarkdownIt, renderGraphSXBlocks } from "inline-graph-dsl";
import "inline-graph-dsl/markdown.css";

const md = new MarkdownIt().use(graphsxMarkdownIt);
const preview = document.querySelector("#preview");

preview.innerHTML = md.render(markdownSource);
renderGraphSXBlocks(preview, { katex });
```

The optional `markdown.css` stylesheet centers rendered diagrams by default, keeps them responsive, and removes editor-style canvas chrome:

```js
import "inline-graph-dsl/markdown.css";
```

Override `.graphsx-rendered` or `.graphsx-block` in app CSS when a document needs left-aligned or custom diagram layout.

Markdown authors use the `graphsx` fence:

````md
```graphsx
<Graph>
  <Rect id="A" />
  <Rect id="B" at={[220, 0]} />
  <Link headArrow from="A.right" to="B.left" />
</Graph>
```
````

The plugin emits safe placeholders for `graphsx` fences. `renderGraphSXBlocks` finds those placeholders and replaces them with SVG using the normal parser and renderer.

Definitions can be shared across Markdown fences with explicit document-local libraries. A `graphsx-defs` fence is hidden in the preview, and a graph imports one or more libraries with `use`:

````md
```graphsx-defs colors
<Style id="tensor" fill="#6aa4d8" stroke="#111111" />
<Style id="wire" stroke="#111111" strokeWidth={2.5} />
```

```graphsx-defs mps
<Shape id="Tensor" groupBox={false}>
  <Rect id="box" at={[0, 0]} size={[56, 56]} corner={8} useStyle="tensor" />
  <Port id="left" target="box.left" />
  <Port id="right" target="box.right" />
</Shape>
```

```graphsx use="colors mps"
<Graph route="straight">
  <Tensor id="A0" at={[0, 0]} />
  <Tensor id="A1" at={[110, 0]} />
  <Link from="A0.right" to="A1.left" useStyle="wire" />
</Graph>
```
````

Multiple library names can be separated by spaces or commas. They are applied left to right; later libraries and the graph fence itself can override earlier styles or shapes with the same id.

## CodeMirror Live Preview

Use the CodeMirror extension to render `graphsx` fences as editable live widgets inside a Markdown editor:

```js
import { EditorView, basicSetup } from "codemirror";
import { markdown } from "@codemirror/lang-markdown";
import { jsxLanguage } from "@codemirror/lang-javascript";
import { graphsxCodeMirrorLivePreview } from "inline-graph-dsl/codemirror";
import "inline-graph-dsl/codemirror.css";

new EditorView({
  doc,
  extensions: [
    basicSetup,
    markdown({
      codeLanguages: (info) => {
        const name = info.trim().split(/\s+/)[0];
        return name === "graphsx" || name === "graphsx-defs" ? jsxLanguage : null;
      }
    }),
    graphsxCodeMirrorLivePreview({ katex })
  ],
  parent: document.querySelector("#editor")
});
```

When the cursor is outside a `graphsx` fence, the fence renders as an SVG widget. Clicking the widget moves the cursor into the original fenced code so it can be edited. `graphsx-defs` fences render as compact library markers and still feed reusable shapes/styles to later graph fences.
