import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile } from "node:process";

export function loadLocalEnv(filePath = resolve(process.cwd(), ".env")): boolean {
  if (!existsSync(filePath)) {
    return false;
  }

  loadEnvFile(filePath);
  return true;
}

loadLocalEnv();
