import { describe, expect, it } from "vitest";
import {
  agentToolPolicy,
  parseAgentModelCatalog,
  parseAgentEvent,
  parseAgentRequest,
  parseResourceCatalog,
  parseAgentResponse,
  parseSessionCatalog,
  parseSessionSnapshot,
  parseStoredProjects,
  protocolVersion,
  ProtocolValidationError,
  sessionTitle,
} from "./index";

describe("agent protocol validation", () => {
  it("normalizes generated session titles consistently", () => {
    expect(sessionTitle("  Inspect the active scene  ")).toBe(
      "Inspect the active scene",
    );
    expect(sessionTitle("")).toBe("New session");
    expect(sessionTitle("x".repeat(49))).toBe(`${"x".repeat(47)}…`);
  });

  it("defines the harness-owned full-access tool boundary", () => {
    expect(agentToolPolicy).toEqual({
      tools: ["read", "edit", "write", "git_status"],
      approvals: false,
      extensions: false,
    });
    expect(agentToolPolicy.tools).not.toContain("bash");
  });

  it("accepts a valid prompt request", () => {
    const request = parseAgentRequest({
      protocolVersion,
      requestId: "request-1",
      type: "session.prompt",
      sessionId: "session-1",
      text: "Inspect the active scene",
    });

    expect(request.type).toBe("session.prompt");
  });

  it("validates Pi extension UI requests and responses", () => {
    expect(
      parseAgentEvent({
        protocolVersion,
        eventId: 1,
        sessionId: "session-1",
        type: "extension.ui.requested",
        runtimeId: "runtime-1",
        uiRequestId: "ui-1",
        request: {
          method: "select",
          title: "Environment",
          options: ["dev", "prod"],
        },
      }),
    ).toMatchObject({ type: "extension.ui.requested" });

    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "respond-1",
        type: "extension.ui.respond",
        sessionId: "session-1",
        runtimeId: "runtime-1",
        uiRequestId: "ui-1",
        response: { kind: "value", value: "prod" },
      }),
    ).toMatchObject({ type: "extension.ui.respond" });
  });

  it("accepts opaque extension operations through the generic project boundary", () => {
    const request = parseAgentRequest({
      protocolVersion,
      requestId: "request-extension",
      type: "project.extension.invoke",
      projectPath: "/projects/game",
      extensionId: "com.gizmo.extras.console",
      operation: "snapshot",
      input: { tail: 20 },
    });

    expect(request.type).toBe("project.extension.invoke");
  });

  it("validates stored projects with their selected integrations", () => {
    expect(
      parseStoredProjects([
        {
          title: "Game",
          path: "/projects/game",
          integrations: [{ id: "unity", root: "." }],
          addedAt: 1,
        },
      ]),
    ).toHaveLength(1);
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "detect-1",
        type: "project.detect",
        projectPath: "/projects/game",
      }),
    ).toMatchObject({ type: "project.detect" });
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "browse-1",
        type: "project.browse",
        path: "/projects",
      }),
    ).toMatchObject({ type: "project.browse", path: "/projects" });
  });

  it("accepts base64 file attachments on prompts", () => {
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-attachment",
        type: "session.prompt",
        sessionId: "session-1",
        text: "Inspect this",
        attachments: [
          {
            name: "reference.png",
            mimeType: "image/png",
            data: "aGVsbG8=",
          },
        ],
      }),
    ).toMatchObject({ type: "session.prompt" });
  });

  it("accepts session-scoped attachment operations", () => {
    for (const type of ["attachment.read", "attachment.reveal"] as const) {
      expect(
        parseAgentRequest({
          protocolVersion,
          requestId: `request-${type}`,
          type,
          sessionId: "session-1",
          attachmentId: "attachment-1",
        }),
      ).toMatchObject({ type, attachmentId: "attachment-1" });
    }
  });

  it("validates compaction policies", () => {
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-compact",
        type: "session.compact",
        sessionId: "session-1",
        compaction: {
          enabled: true,
          fillPercent: 25,
          retainPercent: 10,
        },
      }),
    ).toMatchObject({ type: "session.compact" });
    expect(() =>
      parseAgentRequest({
        protocolVersion,
        requestId: "request-compact-invalid",
        type: "session.compact",
        sessionId: "session-1",
        compaction: {
          enabled: true,
          fillPercent: 5,
          retainPercent: 0,
        },
      }),
    ).toThrow(ProtocolValidationError);
  });

  it("validates project status subscriptions and change events", () => {
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-watch",
        type: "project.watch",
        sessionId: "session-1",
        projectPath: "/projects/game",
        extensionId: "unity",
      }),
    ).toMatchObject({ type: "project.watch", extensionId: "unity" });
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-status",
        type: "project.status",
        projectPath: "/projects/game",
        extensionId: "unity",
      }),
    ).toMatchObject({ type: "project.status", extensionId: "unity" });
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-open",
        type: "project.open",
        projectPath: "/projects/game",
        extensionId: "unity",
      }),
    ).toMatchObject({ type: "project.open", extensionId: "unity" });
    // v25 compatibility: project requests without an extension id are
    // accepted (first-available routing) for one migration window.
    expect(
      parseAgentRequest({
        protocolVersion: 25,
        requestId: "request-status-legacy",
        type: "project.status",
        projectPath: "/projects/game",
      }),
    ).toMatchObject({ type: "project.status" });
    expect(() =>
      parseAgentRequest({
        // A v26 client may not omit the extension id.
        protocolVersion,
        requestId: "request-status-missing-id",
        type: "project.status",
        projectPath: "/projects/game",
      }),
    ).toThrow(ProtocolValidationError);
    expect(
      parseAgentEvent({
        protocolVersion,
        eventId: 1,
        sessionId: "session-1",
        type: "project.status.changed",
        projectPath: "/projects/game",
        extensionId: "unity",
        // Status payloads are opaque extension-owned data in core.
        status: { whatever: "the extension sent", nested: [1, 2] },
      }),
    ).toMatchObject({ type: "project.status.changed", extensionId: "unity" });
  });

  it("validates model catalogs and model-selection requests", () => {
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-model",
        type: "model.select",
        sessionId: "session-1",
        provider: "openai-codex",
        modelId: "gpt-5.6-sol",
      }),
    ).toMatchObject({ type: "model.select", modelId: "gpt-5.6-sol" });
    expect(
      parseAgentModelCatalog({
        current: {
          provider: "openai-codex",
          id: "gpt-5.6-sol",
          thinkingLevel: "high",
        },
        models: [
          {
            provider: "openai-codex",
            id: "gpt-5.6-sol",
            name: "GPT-5.6 Sol",
            reasoning: true,
          },
        ],
        thinkingLevels: ["low", "high"],
      }),
    ).toMatchObject({ current: { thinkingLevel: "high" } });
  });

  it("correlates successful and failed transport responses", () => {
    expect(
      parseAgentResponse({
        protocolVersion,
        requestId: "request-1",
        type: "response.success",
        sessionId: "session-1",
      }),
    ).toMatchObject({ requestId: "request-1", sessionId: "session-1" });

    expect(
      parseAgentResponse({
        protocolVersion,
        requestId: "request-2",
        type: "response.error",
        code: "request_failed",
        message: "Prompt failed",
      }),
    ).toMatchObject({ requestId: "request-2", code: "request_failed" });
  });

  it("validates durable session catalogs and hydrated transcripts", () => {
    const session = {
      id: "session-1",
      title: "Scene inspection",
      projectPath: "/projects/game",
      createdAt: 1,
      lastActiveAt: 2,
      messageCount: 1,
    };
    expect(
      parseSessionCatalog({ sessions: [session], lastSessionId: "session-1" }),
    ).toMatchObject({ lastSessionId: "session-1" });
    expect(
      parseSessionSnapshot({
        session,
        messages: [
          {
            id: "message-1",
            role: "user",
            content: "Inspect the scene",
            createdAt: 1,
            complete: true,
            tools: [],
          },
        ],
      }),
    ).toMatchObject({ session, messages: [{ role: "user" }] });
  });

  it("rejects unknown and incompatible events", () => {
    expect(() =>
      parseAgentEvent({
        protocolVersion: protocolVersion + 1,
        eventId: 1,
        sessionId: "session-1",
        type: "message.delta",
        messageId: "message-1",
        delta: "hello",
      }),
    ).toThrow(ProtocolValidationError);

    expect(() =>
      parseAgentEvent({
        protocolVersion,
        eventId: 1,
        sessionId: "session-1",
        type: "unknown.event",
      }),
    ).toThrow(ProtocolValidationError);
  });

  it("validates resource requests and the returned catalog", () => {
    expect(
      parseAgentRequest({
        protocolVersion,
        requestId: "request-1",
        type: "resources.skill.project",
        workspacePath: "/projects/game",
        skillId: "global/review",
        enabled: null,
      }),
    ).toMatchObject({ enabled: null });

    expect(() =>
      parseAgentRequest({
        protocolVersion,
        requestId: "request-1",
        type: "resources.skill.project",
        workspacePath: "/projects/game",
        skillId: "global/review",
      }),
    ).toThrow(ProtocolValidationError);

    expect(
      parseResourceCatalog({
        workspacePath: "/projects/game",
        skills: [
          {
            id: "global/review",
            name: "review",
            description: "Review changes",
            scope: "global",
            path: "/skills/review/SKILL.md",
            source: "user",
            installed: true,
            enabledGlobally: false,
            enabled: true,
            override: true,
          },
        ],
        agentsFiles: [],
        prompts: [],
        diagnostics: [],
      }).skills,
    ).toHaveLength(1);

    expect(() =>
      parseResourceCatalog({ skills: [], agentsFiles: [], prompts: [] }),
    ).toThrow(ProtocolValidationError);
  });
});
