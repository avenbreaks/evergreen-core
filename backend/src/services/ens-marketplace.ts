import { randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, ne } from "drizzle-orm";
import {
  createPublicClient,
  decodeFunctionData,
  decodeEventLog,
  encodeFunctionData,
  http,
  isAddress,
  keccak256,
  labelhash,
  namehash,
  toHex,
  type Address,
  type Hex,
} from "viem";

import { authDb, oorthNexusNetwork } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { getAbiBundle, getEnsCoreContracts, getTldConfig, listTldConfigs } from "./ens-contracts";

const DEFAULT_DURATION_SECONDS = 365 * 24 * 60 * 60;
const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000" as Hex;
const ENS_LABEL_REGEX = /^[a-z0-9-]{3,63}$/;

const chain = {
  id: oorthNexusNetwork.chainId,
  name: "OorthNexus",
  nativeCurrency: {
    name: "ONXS",
    symbol: "ONXS",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [oorthNexusNetwork.rpcUrl],
    },
  },
} as const;

const publicClient = createPublicClient({
  chain,
  transport: http(oorthNexusNetwork.rpcUrl),
});

const normalizeAddress = (address: string): Address => address.trim().toLowerCase() as Address;

const normalizeLabel = (label: string): string => label.trim().toLowerCase();

const normalizeTld = (tld: string): string => tld.trim().toLowerCase().replace(/^\./, "");

const ensureValidLabel = (label: string): void => {
  if (!ENS_LABEL_REGEX.test(label)) {
    throw new HttpError(400, "INVALID_LABEL", "Label must be 3-63 chars using a-z, 0-9, and '-' only");
  }
};

const ensureDuration = (durationSeconds: number): void => {
  if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
    throw new HttpError(400, "INVALID_DURATION", "Duration must be a positive integer in seconds");
  }
};

const ensureAddress = (address: string): Address => {
  if (!isAddress(address)) {
    throw new HttpError(400, "INVALID_ADDRESS", `Invalid EVM address: ${address}`);
  }

  return normalizeAddress(address);
};

const toDomainName = (label: string, tld: string): string => `${label}.${tld}`;

const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

const secondsToDate = (seconds: bigint): Date => new Date(Number(seconds) * 1000);

const createSecret = (): Hex => toHex(randomBytes(32));

const toHex32 = (value?: string): Hex => {
  if (!value) {
    return ZERO_BYTES32;
  }

  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(400, "INVALID_REFERRER", "Referrer must be a 32-byte hex string");
  }

  return value.toLowerCase() as Hex;
};

const toTxHash = (value: string): Hex => {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new HttpError(400, "INVALID_TX_HASH", "Invalid transaction hash format");
  }

  return value as Hex;
};

const toPriceSummary = (base: bigint, premium: bigint) => {
  const total = base + premium;
  const valueWithBuffer = (total * 110n) / 100n;
  return {
    base,
    premium,
    total,
    valueWithBuffer,
  };
};

const ensureWalletOwnedByUser = async (userId: string, walletAddress: string, chainId: number): Promise<void> => {
  const normalizedAddress = normalizeAddress(walletAddress);

  const [wallet] = await authDb
    .select({ id: schema.wallets.id })
    .from(schema.wallets)
    .where(
      and(
        eq(schema.wallets.userId, userId),
        eq(schema.wallets.chainId, chainId),
        eq(schema.wallets.address, normalizedAddress)
      )
    )
    .limit(1);

  if (!wallet) {
    throw new HttpError(
      403,
      "WALLET_NOT_LINKED",
      "Wallet is not linked to this account. Link wallet first before buying ENS domains."
    );
  }
};

const readControllerConfig = async (
  controllerAddress: Address
): Promise<{ minCommitmentAge: bigint; maxCommitmentAge: bigint; minRegistrationDuration: bigint }> => {
  const { controllerAbi } = getAbiBundle();

  const [minCommitmentAge, maxCommitmentAge, minRegistrationDuration] =
    (await Promise.all([
      publicClient.readContract({
        address: controllerAddress,
        abi: controllerAbi,
        functionName: "minCommitmentAge",
      }),
      publicClient.readContract({
        address: controllerAddress,
        abi: controllerAbi,
        functionName: "maxCommitmentAge",
      }),
      publicClient.readContract({
        address: controllerAddress,
        abi: controllerAbi,
        functionName: "MIN_REGISTRATION_DURATION",
      }),
    ])) as [bigint, bigint, bigint];

  return {
    minCommitmentAge,
    maxCommitmentAge,
    minRegistrationDuration,
  };
};

