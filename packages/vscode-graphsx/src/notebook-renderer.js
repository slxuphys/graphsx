import katex from "katex";
import { graphsxMarkdownIt, renderGraphSXBlocks } from "../../../src/markdown.js";
import { installGraphSXFrontMatter } from "./frontmatter.js";

export async function activate(context) {
  const markdownItRenderer = await context.getRenderer("vscode.markdown-it-renderer");
  if (!markdownItRenderer) {
    throw new Error("Could not load vscode.markdown-it-renderer");
  }

  markdownItRenderer.extendMarkdownIt((md) => {
    installGraphSXFrontMatter(md);
    md.use(graphsxMarkdownIt);

    const render = md.renderer.render;
    md.renderer.render = function renderWithGraphSX(tokens, options, env) {
      const html = render.call(this, tokens, options, env);
      const temp = document.createElement("div");
      temp.innerHTML = html;
      renderGraphSXBlocks(temp, {
        libraries: readMetadataLibraries(env),
        katex,
        document
      });
      return temp.innerHTML;
    };

    return md;
  });
}

function readMetadataLibraries(env) {
  const metadata = env?.metadata ?? env?.cell?.metadata ?? env?.outputItem?.metadata ?? {};
  const rawLibraries = metadata.graphsxLibraries;
  if (!rawLibraries || typeof rawLibraries !== "object") {
    return {};
  }
  return rawLibraries;
}
