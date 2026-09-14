import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	binaryCandidates,
	formatBytes,
	isNewerVersion,
	managedInstallDir,
	parseOllamaVersion,
	releaseAssetName,
	releaseDownloadUrl,
} from "./host.ts";

describe("parseOllamaVersion", () => {
	it("reads the version from --version output", () => {
		expect(parseOllamaVersion("ollama version is 0.5.7\n")).toBe("0.5.7");
		expect(parseOllamaVersion("Warning: something\nollama version is 1.2.3"))
			.toBe("1.2.3");
	});

	it("returns undefined without a version", () => {
		expect(parseOllamaVersion("no version here")).toBeUndefined();
		expect(parseOllamaVersion("")).toBeUndefined();
	});
});

describe("isNewerVersion", () => {
	it("compares numerically, not lexically", () => {
		expect(isNewerVersion("0.10.0", "0.9.0")).toBe(true);
		expect(isNewerVersion("0.9.0", "0.10.0")).toBe(false);
		expect(isNewerVersion("1.0.0", "1.0.0")).toBe(false);
		expect(isNewerVersion("1.0.1", "1.0.0")).toBe(true);
	});

	it("tolerates a v prefix and shorter versions", () => {
		expect(isNewerVersion("v0.6.0", "0.5.7")).toBe(true);
		expect(isNewerVersion("0.6", "0.6.0")).toBe(false);
	});
});

describe("releaseAssetName", () => {
	it("names the platform artifact", () => {
		expect(releaseAssetName("windows")).toBe("OllamaSetup.exe");
		expect(releaseAssetName("macos")).toBe("Ollama-darwin.zip");
		expect(releaseAssetName("linux", "x64")).toBe("ollama-linux-amd64.tgz");
		expect(releaseAssetName("linux", "arm64")).toBe("ollama-linux-arm64.tgz");
		expect(releaseAssetName("unknown")).toBeUndefined();
	});
});

describe("releaseDownloadUrl", () => {
	it("builds a tagged release URL", () => {
		expect(releaseDownloadUrl("0.5.7", "OllamaSetup.exe")).toBe(
			"https://github.com/ollama/ollama/releases/download/v0.5.7/OllamaSetup.exe",
		);
		expect(releaseDownloadUrl("v1.2.3", "ollama")).toBe(
			"https://github.com/ollama/ollama/releases/download/v1.2.3/ollama",
		);
	});
});

describe("binaryCandidates", () => {
	it("puts the per-user Windows install first", () => {
		const [first] = binaryCandidates("windows");
		expect(first).toMatch(/Programs\\Ollama\\ollama\.exe$/u);
	});

	it("includes the managed Linux install", () => {
		const [first] = binaryCandidates("linux");
		expect(first).toBe(join(managedInstallDir(), "bin", "ollama"));
	});

	it("returns nothing for unknown platforms", () => {
		expect(binaryCandidates("unknown")).toEqual([]);
	});
});

describe("formatBytes", () => {
	it("renders human sizes", () => {
		expect(formatBytes(500)).toBe("500 B");
		expect(formatBytes(2048)).toBe("2 KB");
		expect(formatBytes(5 * 1024 ** 2)).toBe("5 MB");
		expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
	});
});