const readRentPrice = async (controllerAddress: Address, label: string, durationSeconds: number) => {
  const { controllerAbi } = getAbiBundle();

  const price = (await publicClient.readContract({
    address: controllerAddress,
    abi: controllerAbi,
    functionName: "rentPrice",
    args: [label, BigInt(durationSeconds)],
  })) as { base: bigint; premium: bigint };

  return {
    base: price.base as bigint,
    premium: price.premium as bigint,
  };
};

const classifyStatus = (expiresAt: bigint, gracePeriod: bigint): "available" | "registered" | "grace" => {
  const now = nowSeconds();

  if (expiresAt === 0n) {
    return "available";
  }

  if (expiresAt > now) {
    return "registered";
  }

  if (expiresAt + gracePeriod > now) {
    return "grace";
  }

  return "available";
};

const getIntentById = async (intentId: string) => {
  const [intent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, intentId))
    .limit(1);

  if (!intent) {
    throw new HttpError(404, "INTENT_NOT_FOUND", "ENS purchase intent not found");
  }

  return intent;
};

const getIntentByUser = async (userId: string, intentId: string) => {
  const intent = await getIntentById(intentId);

  if (intent.userId !== userId) {
    throw new HttpError(404, "INTENT_NOT_FOUND", "ENS purchase intent not found");
  }

  return intent;
};

export const getPurchaseIntentById = getIntentById;

export const markPurchaseIntentFailed = async (input: {
  intentId: string;
  reason: string;
  txHash?: string;
}) => {
  const intent = await getIntentById(input.intentId);

  const now = new Date();
  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      status: "failed",
      failureReason: input.reason,
      registerTxHash: input.txHash ?? intent.registerTxHash,
      updatedAt: now,
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  const [updatedIntent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, input.intentId))
    .limit(1);

  if (!updatedIntent) {
    throw new HttpError(500, "INTENT_UPDATE_FAILED", "Failed to reload updated ENS purchase intent");
  }

  return summarizeIntent(updatedIntent);
};

export const retryPurchaseIntentById = async (input: { intentId: string; reason?: string }) => {
  const intent = await getIntentById(input.intentId);

  if (intent.status === "registered") {
    throw new HttpError(409, "INTENT_STATE_INVALID", "Registered intent cannot be retried");
  }

  const now = new Date();
  const withinRegisterWindow = Boolean(intent.registerBy && intent.registerBy > now);
  const isRegisterable = Boolean(intent.registerableAt && intent.registerableAt <= now && withinRegisterWindow);

  const nextStatus: "prepared" | "committed" | "registerable" = isRegisterable
    ? "registerable"
    : intent.committedAt
      ? "committed"
      : "prepared";

  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      status: nextStatus,
      failureReason: input.reason ?? null,
      updatedAt: now,
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  const [updatedIntent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, intent.id))
    .limit(1);

  if (!updatedIntent) {
    throw new HttpError(500, "INTENT_UPDATE_FAILED", "Failed to reload retried ENS purchase intent");
  }

  return summarizeIntent(updatedIntent);
};

export const expirePurchaseIntentById = async (input: { intentId: string; reason?: string }) => {
  const intent = await getIntentById(input.intentId);

  if (intent.status === "registered") {
    throw new HttpError(409, "INTENT_STATE_INVALID", "Registered intent cannot be expired");
  }

  const now = new Date();
  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      status: "expired",
      failureReason: input.reason ?? "Expired by operator",
      updatedAt: now,
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  const [updatedIntent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, intent.id))
    .limit(1);

  if (!updatedIntent) {
    throw new HttpError(500, "INTENT_UPDATE_FAILED", "Failed to reload expired ENS purchase intent");
  }

  return summarizeIntent(updatedIntent);
};

