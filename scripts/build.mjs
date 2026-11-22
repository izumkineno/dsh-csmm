import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(root, "dist");

await mkdir(dist, { recursive: true });

await build({
  entryPoints: [join(root, "src/host/index.ts")],
  outfile: join(dist, "index.js"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "info",
});

const client = await build({
  entryPoints: [join(root, "src/client/index.tsx")],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  external: ["react", "react/jsx-runtime", "react-dom"],
  logLevel: "info",
});

const body = client.outputFiles[0].text.trimEnd();
const wrapped = `(function () {
  var host = typeof window !== "undefined" ? window : globalThis;
  if (!host.__ModuleLoader__) {
    throw new Error("dsh-csmm: window.__ModuleLoader__ is missing");
  }
  host.__ModuleLoader__.load({
    id: "dsh-csmm",
    factory: function (require) {
      var module = { exports: {} };
      var exports = module.exports;
${body}
      return module.exports;
    }
  });
})();
`;

await writeFile(join(dist, "client.js"), wrapped);
console.log("built dist/index.js and dist/client.js");
