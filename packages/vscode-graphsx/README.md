# GraphSX for VS Code

Render `graphsx` fenced code blocks in VS Code's built-in Markdown preview.

````md
```graphsx
<Graph>
  <Rect id="A" label="$\alpha$" />
  <Rect id="B" at={[220, 0]} />
  <Link headArrow from="A.right" to="B.left" />
</Graph>
```
````

This extension uses the same GraphSX Markdown pipeline as the playground:

- a Markdown-it plugin turns `graphsx` fences into preview placeholders
- a preview script upgrades those placeholders into SVG
- KaTeX is bundled for math labels

## Development

From the repository root:

```bash
npm run build:vscode
```

To test with F5:

1. Open `packages/vscode-graphsx` as the VS Code workspace folder.
2. Press F5 and choose `Run GraphSX Extension`.
3. In the Extension Development Host, open a Markdown file and run `Markdown: Open Preview`.

If you open the repository root instead, use the launch configuration from the extension folder or pass `--extensionDevelopmentPath=packages/vscode-graphsx` manually.
