import { loadEnvironmentFiles } from "./config/load-env";

loadEnvironmentFiles();

const [{ buildApp }, { backendEnv }] = await Promise.all([import("./app"), import("./config/env")]);

const app = buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Shutting down backend");
  await app.close();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

try {
  await app.listen({
    host: backendEnv.host,
    port: backendEnv.port,
  });

  app.log.info({ host: backendEnv.host, port: backendEnv.port }, "Backend server started");
} catch (error) {
  app.log.error({ err: error }, "Failed to start backend server");
  process.exit(1);
}
