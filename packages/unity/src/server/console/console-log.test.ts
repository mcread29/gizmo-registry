import type { ConsoleEntry } from "./console-types";
import { describe, expect, it } from "vitest";
import {
  consoleErrorCount,
  consoleLine,
  consoleSourceLabel,
  consoleTimeLabel,
  matchesConsoleFilter,
} from "./console-log";

const entry: ConsoleEntry = {
  level: "error",
  message: "NullReferenceException in PlayerController",
  file: "Assets/Player.cs",
  line: 58,
  timestamp: "14:02:11",
};

describe("matchesConsoleFilter", () => {
  it("combines visible levels with the text filter", () => {
    expect(matchesConsoleFilter(entry, new Set(["error"]), "null")).toBe(true);
    expect(matchesConsoleFilter(entry, new Set(["warn"]), "")).toBe(false);
    expect(
      matchesConsoleFilter(entry, new Set(["log", "warn", "error"]), "shader"),
    ).toBe(false);
  });

  it("matches the file as well as the message", () => {
    expect(
      matchesConsoleFilter(
        entry,
        new Set(["log", "warn", "error"]),
        "player.cs",
      ),
    ).toBe(true);
  });
});

describe("consoleLine", () => {
  it("keeps the timestamp, level and location when copied out", () => {
    expect(consoleLine(entry)).toBe(
      "14:02:11 [error] NullReferenceException in PlayerController (Assets/Player.cs:58)",
    );
  });
});

describe("consoleErrorCount", () => {
  it("counts only errors", () => {
    expect(consoleErrorCount([entry, { level: "warn", message: "x" }])).toBe(1);
  });
});

describe("console metadata", () => {
  it("keeps timestamps and source locations useful at narrow widths", () => {
    expect(consoleTimeLabel("2026-08-19T19:40:33.385013Z")).toBe("19:40:33");
    expect(consoleSourceLabel("Assets/Game/Systems/Player.cs", 42)).toBe(
      "Systems/Player.cs:42",
    );
  });
});
