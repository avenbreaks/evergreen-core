import Link from "next/link";

import { Search, Sparkles } from "lucide-react";

import { BackendHealthPill } from "@/components/backend-health-pill";
import { SessionDock } from "@/components/auth/session-dock";
import { NetworkPill } from "@/components/network-pill";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type EvergreenHeaderProps = {
  showSearch?: boolean;
};

export function EvergreenHeader({ showSearch = true }: EvergreenHeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-border/80 bg-background/90 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-5">
          <Link href="/" className="flex items-center gap-2 text-foreground">
            <div className="flex size-8 items-center justify-center rounded-md border border-primary/30 bg-primary/15">
              <Sparkles className="size-4 text-primary" />
            </div>
            <span className="text-sm font-bold tracking-wide">Evergreen Devparty</span>
          </Link>

          <nav className="hidden items-center gap-1 md:flex">
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Link href="/feed">Feed</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Link href="/thread/react-usememo">Threads</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-muted-foreground hover:text-foreground">
              <Link href="/profile/alex-devparty">Profile</Link>
            </Button>
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {showSearch ? (
            <div className="hidden w-[240px] items-center gap-2 rounded-md border border-border bg-card/80 px-3 md:flex">
              <Search className="size-4 text-muted-foreground" />
              <Input
                placeholder="Search discussions..."
                className="border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
              />
            </div>
          ) : null}

          <div className="hidden items-center gap-2 xl:flex">
            <NetworkPill />
            <BackendHealthPill />
          </div>

          <SessionDock compact />
        </div>
      </div>
    </header>
  );
}
