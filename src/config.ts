import * as core from "@actions/core";
import { z } from "zod";

const ConfigSchema = z.object({
  anthropicApiKey: z.string().min(1, "anthropic-api-key is required"),
  githubToken: z.string().min(1),
  dryRun: z.boolean(),
  botLogins: z.array(z.string().min(1)),
  model: z.string().min(1),
  maxResolutionsPerRun: z.number().int().positive(),
  generatedFileGlobs: z.array(z.string().min(1)),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  const parseCsv = (raw: string): string[] =>
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

  return ConfigSchema.parse({
    anthropicApiKey: core.getInput("anthropic-api-key", { required: true }),
    githubToken: core.getInput("github-token", { required: true }),
    dryRun: core.getBooleanInput("dry-run"),
    botLogins: parseCsv(core.getInput("bot-logins")).map((s) => s.toLowerCase()),
    model: core.getInput("model"),
    maxResolutionsPerRun: Number.parseInt(core.getInput("max-resolutions-per-run"), 10),
    generatedFileGlobs: parseCsv(core.getInput("generated-file-globs")),
  });
}