export const confirmCommitmentIntentByIntentId = async (input: { intentId: string; txHash: string }) => {
  const intent = await getIntentById(input.intentId);

  return confirmCommitmentIntent({
    userId: intent.userId,
    intentId: input.intentId,
    txHash: input.txHash,
  });
};

export const confirmRegisterTransactionByIntentId = async (input: {
  intentId: string;
  txHash: string;
  setPrimary?: boolean;
}) => {
  const intent = await getIntentById(input.intentId);

  return confirmRegisterTransaction({
    userId: intent.userId,
    intentId: input.intentId,
    txHash: input.txHash,
    setPrimary: input.setPrimary,
  });
};

const buildRegistrationTuple = (intent: {
  label: string;
  walletAddress: string;
  durationSeconds: number;
  resolverAddress: string;
  secret: Hex;
  referrer: Hex;
}) => ({
  label: intent.label,
  owner: intent.walletAddress as Address,
  duration: BigInt(intent.durationSeconds),
  secret: intent.secret,
  resolver: intent.resolverAddress as Address,
  data: [] as readonly Hex[],
  reverseRecord: 0,
  referrer: intent.referrer,
});

type RegisterTxRegistrationArg = {
  label?: string;
  owner?: string;
  duration?: bigint;
  resolver?: string;
  data?: readonly Hex[];
  reverseRecord?: number;
};

const assertCommitTxMatchesIntent = (input: { txInput: Hex; expectedCommitment: string }): void => {
  const decoded = decodeFunctionData({
    abi: getAbiBundle().controllerAbi,
    data: input.txInput,
  });

  if (decoded.functionName !== "commit") {
    throw new HttpError(400, "INVALID_COMMIT_TX", "Transaction input is not a commit call");
  }

  const commitmentArg = String((decoded.args as readonly unknown[] | undefined)?.[0] ?? "").toLowerCase();
  if (commitmentArg !== input.expectedCommitment.toLowerCase()) {
    throw new HttpError(400, "INVALID_COMMIT_TX", "Commitment hash does not match purchase intent");
  }
};

const assertRegisterTxMatchesIntent = (input: {
  txInput: Hex;
  expectedLabel: string;
  expectedOwner: string;
  expectedDurationSeconds: number;
  expectedResolver: string;
}): void => {
  const decoded = decodeFunctionData({
    abi: getAbiBundle().controllerAbi,
    data: input.txInput,
  });

  if (decoded.functionName !== "register") {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Transaction input is not a register call");
  }

  const registration = ((decoded.args as readonly unknown[] | undefined)?.[0] ?? null) as
    | RegisterTxRegistrationArg
    | null;

  if (!registration) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Missing register arguments in transaction input");
  }

  const label = String(registration.label ?? "").toLowerCase();
  if (label !== input.expectedLabel) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register call label does not match purchase intent");
  }

  const owner = String(registration.owner ?? "");
  if (!owner || normalizeAddress(owner) !== normalizeAddress(input.expectedOwner)) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register call owner does not match purchase intent");
  }

  const duration = registration.duration ?? 0n;
  if (duration !== BigInt(input.expectedDurationSeconds)) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register call duration does not match purchase intent");
  }

  const resolver = String(registration.resolver ?? "");
  if (!resolver || normalizeAddress(resolver) !== normalizeAddress(input.expectedResolver)) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register call resolver does not match purchase intent");
  }

  const data = Array.isArray(registration.data) ? registration.data : [];
  if (data.length > 0) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register call must use empty data array");
  }

  const reverseRecord = registration.reverseRecord ?? 0;
  if (reverseRecord !== 0) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register call reverseRecord must be 0");
  }
};

const summarizeIntent = (intent: {
  id: string;
  chainId: number;
  tld: string;
  label: string;
  domainName: string;
  durationSeconds: number;
  walletAddress: string;
  status: string;
  commitment: string;
  commitTxHash: string | null;
  registerTxHash: string | null;
  registerValueWei: string | null;
  committedAt: Date | null;
  registerableAt: Date | null;
  registerBy: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: intent.id,
  chainId: intent.chainId,
  tld: intent.tld,
  label: intent.label,
  domainName: intent.domainName,
  durationSeconds: intent.durationSeconds,
  walletAddress: intent.walletAddress,
  status: intent.status,
  commitment: intent.commitment,
  commitTxHash: intent.commitTxHash,
  registerTxHash: intent.registerTxHash,
  registerValueWei: intent.registerValueWei,
  committedAt: intent.committedAt,
  registerableAt: intent.registerableAt,
  registerBy: intent.registerBy,
  createdAt: intent.createdAt,
  updatedAt: intent.updatedAt,
});

