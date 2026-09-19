import { describe, expect, it } from "vitest";
import { compilerDiagnostic, diagnosticPath } from "./compiler-diagnostics";

describe("compiler diagnostics", () => {
  it("extracts Unity compiler locations from C# diagnostics", () => {
    const diagnostic = compilerDiagnostic(
      "Assets/Scripts/Player.cs(12,7): error CS1002: ; expected",
    );

    expect(diagnostic).toMatchObject({
      code: "CS1002",
      file: "Assets/Scripts/Player.cs",
      line: 12,
      column: 7,
    });
    expect(diagnosticPath(diagnostic!, "/projects/game")).toBe(
      "/projects/game/Assets/Scripts/Player.cs",
    );
  });

  it("prefers structured locations supplied by the harness", () => {
    expect(
      compilerDiagnostic({
        code: "CS0246",
        message: "Unknown type",
        file: "/projects/game/Assets/Foo.cs",
        line: 4,
      }),
    ).toMatchObject({ file: "/projects/game/Assets/Foo.cs", line: 4 });
  });
});
