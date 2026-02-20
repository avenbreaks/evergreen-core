"use client";

import { useQuery } from "@tanstack/react-query";

import { Badge } from "@/components/ui/badge";
import { fetchNetwork } from "@/lib/api-client";

export function NetworkPill() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["network"],
    queryFn: fetchNetwork,
    staleTime: 120_000,
  });

  if (isPending) {
    return <Badge variant="outline">Network: loading...</Badge>;
  }

  if (isError || !data?.network) {
    return <Badge variant="destructive">Network: unavailable</Badge>;
  }

  return (
    <Badge variant="outline" className="border-border bg-card">
      {data.network.name ?? "Unknown"} · chain {data.network.chainId ?? "-"}
    </Badge>
  );
}
