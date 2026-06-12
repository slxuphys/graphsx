# Inline Graph DSL

A small scaffold for a React/HTML-like graph language:

```jsx
<Graph>
  <Rect id="A" at={[100, 100]} size={[100, 60]} label="$\alpha$">
    <Port id="out" right label="xy" />
  </Rect>

  <Circle id="B" at={[300, 100]} r={40} label="B">
    <Port id="in" left />
  </Circle>

  <Arrow from="A.out" to="B.in" />
</Graph>
```

The parser returns a plain JavaScript model:

- `nodes`: shape instances with computed leg coordinates
- `edges`: connections between `node.leg` addresses
- `shapes`: reusable grouped shape definitions

The package exports reusable parser and renderer helpers:

```js
import { parseGraph, renderGraph } from "./src/index.js";

const graph = parseGraph(source);
renderGraph(document.querySelector("svg"), graph, { katex });
```

Labels are opt-in. Use `label="xy"` for plain text and `label="$\alpha$"` for KaTeX math. If a node or port has no `label` prop, no label is rendered.

Ports can use side shorthand or custom local coordinates:

```jsx
<Rect id="A" at={[100, 100]} size={[120, 80]}>
  <Port id="in" left />
  <Port id="tap" at={[60, 20]} angle={35} label="$t$" />
</Rect>
```

`at` on a port is relative to its shape. The `tap` port above lands at `[160, 120]` in graph coordinates.
`angle` controls the direction an arrow emits from or enters the port. `0` points right, `90` points down, `180` points left, and `-90` points up. Side shorthand sets this automatically, but `angle` can override it.

Built-in `Rect` and `Circle` shapes automatically expose `left`, `right`, `top`, and `bottom` ports, so simple connections do not need explicit port declarations:

```jsx
<Rect id="A" at={[100, 100]} size={[120, 80]} />
<Circle id="B" at={[320, 140]} r={40} />

<Arrow from="A.right" to="B.left" />
<Arrow from="A.top" to="B.bottom" />
```

If you define a port with one of those names yourself, your explicit port overrides the default.

Arrows use curved routing by default. Use `route="straight"` for a direct segment or `route="orthogonal"` for right-angle routing. Orthogonal routing respects port angles by adding a short first and last segment in the port direction:

```jsx
<Rect id="A" at={[100, 120]} size={[100, 60]} />
<Rect id="B" at={[340, 60]} size={[100, 60]} />

<Arrow from="A.right" to="B.bottom" route="orthogonal" />
<Arrow from="A.top" to="B.left" route="straight" />
```

For orthogonal routes, custom angles are snapped to the nearest cardinal direction. You can change the first and last segment length with `stub={40}`.

Use `style={{ ... }}` for SVG styling on shapes, ports, and edges:

```jsx
<Style id="blueBox" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />

<Rect id="A" at={[100, 100]} size={[120, 80]} style={{ fill: "#eef6ff", stroke: "#1d4ed8" }}>
  <Port id="out" right style={{ fill: "#f97316" }} />
</Rect>

<Arrow from="A.out" to="B.in" style={{ stroke: "#7c3aed", strokeWidth: 3 }} />
```

Style keys can use camelCase, such as `strokeWidth`; the playground maps them to SVG attributes. Reuse named styles with `useStyle`, and override them with inline `style`:

```jsx
<Rect id="A" useStyle="blueBox" style={{ strokeWidth: 5 }} />
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
    <Circ id="right" at={[160, 0]} r={25}>
      <Port id="in" left />
    </Circ>
    <Arrow from="left.out" to="right.in" />
    <Port id="in" target="left.in" left />
    <Port id="out" target="right.in" right />
  </Shape>

  <Pair id="P1" at={[100, 100]} />
  <Pair id="P2" at={[450, 100]} />
  <Arrow from="P1.out" to="P2.in" />
  <Arrow from="P1.left.in" to="P2.right.in" />
</Graph>
```

Address paths use IDs. `P1.left` is the child shape named `left` inside the custom shape instance `P1`; `P1.left.in` is the `in` port on that child. Public ports on the custom shape use the shorter form, such as `P1.in`.

## Repeat

Use `<Repeat>` to expand repeated nodes or edges before the graph is built:

```jsx
<Graph>
  <Repeat count={4} as="i" step={[80, 0]}>
    <Rect id="box{i}" at={[100, 100]} size={[60, 40]} label="$x_{i}$">
      <Port id="in" left />
      <Port id="out" right />
    </Rect>
  </Repeat>

  <Repeat count={3} as="i">
    <Arrow from="box{i}.out" to="box{i+1}.in" />
  </Repeat>
</Graph>
```

`{i}` is replaced with the loop index. `{i+1}` and `{i-1}` are supported for neighboring edges. `step` offsets repeated shapes; ports remain local to their shape.

Nested repeats can build grids:

```jsx
<Graph>
  <Repeat count={2} as="row" step={[0, 90]}>
    <Repeat count={3} as="col" step={[100, 0]}>
      <Rect id="cell-{row}-{col}" at={[100, 100]} size={[70, 50]} label="cell {row},{col}">
        <Port id="left" left />
        <Port id="right" right />
      </Rect>
    </Repeat>
  </Repeat>
</Graph>
```

Repeats also work inside `<Shape>` definitions, so a reusable shape can hide repeated internal structure behind public ports.

The browser playground renders the normalized graph as SVG.
