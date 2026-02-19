import assert from "node:assert/strict";
import test from "node:test";

import Fastify from "fastify";

import { HttpError } from "../lib/http-error";

const INTERNAL_SECRET = "test-metrics-secret";

process.env.INTERNAL_OPS_ACTIVE_SECRET = INTERNAL_SECRET;
process.env.TRUST_PROXY = "false";

const buildMetricsTestApp = async () => {
  const { metricsRoutes } = await import("./metrics");
  const app = Fastify({ logger: false });

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof HttpError) {
      return reply.status(error.statusCode).send({
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }

    return reply.status(500).send({
      code: "INTERNAL_SERVER_ERROR",
      message: "Unexpected error",
    });
  });

  await app.register(metricsRoutes);
  return app;
};

test("metrics route requires internal secret", async (t) => {
  const app = await buildMetricsTestApp();

  t.after(async () => {
    await app.close();
  });

  const unauthorized = await app.inject({
    method: "GET",
    url: "/metrics",
  });

  assert.equal(unauthorized.statusCode, 401);
  assert.equal(unauthorized.json().code, "INTERNAL_OPS_UNAUTHORIZED");

  const authorized = await app.inject({
    method: "GET",
    url: "/metrics",
    headers: {
      "x-internal-secret": INTERNAL_SECRET,
    },
  });

  assert.equal(authorized.statusCode, 200);
  assert.match(authorized.headers["content-type"] ?? "", /text\/plain/);
  assert.match(authorized.body, /evergreen_backend_webhook_processed_total/);
  assert.match(authorized.body, /evergreen_backend_worker_runs_total/);
});
