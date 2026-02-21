import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";
import { ZodError } from "zod";

import { HttpError } from "../../../src/lib/http-error";

type EmailVerificationRouteDeps = {
  forwardAuthRequest: (input: any) => Promise<void>;
};

const buildEmailVerificationTestApp = async (depsOverrides: Partial<EmailVerificationRouteDeps> = {}) => {
  const { emailVerificationRoutes } = await import("../../../src/routes/email-verification");

  const app = Fastify({ logger: false });
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    if (error instanceof ZodError) {
      return reply.status(400).send({
        code: "VALIDATION_ERROR",
        message: "Invalid request payload",
      });
    }

    return reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
    });
  });

  const deps: EmailVerificationRouteDeps = {
    forwardAuthRequest: async (input) => {
      input.reply.status(200).send({ status: true, message: "ok" });
    },
    ...depsOverrides,
  };

  await app.register(emailVerificationRoutes, {
    deps,
  });

  return app;
};

test("email-verification send route forwards payload to Better Auth endpoint", async (t) => {
  let receivedPath: string | null = null;
  let receivedBody: unknown = null;

  const app = await buildEmailVerificationTestApp({
    forwardAuthRequest: async (input) => {
      receivedPath = input.targetPath;
      receivedBody = input.body;
      input.reply.status(200).send({ status: true });
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/email-verification/send",
    payload: {
      email: "verify-user@example.com",
      callbackURL: "http://localhost:3000/login?verified=1",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedPath, "/api/auth/send-verification-email");
  assert.deepEqual(receivedBody, {
    email: "verify-user@example.com",
    callbackURL: "http://localhost:3000/login?verified=1",
  });
});

test("email-verification send route drops untrusted callback URL", async (t) => {
  let receivedBody: unknown = null;

  const app = await buildEmailVerificationTestApp({
    forwardAuthRequest: async (input) => {
      receivedBody = input.body;
      input.reply.status(200).send({ status: true });
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/email-verification/send",
    payload: {
      email: "verify-user@example.com",
      callbackURL: "https://evil.example/redirect",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(receivedBody, {
    email: "verify-user@example.com",
  });
});

test("email-verification verify route forwards token query params", async (t) => {
  let receivedPath: string | null = null;

  const app = await buildEmailVerificationTestApp({
    forwardAuthRequest: async (input) => {
      receivedPath = input.targetPath;
      input.reply.status(302).send();
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/api/email-verification/verify?token=verify-token-12345678&callbackURL=http%3A%2F%2Flocalhost%3A3000%2Flogin%3Fverified%3D1",
  });

  assert.equal(response.statusCode, 302);

  const target = new URL(receivedPath ?? "", "http://localhost:3001");
  assert.equal(target.pathname, "/api/auth/verify-email");
  assert.equal(target.searchParams.get("token"), "verify-token-12345678");
  assert.equal(target.searchParams.get("callbackURL"), "http://localhost:3000/login?verified=1");
});

test("email-verification legacy /verify-email route forwards to Better Auth verify endpoint", async (t) => {
  let receivedPath: string | null = null;

  const app = await buildEmailVerificationTestApp({
    forwardAuthRequest: async (input) => {
      receivedPath = input.targetPath;
      input.reply.status(200).send({ status: true });
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "GET",
    url: "/verify-email?token=legacy-token-12345678",
  });

  assert.equal(response.statusCode, 200);

  const target = new URL(receivedPath ?? "", "http://localhost:3001");
  assert.equal(target.pathname, "/api/auth/verify-email");
  assert.equal(target.searchParams.get("token"), "legacy-token-12345678");
  assert.equal(target.searchParams.get("callbackURL"), null);
});
