import * as vscode from "vscode";
import { graphsxMarkdownIt } from "../../../src/markdown.js";
import { parseGraphSXFrontMatter } from "./frontmatter.js";

const GRAPHSX_NOTEBOOK_LIBRARIES = "graphsxLibraries";
const GRAPHSX_NOTEBOOK_LIBRARY_VERSION = "graphsxLibrariesVersion";
const syncTimers = new Map();

export function extendMarkdownIt(md) {
  return md.use(graphsxMarkdownIt);
}

export function activate(context) {
  context?.subscriptions.push(
    vscode.workspace.onDidChangeNotebookDocument((event) => {
      queueNotebookLibrarySync(event.notebook);
    }),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const notebook = notebookForDocument(event.document);
      if (notebook) {
        queueNotebookLibrarySync(notebook);
      }
    })
  );
  if (vscode.workspace.onDidOpenNotebookDocument) {
    context?.subscriptions.push(
      vscode.workspace.onDidOpenNotebookDocument((notebook) => {
        queueNotebookLibrarySync(notebook);
      })
    );
  }
  if (vscode.window.activeNotebookEditor) {
    queueNotebookLibrarySync(vscode.window.activeNotebookEditor.notebook);
  }

  return { extendMarkdownIt };
}

export function deactivate() {}

function notebookForDocument(document) {
  if (!document) {
    return null;
  }
  for (const notebook of vscode.workspace.notebookDocuments ?? []) {
    if (notebook.notebookType !== "jupyter-notebook") {
      continue;
    }
    const match = notebook.getCells().some((cell) => cell.document === document);
    if (match) {
      return notebook;
    }
  }
  return null;
}

function queueNotebookLibrarySync(notebook) {
  if (!notebook || notebook.notebookType !== "jupyter-notebook") {
    return;
  }
  const key = notebook.uri.toString();
  clearTimeout(syncTimers.get(key));
  syncTimers.set(key, setTimeout(() => {
    syncTimers.delete(key);
    syncNotebookLibraries(notebook);
  }, 120));
}

async function syncNotebookLibraries(notebook) {
  const cells = notebook.getCells();
  const firstMarkdown = cells.find((cell) => cell.kind === vscode.NotebookCellKind.Markup);
  if (!firstMarkdown) {
    return;
  }

  const parsed = parseGraphSXFrontMatter(firstMarkdown.document.getText());
  if (!parsed.ok) {
    return;
  }

  const libraries = librariesToMetadata(parsed.libraries);
  const version = JSON.stringify(libraries);
  const edits = [];

  cells.forEach((cell, index) => {
    if (cell.kind !== vscode.NotebookCellKind.Markup) {
      return;
    }
    if (!isGraphSXMarkdownCell(cell)) {
      return;
    }

    const nextMetadata = nextGraphSXMetadata(cell.metadata, libraries, version);
    if (JSON.stringify(nextMetadata) !== JSON.stringify(cell.metadata)) {
      edits.push(vscode.NotebookEdit.updateCellMetadata(index, nextMetadata));
    }
  });

  if (edits.length > 0) {
    const workspaceEdit = new vscode.WorkspaceEdit();
    workspaceEdit.set(notebook.uri, edits);
    await vscode.workspace.applyEdit(workspaceEdit);
  }
}

function isGraphSXMarkdownCell(cell) {
  const text = cell.document.getText();
  return /```(?:graphsx|graphsx-defs)\b/.test(text) || /^---\s*\r?\ngraphsx-libs:/m.test(text);
}

function librariesToMetadata(libraries) {
  return Object.fromEntries([...libraries].map(([name, library]) => [name, library.source]));
}

function nextGraphSXMetadata(metadata, libraries, version) {
  const next = { ...metadata };
  if (Object.keys(libraries).length === 0) {
    delete next[GRAPHSX_NOTEBOOK_LIBRARIES];
    delete next[GRAPHSX_NOTEBOOK_LIBRARY_VERSION];
    return next;
  }
  next[GRAPHSX_NOTEBOOK_LIBRARIES] = libraries;
  next[GRAPHSX_NOTEBOOK_LIBRARY_VERSION] = version;
  return next;
}
