import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Abi, Address } from "viem";

import { ensCoreContracts } from "@evergreen-devparty/auth";

type TldConfig = {
  tld: string;
  controllerAddress: Address;
  baseRegistrarAddress: Address;
};

const TLD_CONFIGS: readonly TldConfig[] = [
  {
    tld: "dev",
    controllerAddress: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
    baseRegistrarAddress: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
  },
  {
    tld: "vibecoders",
    controllerAddress: "0x48d7c909f01b6bb49461e24335734e13f5c900c2",
    baseRegistrarAddress: "0x5b34fecea2324ad60bb29970ba343eda2cc39890",
  },
  {
    tld: "fullstack",
    controllerAddress: "0x0f3e10eef6327cc54a940565bab22cb68e1744cc",
    baseRegistrarAddress: "0x9794c5fe486ca9f6e60d85af502e8b8760531cec",
  },
  {
    tld: "backend",
    controllerAddress: "0x078e29ad8ee892501864cd5a08b1e02e38063857",
    baseRegistrarAddress: "0xc5ef6cf706800c7af9bef7c586db998a283e74f0",
  },
  {
    tld: "frontend",
    controllerAddress: "0x3ec2521319ceb4d66bd877f432ea405f2806e623",
    baseRegistrarAddress: "0x203c38e52b324221d12fb6407d8603fdcb2ba655",
  },
] as const;

type AbiBundle = {
  controllerAbi: Abi;
  baseRegistrarAbi: Abi;
  publicResolverAbi: Abi;
  priceOracleAbi: Abi;
};

let abiBundle: AbiBundle | null = null;

const resolveProjectRoot = (): string => {
  let cursor = process.cwd();

  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = resolve(cursor, "docs/frontend-abis");
    if (existsSync(candidate)) {
      return cursor;
    }

    const next = resolve(cursor, "..");
    if (next === cursor) {
      break;
    }
    cursor = next;
  }

  throw new Error("Cannot locate docs/frontend-abis directory from current working directory");
};

const readAbi = (filename: string): Abi => {
  const root = resolveProjectRoot();
  const filePath = resolve(root, "docs/frontend-abis", filename);
  const content = readFileSync(filePath, "utf8");
  return JSON.parse(content) as Abi;
};

export const getAbiBundle = (): AbiBundle => {
  if (abiBundle) {
    return abiBundle;
  }

  abiBundle = {
    controllerAbi: readAbi("CustomRegistrarController.abi.json"),
    baseRegistrarAbi: readAbi("BaseRegistrar.abi.json"),
    publicResolverAbi: readAbi("PublicResolver.abi.json"),
    priceOracleAbi: readAbi("PriceOracle.abi.json"),
  };

  return abiBundle;
};

export const getTldConfig = (tldInput: string): TldConfig => {
  const normalized = tldInput.trim().toLowerCase().replace(/^\./, "");
  const config = TLD_CONFIGS.find((entry) => entry.tld === normalized);
  if (!config) {
    throw new Error(`Unsupported ENS TLD: ${tldInput}`);
  }

  return config;
};

export const listTldConfigs = (): readonly TldConfig[] => TLD_CONFIGS;

export const getEnsCoreContracts = () => ({
  publicResolver: ensCoreContracts.publicResolver as Address,
  ensRegistry: ensCoreContracts.ensRegistry as Address,
  reverseRegistrar: ensCoreContracts.reverseRegistrar as Address,
});
