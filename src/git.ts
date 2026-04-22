import * as exec from "@actions/exec";

export interface FileAccess {
  fileExistsAtRef(path: string, ref: string): Promise<boolean>;
  readFileAtRef(path: string, ref: string): Promise<string | null>;
  readLineWindow(path: string, ref: string, line: number, pad: number): Promise<string | null>;
}

export function createGit(): FileAccess {
  const run = async (args: string[]): Promise<{ stdout: string; code: number }> => {
    let stdout = "";
    const code = await exec.exec("git", args, {
      silent: true,
      ignoreReturnCode: true,
      listeners: {
        stdout: (b) => {
          stdout += b.toString();
        },
      },
    });
    return { stdout, code };
  };

  return {
    async fileExistsAtRef(path, ref) {
      const { code } = await run(["cat-file", "-e", `${ref}:${path}`]);
      return code === 0;
    },
    async readFileAtRef(path, ref) {
      const { stdout, code } = await run(["show", `${ref}:${path}`]);
      return code === 0 ? stdout : null;
    },
    async readLineWindow(path, ref, line, pad) {
      const { stdout, code } = await run(["show", `${ref}:${path}`]);
      if (code !== 0) return null;
      const lines = stdout.split("\n");
      const start = Math.max(0, line - 1 - pad);
      const end = Math.min(lines.length, line + pad);
      return lines.slice(start, end).join("\n");
    },
  };
}
