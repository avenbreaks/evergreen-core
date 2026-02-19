import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

const loadIfExists = (filePath: string): void => {
  if (existsSync(filePath)) {
    config({ path: filePath, override: false });
  }
};

export const loadEnvironmentFiles = (): void => {
  const cwd = process.cwd();

  const candidates = [
    resolve(cwd, ".env"),
    resolve(cwd, "backend/.env"),
    resolve(cwd, "packages/auth/.env"),
    resolve(cwd, "../.env"),
    resolve(cwd, "../backend/.env"),
    resolve(cwd, "../packages/auth/.env"),
  ];

  for (const filePath of candidates) {
    loadIfExists(filePath);
  }
};
