"use client";

import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchMe } from "@/lib/api-client";

const truncateWallet = (value: string): string => `${value.slice(0, 6)}...${value.slice(-4)}`;

export function ViewerSummaryCard() {
  const { data, isPending, isError } = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  if (isPending) {
    return (
      <Card className="border-border bg-card/90">
        <CardHeader>
          <CardTitle className="text-base">Your account</CardTitle>
          <CardDescription>Loading profile...</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  if (isError || !data?.user) {
    return (
      <Card className="border-border bg-card/90">
        <CardHeader>
          <CardTitle className="text-base">Your account</CardTitle>
          <CardDescription>Sign in to load profile, wallets, and ENS context from backend.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="border-border bg-card/90">
      <CardHeader>
        <CardTitle className="text-base">Signed in</CardTitle>
        <CardDescription>{data.user.name || data.user.email || data.user.id}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">User ID</p>
          <p className="font-mono text-xs text-primary">{data.user.id}</p>
        </div>

        <div className="space-y-1.5">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Wallets</p>
          {data.wallets && data.wallets.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {data.wallets.slice(0, 3).map((wallet) => (
                <Badge key={wallet.address} variant="outline" className="border-border bg-background text-xs">
                  <Wallet className="mr-1 size-3" />
                  {truncateWallet(wallet.address)}
                  {wallet.isPrimary ? "*" : ""}
                </Badge>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No linked wallets yet.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
