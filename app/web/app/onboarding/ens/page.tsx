"use client";

import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Fingerprint, Loader2, ShieldCheck } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  confirmEnsCommitmentIntent,
  confirmEnsRegisterTransaction,
  createEnsCommitmentIntent,
  fetchEnsDomains,
  fetchEnsPurchaseIntents,
  fetchEnsTlds,
  fetchMe,
  postEnsCheck,
  prepareEnsRegisterTransaction,
  type EnsCheckPayload,
  type EnsTransactionPreview,
} from "@/lib/api-client";

const fallbackTlds = ["devparty", "eth"];
const YEAR_SECONDS = 31_536_000;

const formatStatus = (value: string | null | undefined): string => {
  if (!value) {
    return "-";
  }

  return value.replace(/_/g, " ");
};

const formatDate = (value: string | null | undefined): string => {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
};

const formatTxPreview = (tx: EnsTransactionPreview | null): string => {
  if (!tx) {
    return "No transaction payload yet.";
  }

  return JSON.stringify(tx, null, 2);
};

export default function EnsOnboardingStepOnePage() {
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("satoshi");
  const [selectedTld, setSelectedTld] = useState("devparty");
  const [durationYears, setDurationYears] = useState(1);
  const [activeIntentId, setActiveIntentId] = useState("");
  const [secretInput, setSecretInput] = useState("");
  const [commitTxHashInput, setCommitTxHashInput] = useState("");
  const [registerTxHashInput, setRegisterTxHashInput] = useState("");
  const [setPrimaryAfterRegister, setSetPrimaryAfterRegister] = useState(true);
  const [latestCheck, setLatestCheck] = useState<EnsCheckPayload | null>(null);
  const [commitTxPreview, setCommitTxPreview] = useState<EnsTransactionPreview | null>(null);
  const [registerTxPreview, setRegisterTxPreview] = useState<EnsTransactionPreview | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const tldsQuery = useQuery({
    queryKey: ["ens", "tlds"],
    queryFn: fetchEnsTlds,
  });

  const isAuthenticated = Boolean(meQuery.data?.user?.id);

  const intentsQuery = useQuery({
    queryKey: ["ens", "intents"],
    queryFn: () => fetchEnsPurchaseIntents({ limit: 20 }),
    enabled: isAuthenticated,
  });

  const domainsQuery = useQuery({
    queryKey: ["ens", "domains"],
    queryFn: fetchEnsDomains,
    enabled: isAuthenticated,
  });

  const availableTlds = useMemo(() => {
    const source = tldsQuery.data?.tlds?.length ? tldsQuery.data.tlds : fallbackTlds;
    const normalized = source
      .map((item) => (typeof item === "string" ? item : ""))
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    return Array.from(new Set(normalized));
  }, [tldsQuery.data?.tlds]);

  const resolvedTld = availableTlds.includes(selectedTld) ? selectedTld : (availableTlds[0] ?? fallbackTlds[0]);

  const sanitizedLabel = label.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  const durationSeconds = durationYears * YEAR_SECONDS;
  const domainName = sanitizedLabel ? `${sanitizedLabel}.${resolvedTld}` : `your-name.${resolvedTld}`;

  const walletAddress = meQuery.data?.wallets?.find((wallet) => wallet.isPrimary)?.address ?? meQuery.data?.wallets?.[0]?.address ?? "";
  const intents = intentsQuery.data?.intents ?? [];
  const selectedIntentId = activeIntentId || intents[0]?.id || "";
  const selectedIntent = intents.find((intent) => intent.id === selectedIntentId) ?? intents[0] ?? null;

  const checkedDomainName = typeof latestCheck?.domainName === "string" ? latestCheck.domainName.toLowerCase() : "";
  const latestCheckMatchesCurrent = checkedDomainName === domainName.toLowerCase();
  const latestCheckAvailable = Boolean(latestCheck?.isAvailable ?? latestCheck?.available);
  const canCreateIntent =
    isAuthenticated && Boolean(walletAddress) && sanitizedLabel.length >= 3 && latestCheckMatchesCurrent && latestCheckAvailable;

  const ensureError = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);

  const ensCheckMutation = useMutation({
    mutationFn: () =>
      postEnsCheck({
        label: sanitizedLabel,
        tld: resolvedTld,
        durationSeconds,
      }),
    onSuccess: (payload) => {
      setLatestCheck(payload);
      setErrorMessage(null);

      const available = Boolean(payload.isAvailable ?? payload.available);
      if (available) {
        setInfoMessage(`Great news: ${payload.domainName ?? domainName} is available.`);
        return;
      }

      const backendMessage =
        typeof payload.message === "string"
          ? payload.message
          : typeof payload.reason === "string"
            ? payload.reason
            : `${payload.domainName ?? domainName} is unavailable. Try another label.`;
      setInfoMessage(backendMessage);
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureError(error, "Could not check ENS availability"));
    },
  });

  const createIntentMutation = useMutation({
    mutationFn: () => {
      if (!walletAddress) {
        throw new Error("No wallet linked to your account. Add a wallet before creating commitment intent.");
      }

      return createEnsCommitmentIntent({
        walletAddress,
        label: sanitizedLabel,
        tld: resolvedTld,
        durationSeconds,
      });
    },
    onSuccess: async (payload) => {
      setErrorMessage(null);
      setInfoMessage(`Commitment intent created for ${payload.domainName}. Submit commit tx and confirm with tx hash.`);
      setActiveIntentId(payload.intentId);
      setSecretInput(payload.secret);
      setCommitTxPreview(payload.tx ?? null);
      setRegisterTxPreview(null);
      setCommitTxHashInput("");
      setRegisterTxHashInput("");
      await queryClient.invalidateQueries({ queryKey: ["ens", "intents"] });
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureError(error, "Could not create commitment intent"));
    },
  });

  const confirmCommitMutation = useMutation({
    mutationFn: () => {
      const txHash = commitTxHashInput.trim();
      if (!selectedIntentId) {
        throw new Error("Choose an intent first.");
      }

      if (!txHash) {
        throw new Error("Commit transaction hash is required.");
      }

      return confirmEnsCommitmentIntent({
        intentId: selectedIntentId,
        txHash,
      });
    },
    onSuccess: async (payload) => {
      setErrorMessage(null);
      setInfoMessage(`Commitment confirmed. Intent status: ${payload.intent?.status ?? "updated"}.`);
      await queryClient.invalidateQueries({ queryKey: ["ens", "intents"] });
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureError(error, "Could not confirm commitment"));
    },
  });

  const prepareRegisterMutation = useMutation({
    mutationFn: () => {
      const secret = secretInput.trim();
      if (!selectedIntentId) {
        throw new Error("Choose an intent first.");
      }

      if (!secret) {
        throw new Error("Secret is required to prepare register transaction.");
      }

      return prepareEnsRegisterTransaction({
        intentId: selectedIntentId,
        secret,
      });
    },
    onSuccess: async (payload) => {
      setErrorMessage(null);
      setInfoMessage("Register transaction prepared. Submit tx from your wallet then confirm register.");
      setRegisterTxPreview(payload.tx ?? null);
      if (payload.intent?.id) {
        setActiveIntentId(payload.intent.id);
      }
      await queryClient.invalidateQueries({ queryKey: ["ens", "intents"] });
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureError(error, "Could not prepare register transaction"));
    },
  });

  const confirmRegisterMutation = useMutation({
    mutationFn: () => {
      const txHash = registerTxHashInput.trim();
      if (!selectedIntentId) {
        throw new Error("Choose an intent first.");
      }

      if (!txHash) {
        throw new Error("Register transaction hash is required.");
      }

      return confirmEnsRegisterTransaction({
        intentId: selectedIntentId,
        txHash,
        setPrimary: setPrimaryAfterRegister,
      });
    },
    onSuccess: async (payload) => {
      setErrorMessage(null);
      setInfoMessage(payload.domain?.name ? `Registration confirmed: ${payload.domain.name}` : "Registration confirmed.");
      setRegisterTxHashInput("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ens", "intents"] }),
        queryClient.invalidateQueries({ queryKey: ["ens", "domains"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureError(error, "Could not confirm register transaction"));
    },
  });

  const isBusy =
    ensCheckMutation.isPending ||
    createIntentMutation.isPending ||
    confirmCommitMutation.isPending ||
    prepareRegisterMutation.isPending ||
    confirmRegisterMutation.isPending;

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader showSearch={false} />

      <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <Badge className="w-fit border border-primary/30 bg-primary/15 text-primary">Identity onboarding</Badge>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Claim your ENS-style identity</h1>
          <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
            End-to-end flow: check availability, create commitment intent, confirm commit tx, prepare register tx, then
            confirm registration.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_320px]">
          <div className="space-y-5">
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
                    <span className="border-l border-border bg-card px-4 py-3 font-mono text-sm text-muted-foreground">.{resolvedTld}</span>
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
                        variant={tld === resolvedTld ? "default" : "outline"}
                        className={
                          tld === resolvedTld
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

                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Duration</p>
                  <div className="flex flex-wrap gap-2">
                    {[1, 2, 3].map((years) => (
                      <Button
                        key={years}
                        type="button"
                        size="sm"
                        variant={durationYears === years ? "default" : "outline"}
                        className={
                          durationYears === years
                            ? "bg-primary text-primary-foreground hover:bg-primary/90"
                            : "border-border bg-background text-muted-foreground hover:bg-card"
                        }
                        onClick={() => setDurationYears(years)}
                      >
                        {years} year{years > 1 ? "s" : ""}
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
                      <p className="text-xs text-muted-foreground">Duration: {durationYears} year(s)</p>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">Wallet: {walletAddress || "(no linked wallet yet)"}</p>
                </div>

                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    type="button"
                    className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
                    disabled={ensCheckMutation.isPending || sanitizedLabel.length < 3}
                    onClick={() => ensCheckMutation.mutate()}
                  >
                    {ensCheckMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    Check availability
                    <ArrowRight className="size-4" />
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1 border-border bg-background hover:bg-card"
                    disabled={!canCreateIntent || createIntentMutation.isPending}
                    onClick={() => createIntentMutation.mutate()}
                  >
                    {createIntentMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
                    Create commitment intent
                  </Button>
                </div>

                {errorMessage ? (
                  <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">
                    {errorMessage}
                  </p>
                ) : null}
                {infoMessage ? (
                  <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-sm text-primary">{infoMessage}</p>
                ) : null}
              </CardContent>
            </Card>

            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Commit transaction step</CardTitle>
                <CardDescription>
                  Intent: <span className="font-mono">{selectedIntentId || "(none)"}</span>
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Commit tx payload</p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                    {formatTxPreview(commitTxPreview)}
                  </pre>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Secret (32-byte hex)</p>
                  <Input
                    value={secretInput}
                    onChange={(event) => setSecretInput(event.target.value)}
                    placeholder="0x..."
                    className="border-border bg-background font-mono"
                  />
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Commit tx hash</p>
                  <Input
                    value={commitTxHashInput}
                    onChange={(event) => setCommitTxHashInput(event.target.value)}
                    placeholder="0x..."
                    className="border-border bg-background font-mono"
                  />
                </div>

                <Button
                  type="button"
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={!selectedIntentId || confirmCommitMutation.isPending}
                  onClick={() => confirmCommitMutation.mutate()}
                >
                  {confirmCommitMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirm commit tx
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Register transaction step</CardTitle>
                <CardDescription>Prepare register payload, submit tx from wallet, then confirm tx hash.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  className="border-border bg-background hover:bg-card"
                  disabled={!selectedIntentId || prepareRegisterMutation.isPending}
                  onClick={() => prepareRegisterMutation.mutate()}
                >
                  {prepareRegisterMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                  Prepare register tx
                </Button>

                <div className="rounded-md border border-border bg-background p-3">
                  <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Register tx payload</p>
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words font-mono text-xs text-foreground">
                    {formatTxPreview(registerTxPreview)}
                  </pre>
                </div>

                <div className="space-y-1.5">
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Register tx hash</p>
                  <Input
                    value={registerTxHashInput}
                    onChange={(event) => setRegisterTxHashInput(event.target.value)}
                    placeholder="0x..."
                    className="border-border bg-background font-mono"
                  />
                </div>

                <label className="flex items-center gap-3 text-sm text-muted-foreground">
                  <Checkbox checked={setPrimaryAfterRegister} onCheckedChange={(checked) => setSetPrimaryAfterRegister(Boolean(checked))} />
                  Set as primary ENS after register
                </label>

                <Button
                  type="button"
                  className="bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={!selectedIntentId || confirmRegisterMutation.isPending}
                  onClick={() => confirmRegisterMutation.mutate()}
                >
                  {confirmRegisterMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Confirm register tx
                </Button>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-4">
            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-muted-foreground">
                <p>Auth session: {isAuthenticated ? "ready" : "sign in required"}</p>
                <p>TLD source: {tldsQuery.isPending ? "loading" : "ready"}</p>
                <p>Selected intent status: {formatStatus(selectedIntent?.status)}</p>
                <p>Registerable at: {formatDate(selectedIntent?.registerableAt as string | null | undefined)}</p>
                <p>Register by: {formatDate(selectedIntent?.registerBy as string | null | undefined)}</p>
                <p>Busy: {isBusy ? "yes" : "no"}</p>
              </CardContent>
            </Card>

            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Recent intents</CardTitle>
                <CardDescription>From `/api/ens/intents`</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {intentsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading intents...</p> : null}
                {!intentsQuery.isPending && intents.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No intents yet.</p>
                ) : null}
                {intents.map((intent) => (
                  <button
                    key={intent.id}
                    type="button"
                    className={`w-full rounded-md border px-3 py-2 text-left text-xs ${intent.id === selectedIntentId ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background text-muted-foreground"}`}
                    onClick={() => setActiveIntentId(intent.id)}
                  >
                    <p className="font-mono text-foreground">{intent.domainName}</p>
                    <p className="mt-1">status: {formatStatus(intent.status)}</p>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="border-border bg-card/90">
              <CardHeader>
                <CardTitle className="text-base">Owned domains</CardTitle>
                <CardDescription>From `/api/ens/domains`</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {!isAuthenticated ? <p className="text-sm text-muted-foreground">Sign in to view registered domains.</p> : null}
                {isAuthenticated && domainsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading domains...</p> : null}
                {isAuthenticated && !domainsQuery.isPending && (domainsQuery.data?.domains?.length ?? 0) === 0 ? (
                  <p className="text-sm text-muted-foreground">No domains registered yet.</p>
                ) : null}
                {(domainsQuery.data?.domains ?? []).map((domain) => (
                  <div key={domain.id} className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                    <p className="font-mono text-foreground">{domain.name}</p>
                    <p className="mt-1">status: {formatStatus(domain.status)}</p>
                    <p>primary: {domain.isPrimary ? "yes" : "no"}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
