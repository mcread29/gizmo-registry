/**
 * Builds a Gizmo web extension into a single standalone ES module that the app
 * can load at runtime.
 *
 * The app's own bundle is produced by Vite, which resolves import specifiers by
 * static analysis at build time — so it can never see a plugin installed later.
 * The way around that is to build the plugin separately and load it through a
 * genuinely runtime `import()`, which the JS engine resolves itself.
 *
 * The one thing a plugin must not bundle is the Svelte runtime: two copies do
 * not share context or reactivity. Those specifiers are rewritten to read from
 * a global the host publishes (see `host-modules.ts`), rather than left
 * external and resolved through an import map — import-map support varies
 * across the webviews Tauri uses, a global does not.
 *
 * Usage: bun scripts/build-web-extension.ts <package-dir> [--out <file>]
 */
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { build, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const hostModulesKey = "__gizmoHostModules__";
const sharedSpecifiers = ["svelte", "svelte/internal/client"];

/**
 * Side-effect-only imports the Svelte compiler injects. They export nothing and
 * only register version metadata for devtools, so a plugin can drop them — the
 * host has already disclosed its own version.
 */
const inertSpecifiers = [
  "svelte/internal/disclose-version",
  "svelte/internal/flags/legacy",
  "svelte/internal/flags/async",
];

/**
 * Emits, for each shared specifier, a module re-exporting every name the host's
 * copy actually exports. The list is read from the installed package at build
 * time, so it tracks the Svelte version in use instead of a hand-kept list.
 */
function shareHostModules(): Plugin {
  const prefix = "\0gizmo-host:";
  return {
    name: "gizmo:share-host-modules",
    enforce: "pre",
    resolveId(source) {
      if (source.startsWith(prefix)) return source;
      if (inertSpecifiers.includes(source)) return prefix + source;
      return sharedSpecifiers.includes(source) ? prefix + source : null;
    },
    async load(id) {
      if (!id.startsWith(prefix)) return null;
      const specifier = id.slice(prefix.length);
      if (inertSpecifiers.includes(specifier)) return "export {};";
      const names = Object.keys(await import(specifier)).filter(
        (name) => name !== "default",
      );
      const access = `globalThis[${JSON.stringify(hostModulesKey)}][${JSON.stringify(specifier)}]`;
      // Svelte's internal client exports names that are reserved words
      // (`if`, `await`, `try`), so each binds to a safe local and is
      // renamed in a single export clause.
      const bindings = names.map((name, index) => ({
        name,
        local: `__gizmo_${index}`,
      }));
      return [
        `const host = ${access};`,
        `if (!host) throw new Error(${JSON.stringify(
          `Gizmo host module "${specifier}" is unavailable; the host must publish it before loading extensions.`,
        )});`,
        ...bindings.map(
          ({ name, local }) =>
            `const ${local} = host[${JSON.stringify(name)}];`,
        ),
        `export { ${bindings
          .map(({ name, local }) => `${local} as ${JSON.stringify(name)}`)
          .join(", ")} };`,
        "export default host;",
      ].join("\n");
    },
  };
}

export async function buildWebExtension(
  packageDir: string,
  outFile: string,
): Promise<string> {
  const root = resolve(packageDir);
  const result = await build({
    root,
    configFile: false,
    logLevel: "warn",
    plugins: [svelte({ configFile: false }), shareHostModules()],
    resolve: { conditions: ["browser"] },
    // Some browser-targeted dependencies still use the Node-style development
    // guard. Runtime extension modules execute directly in the webview, where
    // `process` does not exist, so replace it while bundling rather than
    // requiring the host to install a Node compatibility shim.
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      write: false,
      emptyOutDir: false,
      lib: {
        entry: join(root, "src/web/index.ts"),
        formats: ["es"],
        fileName: "web",
      },
      rollupOptions: { output: { codeSplitting: false } },
    },
  });
  const outputs = Array.isArray(result) ? result : [result];
  const entries = outputs.flatMap((bundle) =>
    "output" in bundle ? bundle.output : [],
  );
  const chunks = entries.filter((entry) => entry.type === "chunk");
  if (chunks.length !== 1) {
    throw new Error(
      `Expected one output chunk for ${packageDir}, got ${chunks.length}`,
    );
  }

  // Vite extracts component CSS into assets for library builds. Extensions are
  // installed as one runtime-imported JavaScript file, so leaving those assets
  // behind silently drops their styles. Install the emitted CSS once when the
  // module loads instead.
  const css = entries
    .flatMap((entry) => {
      if (entry.type !== "asset" || !entry.fileName.endsWith(".css")) return [];
      return [
        typeof entry.source === "string"
          ? entry.source
          : Buffer.from(entry.source).toString("utf8"),
      ];
    })
    .join("\n");
  const styleKey = basename(root);
  const styleSelector = `style[data-gizmo-extension-style=${JSON.stringify(styleKey)}]`;
  const installStyles = css
    ? [
        `const __gizmoStyleSelector = ${JSON.stringify(styleSelector)};`,
        `if (typeof document !== "undefined") {`,
        `  const style = document.querySelector(__gizmoStyleSelector) ?? document.createElement("style");`,
        `  style.dataset.gizmoExtensionStyle = ${JSON.stringify(styleKey)};`,
        `  style.textContent = ${JSON.stringify(css)};`,
        `  if (!style.isConnected) document.head.append(style);`,
        `}`,
      ].join("\n")
    : "";

  const target = resolve(outFile);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${installStyles}\n${chunks[0]!.code}`, "utf8");
  return target;
}

if (import.meta.main) {
  const [packageDir, ...rest] = process.argv.slice(2);
  if (!packageDir) {
    console.error(
      "Usage: bun scripts/build-web-extension.ts <package-dir> [--out <file>]",
    );
    process.exit(1);
  }
  const outIndex = rest.indexOf("--out");
  const outFile =
    outIndex >= 0 ? rest[outIndex + 1]! : join(packageDir, "dist/web.js");
  console.log(await buildWebExtension(packageDir, outFile));
}
