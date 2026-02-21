"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, LogOut } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

const normalizeNextPath = (value: string): string => {
  if (!value.startsWith("/") || value.startsWith("//")) {
    return "/feed";
  }

  if (value.startsWith("/login")) {
    return "/feed";
  }

  return value;
};

const buildLoginHref = (nextPath: string, message?: string): string => {
  const params = new URLSearchParams();
  params.set("next", nextPath);
  if (message) {
    params.set("message", message);
  }

  const query = params.toString();
  return `/login${query ? `?${query}` : ""}`;
};

export function SessionDock({ compact = false }: SessionDockProps) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  const { data: session, isPending: isSessionLoading } = useQuery({
    queryKey: ["session"],
    queryFn: fetchSession,
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

  const currentPath = useMemo(() => {
    return normalizeNextPath(pathname || "/");
  }, [pathname]);

  const loginHref = useMemo(() => buildLoginHref(currentPath), [currentPath]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleAuthRequired = (event: Event) => {
      if (authenticatedUser) {
        return;
      }

      const customEvent = event as CustomEvent<{ message?: string }>;
      router.push(buildLoginHref(currentPath, customEvent.detail?.message || "Please sign in to continue."));
    };

    window.addEventListener(AUTH_REQUIRED_EVENT_NAME, handleAuthRequired as EventListener);
    return () => {
      window.removeEventListener(AUTH_REQUIRED_EVENT_NAME, handleAuthRequired as EventListener);
    };
  }, [authenticatedUser, currentPath, router]);

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
    <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90" size={compact ? "sm" : "default"}>
      <Link href={loginHref}>
        <LogIn className="size-4" />
        {compact ? "Sign in" : "Go to login"}
      </Link>
    </Button>
  );
}
