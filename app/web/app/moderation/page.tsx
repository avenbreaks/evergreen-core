import { AlertTriangle, CheckCircle2, Clock3, Flag, Search, ShieldAlert, Trash2 } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

const reports = [
  {
    id: "#4921",
    reason: "Harassment",
    title: 'Comment on "Why React Hooks are..."',
    excerpt: "User is being aggressively dismissive toward beginners in a technical thread.",
    reporter: "dev_guru",
    ago: "2h ago",
    active: true,
  },
  {
    id: "#4920",
    reason: "Spam",
    title: 'Post "Buy cheap crypto now!!!"',
    excerpt: "Bot account posting scam links repeatedly in general discussion.",
    reporter: "clean_web",
    ago: "3h ago",
    active: false,
  },
  {
    id: "#4919",
    reason: "Low Quality",
    title: 'Question "help me fix code"',
    excerpt: "Code dump without context, repro steps, or expected behavior.",
    reporter: "senior_eng",
    ago: "4h ago",
    active: false,
  },
];

export default function ModerationDashboardPage() {
  const highlighted = reports[0];

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1450px] grid-cols-1 gap-5 px-4 pb-10 pt-6 xl:grid-cols-[1fr_1fr] sm:px-6 lg:px-8">
        <section className="space-y-4 rounded-xl border border-border bg-card/90 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight">
                Queue
                <Badge variant="outline" className="border-border bg-background text-xs text-muted-foreground">
                  {reports.length}
                </Badge>
              </h1>
              <p className="text-sm text-muted-foreground">Moderation triage for reported content.</p>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="border-border bg-background hover:bg-secondary/60">
                <Clock3 className="size-4" />
                Sort
              </Button>
              <Button variant="outline" size="sm" className="border-border bg-background hover:bg-secondary/60">
                <Flag className="size-4" />
                Filter
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2">
            <Search className="size-4 text-muted-foreground" />
            <Input
              placeholder="Search reports, usernames, thread IDs..."
              className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
            />
          </div>

          <div className="space-y-2">
            {reports.map((report) => (
              <article
                key={report.id}
                className={`rounded-lg border p-3 transition ${
                  report.active
                    ? "border-primary/45 bg-primary/10"
                    : "border-border bg-background/70 hover:border-border/70 hover:bg-background"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Badge
                      className={`border ${
                        report.reason === "Harassment"
                          ? "border-red-500/20 bg-red-500/15 text-red-300"
                          : report.reason === "Spam"
                            ? "border-amber-500/25 bg-amber-500/15 text-amber-300"
                            : "border-slate-500/25 bg-slate-500/15 text-slate-300"
                      }`}
                    >
                      {report.reason}
                    </Badge>
                    <span>{report.id}</span>
                    <span>{report.ago}</span>
                  </div>
                </div>

                <h2 className="mt-2 text-sm font-semibold text-foreground">{report.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">{report.excerpt}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Reported by <span className="font-medium text-foreground">@{report.reporter}</span>
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-xl border border-border bg-card/90 p-4">
          <Card className="border-border bg-background/80">
            <CardHeader>
              <CardTitle className="text-lg">{highlighted.title}</CardTitle>
              <CardDescription className="text-xs">{highlighted.id} · {highlighted.ago}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Reason</p>
                  <p className="mt-1 flex items-center gap-1.5 font-medium text-red-300">
                    <AlertTriangle className="size-4" />
                    {highlighted.reason}
                  </p>
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Context</p>
                  <p className="mt-1 text-foreground">Comment thread</p>
                </div>
                <div className="rounded-md border border-border bg-card px-3 py-2">
                  <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Reporter</p>
                  <p className="mt-1 text-foreground">@{highlighted.reporter}</p>
                </div>
              </div>

              <div className="rounded-lg border border-border bg-card p-4">
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground">Reported content</p>
                <div className="mt-3 space-y-3 text-sm text-muted-foreground">
                  <p>You clearly have no idea what you are talking about. React hooks are simple if you read docs.</p>
                  <p className="font-semibold text-foreground">Only an idiot would struggle with useEffect in 2024.</p>
                  <p>Maybe quit coding if basic hooks are hard. Stop wasting everyone&apos;s time with beginner issues.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
              <CheckCircle2 className="size-4" />
              Approve
            </Button>
            <Button variant="outline" className="border-border bg-background hover:bg-secondary/60">
              <ShieldAlert className="size-4" />
              Warn
            </Button>
            <Button variant="outline" className="border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20">
              <Trash2 className="size-4" />
              Remove
            </Button>
          </div>
        </section>
      </main>
    </div>
  );
}
