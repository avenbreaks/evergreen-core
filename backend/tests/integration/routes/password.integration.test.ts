import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";
import { ZodError } from "zod";

import { HttpError } from "../../../src/lib/http-error";

type PasswordRouteDeps = {
  forwardAuthRequest: (input: any) => Promise<void>;
};

const buildPasswordTestApp = async (depsOverrides: Partial<PasswordRouteDeps> = {}) => {
  const { passwordRoutes } = await import("../../../src/routes/password");

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

  const deps: PasswordRouteDeps = {
    forwardAuthRequest: async (input) => {
      input.reply.status(200).send({ status: true, message: "ok" });
    },
    ...depsOverrides,
  };

  await app.register(passwordRoutes, {
    deps,
  });

  return app;
};

test("password route forwards forgot-password payload to Better Auth endpoint", async (t) => {
  let receivedPath: string | null = null;
  let receivedBody: unknown = null;

  const app = await buildPasswordTestApp({
    forwardAuthRequest: async (input) => {
      receivedPath = input.targetPath;
      receivedBody = input.body;
      input.reply.status(200).send({ status: true, message: "queued" });
    },
  });

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/password/forgot-password",
    payload: {
      email: "user@example.com",
      redirectTo: "http://localhost:3000/reset-password",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedPath, "/api/auth/request-password-reset");
  assert.deepEqual(receivedBody, {
    email: "user@example.com",
    redirectTo: "http://localhost:3000/reset-password",
  });
});

test("password route forwards reset-password payload to Better Auth endpoint", async (t) => {
  let receivedPath: string | null = null;
  let receivedBody: unknown = null;

  const app = await buildPasswordTestApp({
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
    url: "/api/password/reset-password",
    payload: {
      token: "reset-token-12345678",
      newPassword: "NewStrongPass!2026",
    },
  });

  assert.equal(response.statusCode, 200);
  assert.equal(receivedPath, "/api/auth/reset-password");
  assert.deepEqual(receivedBody, {
    token: "reset-token-12345678",
    newPassword: "NewStrongPass!2026",
  });
});

test("password route validates forgot-password email format", async (t) => {
  const app = await buildPasswordTestApp();

  t.after(async () => {
    await app.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/password/forgot-password",
    payload: {
      email: "invalid-email",
    },
  });

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().code, "VALIDATION_ERROR");
});