export const listEnsTlds = () =>
  listTldConfigs().map((config) => ({
    tld: config.tld,
    controllerAddress: config.controllerAddress,
    baseRegistrarAddress: config.baseRegistrarAddress,
  }));

export const getChainBlockNumber = () => publicClient.getBlockNumber();

export const checkDomainAvailability = async (input: {
  label: string;
  tld: string;
  durationSeconds?: number;
}) => {
  const label = normalizeLabel(input.label);
  const tld = normalizeTld(input.tld);
  ensureValidLabel(label);

  const durationSeconds = input.durationSeconds ?? DEFAULT_DURATION_SECONDS;
  ensureDuration(durationSeconds);

  const tldConfig = getTldConfig(tld);
  const { controllerAbi, baseRegistrarAbi } = getAbiBundle();

  const [isValid, isAvailable, rentPrice, gracePeriod, expiresAt, controllerRules] = await Promise.all([
    publicClient.readContract({
      address: tldConfig.controllerAddress,
      abi: controllerAbi,
      functionName: "valid",
      args: [label],
    }),
    publicClient.readContract({
      address: tldConfig.controllerAddress,
      abi: controllerAbi,
      functionName: "available",
      args: [label],
    }),
    readRentPrice(tldConfig.controllerAddress, label, durationSeconds),
    publicClient.readContract({
      address: tldConfig.baseRegistrarAddress,
      abi: baseRegistrarAbi,
      functionName: "GRACE_PERIOD",
    }),
    publicClient.readContract({
      address: tldConfig.baseRegistrarAddress,
      abi: baseRegistrarAbi,
      functionName: "nameExpires",
      args: [BigInt(labelhash(label))],
    }),
    readControllerConfig(tldConfig.controllerAddress),
  ]);

  const price = toPriceSummary(rentPrice.base, rentPrice.premium);
  const status = classifyStatus(expiresAt as bigint, gracePeriod as bigint);

  return {
    label,
    tld,
    domainName: toDomainName(label, tld),
    isValid: Boolean(isValid),
    isAvailable: Boolean(isAvailable),
    status,
    durationSeconds,
    gracePeriodSeconds: Number(gracePeriod as bigint),
    expiresAt,
    minCommitmentAgeSeconds: Number(controllerRules.minCommitmentAge),
    maxCommitmentAgeSeconds: Number(controllerRules.maxCommitmentAge),
    minRegistrationDurationSeconds: Number(controllerRules.minRegistrationDuration),
    price,
  };
};

