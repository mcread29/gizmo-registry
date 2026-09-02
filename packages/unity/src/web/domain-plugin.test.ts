import { describe, expect, it, vi } from "vitest";
import {
  openUnityEditor,
  unityDomainPlugin,
  unityStatusFrom,
  type UnityDomainStore,
} from "./domain-plugin";

function store(overrides: Partial<UnityDomainStore> = {}): UnityDomainStore {
  return {
    messages: [],
    projects: [{ title: "game", path: "/projects/game" }],
    activeDomains: ["unity"],
    selectedProjectPath: "/projects/game",
    projectStatuses: {},
    projectServiceErrors: {},
    projectsLoading: false,
    openProjectService: vi.fn(async () => ({})),
    refreshProjectStatus: vi.fn(),
    ...overrides,
  };
}

/** A Unity-shaped status payload; only this extension interprets it. */
const unityStatusPayload = {
  state: "connected",
  ok: true,
  command: ["unity", "status"],
  exitCode: 0,
  durationMs: 1,
  instances: [{ projectPath: "/projects/game" }],
  errors: [],
  warnings: [],
};

describe("unityDomainPlugin", () => {
  it("contributes Unity as a peer inspector tab without owning the workspace", () => {
    const [tab] = unityDomainPlugin.inspectorTabs({ store: store() });

    expect(unityDomainPlugin).not.toHaveProperty("createView");
    expect(tab).toMatchObject({ id: "unity", label: "Unity" });
    expect(tab?.props.view.projectPath).toBe("/projects/game");
  });

  it("validates its opaque status payload with Unity's own schema", () => {
    const parsed = unityStatusFrom(
      store({ projectStatuses: { unity: unityStatusPayload } }),
    );
    expect(parsed?.state).toBe("connected");
    expect(parsed?.instances[0]?.projectPath).toBe("/projects/game");

    expect(unityStatusFrom(store())).toBeUndefined();
    // A payload that does not match Unity's schema is not interpreted.
    expect(
      unityStatusFrom(store({ projectStatuses: { unity: { nope: true } } })),
    ).toBeUndefined();
  });

  it("offers the open-editor command while no Editor instance is connected", () => {
    const commands = unityDomainPlugin.commands({
      store: store({ projectStatuses: { unity: unityStatusPayload } }),
    });
    expect(commands.map(({ id }) => id)).not.toContain("unity.open-editor");
  });

  it("reports open failures against the unity extension id", async () => {
    const target = store({
      openProjectService: vi.fn(async () => ({
        state: "error",
        ok: false,
        command: ["unity", "open", "/projects/game"],
        exitCode: 1,
        durationMs: 1,
        data: null,
        errors: [{ code: "UNITY_CLI", message: "Editor exited with code 1" }],
        warnings: [],
      })),
    });

    await openUnityEditor(target);

    expect(target.projectServiceErrors.unity).toBe("Editor exited with code 1");
    expect(target.refreshProjectStatus).not.toHaveBeenCalled();
  });

  it("clears the service error and refreshes status after a successful open", async () => {
    const target = store({
      projectServiceErrors: { unity: "Editor exited with code 1" },
      openProjectService: vi.fn(async () => ({
        state: "opened",
        ok: true,
        command: ["unity", "open", "/projects/game"],
        exitCode: 0,
        durationMs: 1,
        data: null,
        errors: [],
        warnings: [],
      })),
    });

    await openUnityEditor(target);

    expect(target.projectServiceErrors.unity).toBeUndefined();
    expect(target.refreshProjectStatus).toHaveBeenCalledOnce();
  });
});
