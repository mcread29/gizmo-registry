import { FolderOpen, RefreshCw } from "@lucide/svelte";
import type { Component } from "svelte";
import type { ConversationMessage, StoredProject, UnityStatus } from "./types";
import { parseUnityOpenProjectResult, parseUnityStatus } from "./unity-wire";
import UnityDomainDialog from "./UnityDomainDialog.svelte";
import UnityDomainSettings from "./UnityDomainSettings.svelte";
import UnityPanel from "./unity/UnityPanel.svelte";
import { createUnityView } from "./unity/unity-view";

export interface UnityDomainStore {
  messages: ConversationMessage[];
  projects: StoredProject[];
  activeDomains: string[];
  selectedProjectPath?: string;
  /** Opaque project-service status payloads, keyed by extension id. */
  projectStatuses: Record<string, unknown>;
  /** Per-extension project-service error messages, keyed by extension id. */
  projectServiceErrors: Record<string, string>;
  projectsLoading: boolean;
  openProjectService(extensionId: string): Promise<unknown>;
  refreshProjectStatus(): void;
}

export interface UnityCommand {
  id: string;
  label: string;
  keywords?: string[];
  icon?: Component;
  run(): void;
}

/**
 * Validates this extension's opaque status payload with Unity's own schema.
 * An absent or malformed payload simply reads as "not checked" — the core
 * never interprets the data, so there is nothing to fall back to here.
 */
export function unityStatusFrom(
  store: UnityDomainStore,
): UnityStatus | undefined {
  const raw = store.projectStatuses.unity;
  if (raw === undefined || raw === null) return undefined;
  try {
    return parseUnityStatus(raw);
  } catch {
    return undefined;
  }
}

/**
 * Unity owns the open flow and its errors: the shell hands back the raw
 * project-service result, Unity validates it and reports failures against
 * its own extension id.
 */
export async function openUnityEditor(store: UnityDomainStore): Promise<void> {
  const setError = (message: string) => {
    store.projectServiceErrors = {
      ...store.projectServiceErrors,
      unity: message,
    };
  };
  try {
    const result = parseUnityOpenProjectResult(
      await store.openProjectService("unity"),
    );
    if (!result.ok || result.state === "error") {
      setError(
        result.errors[0]?.message ??
          result.stderr ??
          "Unity Editor could not be opened.",
      );
      return;
    }
    const errors = { ...store.projectServiceErrors };
    delete errors.unity;
    store.projectServiceErrors = errors;
    store.refreshProjectStatus();
  } catch (error) {
    setError(error instanceof Error ? error.message : String(error));
  }
}

/** Unity's contribution to Gizmo's generic workspace-view/domain-plugin contract. */
export const unityDomainPlugin = {
  id: "unity",
  dialog: UnityDomainDialog,
  settings: UnityDomainSettings,
  hasProjectStatus: true,
  inspectorTabs(context: { store: UnityDomainStore }) {
    const { store } = context;
    const view = createUnityView({
      messages: store.messages,
      projects: store.projects,
      selectedProjectPath: store.selectedProjectPath,
      projectStatus: unityStatusFrom(store),
      projectsLoading: store.projectsLoading,
    });
    return [
      {
        id: "unity",
        label: "Unity",
        badge: view.lifecycle.errors.length || undefined,
        badgeTone: "danger" as const,
        component: UnityPanel,
        props: {
          view,
          store,
          onOpenProject: () => void openUnityEditor(store),
        },
      },
    ];
  },
  commands(context: { store: UnityDomainStore }): UnityCommand[] {
    const { store } = context;
    if (!store.activeDomains.includes("unity") || !store.selectedProjectPath) {
      return [];
    }
    const editorConnected = Boolean(unityStatusFrom(store)?.instances[0]);
    return [
      ...(editorConnected
        ? []
        : [
            {
              id: "unity.open-editor",
              label: "Open Unity Editor",
              icon: FolderOpen,
              run: () => void openUnityEditor(store),
            },
          ]),
      {
        id: "unity.refresh-status",
        label: "Refresh Unity project status",
        icon: RefreshCw,
        run: () => store.refreshProjectStatus(),
      },
    ];
  },
};
