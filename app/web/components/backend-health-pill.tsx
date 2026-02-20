"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";

type HealthPayload = {
  ok: boolean;
  backendUrl: string;
  status: string;
};

const fetchBackendHealth = async (): Promise<HealthPayload> => {
  const response = await fetch("/api/backend-ready", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Health check failed (${response.status})`);
  }

  return response.json() as Promise<HealthPayload>;
};

export function BackendHealthPill() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["backend-ready"],
    queryFn: fetchBackendHealth,
    refetchInterval: 30_000,
  });

  if (isPending) {
    return <Badge variant="outline">Backend: checking...</Badge>;
  }

  if (isError || !data) {
    return <Badge variant="destructive">Backend: offline</Badge>;
  }

  const label = data.ok ? `Backend: ${data.status}` : "Backend: degraded";

  return (
    <Badge className="border border-primary/30 bg-primary/15 text-primary hover:bg-primary/15">
      {label}
    </Badge>
  );
}
