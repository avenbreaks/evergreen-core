import { randomUUID } from "node:crypto";

import { createDb, schema } from "@evergreen-devparty/db";
import { eq } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

export type CreatePendingEnsIdentityInput = {
  db: Db;
  userId: string;
  chainId: number;
  label: string;
  rootDomain?: string;
};

const ENS_LABEL_REGEX = /^[a-z0-9-]{3,63}$/;

export const normalizeEnsLabel = (label: string): string => label.trim().toLowerCase();

export const isValidEnsLabel = (label: string): boolean => ENS_LABEL_REGEX.test(normalizeEnsLabel(label));

export const toEnsName = (label: string, rootDomain = "devparty"): string =>
  `${normalizeEnsLabel(label)}.${rootDomain}`;

export const createPendingEnsIdentity = async (
  input: CreatePendingEnsIdentityInput
): Promise<{ id: string; name: string; label: string }> => {
  const now = new Date();
  const label = normalizeEnsLabel(input.label);
  const rootDomain = normalizeEnsLabel(input.rootDomain ?? "devparty");

  if (!isValidEnsLabel(label)) {
    throw new Error("ENS label is invalid. Use 3-63 chars: a-z, 0-9, and '-'");
  }

  const name = toEnsName(label, rootDomain);

  const [existingName] = await input.db
    .select({ userId: schema.ensIdentities.userId })
    .from(schema.ensIdentities)
    .where(eq(schema.ensIdentities.name, name))
    .limit(1);

  if (existingName && existingName.userId !== input.userId) {
    throw new Error("ENS name is already claimed");
  }

  const id = randomUUID();

  await input.db
    .insert(schema.ensIdentities)
    .values({
      id,
      userId: input.userId,
      chainId: input.chainId,
      name,
      label,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: schema.ensIdentities.userId,
      set: {
        chainId: input.chainId,
        name,
        label,
        status: "pending",
        txHash: null,
        claimedAt: null,
        updatedAt: now,
      },
    });

  return { id, name, label };
};
