import { Type, type Static } from "typebox";
import { Value } from "typebox/value";

/**
 * Unity-owned wire schemas. Since protocol v26 the Gizmo core treats
 * project-service status payloads as opaque extension-owned data; Unity
 * validates and parses its own payloads here, in the extension.
 */
const unityCliMessageSchema = Type.Object(
  {
    code: Type.String(),
    message: Type.String(),
    file: Type.Optional(Type.String()),
    line: Type.Optional(Type.Integer({ minimum: 1 })),
    column: Type.Optional(Type.Integer({ minimum: 1 })),
  },
  { additionalProperties: false },
);

export const unityStatusSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal("connected"),
      Type.Literal("disconnected"),
      Type.Literal("unavailable"),
      Type.Literal("error"),
    ]),
    ok: Type.Boolean(),
    command: Type.Array(Type.String()),
    exitCode: Type.Union([Type.Integer(), Type.Null()]),
    durationMs: Type.Integer({ minimum: 0 }),
    instances: Type.Array(Type.Record(Type.String(), Type.Unknown())),
    errors: Type.Array(unityCliMessageSchema),
    warnings: Type.Array(unityCliMessageSchema),
    stderr: Type.Optional(Type.String()),
  },
  { additionalProperties: false },
);

export type UnityStatus = Static<typeof unityStatusSchema>;

export const unityOpenProjectResultSchema = Type.Object(
  {
    state: Type.Union([
      Type.Literal("opened"),
      Type.Literal("already_open"),
      Type.Literal("error"),
    ]),
    ok: Type.Boolean(),
    command: Type.Array(Type.String()),
    exitCode: Type.Union([Type.Integer(), Type.Null()]),
    durationMs: Type.Integer({ minimum: 0 }),
    data: Type.Unknown(),
    errors: Type.Array(unityCliMessageSchema),
    warnings: Type.Array(unityCliMessageSchema),
    stderr: Type.Optional(Type.String()),
    status: Type.Optional(unityStatusSchema),
  },
  { additionalProperties: false },
);

export type UnityOpenProjectResult = Static<
  typeof unityOpenProjectResultSchema
>;

export class UnityProtocolValidationError extends Error {
  constructor(kind: string) {
    super(`Invalid ${kind} payload for the Unity extension`);
    this.name = "UnityProtocolValidationError";
  }
}

export function parseUnityStatus(input: unknown): UnityStatus {
  if (!Value.Check(unityStatusSchema, input)) {
    throw new UnityProtocolValidationError("project status");
  }
  return input;
}

export function parseUnityOpenProjectResult(
  input: unknown,
): UnityOpenProjectResult {
  if (!Value.Check(unityOpenProjectResultSchema, input)) {
    throw new UnityProtocolValidationError("project open result");
  }
  return input;
}
