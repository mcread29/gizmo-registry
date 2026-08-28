import { unityDomainPlugin } from "./domain-plugin";
import { unityToolPresentation } from "./tool-presentation";
import { unityExtension } from "./console/console-extension.svelte";

/** Unity's single entry point into Gizmo's generic web extension contract. */
export const unityWebExtension = {
  id: "unity",
  dialog: unityDomainPlugin.dialog,
  settings: unityDomainPlugin.settings,
  createView: unityDomainPlugin.createView,
  commands: unityDomainPlugin.commands,
  hasProjectStatus: unityDomainPlugin.hasProjectStatus,
  apiVersion: unityExtension.apiVersion,
  activate: unityExtension.activate,
  labels: unityToolPresentation.labels,
  iconFor: unityToolPresentation.iconFor,
  consoleEntriesKey: unityToolPresentation.consoleEntriesKey,
  parametersFor: unityToolPresentation.parametersFor,
  resultFor: unityToolPresentation.resultFor,
  diagnosticsComponent: unityToolPresentation.diagnosticsComponent,
};
