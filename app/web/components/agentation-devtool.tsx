"use client";

import { Agentation } from "agentation";

export function AgentationDevtool() {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }

  return <Agentation />;
}
