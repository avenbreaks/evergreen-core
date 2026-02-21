import Link from "next/link";

import { ArrowRight, Check, Code2, Fingerprint, MessageCircle, Sparkles } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-35" />
      <EvergreenHeader showSearch={false} />

      <main className="overflow-x-hidden">
        <section className="relative px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pt-24">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_45%_20%,rgba(17,212,131,0.18),transparent_48%)]" />
          <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-8 text-center">
            <Badge className="border border-primary/30 bg-primary/15 text-primary">v1.0 is live</Badge>
            <h1 className="max-w-4xl text-5xl font-black tracking-tight text-foreground md:text-7xl md:leading-[1.05]">
              Where code meets <span className="text-primary">community.</span>
            </h1>
            <p className="max-w-2xl text-lg text-muted-foreground md:text-xl">
              The decentralized town square for developers. Build your reputation, share technical depth, and move with
              a verifiable ENS-native identity.
            </p>

            <div className="flex flex-col items-center gap-3 sm:flex-row">
              <Button asChild size="lg" className="soft-glow bg-primary text-primary-foreground hover:bg-primary/90">
                <Link href="/onboarding/register">
                  Start Building
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-border bg-card hover:bg-secondary/70">
                <Link href="/feed">Explore Live Feed</Link>
              </Button>
            </div>
          </div>

          <div className="mx-auto mt-14 w-full max-w-6xl rounded-2xl border border-border bg-card/90 shadow-2xl shadow-black/35">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <div className="size-2.5 rounded-full bg-red-500/70" />
              <div className="size-2.5 rounded-full bg-amber-500/70" />
              <div className="size-2.5 rounded-full bg-emerald-500/70" />
              <span className="ml-3 text-xs font-mono text-muted-foreground">evergreen.dev/feed</span>
            </div>
            <div className="grid min-h-[420px] grid-cols-1 md:grid-cols-[230px_1fr_260px]">
              <aside className="hidden border-r border-border p-4 md:block">
                <div className="space-y-2">
                  {[
                    { item: "Home", active: true },
                    { item: "Topics", active: false },
                    { item: "Bookmarks", active: false },
                    { item: "Showcase", active: false },
                  ].map(({ item, active }) => (
                    <div
                      key={item}
                      className={`rounded-md px-3 py-2 text-sm ${active ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
                    >
                      {item}
                    </div>
                  ))}
                </div>
              </aside>

              <div className="space-y-4 p-4 md:p-6">
                <div className="rounded-lg border border-border bg-background p-3 text-left text-sm text-muted-foreground">
                  What are you working on?
                </div>
                <article className="rounded-lg border border-border bg-background p-4 text-left">
                  <p className="text-sm text-foreground">
                    Just published a new proposal for account abstraction. Would love feedback on gas sponsorship and
                    fallback execution paths.
                  </p>
                  <div className="mt-3 rounded border border-border bg-card px-3 py-2 font-mono text-xs text-primary">
                    git clone / proposal-4337 / npm run test
                  </div>
                </article>
              </div>

              <aside className="hidden border-l border-border p-4 md:block">
                <h4 className="text-sm font-semibold text-foreground">Trending Devs</h4>
                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                  <p>alex.lens · Rust Expert</p>
                  <p>jordan.sol · Solidity Dev</p>
                  <p>mina.ops · Infra Specialist</p>
                </div>
              </aside>
            </div>
          </div>
        </section>

        <section className="border-y border-border bg-card/60 py-10">
          <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-8 px-4 text-sm text-muted-foreground sm:px-6 lg:px-8">
            <span className="font-semibold uppercase tracking-[0.16em]">Trusted by builders at</span>
            <span>Ethereum</span>
            <span>Optimism</span>
            <span>Polygon</span>
            <span>Arbitrum</span>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 py-20 sm:px-6 lg:px-8" id="features">
          <div className="mb-12 space-y-3 text-center">
            <h2 className="text-4xl font-black tracking-tight">Developer-first features</h2>
            <p className="mx-auto max-w-2xl text-muted-foreground">
              Everything you need to share deep technical work, grow reputation, and collaborate without noisy social
              defaults.
            </p>
          </div>

          <div className="grid auto-rows-[250px] gap-4 md:grid-cols-3">
            <Card className="relative overflow-hidden border-border bg-card/85 md:col-span-2">
              <div className="pointer-events-none absolute -right-20 -top-20 size-52 rounded-full bg-primary/15 blur-3xl" />
              <CardHeader className="relative z-10">
                <Badge className="w-fit border border-primary/30 bg-primary/20 text-primary">
                  <Fingerprint className="mr-1 size-3.5" /> ENS Native Identity
                </Badge>
                <CardTitle className="text-2xl">Your reputation follows your wallet</CardTitle>
                <CardDescription className="max-w-lg text-sm text-muted-foreground">
                  Profile ownership, identity continuity, and portable proof across the ecosystem.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border bg-card/85">
              <CardHeader>
                <Badge className="w-fit border border-border bg-background text-muted-foreground">
                  <MessageCircle className="mr-1 size-3.5" /> Discussions
                </Badge>
                <CardTitle className="text-xl">Threaded technical depth</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Markdown, code snippets, and structured context for real engineering conversations.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border bg-card/85">
              <CardHeader>
                <Badge className="w-fit border border-border bg-background text-muted-foreground">
                  <Sparkles className="mr-1 size-3.5" /> Discovery
                </Badge>
                <CardTitle className="text-xl">Signal-first networking</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Find collaborators by demonstrated capability, not shallow engagement metrics.
                </CardDescription>
              </CardHeader>
            </Card>

            <Card className="border-border bg-card/85 md:col-span-2">
              <CardHeader>
                <Badge className="w-fit border border-border bg-background text-muted-foreground">
                  <Code2 className="mr-1 size-3.5" /> Open Source Core
                </Badge>
                <CardTitle className="text-2xl">Platform and protocol evolve in public</CardTitle>
                <CardDescription className="text-sm text-muted-foreground">
                  Frontend and backend surface area stays transparent, auditable, and builder-owned.
                </CardDescription>
              </CardHeader>
            </Card>
          </div>
        </section>

        <section className="relative overflow-hidden border-t border-border py-20">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_70%_10%,rgba(17,212,131,0.15),transparent_45%)]" />
          <div className="relative mx-auto flex w-full max-w-4xl flex-col items-center gap-5 px-4 text-center sm:px-6 lg:px-8">
            <h3 className="text-4xl font-black tracking-tight">Ready to join the party?</h3>
            <p className="max-w-2xl text-muted-foreground">
              Connect your account, claim your identity, and start building your on-chain developer story.
            </p>
            <Button asChild size="lg" className="soft-glow bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/onboarding/ens">
                <Check className="size-4" />
                Claim ENS Identity
              </Link>
            </Button>
          </div>
        </section>

        <footer className="border-t border-border bg-card/70">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
            <div>
              <p className="text-sm font-semibold text-foreground">Evergreen Devparty</p>
              <p className="text-xs text-muted-foreground">Build reputation through technical depth and verifiable identity.</p>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
              <Link href="/feed" className="hover:text-foreground">Feed</Link>
              <Link href="/thread" className="hover:text-foreground">Threads</Link>
              <Link href="/notifications" className="hover:text-foreground">Notifications</Link>
              <Link href="/settings/profile" className="hover:text-foreground">Settings</Link>
              <Link href="/login" className="hover:text-foreground">Login</Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
