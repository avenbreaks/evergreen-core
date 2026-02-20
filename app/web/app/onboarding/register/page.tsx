"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { postJson, requestPasswordReset } from "@/lib/api-client";

type AuthMode = "signup" | "signin";

export default function RegisterOnboardingPage() {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<AuthMode>("signup");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);

  const signUpMutation = useMutation({
    mutationFn: (payload: { name: string; email: string; password: string }) => postJson("/api/auth/sign-up", payload),
    onSuccess: async () => {
      setErrorMessage(null);
      setInfoMessage("Account created. Redirecting to feed...");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
      router.push("/feed");
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(error instanceof Error ? error.message : "Sign up failed");
    },
  });

  const signInMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) => postJson("/api/auth/sign-in", payload),
    onSuccess: async () => {
      setErrorMessage(null);
      setInfoMessage("Signed in. Redirecting to feed...");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
      router.push("/feed");
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(error instanceof Error ? error.message : "Sign in failed");
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: () =>
      requestPasswordReset({
        email,
        redirectTo: typeof window === "undefined" ? undefined : `${window.location.origin}/onboarding/register`,
      }),
    onSuccess: () => {
      setErrorMessage(null);
      setInfoMessage("Password reset link requested. Check your inbox.");
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(error instanceof Error ? error.message : "Could not request password reset");
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    setInfoMessage(null);

    if (mode === "signup") {
      if (!agreed) {
        setErrorMessage("Please accept Terms and Privacy before creating your account.");
        return;
      }

      signUpMutation.mutate({
        name,
        email,
        password,
      });
      return;
    }

    signInMutation.mutate({
      email,
      password,
    });
  };

  const isBusy = signUpMutation.isPending || signInMutation.isPending || forgotPasswordMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="grid min-h-screen grid-cols-1 lg:grid-cols-2">
        <section className="relative hidden border-r border-border bg-card/70 p-10 lg:flex lg:flex-col lg:justify-between">
          <div className="grid-atmosphere absolute inset-0 opacity-25" />
          <div className="relative z-10 space-y-5">
            <BadgeAnchor />
            <h1 className="max-w-lg text-4xl font-black tracking-tight text-foreground">Build alongside the best.</h1>
            <p className="max-w-xl text-base leading-relaxed text-muted-foreground">
              Join an ecosystem where code is currency and reputation is verifiable. Evergreen Devparty is designed for
              serious builders who value depth over noise.
            </p>
          </div>

          <Card className="relative z-10 max-w-xl border-border bg-background/80">
            <CardContent className="space-y-4 p-6">
              <p className="text-sm leading-relaxed text-muted-foreground">
                &quot;The technical depth of the discussions here is unmatched. It is not just a forum, it is a crucible
                for better engineering standards.&quot;
              </p>
              <div>
                <p className="text-sm font-semibold text-foreground">Elena R.</p>
                <p className="text-xs text-primary">Senior Solidity Engineer</p>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="flex items-center justify-center px-4 py-12 sm:px-8">
          <div className="w-full max-w-md space-y-6">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Onboarding</p>
              <h2 className="text-3xl font-black tracking-tight">Create your account</h2>
            </div>

            <Tabs value={mode} onValueChange={(value) => setMode(value as AuthMode)}>
              <TabsList className="grid w-full grid-cols-2 bg-card">
                <TabsTrigger value="signup">Sign up</TabsTrigger>
                <TabsTrigger value="signin">Sign in</TabsTrigger>
              </TabsList>
            </Tabs>

            <form className="space-y-4" onSubmit={submit}>
              {mode === "signup" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="register-name">Display name</Label>
                  <Input
                    id="register-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    placeholder="Alex Developer"
                    className="border-border bg-card"
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="register-email">Email</Label>
                <Input
                  id="register-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  placeholder="you@company.com"
                  className="border-border bg-card"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="register-password">Password</Label>
                <Input
                  id="register-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  minLength={8}
                  placeholder="At least 8 characters"
                  className="border-border bg-card"
                />
              </div>

              {mode === "signup" ? (
                <label className="flex items-start gap-3 rounded-md border border-border bg-card/50 p-3 text-sm text-muted-foreground">
                  <Checkbox checked={agreed} onCheckedChange={(checked) => setAgreed(Boolean(checked))} />
                  <span>
                    I agree to the Terms and Privacy Policy and understand this account links to Evergreen identity flows.
                  </span>
                </label>
              ) : (
                <button
                  type="button"
                  className="text-xs text-primary hover:underline"
                  disabled={!email || forgotPasswordMutation.isPending}
                  onClick={() => forgotPasswordMutation.mutate()}
                >
                  Forgot password?
                </button>
              )}

              {errorMessage ? <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{errorMessage}</p> : null}
              {infoMessage ? <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-sm text-primary">{infoMessage}</p> : null}

              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={isBusy}>
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                {mode === "signup" ? "Sign up" : "Sign in"}
                <ArrowRight className="size-4" />
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">
              Next step after auth: claim ENS identity in <Link href="/onboarding/ens" className="text-primary hover:underline">onboarding</Link>.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

function BadgeAnchor() {
  return (
    <div className="inline-flex items-center gap-2 rounded-md border border-primary/30 bg-primary/15 px-3 py-1.5 text-xs font-medium text-primary">
      <ShieldCheck className="size-3.5" />
      Evergreen account gateway
    </div>
  );
}
