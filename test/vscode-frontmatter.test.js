import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import {
  installGraphSXFrontMatter,
  parseGraphSXFrontMatter,
  parseGraphSXFrontMatterLibraries
} from "../packages/vscode-graphsx/src/frontmatter.js";

test("parses GraphSX notebook front matter libraries", () => {
  const libraries = parseGraphSXFrontMatterLibraries(`
graphsx-libs:
  theme: |
    <Style id="box" fill="#eef6ff" stroke="#1d4ed8" />
    <Style id="wire" stroke="#7c3aed" strokeWidth={3} />
  circuit: |
    <Shape id="Gate">
      <Rect id="box" size={[60, 30]} />
    </Shape>
`);

  assert.equal(libraries.size, 2);
  assert.equal(
    libraries.get("theme").source,
    `<Style id="box" fill="#eef6ff" stroke="#1d4ed8" />\n<Style id="wire" stroke="#7c3aed" strokeWidth={3} />`
  );
  assert.equal(
    libraries.get("circuit").source,
    `<Shape id="Gate">\n  <Rect id="box" size={[60, 30]} />\n</Shape>`
  );
});

test("reports malformed GraphSX notebook front matter", () => {
  const parsed = parseGraphSXFrontMatter(`
graphsx-libs:
  theme:
    <Style id="box" />
`);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.libraries.size, 0);
  assert.match(parsed.error.message, /Invalid GraphSX front matter library header/);
});

test("parses GraphSX libraries from fenced notebook front matter", () => {
  const parsed = parseGraphSXFrontMatter(`---
graphsx-libs:
  theme: |
    <Style id="box" fill="#eef6ff" />
---
# Notebook title
`);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.libraries.size, 1);
  assert.equal(parsed.libraries.get("theme").source, `<Style id="box" fill="#eef6ff" />`);
});

test("reports invalid GraphSX inside notebook front matter libraries", () => {
  const parsed = parseGraphSXFrontMatter(`---
graphsx-libs:
  theme: |
    <Style id="box" fill="#eef6ff" /> dk
---
`);

  assert.equal(parsed.ok, false);
  assert.equal(parsed.libraries.size, 0);
  assert.match(parsed.error.message, /Invalid GraphSX library "theme"/);
});

test("renders malformed GraphSX notebook front matter as a visible error", () => {
  const md = new MarkdownIt();
  installGraphSXFrontMatter(md);

  const html = md.render(`---
graphsx-libs:
  theme: |
    <Style id="box" fill="#eef6ff" /> dk
---
`);

  assert.match(html, /graphsx-frontmatter-error/);
  assert.match(html, /GraphSX front matter error/);
  assert.match(html, /Invalid GraphSX library &quot;theme&quot;/);
});
