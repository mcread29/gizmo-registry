export class UnityCompilationTracker {
  readonly #paths = new Set<string>();

  mark(path: string): readonly string[] {
    this.#paths.add(path);
    return this.paths;
  }

  clear(): void {
    this.#paths.clear();
  }

  get paths(): readonly string[] {
    return [...this.#paths].sort();
  }
}

export function affectsUnityCompilation(path: string): boolean {
  const normalized = path.replace(/\\/g, "/").toLowerCase();
  return (
    /\.(cs|asmdef|asmref|rsp)$/.test(normalized) ||
    normalized.endsWith("/packages/manifest.json") ||
    normalized === "packages/manifest.json"
  );
}
