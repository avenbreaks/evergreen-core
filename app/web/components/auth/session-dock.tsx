"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogOut, UserRound } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AUTH_REQUIRED_EVENT_NAME, fetchSession, postJson } from "@/lib/api-client";

type SessionDockProps = {
  compact?: boolean;
};

const initialsFromIdentity = (name?: string | null, email?: string | null): string => {
  const source = name?.trim() || email?.trim() || "U";
  const parts = source.split(/[\s@._-]+/).filter(Boolean);

  const first = parts[0]?.[0] ?? "U";
  const second = parts[1]?.[0] ?? "";
  return `${first}${second}`.toUpperCase();
};

export function SessionDock({ compact = false }: SessionDockProps) {
  const queryClient = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"signin" | "signup">("signin");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [signinEmail, setSigninEmail] = useState("");
  const [signinPassword, setSigninPassword] = useState("");

  const [signupName, setSignupName] = useState("");
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");

  const { data: session, isPending: isSessionLoading } = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
  });

  const signInMutation = useMutation({
    mutationFn: (payload: { email: string; password: string }) => postJson("/api/auth/sign-in", payload),
    onSuccess: async () => {
      setSheetOpen(false);
      setErrorMessage(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Sign in failed");
    },
  });

  const signUpMutation = useMutation({
    mutationFn: (payload: { name: string; email: string; password: string }) => postJson("/api/auth/sign-up", payload),
    onSuccess: async () => {
      setSheetOpen(false);
      setErrorMessage(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
    onError: (error) => {
      setErrorMessage(error instanceof Error ? error.message : "Sign up failed");
    },
  });

  const signOutMutation = useMutation({
    mutationFn: () => postJson("/api/auth/sign-out", {}),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["session"] }),
        queryClient.invalidateQueries({ queryKey: ["me"] }),
      ]);
    },
  });

  const authenticatedUser = session?.user ?? null;

  const identityLabel = useMemo(() => {
    if (!authenticatedUser) {
      return "Guest";
    }

    return authenticatedUser.name || authenticatedUser.email || "Member";
  }, [authenticatedUser]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAuthRequired = (event: Event) => {
      if (authenticatedUser) {
        return;
      }

      const customEvent = event as CustomEvent<{ message?: string }>;
      setActiveTab("signin");
      setErrorMessage(customEvent.detail?.message || "Please sign in to continue.");
      setSheetOpen(true);
    };

    window.addEventListener(AUTH_REQUIRED_EVENT_NAME, handleAuthRequired as EventListener);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT_NAME, handleAuthRequired as EventListener);
    };
  }, [authenticatedUser]);

  const handleSignIn = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    signInMutation.mutate({
      email: signinEmail,
      password: signinPassword,
    });
  };

  const handleSignUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);
    signUpMutation.mutate({
      name: signupName,
      email: signupEmail,
      password: signupPassword,
    });
  };

  if (isSessionLoading) {
    return <Badge variant="outline">Auth: loading...</Badge>;
  }

  if (authenticatedUser) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="border-border bg-card text-foreground">
          <Avatar className="mr-2 size-5">
            <AvatarImage src={authenticatedUser.image ?? undefined} alt={identityLabel} />
            <AvatarFallback className="text-[10px]">{initialsFromIdentity(authenticatedUser.name, authenticatedUser.email)}</AvatarFallback>
          </Avatar>
          <span className="max-w-[130px] truncate">{identityLabel}</span>
        </Badge>
        <Button
          variant="outline"
          size={compact ? "sm" : "default"}
          className="border-border bg-card hover:bg-secondary/70"
          onClick={() => signOutMutation.mutate()}
          disabled={signOutMutation.isPending}
        >
          {signOutMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />}
          {!compact ? "Sign out" : null}
        </Button>
      </div>
    );
  }

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      <SheetTrigger asChild>
        <Button className="bg-primary text-primary-foreground hover:bg-primary/90" size={compact ? "sm" : "default"}>
          <UserRound className="size-4" />
          {compact ? "Sign in" : "Connect Wallet / Sign in"}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full max-w-md border-border bg-card">
        <SheetHeader>
          <SheetTitle>Welcome back to Evergreen</SheetTitle>
          <SheetDescription>Use your email account tied to Better Auth.</SheetDescription>
        </SheetHeader>

        <div className="space-y-4 p-4">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as "signin" | "signup") }>
            <TabsList className="grid w-full grid-cols-2 bg-background">
              <TabsTrigger value="signin">Sign in</TabsTrigger>
              <TabsTrigger value="signup">Sign up</TabsTrigger>
            </TabsList>
          </Tabs>

          {errorMessage ? <p className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{errorMessage}</p> : null}

          {activeTab === "signin" ? (
            <form className="space-y-3" onSubmit={handleSignIn}>
              <div className="space-y-1.5">
                <Label htmlFor="signin-email">Email</Label>
                <Input
                  id="signin-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={signinEmail}
                  onChange={(event) => setSigninEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signin-password">Password</Label>
                <Input
                  id="signin-password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="********"
                  value={signinPassword}
                  onChange={(event) => setSigninPassword(event.target.value)}
                  required
                />
              </div>
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={signInMutation.isPending}>
                {signInMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Continue
              </Button>
            </form>
          ) : (
            <form className="space-y-3" onSubmit={handleSignUp}>
              <div className="space-y-1.5">
                <Label htmlFor="signup-name">Name</Label>
                <Input
                  id="signup-name"
                  type="text"
                  autoComplete="name"
                  placeholder="Your name"
                  value={signupName}
                  onChange={(event) => setSignupName(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-email">Email</Label>
                <Input
                  id="signup-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={signupEmail}
                  onChange={(event) => setSignupEmail(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="signup-password">Password</Label>
                <Input
                  id="signup-password"
                  type="password"
                  autoComplete="new-password"
                  placeholder="At least 8 chars"
                  value={signupPassword}
                  onChange={(event) => setSignupPassword(event.target.value)}
                  required
                />
              </div>
              <Button className="w-full bg-primary text-primary-foreground hover:bg-primary/90" disabled={signUpMutation.isPending}>
                {signUpMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                Create account
              </Button>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
