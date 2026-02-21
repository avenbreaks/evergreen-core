"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2 } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchSession, postJson, requestEmailVerification, requestPasswordReset } from "@/lib/api-client";

type AuthMode = "signin" | "signup";

type AuthMutationPayload = {
  user?: {
    emailVerified?: boolean;
  } | null;
} | null;

const sanitizeNextPath = (value: string | null): string => {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/login")) {
    return "/feed";
  }

  return value;
};

const buildVerificationCallbackURL = (nextPath: string): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const params = new URLSearchParams();
  params.set("verified", "1");
  params.set("next", nextPath);

  return `${window.location.origin}/login?${params.toString()}`;
};

const mapVerificationError = (error: string | null): string | null => {
  if (!error) {
    return null;
  }

  if (error === "token_expired") {
    return "Verification link expired. Request a new verification email.";
  }

  if (error === "invalid_token") {
    return "Invalid verification link. Request a new verification email.";
  }

  if (error === "user_not_found") {
    return "Account for this verification token was not found.";
  }

  if (error === "unauthorized") {
    return "Unauthorized verification request.";
  }

  return `Email verification failed: ${error}`;
};

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen">
          <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
          <EvergreenHeader showSearch={false} />
          <main className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 pb-16 pt-14 sm:px-6 lg:px-8">
            <Card className="w-full max-w-md border-border bg-card/90">
              <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Preparing login page...
              </CardContent>
            </Card>
          </main>
        </div>
      }
    >
      <LoginPageContent />
    </Suspense>
  );
}

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();

  const nextPath = useMemo(() => sanitizeNextPath(searchParams.get("next")), [searchParams]);
  const modeFromQuery = searchParams.get("mode") === "signup" ? "signup" : "signin";
  const messageFromQuery = searchParams.get("message");
  const errorFromQuery = searchParams.get("error");
  const verifiedFromQuery = searchParams.get("verified") === "1";
  const verificationErrorMessage = useMemo(() => mapVerificationError(errorFromQuery), [errorFromQuery]);

  const [mode, setMode] = useState<AuthMode>(modeFromQuery);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const sessionQuery = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
  });

  useEffect(() => {
    setMode(modeFromQuery);
  }, [modeFromQuery]);

  useEffect(() => {
    if (verificationErrorMessage) {
      setErrorMessage(verificationErrorMessage);
      setInfoMessage(null);
      return;
    }

    if (messageFromQuery) {
      setErrorMessage(null);
      setInfoMessage(messageFromQuery);
      return;
    }

    if (verifiedFromQuery) {
      setErrorMessage(null);
      setInfoMessage("Email verified. You can sign in now.");
    }
  }, [messageFromQuery, verifiedFromQuery, verificationErrorMessage]);

  useEffect(() => {
    if (sessionQuery.data?.user?.id && sessionQuery.data.user.emailVerified !== false) {
      router.replace(nextPath);
    }
  }, [nextPath, router, sessionQuery.data?.user?.emailVerified, sessionQuery.data?.user?.id]);

  const signUpMutation = useMutation({
    mutationFn: (payload: { name: string; email: string; password: string; callbackURL?: string }) =>
      postJson<AuthMutationPayload>("/api/auth/sign-up", payload),
    onSuccess: async (payload) => {
      setErrorMessage(null);

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);

      const emailVerified = payload?.user?.emailVerified === true;
      if (emailVerified) {
        setInfoMessage("Account created. Redirecting...");
        router.replace(nextPath);
        return;
      }

      setMode("signin");
      setPassword("");
      setInfoMessage("Account created. Check your inbox and verify your email before signing in.");
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
      setInfoMessage("Signed in. Redirecting...");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
      router.replace(nextPath);
    },
    onError: (error) => {
      setInfoMessage(null);
      const message = error instanceof Error ? error.message : "Sign in failed";
      if (/verify/i.test(message) && /email/i.test(message)) {
        setErrorMessage("Email not verified yet. Verify from your inbox first, then sign in.");
        return;
      }

      setErrorMessage(message);
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: () =>
      requestPasswordReset({
        email: email.trim(),
        redirectTo: typeof window === "undefined" ? undefined : `${window.location.origin}/login`,
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

  const resendVerificationMutation = useMutation({
    mutationFn: () => {
      const normalizedEmail = email.trim();
      if (!normalizedEmail) {
        throw new Error("Enter your email first.");
      }

      return requestEmailVerification({
        email: normalizedEmail,
        callbackURL: buildVerificationCallbackURL(nextPath),
      });
    },
    onSuccess: () => {
      setErrorMessage(null);
      setInfoMessage("Verification email sent. Check your inbox.");
    },
    onError: (error) => {
      setInfoMessage(null);
      setErrorMessage(error instanceof Error ? error.message : "Could not send verification email");
    },
  });

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    const normalizedEmail = email.trim();

    if (mode === "signup") {
      signUpMutation.mutate({
        name,
        email: normalizedEmail,
        password,
        callbackURL: buildVerificationCallbackURL(nextPath),
      });
      return;
    }

    signInMutation.mutate({
      email: normalizedEmail,
      password,
    });
  };

  const isBusy =
    signUpMutation.isPending ||
    signInMutation.isPending ||
    forgotPasswordMutation.isPending ||
    resendVerificationMutation.isPending;

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader showSearch={false} />

      <main className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 pb-16 pt-14 sm:px-6 lg:px-8">
        <Card className="w-full max-w-md border-border bg-card/90">
          <CardHeader>
            <CardTitle className="text-3xl font-black tracking-tight">Welcome back</CardTitle>
            <CardDescription>
              Sign in to continue your flow. After auth we redirect to <span className="font-mono text-foreground">{nextPath}</span>.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Tabs value={mode} onValueChange={(value) => setMode(value as AuthMode)}>
              <TabsList className="grid w-full grid-cols-2 bg-background">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>
            </Tabs>

            <form className="space-y-3" onSubmit={submit}>
              {mode === "signup" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="login-name">Name</Label>
                  <Input
                    id="login-name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alex Builder"
                    required
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="login-email">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="login-password">Password</Label>
                <Input
                  id="login-password"
                  type="password"
                  autoComplete={mode === "signup" ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="********"
                  minLength={8}
                  required
                />
              </div>

              {mode === "signin" ? (
                <div className="flex flex-wrap items-center gap-3 text-xs">
                  <button
                    type="button"
                    className="text-primary hover:underline"
                    disabled={!email || forgotPasswordMutation.isPending}
                    onClick={() => forgotPasswordMutation.mutate()}
                  >
                    Forgot password?
                  </button>

                  <button
                    type="button"
                    className="text-primary hover:underline"
                    disabled={!email || resendVerificationMutation.isPending}
                    onClick={() => resendVerificationMutation.mutate()}
                  >
                    {resendVerificationMutation.isPending ? "Sending verification..." : "Resend verification email"}
                  </button>
                </div>
              ) : null}

              {errorMessage ? <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{errorMessage}</p> : null}
              {infoMessage ? <p className="rounded-md border border-primary/40 bg-primary/10 p-2 text-sm text-primary">{infoMessage}</p> : null}

              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={isBusy}>
                {isBusy ? <Loader2 className="size-4 animate-spin" /> : null}
                {mode === "signup" ? "Create account" : "Sign in"}
                <ArrowRight className="size-4" />
              </Button>
            </form>

            <p className="text-xs text-muted-foreground">
              New account path: sign up here, then continue to <Link href="/onboarding/ens" className="text-primary hover:underline">ENS onboarding</Link>.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
