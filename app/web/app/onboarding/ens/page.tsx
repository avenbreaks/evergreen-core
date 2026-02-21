"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Fingerprint, Loader2, Wallet } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  confirmEnsCommitmentIntent,
  confirmEnsRegisterTransaction,
  createEnsCommitmentIntent,
  createSiweChallenge,
  fetchEnsDomains,
  fetchEnsPurchaseIntents,
  fetchEnsTlds,
  fetchMe,
  linkWalletToMe,
  postEnsCheck,
  prepareEnsRegisterTransaction,
  type EnsTransactionPreview,
} from "@/lib/api-client";

const fallbackTlds = ["devparty", "eth"];
const YEAR_SECONDS = 31_536_000;
const ENS_CHAIN_ID = 131;
const LOGIN_TO_ENS_URL = "/login?mode=signin&next=%2Fonboarding%2Fens";

type Eip1193Provider = {
  request: (input: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

const normalizeWalletAddress = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }

  return /^0x[a-fA-F0-9]{40}$/.test(value) ? value.toLowerCase() : "";
};

const truncateWallet = (value: string): string => `${value.slice(0, 6)}...${value.slice(-4)}`;

const toHexChainId = (chainId: number): string => `0x${chainId.toString(16)}`;

const toHexValue = (value: string): string => {
  const asBigInt = BigInt(value || "0");
  return `0x${asBigInt.toString(16)}`;
};

const getProvider = (): Eip1193Provider => {
  if (typeof window === "undefined") {
    throw new Error("Wallet provider is unavailable on server context");
  }

  const candidate = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
  if (!candidate) {
    throw new Error("No EVM wallet found. Install MetaMask or another wallet extension.");
  }

  return candidate;
};

const ensureEnsChain = async (provider: Eip1193Provider): Promise<void> => {
  const current = await provider.request({ method: "eth_chainId" });
  const currentHex = typeof current === "string" ? current : "";
  const currentId = Number.parseInt(currentHex, 16);
  if (currentId === ENS_CHAIN_ID) {
    return;
  }

  await provider.request({
    method: "wallet_switchEthereumChain",
    params: [{ chainId: toHexChainId(ENS_CHAIN_ID) }],
  });
};

const intentSecretKey = (intentId: string): string => `ens.intent.secret.${intentId}`;

const persistIntentSecret = (intentId: string, secret: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(intentSecretKey(intentId), secret);
};

const loadIntentSecret = (intentId: string): string => {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(intentSecretKey(intentId)) ?? "";
};

const clearIntentSecret = (intentId: string): void => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(intentSecretKey(intentId));
};

const sendContractTransaction = async (input: {
  provider: Eip1193Provider;
  from: string;
  tx: EnsTransactionPreview | undefined;
}): Promise<string> => {
  const tx = input.tx;
  if (!tx?.to || !tx?.data) {
    throw new Error("Missing transaction payload from backend. Please retry.");
  }

  const txHash = await input.provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: input.from,
        to: tx.to,
        data: tx.data,
        value: toHexValue(tx.value ?? "0"),
      },
    ],
  });

  if (typeof txHash !== "string" || !txHash.startsWith("0x")) {
    throw new Error("Wallet did not return a valid transaction hash");
  }

  return txHash;
};

