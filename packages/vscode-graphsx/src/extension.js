import { graphsxMarkdownIt } from "../../../src/markdown.js";

export function extendMarkdownIt(md) {
  return md.use(graphsxMarkdownIt);
}

export function activate() {
  return { extendMarkdownIt };
}

export function deactivate() {}
