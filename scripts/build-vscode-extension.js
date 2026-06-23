import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = path.join(rootDir, "packages", "vscode-graphsx");
const distDir = path.join(extensionDir, "dist");

await mkdir(distDir, { recursive: true });

await Promise.all([
  build({
    entryPoints: [path.join(extensionDir, "src", "extension.js")],
    outfile: path.join(distDir, "extension.cjs"),
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node18",
    external: ["vscode"],
    logLevel: "info"
  }),
  build({
    entryPoints: [path.join(extensionDir, "src", "preview.js")],
    outfile: path.join(distDir, "preview.js"),
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2020",
    logLevel: "info"
  }),
  build({
    entryPoints: [path.join(extensionDir, "src", "notebook-renderer.js")],
    outfile: path.join(distDir, "notebook-renderer.js"),
    bundle: true,
    platform: "browser",
    format: "esm",
    target: "es2020",
    logLevel: "info"
  }),
  build({
    entryPoints: [path.join(extensionDir, "src", "preview.css")],
    outfile: path.join(distDir, "preview.css"),
    bundle: true,
    loader: {
      ".ttf": "file",
      ".woff": "file",
      ".woff2": "file"
    },
    assetNames: "assets/[name]-[hash]",
    logLevel: "info"
  })
]);
