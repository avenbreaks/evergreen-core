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
  priceOracle: "0x2fe5a484ad1479b3f771d6cca9c5edcb42e1ed2d",
} as const;

export const ensTldControllers = {
  dev: {
    controller: "0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d",
    baseRegistrar: "0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c",
  },
  vibecoders: {
    controller: "0x48d7c909f01b6bb49461e24335734e13f5c900c2",
    baseRegistrar: "0x5b34fecea2324ad60bb29970ba343eda2cc39890",
  },
  fullstack: {
    controller: "0x0f3e10eef6327cc54a940565bab22cb68e1744cc",
    baseRegistrar: "0x9794c5fe486ca9f6e60d85af502e8b8760531cec",
  },
  backend: {
    controller: "0x078e29ad8ee892501864cd5a08b1e02e38063857",
    baseRegistrar: "0xc5ef6cf706800c7af9bef7c586db998a283e74f0",
  },
  frontend: {
    controller: "0x3ec2521319ceb4d66bd877f432ea405f2806e623",
    baseRegistrar: "0x203c38e52b324221d12fb6407d8603fdcb2ba655",
  },
} as const;