export const createCommitmentIntent = async (input: {
  userId: string;
  walletAddress: string;
  label: string;
  tld: string;
  durationSeconds: number;
  referrer?: string;
}) => {
  const label = normalizeLabel(input.label);
  const tld = normalizeTld(input.tld);
  const walletAddress = ensureAddress(input.walletAddress);
  ensureValidLabel(label);
  ensureDuration(input.durationSeconds);

  const chainId = oorthNexusNetwork.chainId;
  await ensureWalletOwnedByUser(input.userId, walletAddress, chainId);

  const tldConfig = getTldConfig(tld);
  const { controllerAbi } = getAbiBundle();
  const controllerRules = await readControllerConfig(tldConfig.controllerAddress);

  if (BigInt(input.durationSeconds) < controllerRules.minRegistrationDuration) {
    throw new HttpError(
      400,
      "DURATION_TOO_SHORT",
      `Minimum registration duration is ${controllerRules.minRegistrationDuration.toString()} seconds`
    );
  }

  const [isValid, isAvailable, rentPrice] = await Promise.all([
    publicClient.readContract({
      address: tldConfig.controllerAddress,
      abi: controllerAbi,
      functionName: "valid",
      args: [label],
    }),
    publicClient.readContract({
      address: tldConfig.controllerAddress,
      abi: controllerAbi,
      functionName: "available",
      args: [label],
    }),
    readRentPrice(tldConfig.controllerAddress, label, input.durationSeconds),
  ]);

  if (!isValid) {
    throw new HttpError(400, "INVALID_LABEL", "Label is not valid for this TLD");
  }

  if (!isAvailable) {
    throw new HttpError(409, "DOMAIN_NOT_AVAILABLE", "Domain is not available for registration");
  }

  const secret = createSecret();
  const referrer = toHex32(input.referrer);
  const registration = buildRegistrationTuple({
    label,
    walletAddress,
    durationSeconds: input.durationSeconds,
    resolverAddress: getEnsCoreContracts().publicResolver,
    secret,
    referrer,
  });

  const commitment = (await publicClient.readContract({
    address: tldConfig.controllerAddress,
    abi: controllerAbi,
    functionName: "makeCommitment",
    args: [registration],
  })) as Hex;

  const secretHash = keccak256(secret);
  const price = toPriceSummary(rentPrice.base, rentPrice.premium);
  const now = new Date();
  const intentId = randomUUID();
  const domainName = toDomainName(label, tld);

  await authDb.insert(schema.ensPurchaseIntents).values({
    id: intentId,
    userId: input.userId,
    chainId,
    walletAddress,
    tld,
    label,
    domainName,
    durationSeconds: input.durationSeconds,
    resolverAddress: getEnsCoreContracts().publicResolver,
    controllerAddress: tldConfig.controllerAddress,
    baseRegistrarAddress: tldConfig.baseRegistrarAddress,
    secretHash,
    commitment,
    registerValueWei: price.valueWithBuffer.toString(),
    minCommitmentAgeSeconds: Number(controllerRules.minCommitmentAge),
    maxCommitmentAgeSeconds: Number(controllerRules.maxCommitmentAge),
    status: "prepared",
    createdAt: now,
    updatedAt: now,
  });

  return {
    intentId,
    domainName,
    secret,
    commitment,
    chainId,
    price,
    rules: {
      minCommitmentAgeSeconds: Number(controllerRules.minCommitmentAge),
      maxCommitmentAgeSeconds: Number(controllerRules.maxCommitmentAge),
      minRegistrationDurationSeconds: Number(controllerRules.minRegistrationDuration),
    },
    tx: {
      to: tldConfig.controllerAddress,
      functionName: "commit",
      args: [commitment],
      value: "0",
      data: encodeFunctionData({
        abi: controllerAbi,
        functionName: "commit",
        args: [commitment],
      }),
    },
    registration,
  };
};

export const confirmCommitmentIntent = async (input: {
  userId: string;
  intentId: string;
  txHash: string;
}) => {
  const intent = await getIntentByUser(input.userId, input.intentId);
  const txHash = toTxHash(input.txHash);
  const wasRegistered = intent.status === "registered";

  if (wasRegistered && intent.commitTxHash && intent.commitTxHash.toLowerCase() !== txHash.toLowerCase()) {
    throw new HttpError(
      409,
      "INTENT_STATE_INVALID",
      "Intent already registered with a different commitment transaction"
    );
  }

  if (!["prepared", "committed", "registerable", "registered"].includes(intent.status)) {
    throw new HttpError(409, "INTENT_STATE_INVALID", `Cannot confirm commitment from state '${intent.status}'`);
  }

  const [receipt, tx, commitmentTimestamp] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: txHash }),
    publicClient.getTransaction({ hash: txHash }),
    publicClient.readContract({
      address: intent.controllerAddress as Address,
      abi: getAbiBundle().controllerAbi,
      functionName: "commitments",
      args: [intent.commitment as Hex],
    }),
  ]);

  if (receipt.status !== "success") {
    throw new HttpError(409, "COMMIT_TX_FAILED", "Commit transaction failed on-chain");
  }

  if (!tx.to || normalizeAddress(tx.to) !== normalizeAddress(intent.controllerAddress)) {
    throw new HttpError(400, "INVALID_COMMIT_TX", "Commit transaction target does not match controller");
  }

  if (tx.value !== 0n) {
    throw new HttpError(400, "INVALID_COMMIT_TX", "Commit transaction must use zero value");
  }

  assertCommitTxMatchesIntent({
    txInput: tx.input,
    expectedCommitment: intent.commitment,
  });

  if ((commitmentTimestamp as bigint) === 0n) {
    throw new HttpError(409, "COMMITMENT_NOT_FOUND", "Commitment was not recorded on-chain");
  }

  const committedAt = secondsToDate(commitmentTimestamp as bigint);
  const registerableAtSeconds = (commitmentTimestamp as bigint) + BigInt(intent.minCommitmentAgeSeconds);
  const registerBySeconds = (commitmentTimestamp as bigint) + BigInt(intent.maxCommitmentAgeSeconds);
  const registerableAt = secondsToDate(registerableAtSeconds);
  const registerBy = secondsToDate(registerBySeconds);
  const now = new Date();

  const status = wasRegistered ? "registered" : now >= registerableAt ? "registerable" : "committed";

  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      commitTxHash: txHash,
      committedAt,
      registerableAt,
      registerBy,
      status,
      updatedAt: now,
      failureReason: null,
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  return {
    intent: summarizeIntent({ ...intent, commitTxHash: txHash, committedAt, registerableAt, registerBy, status }),
  };
};

