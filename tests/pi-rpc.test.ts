import { describe, expect, test } from "vitest";
import { verifyPiExtensionLoading } from "../src/pi/rpc.js";

describe("pi rpc smoke", () => {
  test("loads local extension and reports registered command", async () => {
    const result = await verifyPiExtensionLoading({ cwd: process.cwd() });
    expect(result.success).toBe(true);
    expect(result.commandNames).toContain("factory-smoke");
  }, 30000);
});
