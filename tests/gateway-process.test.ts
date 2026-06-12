import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { gatewayStatePath, stopRecordedGateway, writeGatewayState } from "../src/conductor/gateway-process.js";

function processIsAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe("gateway process lifecycle", () => {
  test("stops the recorded detached gateway process and removes its state file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-gateway-"));
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      detached: true,
      stdio: "ignore"
    });
    child.unref();
    try {
      expect(child.pid).toBeTypeOf("number");
      writeGatewayState(dir, {
        pid: child.pid!,
        gatewayUrl: "http://127.0.0.1:5173",
        apiUrl: "http://127.0.0.1:8787",
        factoryRoot: dir,
        startedAt: new Date().toISOString(),
        command: [process.execPath, "-e", "setInterval(() => {}, 1000)"]
      });

      const result = await stopRecordedGateway(dir, { graceMs: 100 });

      expect(result.stopped).toBe(true);
      expect(existsSync(gatewayStatePath(dir))).toBe(false);
      expect(processIsAlive(child.pid!)).toBe(false);
    } finally {
      if (child.pid && processIsAlive(child.pid)) process.kill(-child.pid, "SIGKILL");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