export const prepareRegisterTransaction = async (input: {
  userId: string;
  intentId: string;
  secret: string;
}) => {
  const intent = await getIntentByUser(input.userId, input.intentId);

  if (!["prepared", "committed", "registerable"].includes(intent.status)) {
    throw new HttpError(409, "INTENT_STATE_INVALID", `Cannot prepare register from state '${intent.status}'`);
  }

  const secret = input.secret.toLowerCase() as Hex;

  if (!/^0x[0-9a-f]{64}$/.test(secret)) {
    throw new HttpError(400, "INVALID_SECRET", "Secret must be 32-byte hex string");
  }

  if (keccak256(secret) !== intent.secretHash) {
    throw new HttpError(400, "SECRET_MISMATCH", "Secret does not match commitment intent");
  }

  const commitmentTimestamp = (await publicClient.readContract({
    address: intent.controllerAddress as Address,
    abi: getAbiBundle().controllerAbi,
    functionName: "commitments",
    args: [intent.commitment as Hex],
  })) as bigint;

  if (commitmentTimestamp === 0n) {
    throw new HttpError(409, "COMMITMENT_NOT_FOUND", "Commitment not found on-chain; submit commit transaction first");
  }

  const now = nowSeconds();
  const registerableAtSeconds = commitmentTimestamp + BigInt(intent.minCommitmentAgeSeconds);
  const registerBySeconds = commitmentTimestamp + BigInt(intent.maxCommitmentAgeSeconds);

  if (now < registerableAtSeconds) {
    throw new HttpError(
      409,
      "COMMITMENT_NOT_READY",
      `Commitment is not ready yet. Wait ${Number(registerableAtSeconds - now)} seconds`
    );
  }

  if (now > registerBySeconds) {
    await authDb
      .update(schema.ensPurchaseIntents)
      .set({ status: "expired", updatedAt: new Date(), failureReason: "Commitment expired before register" })
      .where(eq(schema.ensPurchaseIntents.id, intent.id));

    throw new HttpError(409, "COMMITMENT_EXPIRED", "Commitment expired. Create a new commitment intent");
  }

  const rentPrice = await readRentPrice(intent.controllerAddress as Address, intent.label, intent.durationSeconds);
  const price = toPriceSummary(rentPrice.base, rentPrice.premium);

  const registration = buildRegistrationTuple({
    label: intent.label,
    walletAddress: intent.walletAddress,
    durationSeconds: intent.durationSeconds,
    resolverAddress: intent.resolverAddress,
    secret,
    referrer: ZERO_BYTES32,
  });

  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      registerValueWei: price.valueWithBuffer.toString(),
      status: "registerable",
      registerableAt: secondsToDate(registerableAtSeconds),
      registerBy: secondsToDate(registerBySeconds),
      updatedAt: new Date(),
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  return {
    intent: summarizeIntent({
      ...intent,
      status: "registerable",
      registerableAt: secondsToDate(registerableAtSeconds),
      registerBy: secondsToDate(registerBySeconds),
      registerValueWei: price.valueWithBuffer.toString(),
    }),
    price,
    registration,
    tx: {
      to: intent.controllerAddress,
      functionName: "register",
      args: [registration],
      value: price.valueWithBuffer.toString(),
      data: encodeFunctionData({
        abi: getAbiBundle().controllerAbi,
        functionName: "register",
        args: [registration],
      }),
    },
  };
};

