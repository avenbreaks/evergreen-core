"use client";

import Link from "next/link";

import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { fetchMe } from "@/lib/api-client";

export function ProfileNavLink() {
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const profileHref = meQuery.data?.user?.id ? `/profile/${meQuery.data.user.id}` : "/profile/me";

  return (
    <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
      <Link href={profileHref}>Profile</Link>
    </Button>
  );
}
