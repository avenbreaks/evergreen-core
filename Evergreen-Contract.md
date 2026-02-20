# ENS Custom Chain Smart Contracts

This document covers the complete process of deploying ENS contracts on the OorthNexus custom chain (Chain ID: 131), including subgraph + BENS setup for Blockscout explorer integration, and ENS domain registration procedures.

---

## 1. Prerequisites & Setup

### Chain Specifications

| Parameter    | Value                                |
|--------------|--------------------------------------|
| Chain Name   | OorthNexus                           |
| Chain ID     | `131`                                |
| RPC URL      | `https://rpc-api.oorthnexus.xyz`     |
| Explorer     | `https://analytics.oorthnexus.xyz`   |
| Native Token | ONXS                                 |

---

# Appendix: Complete Contract Addresses

## Chain: OorthNexus (Chain ID: 131)

---

## Core Contracts

| Contract                    | Address                                      |
|----------------------------|----------------------------------------------|
| ENSRegistry                 | `0x38355d6486e725896690f727a297fb57a143556c` |
| Root                        | `0xf345d27b97ec7f02795c0e29fb7df79065dd0ca3` |
| RootSecurityController      | `0xbee99683aecd1d9648d79193336e49f34b6c2ed8` |
| RegistrarSecurityController | `0x36e66ecb10fc31a597fb8ff851be1ede03a1fef5` |
| Multicall3                  | `0xcA11bde05977b3631167028862bE2a173976CA11` |

---

## Resolvers

| Contract            | Address                                      |
|--------------------|----------------------------------------------|
| PublicResolver      | `0x47e9cbbd0ee572d996ffd0d7aa17796c5a247590` |
| OwnedResolver       | `0xc8d1cba8653d5bae93bd9b7bfbbaf7a343bb1944` |
| ExtendedDNSResolver | `0xd989e35c12bb1d1d918baa615ff4ba391f5c8dfe` |
| OffchainDNSResolver | `0xc7781c5782b9184ce412abab773b05f720e96c35` |
| UniversalResolver   | `0x43d44619e15e0d03cd01c4c3e339cf0a87937b1d` |

---

## Reverse Contracts

| Contract                | Address                                      |
|------------------------|----------------------------------------------|
| ReverseRegistrar        | `0x98fc575ec10729a3350ca7b74cfd2f1bf81e8f12` |
| DefaultReverseRegistrar | `0x372565916f2363aa5fdc1fb6c0b4c703bbc2ff53` |
| DefaultReverseResolver  | `0x1bd5a9c74c4bd5a3415e22602c32685e17c70515` |
| L2ReverseRegistrar      | `0x61a4cc6afa8a4267f8d234bd11602d3486e3fe20` |

---

## Pricing Contracts

| Contract                      | Address                                      |
|------------------------------|----------------------------------------------|
| ExponentialPremiumPriceOracle | `0x2fe5a484ad1479b3f771d6cca9c5edcb42e1ed2d` |
| DummyOracle                   | `0xdcb10bc4eca90ff03310b70be545c07e87227b02` |

---

## Metadata

| Contract              | Address                                      |
|----------------------|----------------------------------------------|
| StaticMetadataService | `0x05cf0d290c9e5b9cd3c57cb10b098ef5e13a161a` |

---

# Per-TLD Contracts

---

## TLD: `.dev`

| Contract                  | Address                                      |
|--------------------------|----------------------------------------------|
| BaseRegistrar             | `0xe077dc5c0a336f76662f024d98c0f20be0ad9d1c` |
| NameWrapper               | `0x64606c86d56145bec8a000c63b9c7bdfc57c4430` |
| CustomRegistrarController | `0x00a4c7ff46ab778d8333421d42715db2aa6b1b4d` |
| CustomBulkRenewal         | `0xa9e8f28006d8262bf859b52bd5a539ae47b30214` |

---

## TLD: `.vibecoders`

| Contract                  | Address                                      |
|--------------------------|----------------------------------------------|
| BaseRegistrar             | `0x5b34fecea2324ad60bb29970ba343eda2cc39890` |
| NameWrapper               | `0x33762503316f63aa85a7da59b0eb19d90aac30b7` |
| CustomRegistrarController | `0x48d7c909f01b6bb49461e24335734e13f5c900c2` |
| CustomBulkRenewal         | `0xfd60e0d77e9312cb37f0b2e7bbab89499ac52deb` |

---

## TLD: `.fullstack`

| Contract                  | Address                                      |
|--------------------------|----------------------------------------------|
| BaseRegistrar             | `0x9794c5fe486ca9f6e60d85af502e8b8760531cec` |
| NameWrapper               | `0xd5ca06c6f0b34ae71b3a8c9b01a0c870d0cffe67` |
| CustomRegistrarController | `0x0f3e10eef6327cc54a940565bab22cb68e1744cc` |
| CustomBulkRenewal         | `0xf959882a5dac88db4a8984a792e61ebe5915fee6` |

---

## TLD: `.backend`

| Contract                  | Address                                      |
|--------------------------|----------------------------------------------|
| BaseRegistrar             | `0xc5ef6cf706800c7af9bef7c586db998a283e74f0` |
| NameWrapper               | `0xe76d59b4bd6de79f1865ee9522c3e52f5c99eea5` |
| CustomRegistrarController | `0x078e29ad8ee892501864cd5a08b1e02e38063857` |
| CustomBulkRenewal         | `0xcf1b5a6f6bf3cb500e462bf76070a2a1b3b28a8f` |

---

## TLD: `.frontend`

| Contract                  | Address                                      |
|--------------------------|----------------------------------------------|
| BaseRegistrar             | `0x203c38e52b324221d12fb6407d8603fdcb2ba655` |
| NameWrapper               | `0x8faa06bfc9b523a3ad8e92c138b1246bcc9de440` |
| CustomRegistrarController | `0x3ec2521319ceb4d66bd877f432ea405f2806e623` |
| CustomBulkRenewal         | `0x0426924225147af507a9afc016e8af88128c5bab` |

---

*This document is based on the actual ENS deployment on OorthNexus Chain ID 131. All contract addresses listed above are production-ready and currently live.*