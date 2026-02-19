import type { FastifyPluginAsync } from "fastify";

import { ensCoreContracts, oorthNexusNetwork } from "@evergreen-devparty/auth";

import { listEnsTlds } from "../services/ens-marketplace";

export const networkRoutes: FastifyPluginAsync = async (app) => {
  app.get("/api/network", async () => ({
    network: oorthNexusNetwork,
    contracts: ensCoreContracts,
    tlds: listEnsTlds(),
  }));
};
