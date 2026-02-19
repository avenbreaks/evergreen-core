import { randomUUID } from "node:crypto";

import { asc, eq, inArray } from "drizzle-orm";
import { createPublicClient, http, labelhash, namehash, type Address, type Hex } from "viem";

import { authDb, oorthNexusNetwork } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";
import { getAbiBundle } from "./ens-contracts";
import { confirmCommitmentIntentByIntentId, confirmRegisterTransactionByIntentId } from "./ens-marketplace";

const WATCHABLE_INTENT_STATUSES = ["prepared", "committed", "registerable"] as const;

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

type WatchableIntentStatus = (typeof WATCHABLE_INTENT_STATUSES)[number];

type PurchaseIntentRecord = typeof schema.ensPurchaseIntents.$inferSelect;

type WatchError = {
  intentId: string;
  code: string;
  message: string;
};

export type WatchPendingEnsTransactionsResult = {
  scanned: number;
  checkedCommitTx: number;
  checkedRegisterTx: number;
  syncedCommitments: number;
  syncedRegistrations: number;
  expired: number;
  unchanged: number;
  failed: number;
  startedAt: Date;
  finishedAt: Date;
  errors: WatchError[];
};

const clampLimit = (value: number | undefined): number => {
  const fallback = backendEnv.ensTxWatcherLimit;
  if (!value || !Number.isInteger(value)) {
    return fallback;
  }

  return Math.max(1, Math.min(value, 500));
};

const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

const secondsToDate = (seconds: bigint): Date => new Date(Number(seconds) * 1000);

const normalizeAddress = (address: string): Address => address.trim().toLowerCase() as Address;

const sameDate = (left: Date | null, right: Date | null): boolean => {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.getTime() === right.getTime();
};

const toErrorDetails = (error: unknown): Omit<WatchError, "intentId"> => {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "WATCHER_UNHANDLED_ERROR",
      message: error.message,
    };
  }

  return {
    code: "WATCHER_UNHANDLED_ERROR",
    message: "Unknown watcher error",
  };
};

const pushError = (errors: WatchError[], error: WatchError): void => {
  if (errors.length >= 50) {
    return;
  }

  errors.push(error);
};

const loadWatchCandidates = async (limit: number): Promise<PurchaseIntentRecord[]> =>
  authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(inArray(schema.ensPurchaseIntents.status, WATCHABLE_INTENT_STATUSES))
    .orderBy(asc(schema.ensPurchaseIntents.updatedAt))
    .limit(limit);

const loadIntentById = async (intentId: string): Promise<PurchaseIntentRecord> => {
  const [intent] = await authDb
    .select()
    .from(schema.ensPurchaseIntents)
    .where(eq(schema.ensPurchaseIntents.id, intentId))
    .limit(1);

  if (!intent) {
    throw new HttpError(404, "INTENT_NOT_FOUND", "ENS purchase intent not found during tx watcher sync");
  }

  return intent;
};

const syncCommitmentFromChain = async (
  intent: PurchaseIntentRecord
): Promise<{ updated: boolean; intent: PurchaseIntentRecord }> => {
  const { controllerAbi } = getAbiBundle();
  const commitmentTimestamp = (await publicClient.readContract({
    address: intent.controllerAddress as Address,
    abi: controllerAbi,
    functionName: "commitments",
    args: [intent.commitment as Hex],
  })) as bigint;

  if (commitmentTimestamp === 0n) {
    return {
      updated: false,
      intent,
    };
  }

  const committedAt = secondsToDate(commitmentTimestamp);
  const registerableAtSeconds = commitmentTimestamp + BigInt(intent.minCommitmentAgeSeconds);
  const registerBySeconds = commitmentTimestamp + BigInt(intent.maxCommitmentAgeSeconds);
  const registerableAt = secondsToDate(registerableAtSeconds);
  const registerBy = secondsToDate(registerBySeconds);
  const nextStatus: WatchableIntentStatus = new Date() >= registerableAt ? "registerable" : "committed";

  const shouldUpdate =
    intent.status !== nextStatus ||
    !sameDate(intent.committedAt, committedAt) ||
    !sameDate(intent.registerableAt, registerableAt) ||
    !sameDate(intent.registerBy, registerBy) ||
    intent.failureReason !== null;

  if (!shouldUpdate) {
    return {
      updated: false,
      intent,
    };
  }

  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      committedAt,
      registerableAt,
      registerBy,
      status: nextStatus,
      failureReason: null,
      updatedAt: new Date(),
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  return {
    updated: true,
    intent: await loadIntentById(intent.id),
  };
};

