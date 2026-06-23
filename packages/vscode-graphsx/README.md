# GraphSX for VS Code

VS Code support for [GraphSX](https://github.com/slxuphys/graphsx), a JSX-like diagram and plot DSL for Markdown notes, documentation, and notebooks.

This extension renders `graphsx` fenced blocks in both:

- Markdown files, through VS Code's built-in Markdown preview
- Jupyter notebook Markdown cells, through VS Code's notebook Markdown renderer

It also adds GraphSX syntax highlighting for fenced blocks in Markdown editors and notebook Markdown-cell edit mode.

## Features

- Render `<Graph>` diagrams from `graphsx` fenced blocks
- Render `<Plot>` figures from `graphsx` fenced blocks
- Support reusable `graphsx-defs` libraries
- Support KaTeX math labels
- Highlight GraphSX fences with JSX-like syntax
- Work in normal `.md` files and rendered Jupyter notebook Markdown cells

## Markdown Usage

Write GraphSX inside a Markdown fence:

````md
```graphsx
<Graph>
  <Rect id="A" label="$\alpha$" />
  <Rect id="B" at={[220, 0]} />
  <Link headArrow from="A.right" to="B.left" />
</Graph>
```
````

Then open VS Code's Markdown preview.

## Notebook Usage

Use the same fence inside a Jupyter notebook Markdown cell:

````md
```graphsx
<Plot width={560} height={340} xDomain={[0, 2*pi]} yDomain={[-1.2, 1.2]} box>
  <Data id="sin" y="sin(x)" domain={[0, 2*pi]} samples={160} />
  <Axis x label="$x$" ticks grid />
  <Axis y label="$\sin(x)$" ticks grid />
  <Line data="sin" stroke="#2563eb" strokeWidth={2} label="$\sin(x)$" />
  <Legend />
</Plot>
```
````

When the Markdown cell is rendered, GraphSX is rendered directly into the cell output.

## Notebook Preamble Libraries

Notebook Markdown cells are rendered independently. Same-cell `graphsx-defs` fences always work, and the VS Code extension also supports an explicit notebook preamble convention.

Put reusable GraphSX libraries in YAML-style front matter in the first Markdown cell:

````md
---
graphsx-libs:
  theme: |
    <Style id="box" fill="#eef6ff" stroke="#1d4ed8" />
    <Style id="wire" stroke="#7c3aed" strokeWidth={3} />
---
# Notebook title
````

Then later Markdown cells can use that library:

````md
```graphsx use="theme"
<Graph>
  <Rect id="A" useStyle="box" />
  <Rect id="B" at={[220, 0]} useStyle="box" />
  <Link headArrow from="A.right" to="B.left" useStyle="wire" />
</Graph>
```
````

Same-cell `graphsx-defs` libraries override preamble libraries with the same name. When the preamble parses successfully, the extension stores the library source in GraphSX metadata on Markdown cells that use GraphSX, which nudges VS Code to refresh rendered notebook cells after the setup cell changes. This metadata sync can mark the notebook as modified, similar to notebook tools that update cell metadata.

If the front matter is malformed, the first Markdown cell renders a visible GraphSX front matter error and the previous valid notebook metadata is left unchanged.

## Reusable Libraries

Define reusable styles or shapes with `graphsx-defs`, then reference them from later `graphsx` fences.

````md
```graphsx-defs theme
<Style id="box" fill="#eef6ff" stroke="#1d4ed8" strokeWidth={2} />
<Style id="wire" stroke="#7c3aed" strokeWidth={3} />
```

```graphsx use="theme"
<Graph>
  <Rect id="A" label="$L$" useStyle="box" />
  <Rect id="B" at={[220, 0]} label="$R$" useStyle="box" />
  <Link headArrow from="A.right" to="B.left" useStyle="wire" />
</Graph>
```
````

## Supported Fences

- `graphsx`: render a GraphSX document
- `graphsx-defs`: define reusable styles and shapes

Both fences are syntax-highlighted in Markdown source.

## How It Works

For normal Markdown preview, the extension uses VS Code's Markdown extension hooks:

- a Markdown-it plugin converts `graphsx` fences into GraphSX placeholders
- a preview script upgrades those placeholders into SVG

For notebook Markdown cells, VS Code uses a different renderer. This extension contributes a notebook renderer that extends `vscode.markdown-it-renderer`, installs the same GraphSX Markdown-it plugin, and renders GraphSX blocks inside the notebook Markdown renderer.

## Development

From the repository root:

```bash
npm run build:vscode
```

To test with F5:

1. Open `packages/vscode-graphsx` as the VS Code workspace folder.
2. Press F5 and choose `Run GraphSX Extension`.
3. In the Extension Development Host, open a Markdown file or Jupyter notebook.

If you open the repository root instead, use the launch configuration from the extension folder or pass `--extensionDevelopmentPath=packages/vscode-graphsx` manually.
