import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FACTORY_PURGE_CONFIRMATION, purgeFactoryDataStores } from "../src/conductor/factory-data.js";

describe("factory data purge", () => {
  test("refuses to delete saved data without exact confirmation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-purge-"));
    try {
      const runDb = join(dir, ".factory", "runs", "run-test", "blackboard.sqlite");
      mkdirSync(join(dir, ".factory", "runs", "run-test"), { recursive: true });
      writeFileSync(runDb, "throwaway db");

      const result = await purgeFactoryDataStores(dir, "yes");

      expect(result.purged).toBe(false);
      expect(result.deletedPaths).toEqual([]);
      expect(result.requiredConfirmation).toBe(FACTORY_PURGE_CONFIRMATION);
      expect(existsSync(runDb)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("deletes the factory data directory after exact confirmation", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pi-factory-purge-"));
    try {
      const factoryDir = join(dir, ".factory");
      const runDb = join(factoryDir, "runs", "run-test", "blackboard.sqlite");
      const gatewayState = join(factoryDir, "gateway.json");
      const sourceFile = join(dir, "package.json");
      mkdirSync(join(factoryDir, "runs", "run-test"), { recursive: true });
      writeFileSync(runDb, "throwaway db");
      writeFileSync(gatewayState, "{}");
      writeFileSync(sourceFile, "{}");

      const result = await purgeFactoryDataStores(dir, FACTORY_PURGE_CONFIRMATION);

      expect(result.purged).toBe(true);
      expect(result.deletedPaths).toEqual([factoryDir]);
      expect(existsSync(factoryDir)).toBe(false);
      expect(existsSync(sourceFile)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