export const confirmRegisterTransaction = async (input: {
  userId: string;
  intentId: string;
  txHash: string;
  setPrimary?: boolean;
}) => {
  const intent = await getIntentByUser(input.userId, input.intentId);
  const txHash = toTxHash(input.txHash);

  if (intent.status === "registered") {
    if (intent.registerTxHash && intent.registerTxHash.toLowerCase() !== txHash.toLowerCase()) {
      throw new HttpError(
        409,
        "INTENT_STATE_INVALID",
        "Intent already registered with a different register transaction"
      );
    }

    const [existingDomain] = await authDb
      .select()
      .from(schema.ensIdentities)
      .where(and(eq(schema.ensIdentities.userId, input.userId), eq(schema.ensIdentities.name, intent.domainName)))
      .limit(1);

    if (!existingDomain) {
      throw new HttpError(
        409,
        "REGISTER_STATE_INCONSISTENT",
        "Intent is registered but domain record was not found"
      );
    }

    return {
      domain: existingDomain,
      registerTxHash: intent.registerTxHash ?? txHash,
    };
  }

  if (!["committed", "registerable"].includes(intent.status)) {
    throw new HttpError(409, "INTENT_STATE_INVALID", `Cannot confirm register from state '${intent.status}'`);
  }

  const [receipt, tx] = await Promise.all([
    publicClient.getTransactionReceipt({ hash: txHash }),
    publicClient.getTransaction({ hash: txHash }),
  ]);

  if (receipt.status !== "success") {
    await authDb
      .update(schema.ensPurchaseIntents)
      .set({ status: "failed", registerTxHash: txHash, failureReason: "Register tx reverted", updatedAt: new Date() })
      .where(eq(schema.ensPurchaseIntents.id, intent.id));
    throw new HttpError(409, "REGISTER_TX_FAILED", "Register transaction failed on-chain");
  }

  if (!tx.to || normalizeAddress(tx.to) !== normalizeAddress(intent.controllerAddress)) {
    throw new HttpError(400, "INVALID_REGISTER_TX", "Register transaction target does not match controller");
  }

  assertRegisterTxMatchesIntent({
    txInput: tx.input,
    expectedLabel: intent.label,
    expectedOwner: intent.walletAddress,
    expectedDurationSeconds: intent.durationSeconds,
    expectedResolver: intent.resolverAddress,
  });

  const { controllerAbi } = getAbiBundle();

  const registeredLog = receipt.logs
    .map((log) => {
      try {
        return decodeEventLog({
          abi: controllerAbi,
          topics: log.topics,
          data: log.data,
          strict: false,
        });
      } catch {
        return null;
      }
    })
    .find((event) => event?.eventName === "NameRegistered");

  if (!registeredLog) {
    throw new HttpError(409, "REGISTER_EVENT_MISSING", "NameRegistered event not found in transaction receipt");
  }

  const label = String((registeredLog.args as { label?: string }).label ?? "").toLowerCase();
  if (label !== intent.label) {
    throw new HttpError(409, "REGISTER_LABEL_MISMATCH", "Registered label does not match commitment intent");
  }

  const ownerAddress = normalizeAddress(
    String((registeredLog.args as { owner?: string }).owner ?? intent.walletAddress)
  );
  const expiresRaw = (registeredLog.args as { expires?: bigint }).expires ?? 0n;
  const expiresAt = expiresRaw > 0n ? secondsToDate(expiresRaw) : null;

  if (input.setPrimary) {
    await authDb
      .update(schema.ensIdentities)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(eq(schema.ensIdentities.userId, input.userId));
  }

  const now = new Date();
  const domainNode = namehash(intent.domainName);

  await authDb
    .insert(schema.ensIdentities)
    .values({
      id: randomUUID(),
      userId: input.userId,
      chainId: intent.chainId,
      tld: intent.tld,
      name: intent.domainName,
      label: intent.label,
      node: domainNode,
      resolverAddress: intent.resolverAddress,
      ownerAddress,
      controllerAddress: intent.controllerAddress,
      baseRegistrarAddress: intent.baseRegistrarAddress,
      txHash,
      status: "active",
      isPrimary: Boolean(input.setPrimary),
      commitmentId: intent.id,
      expiresAt,
      registeredAt: now,
      claimedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.ensIdentities.name,
      set: {
        userId: input.userId,
        chainId: intent.chainId,
        tld: intent.tld,
        label: intent.label,
        node: domainNode,
        resolverAddress: intent.resolverAddress,
        ownerAddress,
        controllerAddress: intent.controllerAddress,
        baseRegistrarAddress: intent.baseRegistrarAddress,
        txHash,
        status: "active",
        isPrimary: Boolean(input.setPrimary),
        commitmentId: intent.id,
        expiresAt,
        registeredAt: now,
        claimedAt: now,
        updatedAt: now,
      },
    });

  if (input.setPrimary) {
    await authDb
      .update(schema.ensIdentities)
      .set({ isPrimary: false, updatedAt: now })
      .where(
        and(eq(schema.ensIdentities.userId, input.userId), ne(schema.ensIdentities.name, intent.domainName))
      );
  }

  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      status: "registered",
      registerTxHash: txHash,
      failureReason: null,
      updatedAt: now,
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  const [domain] = await authDb
    .select()
    .from(schema.ensIdentities)
    .where(and(eq(schema.ensIdentities.userId, input.userId), eq(schema.ensIdentities.name, intent.domainName)))
    .limit(1);

  return {
    domain,
    registerTxHash: txHash,
  };
};

