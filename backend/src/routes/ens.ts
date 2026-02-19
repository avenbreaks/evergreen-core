import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { requireAuthSession } from "../lib/auth-session";
import { serializeBigInt } from "../lib/serialize";
import { requireAuthSessionMiddleware } from "../middleware/auth-session";
import { createDebounceMiddleware, hashDebouncePayload } from "../middleware/debounce-limit";
import {
  checkDomainAvailability,
  confirmCommitmentIntent,
  confirmRegisterTransaction,
  createCommitmentIntent,
  listEnsTlds,
  listUserDomains,
  listUserPurchaseIntents,
  prepareRegisterTransaction,
  prepareRenewal,
  prepareSetAddressRecord,
} from "../services/ens-marketplace";

const domainCheckBodySchema = z.object({
  label: z.string().min(3).max(63),
  tld: z.string().min(2).max(64),
  durationSeconds: z.number().int().positive().optional(),
});

const commitmentCreateBodySchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  label: z.string().min(3).max(63),
  tld: z.string().min(2).max(64),
  durationSeconds: z.number().int().positive(),
  referrer: z.string().optional(),
});

const txHashBodySchema = z.object({
  txHash: z.string().min(66).max(66),
});

const prepareRegisterBodySchema = z.object({
  secret: z.string().min(66).max(66),
});

const confirmRegisterBodySchema = z.object({
  txHash: z.string().min(66).max(66),
  setPrimary: z.boolean().optional(),
});

const intentListQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
});

const prepareAddrBodySchema = z.object({
  domainName: z.string().min(3).max(255),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
});

const prepareRenewalBodySchema = z.object({
  domainName: z.string().min(3).max(255),
  durationSeconds: z.number().int().positive(),
  referrer: z.string().optional(),
});

export const ensRoutes: FastifyPluginAsync = async (app) => {
  const debounceEnsCheck = createDebounceMiddleware({
    namespace: "ens.check",
    key: (request) => {
      const parsed = domainCheckBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return `${request.ip}:invalid`;
      }

      return `${request.ip}:${parsed.data.label.toLowerCase()}:${parsed.data.tld.toLowerCase()}:${parsed.data.durationSeconds ?? "default"}`;
    },
  });

  const debounceEnsProtected = createDebounceMiddleware({
    namespace: "ens.protected",
    key: async (request) => {
      const authSession = await requireAuthSession(request);
      return `${authSession.user.id}:${request.routeOptions.url}:${hashDebouncePayload(request.body)}`;
    },
  });

  app.get("/api/ens/tlds", async () => ({
    tlds: listEnsTlds(),
  }));

  app.post(
    "/api/ens/check",
    {
      preHandler: debounceEnsCheck,
    },
    async (request) => {
    const body = domainCheckBodySchema.parse(request.body);
    const result = await checkDomainAvailability({
      label: body.label,
      tld: body.tld,
      durationSeconds: body.durationSeconds,
    });

    return serializeBigInt(result);
    }
  );

  app.get(
    "/api/ens/domains",
    {
      preHandler: requireAuthSessionMiddleware,
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const domains = await listUserDomains(authSession.user.id);
    return { domains };
    }
  );

  app.get(
    "/api/ens/intents",
    {
      preHandler: requireAuthSessionMiddleware,
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const query = intentListQuerySchema.parse(request.query);
    const intents = await listUserPurchaseIntents(authSession.user.id, query.limit);
    return { intents };
    }
  );

  app.post(
    "/api/ens/commitments",
    {
      preHandler: [requireAuthSessionMiddleware, debounceEnsProtected],
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const body = commitmentCreateBodySchema.parse(request.body);

    const result = await createCommitmentIntent({
      userId: authSession.user.id,
      walletAddress: body.walletAddress,
      label: body.label,
      tld: body.tld,
      durationSeconds: body.durationSeconds,
      referrer: body.referrer,
    });

    return serializeBigInt(result);
    }
  );

  app.post(
    "/api/ens/commitments/:intentId/confirm",
    {
      preHandler: [requireAuthSessionMiddleware, debounceEnsProtected],
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const params = z.object({ intentId: z.string().uuid() }).parse(request.params);
    const body = txHashBodySchema.parse(request.body);

    const result = await confirmCommitmentIntent({
      userId: authSession.user.id,
      intentId: params.intentId,
      txHash: body.txHash,
    });

    return result;
    }
  );

  app.post(
    "/api/ens/registrations/:intentId/prepare",
    {
      preHandler: [requireAuthSessionMiddleware, debounceEnsProtected],
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const params = z.object({ intentId: z.string().uuid() }).parse(request.params);
    const body = prepareRegisterBodySchema.parse(request.body);

    const result = await prepareRegisterTransaction({
      userId: authSession.user.id,
      intentId: params.intentId,
      secret: body.secret,
    });

    return serializeBigInt(result);
    }
  );

  app.post(
    "/api/ens/registrations/:intentId/confirm",
    {
      preHandler: [requireAuthSessionMiddleware, debounceEnsProtected],
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const params = z.object({ intentId: z.string().uuid() }).parse(request.params);
    const body = confirmRegisterBodySchema.parse(request.body);

    const result = await confirmRegisterTransaction({
      userId: authSession.user.id,
      intentId: params.intentId,
      txHash: body.txHash,
      setPrimary: body.setPrimary,
    });

    return result;
    }
  );

  app.post(
    "/api/ens/records/address/prepare",
    {
      preHandler: [requireAuthSessionMiddleware, debounceEnsProtected],
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const body = prepareAddrBodySchema.parse(request.body);

    const result = await prepareSetAddressRecord({
      userId: authSession.user.id,
      domainName: body.domainName,
      address: body.address,
    });

    return result;
    }
  );

  app.post(
    "/api/ens/renew/prepare",
    {
      preHandler: [requireAuthSessionMiddleware, debounceEnsProtected],
    },
    async (request) => {
    const authSession = await requireAuthSession(request);
    const body = prepareRenewalBodySchema.parse(request.body);

    const result = await prepareRenewal({
      userId: authSession.user.id,
      domainName: body.domainName,
      durationSeconds: body.durationSeconds,
      referrer: body.referrer,
    });

    return serializeBigInt(result);
    }
  );
};
