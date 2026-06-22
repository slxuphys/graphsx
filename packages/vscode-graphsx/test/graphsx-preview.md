# GraphSX VS Code Preview Test

Open this file in the Extension Development Host and run `Markdown: Open Preview`.

## Diagram

```graphsx
<Graph>
  <Style id="blueBox" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />
  <Style id="violetEdge" stroke="#7c3aed" strokeWidth={3} />

  <Rect id="A" at={[100, 100]} size={[100, 60]} label="$\alpha$" useStyle="blueBox">
    <Port id="out" right label="xy" style={{ fill: "#f97316" }} />
  </Rect>

  <Circle id="B" at={[300, 100]} r={40} label="B">
    <Port id="in" left />
  </Circle>

  <Link headArrow from="A.out" to="B.in" useStyle="violetEdge" />
</Graph>
```

## Plot

```graphsx
<Plot width={520} height={320} xDomain={[0, 2*pi]} yDomain={[-1.2, 1.2]} frame box>
  <Data id="sin" y="sin(x)" domain={[0, 2*pi]} samples={100} />
  <Axis x label="$x$" ticks grid />
  <Axis y label="$\sin(x)$" ticks grid />
  <Line data="sin" stroke="#2563eb" strokeWidth={2} label="$\sin(x)$" />
  <Legend />
</Plot>
```

## Library Reuse

```graphsx-defs theme
<Style id="box" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />
<Style id="wire" stroke="#7c3aed" strokeWidth={3} />
```

```graphsx use="theme"
<Graph>
  <Rect id="L" label="$L$" useStyle="box" />
  <Rect id="R" at={[180, 0]} label="$R$" useStyle="box" />
  <Link from="L.right" to="R.left" headArrow useStyle="wire" />
</Graph>
```

```graphsx 
<Plot width={520} height={320} xDomain={[0, 2*pi]} yDomain={[-1.2, 1.2]} frame box>
  <Data id="cos" y="cos(x)" domain={[0, 2*pi]} samples={100} />
  <Axis x label="$x$" ticks grid />
  <Axis y label="$\cos(x)$" ticks grid />
  <Line data="cos" stroke="#7c3aed" strokeWidth={2} label="$\cos(x)$" />
  <Legend />
</Plot>
``` 
