import { z } from "zod";

export const webhookTxHashSchema = z.string().regex(/^0x[a-fA-F0-9]{64}$/);

export const ensWebhookPayloadSchema = z.discriminatedUnion("event", [
  z.object({
    event: z.literal("ens.commit.confirmed"),
    data: z.object({
      intentId: z.string().uuid(),
      txHash: webhookTxHashSchema,
    }),
  }),
  z.object({
    event: z.literal("ens.register.confirmed"),
    data: z.object({
      intentId: z.string().uuid(),
      txHash: webhookTxHashSchema,
      setPrimary: z.boolean().optional(),
    }),
  }),
  z.object({
    event: z.literal("ens.register.failed"),
    data: z.object({
      intentId: z.string().uuid(),
      txHash: webhookTxHashSchema.optional(),
      reason: z.string().min(1).max(500),
    }),
  }),
]);

export type EnsWebhookPayload = z.infer<typeof ensWebhookPayloadSchema>;

export type EnsWebhookProcessorDependencies = {
  confirmCommitmentIntentByIntentId: (input: { intentId: string; txHash: string }) => Promise<{ intent: unknown }>;
  confirmRegisterTransactionByIntentId: (input: {
    intentId: string;
    txHash: string;
    setPrimary?: boolean;
  }) => Promise<{ domain: unknown; registerTxHash: string }>;
  markPurchaseIntentFailed: (input: {
    intentId: string;
    reason: string;
    txHash?: string;
  }) => Promise<unknown>;
};

export const loadDefaultEnsWebhookProcessorDependencies = async (): Promise<EnsWebhookProcessorDependencies> => {
  const ensMarketplaceService = await import("./ens-marketplace");

  return {
    confirmCommitmentIntentByIntentId: ensMarketplaceService.confirmCommitmentIntentByIntentId,
    confirmRegisterTransactionByIntentId: ensMarketplaceService.confirmRegisterTransactionByIntentId,
    markPurchaseIntentFailed: ensMarketplaceService.markPurchaseIntentFailed,
  };
};

export const processEnsWebhookPayload = async (
  payload: EnsWebhookPayload,
  deps: EnsWebhookProcessorDependencies
): Promise<
  | {
      acknowledged: true;
      event: "ens.commit.confirmed";
      intent: unknown;
    }
  | {
      acknowledged: true;
      event: "ens.register.confirmed";
      domain: unknown;
      registerTxHash: string;
    }
  | {
      acknowledged: true;
      event: "ens.register.failed";
      intent: unknown;
    }
> => {
  if (payload.event === "ens.commit.confirmed") {
    const result = await deps.confirmCommitmentIntentByIntentId({
      intentId: payload.data.intentId,
      txHash: payload.data.txHash,
    });

    return {
      acknowledged: true,
      event: payload.event,
      intent: result.intent,
    };
  }

  if (payload.event === "ens.register.confirmed") {
    const result = await deps.confirmRegisterTransactionByIntentId({
      intentId: payload.data.intentId,
      txHash: payload.data.txHash,
      setPrimary: payload.data.setPrimary,
    });

    return {
      acknowledged: true,
      event: payload.event,
      domain: result.domain,
      registerTxHash: result.registerTxHash,
    };
  }

  const intent = await deps.markPurchaseIntentFailed({
    intentId: payload.data.intentId,
    txHash: payload.data.txHash,
    reason: payload.data.reason,
  });

  return {
    acknowledged: true,
    event: payload.event,
    intent,
  };
};
