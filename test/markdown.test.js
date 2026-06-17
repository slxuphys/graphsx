import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { GRAPHSX_DEFS_FENCE, GRAPHSX_FENCE, graphsxMarkdownIt, parseFenceInfo, parseGraphWithLibraries } from "../src/index.js";

test("renders graphsx fences as upgradeable placeholders", () => {
  const md = new MarkdownIt().use(graphsxMarkdownIt);
  const html = md.render(`
\`\`\`graphsx
<Graph>
  <Rect id="A" />
</Graph>
\`\`\`
`);

  assert.equal(GRAPHSX_FENCE, "graphsx");
  assert.match(html, /class="graphsx-block"/);
  assert.match(html, /data-graphsx="true"/);
  assert.match(html, /<template class="graphsx-source">/);
  assert.match(html, /&lt;Graph&gt;/);
});

test("leaves non-graphsx fences to markdown-it", () => {
  const md = new MarkdownIt().use(graphsxMarkdownIt);
  const html = md.render(`
\`\`\`js
console.log("ok")
\`\`\`
`);

  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /console\.log/);
  assert.doesNotMatch(html, /graphsx-block/);
});

test("renders graphsx definition fences as hidden libraries", () => {
  const md = new MarkdownIt().use(graphsxMarkdownIt);
  const html = md.render(`
\`\`\`graphsx-defs mps
<Style id="wire" stroke="#111" />
\`\`\`

\`\`\`graphsx use="mps"
<Graph />
\`\`\`
`);

  assert.equal(GRAPHSX_DEFS_FENCE, "graphsx-defs");
  assert.match(html, /class="graphsx-defs"/);
  assert.match(html, /data-graphsx-defs="mps"/);
  assert.match(html, /hidden/);
  assert.match(html, /data-graphsx-use="mps"/);
});

test("parses quoted fence info values", () => {
  assert.deepEqual(parseFenceInfo(`graphsx use="colors mps"`), {
    name: "graphsx",
    args: [],
    attrs: { use: "colors mps" }
  });
});

test("parses graph fences with multiple libraries", () => {
  const libraries = new Map([
    ["colors", { name: "colors", source: `<Style id="box" fill="#eef" stroke="#111" />` }],
    ["mps", { name: "mps", source: `<Shape id="Tensor" groupBox={false}>
  <Rect id="box" at={[0, 0]} size={[56, 56]} useStyle="box" />
  <Port id="left" target="box.left" />
  <Port id="right" target="box.right" />
</Shape>` }]
  ]);

  const graph = parseGraphWithLibraries(`<Graph>
  <Tensor id="A0" at={[0, 0]} />
  <Tensor id="A1" at={[100, 0]} />
  <Link from="A0.right" to="A1.left" />
</Graph>`, libraries, "colors mps");

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.nodes[0].children[0].attrs.style.fill, "#eef");
});

test("allows braced comments in graphsx definition libraries", () => {
  const libraries = new Map([
    ["shapes", { name: "shapes", source: `{comment}
<Shape id="Tile" groupBox={false}>
  <Rect id="box" />
  <Port id="out" target="box.right" />
</Shape>` }]
  ]);

  const graph = parseGraphWithLibraries(`<Graph>
  <Tile id="T" />
</Graph>`, libraries, "shapes");

  assert.equal(graph.nodes[0].children[0].id, "T.box");
});