const syncRegistrationFromChain = async (
  intent: PurchaseIntentRecord
): Promise<{ updated: boolean; intent: PurchaseIntentRecord }> => {
  if (!(["committed", "registerable"] as const).includes(intent.status as "committed" | "registerable")) {
    return {
      updated: false,
      intent,
    };
  }

  const { baseRegistrarAbi } = getAbiBundle();
  const tokenId = BigInt(labelhash(intent.label));
  const expiresRaw = (await publicClient.readContract({
    address: intent.baseRegistrarAddress as Address,
    abi: baseRegistrarAbi,
    functionName: "nameExpires",
    args: [tokenId],
  })) as bigint;

  if (expiresRaw <= nowSeconds()) {
    return {
      updated: false,
      intent,
    };
  }

  const ownerAddress = normalizeAddress(
    String(
      (await publicClient.readContract({
        address: intent.baseRegistrarAddress as Address,
        abi: baseRegistrarAbi,
        functionName: "ownerOf",
        args: [tokenId],
      })) as Address
    )
  );

  if (ownerAddress !== normalizeAddress(intent.walletAddress)) {
    return {
      updated: false,
      intent,
    };
  }

  const now = new Date();
  const expiresAt = secondsToDate(expiresRaw);
  const domainNode = namehash(intent.domainName);

  await authDb
    .insert(schema.ensIdentities)
    .values({
      id: randomUUID(),
      userId: intent.userId,
      chainId: intent.chainId,
      tld: intent.tld,
      name: intent.domainName,
      label: intent.label,
      node: domainNode,
      resolverAddress: intent.resolverAddress,
      ownerAddress,
      controllerAddress: intent.controllerAddress,
      baseRegistrarAddress: intent.baseRegistrarAddress,
      txHash: intent.registerTxHash,
      status: "active",
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
        userId: intent.userId,
        chainId: intent.chainId,
        tld: intent.tld,
        label: intent.label,
        node: domainNode,
        resolverAddress: intent.resolverAddress,
        ownerAddress,
        controllerAddress: intent.controllerAddress,
        baseRegistrarAddress: intent.baseRegistrarAddress,
        txHash: intent.registerTxHash,
        status: "active",
        commitmentId: intent.id,
        expiresAt,
        registeredAt: now,
        claimedAt: now,
        updatedAt: now,
      },
    });

  if (intent.status !== "registered" || intent.failureReason !== null) {
    await authDb
      .update(schema.ensPurchaseIntents)
      .set({
        status: "registered",
        failureReason: null,
        updatedAt: now,
      })
      .where(eq(schema.ensPurchaseIntents.id, intent.id));
  }

  return {
    updated: true,
    intent: await loadIntentById(intent.id),
  };
};

const expireIntentIfNeeded = async (intent: PurchaseIntentRecord): Promise<boolean> => {
  if (!(["committed", "registerable"] as const).includes(intent.status as "committed" | "registerable")) {
    return false;
  }

  if (!intent.registerBy || intent.registerBy > new Date()) {
    return false;
  }

  await authDb
    .update(schema.ensPurchaseIntents)
    .set({
      status: "expired",
      failureReason: "Commitment window expired during tx watcher fallback",
      updatedAt: new Date(),
    })
    .where(eq(schema.ensPurchaseIntents.id, intent.id));

  return true;
};

const canAttemptRegisterConfirm = (intent: PurchaseIntentRecord): boolean =>
  Boolean(intent.registerTxHash) && (["committed", "registerable"] as const).includes(intent.status as "committed" | "registerable");

const canAttemptCommitConfirm = (intent: PurchaseIntentRecord): boolean =>
  Boolean(intent.commitTxHash) && WATCHABLE_INTENT_STATUSES.includes(intent.status as WatchableIntentStatus);

export const watchPendingEnsTransactions = async (input: {
  limit?: number;
} = {}): Promise<WatchPendingEnsTransactionsResult> => {
  const startedAt = new Date();
  const limit = clampLimit(input.limit);
  const candidates = await loadWatchCandidates(limit);
  const errors: WatchError[] = [];

  let checkedCommitTx = 0;
  let checkedRegisterTx = 0;
  let syncedCommitments = 0;
  let syncedRegistrations = 0;
  let expired = 0;
  let unchanged = 0;
  let failed = 0;

  for (const candidate of candidates) {
    let intent = candidate;
    let changed = false;

    try {
      if (canAttemptRegisterConfirm(intent)) {
        checkedRegisterTx += 1;

        try {
          await confirmRegisterTransactionByIntentId({
            intentId: intent.id,
            txHash: intent.registerTxHash as string,
          });
          syncedRegistrations += 1;
          continue;
        } catch (error) {
          const details = toErrorDetails(error);
          pushError(errors, {
            intentId: intent.id,
            code: details.code,
            message: details.message,
          });
        }
      }

      if (canAttemptCommitConfirm(intent)) {
        checkedCommitTx += 1;

        try {
          await confirmCommitmentIntentByIntentId({
            intentId: intent.id,
            txHash: intent.commitTxHash as string,
          });
          syncedCommitments += 1;
          changed = true;
          intent = await loadIntentById(intent.id);
        } catch (error) {
          const details = toErrorDetails(error);
          pushError(errors, {
            intentId: intent.id,
            code: details.code,
            message: details.message,
          });
        }
      }

      const commitmentSync = await syncCommitmentFromChain(intent);
      if (commitmentSync.updated) {
        syncedCommitments += 1;
        changed = true;
      }
      intent = commitmentSync.intent;

      const registrationSync = await syncRegistrationFromChain(intent);
      if (registrationSync.updated) {
        syncedRegistrations += 1;
        changed = true;
        continue;
      }
      intent = registrationSync.intent;

      const wasExpired = await expireIntentIfNeeded(intent);
      if (wasExpired) {
        expired += 1;
        changed = true;
      }

      if (!changed) {
        unchanged += 1;
      }
    } catch (error) {
      const details = toErrorDetails(error);
      pushError(errors, {
        intentId: intent.id,
        code: details.code,
        message: details.message,
      });
      failed += 1;
    }
  }

  return {
    scanned: candidates.length,
    checkedCommitTx,
    checkedRegisterTx,
    syncedCommitments,
    syncedRegistrations,
    expired,
    unchanged,
    failed,
    startedAt,
    finishedAt: new Date(),
    errors,
  };
};
