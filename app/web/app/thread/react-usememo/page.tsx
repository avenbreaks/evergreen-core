import { ArrowBigUp, Bookmark, MessageSquare, Share2 } from "lucide-react";

import { ViewerSummaryCard } from "@/components/auth/viewer-summary-card";
import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

const comments = [
  {
    user: "SarahJs",
    text: "If `userData` is created inline in the parent, it becomes a fresh object on every render. Memoize it at the parent boundary first.",
    votes: 24,
  },
  {
    user: "CodeMaster99",
    text: "You can also memoize `StatsDisplay` with `React.memo`, but stable object references are the first fix.",
    votes: 5,
  },
];

export default function ThreadDiscussionPage() {
  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-6 px-4 pb-12 pt-6 xl:grid-cols-[1fr_320px] sm:px-6 lg:px-8">
        <section className="space-y-6">
          <Card className="border-border bg-card/90">
            <CardHeader className="space-y-3">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>Home</span>
                <span>•</span>
                <span>JavaScript</span>
                <span>•</span>
                <span>Thread</span>
              </div>
              <CardTitle className="text-3xl leading-tight">Optimizing React re-renders with `useMemo`</CardTitle>
              <CardDescription>
                I suspect parent props are invalidating memoized calculations. Looking for practical debugging heuristics.
              </CardDescription>
              <div className="flex flex-wrap gap-2">
                {[
                  "react",
                  "performance",
                  "hooks",
                ].map((tag) => (
                  <Badge key={tag} variant="outline" className="border-border bg-background">
                    #{tag}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border border-border bg-background p-4 font-mono text-xs text-primary">
                const expensiveStats = useMemo(() =&gt; calculateHeavyMetrics(userData.history), [userData]);
              </div>

              <div className="flex items-center justify-between border-t border-border pt-3 text-sm text-muted-foreground">
                <div className="flex items-center gap-4">
                  <button className="inline-flex items-center gap-1 hover:text-foreground">
                    <ArrowBigUp className="size-4" />
                    156
                  </button>
                  <button className="inline-flex items-center gap-1 hover:text-foreground">
                    <MessageSquare className="size-4" />
                    42 comments
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button className="inline-flex items-center gap-1 hover:text-foreground">
                    <Bookmark className="size-4" />
                    Save
                  </button>
                  <button className="inline-flex items-center gap-1 hover:text-foreground">
                    <Share2 className="size-4" />
                    Share
                  </button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-lg">Add to discussion</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea className="min-h-[120px] border-border bg-background/70" placeholder="Add your reasoning and include snippets if needed..." />
              <div className="flex justify-end">
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">Post reply</Button>
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            {comments.map((comment) => (
              <Card key={comment.user} className="border-border bg-card/90">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">{comment.user}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>{comment.text}</p>
                  <button className="inline-flex items-center gap-1 text-xs hover:text-foreground">
                    <ArrowBigUp className="size-4" />
                    {comment.votes}
                  </button>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <aside className="space-y-4">
          <ViewerSummaryCard />

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-base">Related threads</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Understanding referential equality in JavaScript</p>
              <p>Why does `useEffect` run twice in Strict Mode?</p>
              <p>Best practices for large React context providers</p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
