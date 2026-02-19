import type { FastifyPluginAsync } from "fastify";

import { ensCoreContracts, ensTldControllers, oorthNexusNetwork } from "@evergreen-devparty/auth";

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/network", async () => ({
    network: oorthNexusNetwork,
    contracts: ensCoreContracts,
    tldControllers: ensTldControllers,
  }));
};
