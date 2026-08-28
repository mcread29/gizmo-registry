import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { buildWebExtension } from "./build-web-extension.ts";

const extensionsDir = join(import.meta.dirname, "..", "extensions");
const entries = await readdir(extensionsDir, { withFileTypes: true });

for (const entry of entries) {
  if (!entry.isDirectory()) continue;
  const extensionDir = join(extensionsDir, entry.name);
  const webEntry = join(extensionDir, "src", "web", "index.ts");
  try {
    await access(webEntry);
  } catch {
    continue;
  }
  console.log(
    await buildWebExtension(
      extensionDir,
      join(extensionsDir, `${entry.name}.web.js`),
    ),
  );
}
