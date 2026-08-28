import { access, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import {
  getUnityStatus,
  listUnityProjects,
  openUnityProject,
  UnityRunner,
  type UnityCommandRunner,
  type UnityOpenProjectDetails,
  type UnityProject,
  type UnityStatusDetails,
} from "../../../../unity-tools/src/index";
import { revertPatch, type ProjectService } from "../contracts";

export interface ProjectWatchListeners {
  status: (status: UnityStatusDetails) => void;
}

export class UnityProjectService implements ProjectService {
  readonly #runner: UnityCommandRunner;
  readonly #watchIntervalMs: number;
  readonly #controllers = new Set<AbortController>();
  #projects?: UnityProject[];
  #watch?: { controller: AbortController; timer?: NodeJS.Timeout };

  constructor(
    runner: UnityCommandRunner = new UnityRunner(),
    watchIntervalMs = 1_000,
  ) {
    this.#runner = runner;
    this.#watchIntervalMs = watchIntervalMs;
  }

  async listProjects(): Promise<UnityProject[]> {
    return this.#run(async (signal) => {
      const result = await listUnityProjects(this.#runner, signal);
      if (!result.ok) {
        throw new Error(
          result.errors[0]?.message ?? "Could not list Unity projects",
        );
      }
      this.#projects = result.projects;
      return result.projects;
    });
  }

  async getStatus(projectPath: string): Promise<UnityStatusDetails> {
    await this.#requireProject(projectPath);
    return this.#run((signal) =>
      getUnityStatus(this.#runner, { projectPath, signal }),
    );
  }

  /**
   * Undoes one recorded edit. Refuses paths outside the project and patches
   * that no longer describe the file, so a stale change cannot corrupt work
   * done after it.
   */
  async revertFile(
    projectPath: string,
    file: string,
    patch: string,
  ): Promise<void> {
    await this.#requireProject(projectPath);
    const target = isAbsolute(file)
      ? resolve(file)
      : resolve(projectPath, file);
    const within = relative(resolve(projectPath), target);
    if (within.startsWith("..") || isAbsolute(within)) {
      throw new Error("That file is outside the selected project");
    }
    const content = await readFile(target, "utf8");
    await writeFile(target, revertPatch(content, patch), "utf8");
  }

  async openProject(projectPath: string): Promise<UnityOpenProjectDetails> {
    await this.#requireProject(projectPath);
    return this.#run((signal) =>
      openUnityProject(this.#runner, projectPath, signal),
    );
  }

  /**
   * Polls Editor status on one timer and reports only changes.
   */
  async watchStatus(
    projectPath: string,
    listeners: ProjectWatchListeners,
  ): Promise<UnityStatusDetails> {
    await this.#requireProject(projectPath);
    this.#stopWatching();
    const initial = await this.getStatus(projectPath);
    const controller = new AbortController();
    const watch: { controller: AbortController; timer?: NodeJS.Timeout } = {
      controller,
    };
    this.#watch = watch;
    let fingerprint = statusFingerprint(initial);

    const poll = async () => {
      if (controller.signal.aborted) return;
      try {
        const status = await getUnityStatus(this.#runner, {
          projectPath,
          signal: controller.signal,
        });
        const nextFingerprint = statusFingerprint(status);
        if (nextFingerprint !== fingerprint) {
          fingerprint = nextFingerprint;
          listeners.status(status);
        }
      } catch {
        // The next observation retries transient runner failures.
      } finally {
        if (!controller.signal.aborted) {
          watch.timer = setTimeout(poll, this.#watchIntervalMs);
          watch.timer.unref();
        }
      }
    };

    watch.timer = setTimeout(poll, this.#watchIntervalMs);
    watch.timer.unref();
    return initial;
  }

  dispose(): void {
    this.#stopWatching();
    for (const controller of this.#controllers) controller.abort();
    this.#controllers.clear();
  }

  #stopWatching(): void {
    if (!this.#watch) return;
    this.#watch.controller.abort();
    if (this.#watch.timer) clearTimeout(this.#watch.timer);
    this.#watch = undefined;
  }

  async #requireProject(projectPath: string): Promise<void> {
    try {
      const projects = this.#projects ?? (await this.listProjects());
      if (projects.some((project) => project.path === projectPath)) return;
    } catch {
      // A user-selected project does not have to be in the Hub registry.
    }
    try {
      await access(resolve(projectPath, "ProjectSettings"));
    } catch {
      throw new Error("The selected path is not a Unity project");
    }
  }

  async #run<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    this.#controllers.add(controller);
    try {
      return await operation(controller.signal);
    } finally {
      this.#controllers.delete(controller);
    }
  }
}

function statusFingerprint(status: UnityStatusDetails): string {
  return JSON.stringify({
    state: status.state,
    ok: status.ok,
    exitCode: status.exitCode,
    instances: status.instances,
    errors: status.errors,
    warnings: status.warnings,
    stderr: status.stderr,
  });
}
