import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";

export default function mattPocockSkills(pi: ExtensionAPI) {
  pi.on("resources_discover", () => ({
    skillPaths: [join(import.meta.dirname, "skills")],
  }));
}
