import { MessageCircle, Plus, Search, Share2, ThumbsUp } from "lucide-react";

import { ViewerSummaryCard } from "@/components/auth/viewer-summary-card";
import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

const posts = [
  {
    title: "Best practices for React Suspense in 2024",
    author: "react-dev.eth",
    excerpt:
      "Exploring the new hooks and patterns for async data fetching. We migrated our dashboard to use the latest primitives and got cleaner loading boundaries.",
    tags: ["React", "Frontend"],
    votes: 428,
    comments: 32,
  },
  {
    title: "Debugging Rust memory leaks in production",
    author: "rust_guru.eth",
    excerpt:
      "Thread spawn + Arc lock loops can hide memory pressure patterns. Here is the instrumentation strategy that exposed the culprit.",
    tags: ["Rust", "Backend", "Bug"],
    votes: 156,
    comments: 48,
  },
  {
    title: "What is the cleanest auth strategy in Next 16?",
    author: "newbie_dev.eth",
    excerpt:
      "Comparing Better Auth, managed providers, and custom proxy approaches for fast MVPs that still scale under traffic.",
    tags: ["Next.js", "Auth"],
    votes: 89,
    comments: 12,
  },
];

export default function FeedPage() {
  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1400px] grid-cols-1 gap-6 px-4 pb-12 pt-6 md:grid-cols-[220px_1fr] xl:grid-cols-[220px_1fr_300px] sm:px-6 lg:px-8">
        <aside className="hidden space-y-4 rounded-xl border border-border bg-card/80 p-4 md:block">
          <h2 className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Navigation</h2>
          <div className="space-y-1">
            {[
              { label: "Home", active: true },
              { label: "Following", active: false },
              { label: "Categories", active: false },
              { label: "Tags", active: false },
              { label: "Bookmarks", active: false },
            ].map(({ label, active }) => (
              <div
                key={label}
                className={`rounded-md px-3 py-2 text-sm ${active ? "border-l-2 border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-background hover:text-foreground"}`}
              >
                {label}
              </div>
            ))}
          </div>
        </aside>

        <section className="space-y-5">
          <Card className="border-border bg-card/85">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Share a snippet or start a discussion</CardTitle>
              <CardDescription>Markdown and code blocks are supported.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                placeholder="Share a snippet or ask the community..."
                className="min-h-[110px] border-border bg-background/70"
              />
              <div className="flex items-center justify-between">
                <div className="hidden items-center gap-2 md:flex">
                  <Input placeholder="Attach tag: #react" className="w-56 border-border bg-background/70" />
                  <Button variant="outline" size="sm" className="border-border bg-background hover:bg-secondary/60">
                    <Search className="size-4" />
                    Suggest tags
                  </Button>
                </div>
                <Button className="bg-primary text-primary-foreground hover:bg-primary/90">
                  <Plus className="size-4" />
                  Publish
                </Button>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="relevant">
            <TabsList className="bg-card">
              <TabsTrigger value="relevant">Relevant</TabsTrigger>
              <TabsTrigger value="latest">Latest</TabsTrigger>
              <TabsTrigger value="top">Top</TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-4">
            {posts.map((post) => (
              <Card key={post.title} className="border-border bg-card/90">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold text-foreground">{post.author}</span>
                    <span>•</span>
                    <span>2h ago</span>
                  </div>
                  <CardTitle className="text-xl leading-tight">{post.title}</CardTitle>
                  <CardDescription>{post.excerpt}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-1.5">
                    {post.tags.map((tag) => (
                      <Badge key={tag} variant="outline" className="border-border bg-background">
                        {tag}
                      </Badge>
                    ))}
                  </div>

                  <div className="flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground">
                    <div className="flex items-center gap-4">
                      <button className="inline-flex items-center gap-1 hover:text-foreground">
                        <ThumbsUp className="size-4" />
                        {post.votes}
                      </button>
                      <button className="inline-flex items-center gap-1 hover:text-foreground">
                        <MessageCircle className="size-4" />
                        {post.comments}
                      </button>
                    </div>
                    <button className="inline-flex items-center gap-1 hover:text-foreground">
                      <Share2 className="size-4" />
                      Share
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>

        <aside className="hidden space-y-4 xl:block">
          <ViewerSummaryCard />

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-base">Trending Technical</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <p>Why we migrated from Next.js to Astro</p>
              <p>The state of AI agents in Q3</p>
              <p>Is TypeScript becoming too complex?</p>
            </CardContent>
          </Card>
        </aside>
      </main>
    </div>
  );
}
