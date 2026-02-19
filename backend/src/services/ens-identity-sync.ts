import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { createPublicClient, http, labelhash, type Address } from "viem";

import { authDb, oorthNexusNetwork } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { backendEnv } from "../config/env";
import { HttpError } from "../lib/http-error";
import { getAbiBundle } from "./ens-contracts";

const IDENTITY_SYNCABLE_STATUSES = ["active", "pending"] as const;

type IdentityRecord = typeof schema.ensIdentities.$inferSelect;
type IdentityStatus = (typeof IDENTITY_SYNCABLE_STATUSES)[number] | "revoked";

type SyncIdentityError = {
  identityId: string;
  name: string;
  code: string;
  message: string;
};

export type SyncEnsIdentitiesResult = {
  scanned: number;
  updated: number;
  activated: number;
  revoked: number;
  unchanged: number;
  failed: number;
  staleMinutes: number;
  startedAt: Date;
  finishedAt: Date;
  errors: SyncIdentityError[];
};

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

const normalizeAddress = (value: string): Address => value.trim().toLowerCase() as Address;

const secondsToDate = (seconds: bigint): Date => new Date(Number(seconds) * 1000);

const nowSeconds = (): bigint => BigInt(Math.floor(Date.now() / 1000));

const clampLimit = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.ensIdentitySyncLimit;
  }

  return Math.max(1, Math.min(value, 500));
};

const clampStaleMinutes = (value: number | undefined): number => {
  if (!value || !Number.isInteger(value)) {
    return backendEnv.ensIdentitySyncStaleMinutes;
  }

  return Math.max(1, Math.min(value, 7 * 24 * 60));
};

const toErrorDetails = (error: unknown): { code: string; message: string } => {
  if (error instanceof HttpError) {
    return {
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof Error) {
    return {
      code: "ENS_IDENTITY_SYNC_FAILED",
      message: error.message,
    };
  }

  return {
    code: "ENS_IDENTITY_SYNC_FAILED",
    message: "Unknown ENS identity sync failure",
  };
};

const sameDate = (left: Date | null, right: Date | null): boolean => {
  if (!left && !right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.getTime() === right.getTime();
};

const loadSyncCandidates = async (input: {
  staleMinutes: number;
  limit: number;
}): Promise<IdentityRecord[]> => {
  const staleThreshold = new Date(Date.now() - input.staleMinutes * 60 * 1000);

  return authDb
    .select()
    .from(schema.ensIdentities)
    .where(
      and(
        inArray(schema.ensIdentities.status, IDENTITY_SYNCABLE_STATUSES),
        lte(schema.ensIdentities.updatedAt, staleThreshold)
      )
    )
    .orderBy(asc(schema.ensIdentities.updatedAt))
    .limit(input.limit);
};

const loadLinkedWalletMap = async (userIds: string[]): Promise<Map<string, Set<string>>> => {
  if (userIds.length === 0) {
    return new Map();
  }

  const wallets = await authDb
    .select({
      userId: schema.wallets.userId,
      address: schema.wallets.address,
    })
    .from(schema.wallets)
    .where(inArray(schema.wallets.userId, userIds));

  const walletMap = new Map<string, Set<string>>();
  for (const wallet of wallets) {
    const normalizedAddress = normalizeAddress(wallet.address);
    const bucket = walletMap.get(wallet.userId) ?? new Set<string>();
    bucket.add(normalizedAddress);
    walletMap.set(wallet.userId, bucket);
  }

  return walletMap;
};

const readOwnerFromChain = async (identity: IdentityRecord, tokenId: bigint): Promise<Address | null> => {
  if (!identity.baseRegistrarAddress) {
    throw new HttpError(
      409,
      "IDENTITY_CONFIG_INVALID",
      "Identity missing base registrar address for on-chain sync"
    );
  }

  const { baseRegistrarAbi } = getAbiBundle();

  try {
    const owner = (await publicClient.readContract({
      address: identity.baseRegistrarAddress as Address,
      abi: baseRegistrarAbi,
      functionName: "ownerOf",
      args: [tokenId],
    })) as Address;

    return normalizeAddress(owner);
  } catch {
    return null;
  }
};

export const syncEnsIdentitiesFromChain = async (input: {
  limit?: number;
  staleMinutes?: number;
} = {}): Promise<SyncEnsIdentitiesResult> => {
  const startedAt = new Date();
  const limit = clampLimit(input.limit);
  const staleMinutes = clampStaleMinutes(input.staleMinutes);
  const candidates = await loadSyncCandidates({
    staleMinutes,
    limit,
  });
  const userIds = [...new Set(candidates.map((candidate) => candidate.userId))];
  const linkedWalletMap = await loadLinkedWalletMap(userIds);

  let updated = 0;
  let activated = 0;
  let revoked = 0;
  let unchanged = 0;
  let failed = 0;
  const errors: SyncIdentityError[] = [];

  for (const identity of candidates) {
    try {
      if (!identity.baseRegistrarAddress) {
        throw new HttpError(
          409,
          "IDENTITY_CONFIG_INVALID",
          "Identity missing base registrar address for on-chain sync"
        );
      }

      const tokenId = BigInt(labelhash(identity.label));
      const { baseRegistrarAbi } = getAbiBundle();
      const expiresRaw = (await publicClient.readContract({
        address: identity.baseRegistrarAddress as Address,
        abi: baseRegistrarAbi,
        functionName: "nameExpires",
        args: [tokenId],
      })) as bigint;
      const expiryDate = expiresRaw > 0n ? secondsToDate(expiresRaw) : null;
      const owner = expiresRaw > nowSeconds() ? await readOwnerFromChain(identity, tokenId) : null;

      const linkedWallets = linkedWalletMap.get(identity.userId) ?? new Set<string>();
      const ownerLinked = owner ? linkedWallets.has(owner) : false;

      const nextStatus: IdentityStatus = expiresRaw > nowSeconds() && ownerLinked ? "active" : "revoked";
      const nextPrimary = nextStatus === "active" ? identity.isPrimary : false;

      const ownerChanged = normalizeAddress(identity.ownerAddress ?? "0x0000000000000000000000000000000000000000") !==
        normalizeAddress(owner ?? "0x0000000000000000000000000000000000000000");
      const statusChanged = identity.status !== nextStatus;
      const expiresChanged = !sameDate(identity.expiresAt, expiryDate);
      const primaryChanged = identity.isPrimary !== nextPrimary;

      if (!ownerChanged && !statusChanged && !expiresChanged && !primaryChanged) {
        unchanged += 1;
        continue;
      }

      await authDb
        .update(schema.ensIdentities)
        .set({
          ownerAddress: owner,
          expiresAt: expiryDate,
          status: nextStatus,
          isPrimary: nextPrimary,
          updatedAt: new Date(),
        })
        .where(eq(schema.ensIdentities.id, identity.id));

      updated += 1;
      if (nextStatus === "active") {
        activated += 1;
      } else {
        revoked += 1;
      }
    } catch (error) {
      const details = toErrorDetails(error);
      failed += 1;

      if (errors.length < 50) {
        errors.push({
          identityId: identity.id,
          name: identity.name,
          code: details.code,
          message: details.message,
        });
      }
    }
  }

  return {
    scanned: candidates.length,
    updated,
    activated,
    revoked,
    unchanged,
    failed,
    staleMinutes,
    startedAt,
    finishedAt: new Date(),
    errors,
  };
};
