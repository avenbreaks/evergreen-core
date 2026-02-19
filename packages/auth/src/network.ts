import { authEnv } from "./env";

export const oorthNexusNetwork = {
  rpcUrl: authEnv.network.rpcUrl,
  chainId: authEnv.network.chainId,
  explorerUrl: authEnv.network.explorerUrl,
} as const;

export const ensCoreContracts = {
  ensRegistry: authEnv.ens.registryAddress,
  publicResolver: authEnv.ens.publicResolverAddress,
  reverseRegistrar: authEnv.ens.reverseRegistrarAddress,
} as const;

export const ensTldControllers = {
  dev: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
  vibecoders: "0x48d7c909f01b6bb49461e24335734e13f5c900c2",
  fullstack: "0x0f3e10eef6327cc54a940565bab22cb68e1744cc",
  backend: "0x078e29ad8ee892501864cd5a08b1e02e38063857",
  frontend: "0x3ec2521319ceb4d66bd877f432ea405f2806e623",
} as const;
