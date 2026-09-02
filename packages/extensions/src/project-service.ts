/**
 * Status of the external tool a project extension runs. Opaque to Gizmo
 * core: the extension owns the payload's shape, validation, and errors, and
 * consumers on the wire validate whichever extension's data they render.
 */
export type ProjectStatus = unknown;

export interface ProjectWatchListeners {
  status: (status: ProjectStatus) => void;
}

/**
 * An extension's runtime project operations (status/watch/open/revert).
 * Gizmo core registers one of these per extension id and routes every
 * request to the owning extension's service; it never interprets payloads.
 */
export interface ProjectService {
  getStatus(projectPath: string): Promise<ProjectStatus>;
  watchStatus(
    projectPath: string,
    listeners: ProjectWatchListeners,
  ): Promise<ProjectStatus>;
  openProject(projectPath: string): Promise<unknown>;
  revertFile(projectPath: string, file: string, patch: string): Promise<void>;
  dispose(): void;
}

/**
 * Holds one ProjectService per extension id. Requests name the extension
 * they belong to and are routed directly; there is no fallback order and no
 * implicit "first service wins" routing.
 */
export class ProjectServiceRegistry {
  readonly #services: ReadonlyMap<string, ProjectService>;

  constructor(entries: Iterable<readonly [string, ProjectService]>) {
    this.#services = new Map(entries);
  }

  get ids(): readonly string[] {
    return [...this.#services.keys()];
  }

  /** Registration order preserved; used only by v25 compatibility routing. */
  get entries(): readonly (readonly [string, ProjectService])[] {
    return [...this.#services.entries()];
  }

  serviceFor(extensionId: string): ProjectService | undefined {
    return this.#services.get(extensionId);
  }

  dispose(): void {
    for (const service of this.#services.values()) {
      try {
        service.dispose();
      } catch {
        // One service failing to dispose must not prevent the rest.
      }
    }
  }
}
