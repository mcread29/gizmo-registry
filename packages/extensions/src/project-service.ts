/** Status of the external tool a project extension runs, in whatever terms that tool uses. */
export interface ProjectStatus {
  state: string;
  ok: boolean;
  command: readonly string[];
  exitCode: number | null;
  durationMs: number;
  instances: readonly unknown[];
  errors: readonly unknown[];
  warnings: readonly unknown[];
  stderr?: string;
}

export interface ProjectWatchListeners {
  status: (status: ProjectStatus) => void;
}

/**
 * An extension's runtime project (open/status/watch/revert). Gizmo core only
 * ever holds one of these behind the interface; it never knows which
 * extension it is.
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
 * Fans project operations out to every extension that provides a
 * ProjectService, trying each until one handles the path. Keeps
 * `server.ts` from hardcoding "first extension wins" — a second
 * runtime extension (e.g. a future non-Unity one) is reachable
 * without editing core.
 */
export class CompositeProjectService implements ProjectService {
  readonly #services: readonly ProjectService[];

  constructor(services: readonly ProjectService[]) {
    this.#services = services;
  }

  async getStatus(projectPath: string): Promise<ProjectStatus> {
    return this.#first((service) => service.getStatus(projectPath));
  }

  async watchStatus(
    projectPath: string,
    listeners: ProjectWatchListeners,
  ): Promise<ProjectStatus> {
    return this.#first((service) =>
      service.watchStatus(projectPath, listeners),
    );
  }

  async openProject(projectPath: string): Promise<unknown> {
    return this.#first((service) => service.openProject(projectPath));
  }

  async revertFile(
    projectPath: string,
    file: string,
    patch: string,
  ): Promise<void> {
    return this.#first((service) =>
      service.revertFile(projectPath, file, patch),
    );
  }

  dispose(): void {
    for (const service of this.#services) {
      try {
        service.dispose();
      } catch {
        // One service failing to dispose must not prevent the rest.
      }
    }
  }

  async #first<T>(call: (service: ProjectService) => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (const service of this.#services) {
      try {
        return await call(service);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError ?? new Error("No project service is configured");
  }
}
