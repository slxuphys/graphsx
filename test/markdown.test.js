import assert from "node:assert/strict";
import { test } from "node:test";
import MarkdownIt from "markdown-it";
import { GRAPHSX_FENCE, graphsxMarkdownIt } from "../src/index.js";

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
