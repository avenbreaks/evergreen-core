import { randomBytes, randomUUID } from "node:crypto";

import { createDb, schema } from "@evergreen-devparty/db";
import { and, eq, gt, isNull } from "drizzle-orm";
import { SiweMessage } from "siwe";

import { authEnv } from "./env";

type Db = ReturnType<typeof createDb>;

export type CreateSiweChallengeInput = {
  db: Db;
  walletAddress: string;
  chainId: number;
  domain?: string;
  uri?: string;
  statement?: string;
  ttlSeconds?: number;
};

export type CreateSiweChallengeResult = {
  nonce: string;
  message: string;
  expiresAt: Date;
};

export type VerifySiweChallengeInput = {
  db: Db;
  message: string;
  signature: string;
  expectedDomain?: string;
  expectedUri?: string;
  allowedChainIds?: number[];
};

export type VerifySiweChallengeResult = {
  nonceId: string;
  nonce: string;
  address: string;
  chainId: number;
};

export type LinkSiweIdentityInput = {
  db: Db;
  userId: string;
  address: string;
  chainId: number;
  setAsPrimary?: boolean;
};

const normalizeAddress = (address: string): string => address.trim().toLowerCase();

const createNonceValue = (): string => randomBytes(16).toString("hex");

export const createSiweChallenge = async (
  input: CreateSiweChallengeInput
): Promise<CreateSiweChallengeResult> => {
  const nonce = createNonceValue();
  const now = new Date();
  const ttlSeconds = input.ttlSeconds ?? authEnv.siwe.nonceTtlSeconds;
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  const walletAddress = normalizeAddress(input.walletAddress);
  const domain = input.domain ?? authEnv.siwe.domain;
  const uri = input.uri ?? authEnv.siwe.uri;
  const statement = input.statement ?? authEnv.siwe.statement;

  await input.db.insert(schema.siweNonces).values({
    id: randomUUID(),
    nonce,
    walletAddress,
    chainId: input.chainId,
    domain,
    uri,
    statement,
    expiresAt,
  });

  const message = new SiweMessage({
    domain,
    address: walletAddress,
    statement,
    uri,
    version: "1",
    chainId: input.chainId,
    nonce,
  }).prepareMessage();

  return {
    nonce,
    message,
    expiresAt,
  };
};

export const verifySiweChallenge = async (
  input: VerifySiweChallengeInput
): Promise<VerifySiweChallengeResult> => {
  const parsed = new SiweMessage(input.message);
  const now = new Date();

  const [nonceRecord] = await input.db
    .select()
    .from(schema.siweNonces)
    .where(
      and(
        eq(schema.siweNonces.nonce, parsed.nonce),
        isNull(schema.siweNonces.consumedAt),
        gt(schema.siweNonces.expiresAt, now)
      )
    )
    .limit(1);

  if (!nonceRecord) {
    throw new Error("SIWE nonce is invalid or expired");
  }

  const expectedDomain = input.expectedDomain ?? authEnv.siwe.domain;
  const expectedUri = input.expectedUri ?? authEnv.siwe.uri;
  const allowedChainIds = input.allowedChainIds ?? authEnv.siwe.chainIdAllowlist;

  if (nonceRecord.domain !== expectedDomain) {
    throw new Error("SIWE domain mismatch");
  }

  if (nonceRecord.uri !== expectedUri) {
    throw new Error("SIWE uri mismatch");
  }

  if (!allowedChainIds.includes(nonceRecord.chainId)) {
    throw new Error("SIWE chain is not in allowlist");
  }

  const verification = await parsed.verify({
    signature: input.signature,
    domain: expectedDomain,
    nonce: nonceRecord.nonce,
    time: now.toISOString(),
  });

  if (!verification.success) {
    throw new Error("SIWE signature verification failed");
  }

  const verifiedAddress = normalizeAddress(parsed.address);
  if (verifiedAddress !== nonceRecord.walletAddress) {
    throw new Error("SIWE address mismatch");
  }

  await input.db
    .update(schema.siweNonces)
    .set({ consumedAt: now })
    .where(eq(schema.siweNonces.id, nonceRecord.id));

  return {
    nonceId: nonceRecord.id,
    nonce: nonceRecord.nonce,
    address: verifiedAddress,
    chainId: nonceRecord.chainId,
  };
};

export const linkSiweIdentity = async (input: LinkSiweIdentityInput): Promise<void> => {
  const now = new Date();
  const normalizedAddress = normalizeAddress(input.address);

  const [existingPrimary] = await input.db
    .select({ id: schema.wallets.id })
    .from(schema.wallets)
    .where(and(eq(schema.wallets.userId, input.userId), eq(schema.wallets.isPrimary, true)))
    .limit(1);

  const shouldBePrimary = input.setAsPrimary ?? !existingPrimary;

  if (shouldBePrimary) {
    await input.db
      .update(schema.wallets)
      .set({ isPrimary: false, updatedAt: now })
      .where(eq(schema.wallets.userId, input.userId));
  }

  await input.db
    .insert(schema.wallets)
    .values({
      id: randomUUID(),
      userId: input.userId,
      chainId: input.chainId,
      address: normalizedAddress,
      walletType: "evm",
      isPrimary: shouldBePrimary,
      verifiedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.wallets.chainId, schema.wallets.address],
      set: {
        userId: input.userId,
        isPrimary: shouldBePrimary,
        verifiedAt: now,
        updatedAt: now,
      },
    });

  const siweAccountId = `${input.chainId}:${normalizedAddress}`;
  await input.db
    .insert(schema.authAccounts)
    .values({
      id: randomUUID(),
      userId: input.userId,
      accountId: siweAccountId,
      providerId: "siwe",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [schema.authAccounts.providerId, schema.authAccounts.accountId],
      set: {
        userId: input.userId,
        updatedAt: now,
      },
    });
};