export const listUserDomains = async (userId: string) =>
  authDb
    .select()
    .from(schema.ensIdentities)
    .where(eq(schema.ensIdentities.userId, userId))
    .orderBy(desc(schema.ensIdentities.isPrimary), desc(schema.ensIdentities.registeredAt));

export const listUserPurchaseIntents = async (userId: string, limit = 20) => {
  const capped = Math.max(1, Math.min(limit, 100));
  const rows = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.userId, userId))
    .orderBy(desc(schema.ensPurchaseIntents.createdAt))
    .limit(capped);

  return rows.map((row) => summarizeIntent(row));
};

export const prepareSetAddressRecord = async (input: {
  userId: string;
  domainName: string;
  address: string;
}) => {
  const domainName = input.domainName.trim().toLowerCase();
  const address = ensureAddress(input.address);

  const [domain] = await authDb
    .select()
    .from(schema.ensIdentities)
    .where(and(eq(schema.ensIdentities.userId, input.userId), eq(schema.ensIdentities.name, domainName)))
    .limit(1);

  if (!domain) {
    throw new HttpError(404, "DOMAIN_NOT_FOUND", "Domain not found for current user");
  }

  const node = namehash(domainName);

  return {
    domain,
    tx: {
      to: getEnsCoreContracts().publicResolver,
      functionName: "setAddr",
      args: [node, address],
      value: "0",
    },
  };
};

export const prepareRenewal = async (input: {
  userId: string;
  domainName: string;
  durationSeconds: number;
  referrer?: string;
}) => {
  ensureDuration(input.durationSeconds);

  const [domain] = await authDb
    .select()
    .from(schema.ensIdentities)
    .where(and(eq(schema.ensIdentities.userId, input.userId), eq(schema.ensIdentities.name, input.domainName)))
    .limit(1);

  if (!domain) {
    throw new HttpError(404, "DOMAIN_NOT_FOUND", "Domain not found for current user");
  }

  const price = await readRentPrice(domain.controllerAddress as Address, domain.label, input.durationSeconds);
  const valueWithBuffer = (price.base * 110n) / 100n;
  const referrer = toHex32(input.referrer);

  return {
    domain,
    price: {
      base: price.base,
      premium: price.premium,
      renewalValueWithBuffer: valueWithBuffer,
    },
    tx: {
      to: domain.controllerAddress,
      functionName: "renew",
      args: [domain.label, BigInt(input.durationSeconds), referrer],
      value: valueWithBuffer.toString(),
    },
  };
};
