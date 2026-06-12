import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { createRunContext, writeCoralConfig } from "../src/coral/config.js";

describe("coral config", () => {
  test("writes run-specific config with local agent wildcard and no global mutation", () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-run-"));
    try {
      const ctx = createRunContext({
        projectRoot: "/tmp/example/pi-factory",
        runRoot: dir,
        runId: "run-test"
      });
      const configPath = writeCoralConfig(ctx, {
        authKey: "auth-test",
        customToolSecret: "tool-test"
      });
      const config = readFileSync(configPath, "utf8");
      expect(config).toContain('bind_address = "127.0.0.1"');
      expect(config).toContain('local_agents = ["/tmp/example/pi-factory/agents/*"]');
      expect(config).toContain("include_coral_home_agents = false");
      expect(config).toContain("include_marketplace_agents = false");
      expect(config).toContain('keys = ["auth-test"]');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
