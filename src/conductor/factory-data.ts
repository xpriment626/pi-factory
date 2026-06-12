import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { stopRecordedGateway } from "./gateway-process.js";

export const FACTORY_PURGE_CONFIRMATION = "delete factory data";

export type FactoryPurgeResult = {
  purged: boolean;
  requiredConfirmation: string;
  deletedPaths: string[];
  message: string;
};

export async function purgeFactoryDataStores(factoryRoot: string, confirmation: string): Promise<FactoryPurgeResult> {
  if (confirmation.trim() !== FACTORY_PURGE_CONFIRMATION) {
    return {
      purged: false,
      requiredConfirmation: FACTORY_PURGE_CONFIRMATION,
      deletedPaths: [],
      message: `Refusing to purge. Re-run with: /factory-purge ${FACTORY_PURGE_CONFIRMATION}`
    };
  }

  await stopRecordedGateway(factoryRoot);
  const factoryDataPath = join(factoryRoot, ".factory");
  const deletedPaths: string[] = [];
  if (existsSync(factoryDataPath)) {
    rmSync(factoryDataPath, { recursive: true, force: true });
    deletedPaths.push(factoryDataPath);
  }

  return {
    purged: true,
    requiredConfirmation: FACTORY_PURGE_CONFIRMATION,
    deletedPaths,
    message: deletedPaths.length
      ? `Purged factory data stores:\n${deletedPaths.join("\n")}`
      : "No factory data stores were present."
  };
}
