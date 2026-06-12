import assert from "node:assert/strict";
import { test } from "node:test";
import { findGraphSXFences } from "../src/index.js";

test("finds GraphSX markdown fences for CodeMirror live preview", () => {
  const blocks = findGraphSXFences(`# Note

\`\`\`graphsx-defs theme
<Style id="wire" />
\`\`\`

\`\`\`js
console.log("plain code");
\`\`\`

\`\`\`graphsx use="theme"
<Graph />
\`\`\`
`);

  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].info.name, "graphsx-defs");
  assert.equal(blocks[0].info.args[0], "theme");
  assert.equal(blocks[1].info.name, "graphsx");
  assert.equal(blocks[1].info.attrs.use, "theme");
  assert.match(blocks[1].source, /<Graph \/>/);
});
