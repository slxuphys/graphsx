import { parseGraph, parseMarkup } from "../../../src/parser.js";

const FRONT_MATTER_TOKEN = "graphsxFrontMatter";

export function installGraphSXFrontMatter(md) {
  md.block.ruler.before("hr", FRONT_MATTER_TOKEN, (state, startLine, endLine, silent) => {
    if (startLine !== 0 || lineText(state, startLine).trim() !== "---") {
      return false;
    }

    let closeLine = -1;
    for (let line = startLine + 1; line < endLine; line += 1) {
      if (lineText(state, line).trim() === "---") {
        closeLine = line;
        break;
      }
    }
    if (closeLine < 0) {
      return false;
    }

    const source = state.getLines(startLine + 1, closeLine, 0, false);
    const parsed = parseGraphSXFrontMatter(source);
    if (parsed.libraries.size === 0 && (!parsed.error || !hasGraphSXFrontMatter(source))) {
      return false;
    }
    if (silent) {
      return true;
    }

    const token = state.push(FRONT_MATTER_TOKEN, "div", 0);
    token.block = true;
    token.meta = parsed.ok
      ? { libraries: parsed.libraries, error: null }
      : { libraries: new Map(), error: parsed.error };
    state.line = closeLine + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote"] });

  md.renderer.rules[FRONT_MATTER_TOKEN] = (tokens, index) => {
    const error = tokens[index].meta?.error;
    if (error) {
      return `<div class="graphsx-error graphsx-frontmatter-error"><strong>GraphSX front matter error:</strong> ${md.utils.escapeHtml(error.message)}</div>\n`;
    }

    const libraries = tokens[index].meta?.libraries ?? new Map();
    return [...libraries].map(([name, library]) => {
      const escapedName = md.utils.escapeHtml(name);
      const escapedSource = md.utils.escapeHtml(library.source);
      return `<div class="graphsx-defs graphsx-notebook-defs" data-graphsx-defs="${escapedName}" hidden><template class="graphsx-source">${escapedSource}</template></div>\n`;
    }).join("");
  };
}

export function parseGraphSXFrontMatterLibraries(source) {
  return parseGraphSXFrontMatter(source).libraries;
}

export function parseGraphSXFrontMatter(source) {
  try {
    return {
      ok: true,
      libraries: parseGraphSXFrontMatterLibrariesStrict(frontMatterBody(source)),
      error: null
    };
  } catch (error) {
    return {
      ok: false,
      libraries: new Map(),
      error
    };
  }
}

function frontMatterBody(source) {
  const text = String(source).replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") {
    return text;
  }

  const closeIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  if (closeIndex < 0) {
    throw new Error("Unclosed GraphSX front matter");
  }
  return lines.slice(1, closeIndex).join("\n");
}

function parseGraphSXFrontMatterLibrariesStrict(source) {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const libraries = new Map();
  const sectionIndex = lines.findIndex((line) => line.trim() === "graphsx-libs:");
  if (sectionIndex < 0) {
    return libraries;
  }

  for (let index = sectionIndex + 1; index < lines.length;) {
    if (!lines[index].trim()) {
      index += 1;
      continue;
    }

    const header = lines[index].match(/^  ([A-Za-z][A-Za-z0-9_.-]*):\s*\|\s*$/);
    if (!header) {
      throw new Error(`Invalid GraphSX front matter library header: ${lines[index]}`);
    }

    const name = header[1];
    index += 1;
    const body = [];
    while (index < lines.length) {
      const line = lines[index];
      if (/^  [A-Za-z][A-Za-z0-9_.-]*:\s*\|\s*$/.test(line)) {
        break;
      }
      if (line.trim() && !line.startsWith("    ")) {
        throw new Error(`Invalid GraphSX front matter library body line: ${line}`);
      }
      body.push(line.startsWith("    ") ? line.slice(4) : "");
      index += 1;
    }

    const librarySource = body.join("\n").replace(/\n+$/, "");
    validateGraphSXLibrary(name, librarySource);
    libraries.set(name, {
      name,
      source: librarySource
    });
  }

  return libraries;
}

function validateGraphSXLibrary(name, source) {
  try {
    const nodes = parseMarkup(source);
    const strayText = nodes.find((node) => node.type === "text" && node.value.trim());
    if (strayText) {
      throw new Error(`Unexpected text "${strayText.value.trim()}"`);
    }
    parseGraph(`<Graph>${source}</Graph>`);
  } catch (error) {
    throw new Error(`Invalid GraphSX library "${name}": ${error.message}`);
  }
}

function hasGraphSXFrontMatter(source) {
  return String(source).replace(/\r\n?/g, "\n").split("\n").some((line) => line.trim() === "graphsx-libs:");
}

function lineText(state, line) {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
}
