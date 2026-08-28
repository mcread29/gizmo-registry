import { FolderOpen, RefreshCw } from "@lucide/svelte";
import type { Component } from "svelte";
import type { ConversationMessage, StoredProject, UnityStatus } from "./types";
import UnityDomainDialog from "./UnityDomainDialog.svelte";
import UnityDomainSettings from "./UnityDomainSettings.svelte";
import UnityPanel from "./unity/UnityPanel.svelte";
import { createUnityView } from "./unity/unity-view";

export interface UnityDomainStore {
  messages: ConversationMessage[];
  projects: StoredProject[];
  activeDomains: string[];
  selectedProjectPath?: string;
  projectStatus?: UnityStatus;
  projectsLoading: boolean;
  openSelectedProject(): void;
  refreshProjectStatus(): void;
}

export interface UnityCommand {
  id: string;
  label: string;
  keywords?: string[];
  icon?: Component;
  run(): void;
}

/** Unity's contribution to Gizmo's generic workspace-view/domain-plugin contract. */
export const unityDomainPlugin = {
  id: "unity",
  dialog: UnityDomainDialog,
  settings: UnityDomainSettings,
  hasProjectStatus: true,
  createView(store: UnityDomainStore) {
    const view = createUnityView({
      messages: store.messages,
      projects: store.projects,
      selectedProjectPath: store.selectedProjectPath,
      projectStatus: store.projectStatus,
      projectsLoading: store.projectsLoading,
    });
    return {
      domainId: "unity",
      workspacePath: view.projectPath,
      workspaceName: view.projectName,
      subtitle: view.version ? `Unity ${view.version}` : view.state,
      state: view.status?.state,
      toolActivity: view.toolActivity,
      canOpen: Boolean(view.selectedProject && !view.editor),
      open: () => store.openSelectedProject(),
      refresh: () => store.refreshProjectStatus(),
      pill: view.lifecycle,
      panel: {
        id: "unity",
        label: "Unity",
        component: UnityPanel,
        props: {
          view,
          store,
          onOpenProject: () => store.openSelectedProject(),
        },
      },
    };
  },
  commands(context: { store: UnityDomainStore }): UnityCommand[] {
    const { store } = context;
    if (!store.activeDomains.includes("unity") || !store.selectedProjectPath) {
      return [];
    }
    const editorConnected = Boolean(store.projectStatus?.instances[0]);
    return [
      ...(editorConnected
        ? []
        : [
            {
              id: "unity.open-editor",
              label: "Open Unity Editor",
              icon: FolderOpen,
              run: () => store.openSelectedProject(),
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
