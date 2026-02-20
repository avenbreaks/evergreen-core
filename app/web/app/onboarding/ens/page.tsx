"use client";

import { useMemo, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Fingerprint, Loader2 } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchEnsTlds, postEnsCheck } from "@/lib/api-client";

const fallbackTlds = ["devparty", "eth"];

export default function EnsOnboardingStepOnePage() {
  const [label, setLabel] = useState("satoshi");
  const [selectedTld, setSelectedTld] = useState("devparty");
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const tldsQuery = useQuery({
    queryKey: ["ens", "tlds"],
    queryFn: fetchEnsTlds,
  });

  const availableTlds = useMemo(() => {
    const list = tldsQuery.data?.tlds?.length ? tldsQuery.data.tlds : fallbackTlds;
    return Array.from(new Set(list.map((item) => item.trim().toLowerCase()).filter(Boolean)));
  }, [tldsQuery.data?.tlds]);

  const ensCheckMutation = useMutation({
    mutationFn: () =>
      postEnsCheck({
        label,
        tld: selectedTld,
      }),
    onSuccess: (payload) => {
      setErrorMessage(null);
      if (payload.available) {
        setInfoMessage(`Great news: ${domainName} is available.`);
        return;
      }

      const backendMessage =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.reason === "string"
            ? payload.reason
            : `${domainName} is unavailable. Try another label.`;
      setInfoMessage(backendMessage);
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(error instanceof Error ? error.message : "Could not check ENS availability");
    },
  });

  const sanitizedLabel = label.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const domainName = sanitizedLabel ? `${sanitizedLabel}.${selectedTld}` : `your-name.${selectedTld}`;

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader showSearch={false} />

      <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <Badge className="w-fit border border-primary/30 bg-primary/15 text-primary">Identity onboarding</Badge>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Claim your ENS-style identity</h1>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            Mint your handle to unify account reputation, wallet context, and profile discovery across Evergreen Devparty.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-xl">
                <Fingerprint className="size-5 text-primary" />
                Handle setup
              </CardTitle>
              <CardDescription>Use 3-63 lowercase letters, numbers, or dashes.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Username</p>
                <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background focus-within:border-primary/60">
                  <Input
                    value={label}
                    onChange={(event) => {
                      setLabel(event.target.value);
                      setInfoMessage(null);
                      setErrorMessage(null);
                    }}
                    className="h-12 rounded-none border-0 bg-transparent font-mono text-base focus-visible:ring-0"
                    placeholder="vitalik"
                    spellCheck={false}
                  />
                  <span className="border-l border-border bg-card px-4 py-3 font-mono text-sm text-muted-foreground">
                    .{selectedTld}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">TLD</p>
                <div className="flex flex-wrap gap-2">
                  {availableTlds.map((tld) => (
                    <Button
                      key={tld}
                      type="button"
                      size="sm"
                      variant={tld === selectedTld ? "default" : "outline"}
                      className={
                        tld === selectedTld
                          ? "bg-primary text-primary-foreground hover:bg-primary/90"
                          : "border-border bg-background text-muted-foreground hover:bg-card"
                      }
                      onClick={() => {
                        setSelectedTld(tld);
                        setInfoMessage(null);
                        setErrorMessage(null);
                      }}
                    >
                      .{tld}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border bg-background/70 p-4">
                <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">Preview</p>
                <div className="mt-3 flex items-center gap-3">
                  <div className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-primary">
                    <Fingerprint className="size-5" />
                  </div>
                  <div>
                    <p className="font-mono text-lg font-bold text-foreground">{domainName}</p>
                    <p className="text-xs text-muted-foreground">Est. cost: 0.002 ETH</p>
                  </div>
                </div>
              </div>

              {errorMessage ? (
                <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                  {errorMessage}
                </p>
              ) : null}
              {infoMessage ? (
                <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-sm text-primary">{infoMessage}</p>
              ) : null}

              <Button
                type="button"
                className="w-full bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={ensCheckMutation.isPending || !sanitizedLabel || sanitizedLabel.length < 3}
                onClick={() => ensCheckMutation.mutate()}
              >
                {ensCheckMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Check availability
                <ArrowRight className="size-4" />
              </Button>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>ENS TLD source: {tldsQuery.isPending ? "loading" : "ready"}</p>
                <p>Available suffixes: {availableTlds.join(", ")}</p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Next</CardTitle>
              </CardHeader>
              <CardContent className="text-sm text-muted-foreground">
                After your handle is available, we can wire mint + profile sync against backend transaction flows.
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