export default function EnsOnboardingPage() {
  const queryClient = useQueryClient();

  const [label, setLabel] = useState("satoshi");
  const [selectedTld, setSelectedTld] = useState("devparty");
  const [durationYears, setDurationYears] = useState(1);
  const [connectedWalletAddress, setConnectedWalletAddress] = useState("");
  const [pendingIntentId, setPendingIntentId] = useState<string | null>(null);
  const [pendingDomainName, setPendingDomainName] = useState<string | null>(null);
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

  const linkedWalletAddress =
    meQuery.data?.wallets?.find((wallet) => wallet.isPrimary)?.address ?? meQuery.data?.wallets?.[0]?.address ?? "";
  const activeWalletAddress = normalizeWalletAddress(connectedWalletAddress || linkedWalletAddress);

  const resumableIntent = (intentsQuery.data?.intents ?? []).find((intent) =>
    ["committed", "registerable"].includes(intent.status)
  );
  const effectivePendingIntentId = pendingIntentId ?? resumableIntent?.id ?? null;
  const effectivePendingDomainName = pendingDomainName ?? resumableIntent?.domainName ?? null;

  const ensureErrorMessage = (error: unknown, fallback: string): string => {
    return error instanceof Error ? error.message : fallback;
  };

  const completeIntentRegistration = async (input: {
    intentId: string;
    walletAddress: string;
    setPrimary?: boolean;
  }): Promise<string> => {
    const secret = loadIntentSecret(input.intentId);
    if (!secret) {
      throw new Error("Purchase secret is missing. Please start buy flow again.");
    }

    const provider = getProvider();
    await ensureEnsChain(provider);

    const prepared = await prepareEnsRegisterTransaction({
      intentId: input.intentId,
      secret,
    });

    const registerTxHash = await sendContractTransaction({
      provider,
      from: input.walletAddress,
      tx: prepared.tx,
    });

    const confirmed = await confirmEnsRegisterTransaction({
      intentId: input.intentId,
      txHash: registerTxHash,
      setPrimary: input.setPrimary,
    });

    clearIntentSecret(input.intentId);
    return confirmed.domain?.name ?? effectivePendingDomainName ?? domainName;
  };

  const connectWalletMutation = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) {
        throw new Error("Sign in first before connecting wallet.");
      }

      const provider = getProvider();
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as unknown;
      const account = Array.isArray(accounts) ? normalizeWalletAddress(String(accounts[0] ?? "")) : "";
      if (!account) {
        throw new Error("Wallet account was not returned.");
      }

      const rawChain = await provider.request({ method: "eth_chainId" });
      const chainId = typeof rawChain === "string" ? Number.parseInt(rawChain, 16) : ENS_CHAIN_ID;

      const challenge = await createSiweChallenge({
        walletAddress: account,
        chainId: Number.isFinite(chainId) && chainId > 0 ? chainId : ENS_CHAIN_ID,
        statement: "Link wallet to claim ENS identity",
      });

      const signature = await provider.request({
        method: "personal_sign",
        params: [challenge.message, account],
      });

      if (typeof signature !== "string" || signature.length === 0) {
        throw new Error("Wallet signature was not returned.");
      }

      await linkWalletToMe({
        message: challenge.message,
        signature,
        setAsPrimary: true,
      });

      return account;
    },
    onSuccess: async (walletAddress) => {
      setConnectedWalletAddress(walletAddress);
      setErrorMessage(null);
      setInfoMessage(`Wallet connected: ${walletAddress}`);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["me"] }),
        queryClient.invalidateQueries({ queryKey: ["ens", "domains"] }),
      ]);
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureErrorMessage(error, "Could not connect wallet"));
    },
  });

  const buyEnsMutation = useMutation({
    mutationFn: async () => {
      if (!isAuthenticated) {
        throw new Error("Sign in first before buying ENS.");
      }

      if (!activeWalletAddress) {
        throw new Error("Connect and link your wallet first.");
      }

      const availability = await postEnsCheck({
        label: sanitizedLabel,
        tld: resolvedTld,
        durationSeconds,
      });

      const isAvailable = Boolean(availability.isAvailable ?? availability.available);
      if (!isAvailable) {
        const reason =
          typeof availability.reason === "string"
            ? availability.reason
            : typeof availability.message === "string"
              ? availability.message
              : `${domainName} is not available.`;
        throw new Error(reason);
      }

      const intent = await createEnsCommitmentIntent({
        walletAddress: activeWalletAddress,
        label: sanitizedLabel,
        tld: resolvedTld,
        durationSeconds,
      });

      persistIntentSecret(intent.intentId, intent.secret);

      const provider = getProvider();
      await ensureEnsChain(provider);

      const commitTxHash = await sendContractTransaction({
        provider,
        from: activeWalletAddress,
        tx: intent.tx,
      });

      await confirmEnsCommitmentIntent({
        intentId: intent.intentId,
        txHash: commitTxHash,
      });

      try {
        const registeredDomain = await completeIntentRegistration({
          intentId: intent.intentId,
          walletAddress: activeWalletAddress,
          setPrimary: true,
        });

        return {
          status: "registered" as const,
          intentId: intent.intentId,
          domainName: registeredDomain,
        };
      } catch (error) {
        const message = ensureErrorMessage(error, "Registration is not ready yet");
        if (/not ready|commitment_not_ready|wait/i.test(message)) {
          return {
            status: "waiting" as const,
            intentId: intent.intentId,
            domainName: intent.domainName,
          };
        }

        throw error;
      }
    },
    onSuccess: async (result) => {
      setErrorMessage(null);

      if (result.status === "waiting") {
        setPendingIntentId(result.intentId);
        setPendingDomainName(result.domainName);
        setInfoMessage(
          `Commit confirmed for ${result.domainName}. Wait a bit, then tap "Complete purchase" to finish registration.`
        );
        await queryClient.invalidateQueries({ queryKey: ["ens", "intents"] });
        return;
      }

      setPendingIntentId(null);
      setPendingDomainName(null);
      setInfoMessage(`ENS claimed successfully: ${result.domainName}`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ens", "intents"] }),
        queryClient.invalidateQueries({ queryKey: ["ens", "domains"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureErrorMessage(error, "Could not complete ENS purchase"));
    },
  });

  const completePurchaseMutation = useMutation({
    mutationFn: async () => {
      const intentId = effectivePendingIntentId;
      if (!intentId) {
        throw new Error("No pending ENS purchase to complete.");
      }

      if (!activeWalletAddress) {
        throw new Error("Connect and link your wallet first.");
      }

      const registeredDomain = await completeIntentRegistration({
        intentId,
        walletAddress: activeWalletAddress,
        setPrimary: true,
      });

      return {
        intentId,
        domainName: registeredDomain,
      };
    },
    onSuccess: async (result) => {
      setPendingIntentId(null);
      setPendingDomainName(null);
      setErrorMessage(null);
      setInfoMessage(`Registration completed: ${result.domainName}`);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["ens", "intents"] }),
        queryClient.invalidateQueries({ queryKey: ["ens", "domains"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(ensureErrorMessage(error, "Could not complete ENS purchase"));
    },
  });

  const isBusy = connectWalletMutation.isPending || buyEnsMutation.isPending || completePurchaseMutation.isPending;

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader showSearch={false} />

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8 sm:px-6 lg:px-8">
        <div className="space-y-2">
          <Badge className="w-fit border border-primary/30 bg-primary/15 text-primary">ENS onboarding</Badge>
          <h1 className="text-3xl font-black tracking-tight sm:text-4xl">Claim ENS in a minimal flow</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Connect wallet once, tap buy, approve wallet transactions. We only keep one action flow to reduce friction.
          </p>
        </div>

        <Card className="border-border bg-card/90">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-xl">
              <Fingerprint className="size-5 text-primary" />
              Buy ENS
            </CardTitle>
            <CardDescription>Wallet-linked purchase for direct ownership to your address.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!isAuthenticated ? (
              <p className="rounded-md border border-border bg-background p-3 text-sm text-muted-foreground">
                Sign in first to continue. <Link href={LOGIN_TO_ENS_URL} className="text-primary hover:underline">Open login</Link>
              </p>
            ) : null}

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Name</p>
              <div className="flex items-center overflow-hidden rounded-lg border border-border bg-background focus-within:border-primary/60">
                <Input
                  value={label}
                  onChange={(event) => {
                    setLabel(event.target.value);
                    setErrorMessage(null);
                  }}
                  placeholder="vitalik"
                  className="h-12 rounded-none border-0 bg-transparent font-mono text-base focus-visible:ring-0"
                  spellCheck={false}
                />
                <span className="border-l border-border bg-card px-4 py-3 font-mono text-sm text-muted-foreground">.{resolvedTld}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">TLD</p>
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
                    onClick={() => setSelectedTld(tld)}
                  >
                    .{tld}
                  </Button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Duration</p>
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
              <p className="mt-2 font-mono text-lg font-semibold text-foreground">{domainName}</p>
              <p className="mt-1 text-xs text-muted-foreground">Duration: {durationYears} year(s)</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Wallet:{" "}
                {activeWalletAddress ? (
                  <span className="font-mono text-foreground">{truncateWallet(activeWalletAddress)}</span>
                ) : (
                  "not connected"
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                className="border-border bg-background hover:bg-card"
                disabled={!isAuthenticated || connectWalletMutation.isPending}
                onClick={() => connectWalletMutation.mutate()}
              >
                {connectWalletMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                {activeWalletAddress ? "Reconnect wallet" : "Connect wallet"}
              </Button>

              <Button
                type="button"
                className="bg-primary text-primary-foreground hover:bg-primary/90"
                disabled={!isAuthenticated || !activeWalletAddress || sanitizedLabel.length < 3 || buyEnsMutation.isPending}
                onClick={() => buyEnsMutation.mutate()}
              >
                {buyEnsMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Buy ENS
              </Button>
            </div>

            {effectivePendingIntentId ? (
              <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-primary">
                <p>
                  Pending purchase: <span className="font-mono">{effectivePendingDomainName ?? "ENS"}</span>
                </p>
                <p className="mt-1 text-xs text-primary/90">Commit is done. Finish registration when commitment is ready.</p>
                <Button
                  type="button"
                  className="mt-3 bg-primary text-primary-foreground hover:bg-primary/90"
                  disabled={!activeWalletAddress || completePurchaseMutation.isPending}
                  onClick={() => completePurchaseMutation.mutate()}
                >
                  {completePurchaseMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                  Complete purchase
                </Button>
              </div>
            ) : null}

            {errorMessage ? (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive">{errorMessage}</p>
            ) : null}
            {infoMessage ? <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-sm text-primary">{infoMessage}</p> : null}
            {isBusy ? <p className="text-xs text-muted-foreground">Waiting for wallet / backend confirmation...</p> : null}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/90">
          <CardHeader>
            <CardTitle className="text-base">Owned domains</CardTitle>
            <CardDescription>Live domains from your account.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {!isAuthenticated ? <p className="text-sm text-muted-foreground">Sign in to view your domains.</p> : null}
            {isAuthenticated && domainsQuery.isPending ? <p className="text-sm text-muted-foreground">Loading domains...</p> : null}
            {isAuthenticated && !domainsQuery.isPending && (domainsQuery.data?.domains.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">No ENS domains yet.</p>
            ) : null}
            {(domainsQuery.data?.domains ?? []).map((domain) => (
              <div key={domain.id} className="rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
                <p className="font-mono text-foreground">{domain.name}</p>
                <p className="mt-1">status: {domain.status ?? "unknown"}</p>
                <p>primary: {domain.isPrimary ? "yes" : "no"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
