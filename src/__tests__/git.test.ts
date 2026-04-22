import { describe, expect, it, vi } from "vitest";

vi.mock("@actions/exec", () => ({
  exec: vi.fn(),
}));

import * as exec from "@actions/exec";
import { createGit } from "../git.js";

function mockExec(stdout: string, exitCode = 0) {
  vi.mocked(exec.exec).mockImplementation(async (_cmd, _args, opts) => {
    opts?.listeners?.stdout?.(Buffer.from(stdout));
    return exitCode;
  });
}

describe("createGit", () => {
  describe("fileExistsAtRef", () => {
    it("returns true when git cat-file exits 0", async () => {
      mockExec("", 0);
      const git = createGit();
      expect(await git.fileExistsAtRef("src/a.ts", "abc123")).toBe(true);
      expect(exec.exec).toHaveBeenCalledWith(
        "git",
        ["cat-file", "-e", "abc123:src/a.ts"],
        expect.objectContaining({ silent: true, ignoreReturnCode: true }),
      );
    });

    it("returns false when git cat-file exits non-zero", async () => {
      mockExec("", 1);
      const git = createGit();
      expect(await git.fileExistsAtRef("src/a.ts", "abc123")).toBe(false);
    });
  });

  describe("readFileAtRef", () => {
    it("returns file content when git show exits 0", async () => {
      mockExec("file content here", 0);
      const git = createGit();
      const result = await git.readFileAtRef("src/a.ts", "abc123");
      expect(result).toBe("file content here");
      expect(exec.exec).toHaveBeenCalledWith(
        "git",
        ["show", "abc123:src/a.ts"],
        expect.objectContaining({ silent: true, ignoreReturnCode: true }),
      );
    });

    it("returns null when git show exits non-zero", async () => {
      mockExec("", 1);
      const git = createGit();
      expect(await git.readFileAtRef("src/a.ts", "abc123")).toBeNull();
    });
  });

  describe("readLineWindow", () => {
    it("returns windowed lines around target line", async () => {
      const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
      mockExec(lines, 0);
      const git = createGit();
      const result = await git.readLineWindow("src/a.ts", "abc123", 10, 2);
      // line 10 is index 9; window is start=max(0,9-2-1)=6 wait...
      // start = max(0, line-1-pad) = max(0, 10-1-2) = 7 (0-indexed)
      // end = min(20, line+pad) = min(20, 12) = 12
      // so lines[7..12] = "line 8", "line 9", "line 10", "line 11", "line 12"
      expect(result).toBe("line 8\nline 9\nline 10\nline 11\nline 12");
    });

    it("returns null when git show exits non-zero", async () => {
      mockExec("", 1);
      const git = createGit();
      expect(await git.readLineWindow("src/a.ts", "abc123", 5, 2)).toBeNull();
    });

    it("clamps window at file boundaries", async () => {
      mockExec("line 1\nline 2\nline 3", 0);
      const git = createGit();
      const result = await git.readLineWindow("src/a.ts", "abc123", 1, 5);
      // start = max(0, 1-1-5) = 0, end = min(3, 1+5) = 3
      expect(result).toBe("line 1\nline 2\nline 3");
    });
  });
});
