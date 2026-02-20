import { Code2, Heart, MessageCircle, Repeat2, Share2, Star, Trophy } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const techStack = ["TypeScript", "React", "Node.js", "Rust", "PostgreSQL", "Docker", "AWS"];

const posts = [
  {
    title: "Shipped a big CLI update",
    body: "Added persistent local state + faster dev builds using Turbopack. DX is dramatically better.",
    comments: 24,
    reposts: 12,
    likes: 184,
    views: "2.1k",
    pinned: true,
  },
  {
    title: "RSC mental model discussion",
    body: "Anyone else finding React Server Components powerful but tricky once client state gets deep?",
    comments: 48,
    reposts: 3,
    likes: 56,
    views: "890",
    pinned: false,
  },
];

const heatmapValues = Array.from({ length: 84 }, (_, index) => {
  const value = (index * 17 + 13) % 10;
  if (value > 8) return "bg-primary/80";
  if (value > 6) return "bg-primary/50";
  if (value > 3) return "bg-primary/30";
  return "bg-border";
});

export default function DeveloperProfilePage() {
  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1450px] grid-cols-1 gap-6 px-4 pb-10 pt-6 lg:grid-cols-[310px_1fr] sm:px-6 lg:px-8">
        <aside className="space-y-4">
          <Card className="border-border bg-card/90">
            <CardContent className="space-y-5 p-6 text-center">
              <div className="mx-auto flex size-24 items-center justify-center rounded-full border-2 border-border bg-background text-2xl font-black text-primary">
                AD
              </div>
              <div>
                <h1 className="font-mono text-2xl font-bold text-foreground">alex.devparty</h1>
                <p className="text-sm text-muted-foreground">Senior Full-Stack Engineer</p>
              </div>
              <div className="flex gap-2">
                <Button className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90">Follow</Button>
                <Button variant="outline" className="border-border bg-background hover:bg-secondary/60">
                  Message
                </Button>
              </div>
              <p className="text-sm leading-relaxed text-muted-foreground">
                Building tools for developers. Open source enthusiast. Previously at Stripe.
              </p>
              <div className="grid grid-cols-3 gap-2 border-t border-border pt-4 text-center">
                <div>
                  <p className="text-lg font-bold text-foreground">2.4k</p>
                  <p className="text-xs text-muted-foreground">Followers</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">142</p>
                  <p className="text-xs text-muted-foreground">Following</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-foreground">89</p>
                  <p className="text-xs text-muted-foreground">Repos</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle className="text-sm uppercase tracking-[0.16em] text-muted-foreground">Tech Stack</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {techStack.map((item) => (
                <Badge key={item} variant="outline" className="border-border bg-background text-xs">
                  {item}
                </Badge>
              ))}
            </CardContent>
          </Card>
        </aside>

        <section className="space-y-5">
          <Card className="overflow-hidden border-border bg-card/90">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Code2 className="size-4 text-primary" />
                    Contribution Activity
                  </CardTitle>
                  <CardDescription>2,340 contributions in the last year</CardDescription>
                </div>
                <div className="flex items-center gap-4 text-sm">
                  <div>
                    <p className="font-mono text-lg font-bold text-foreground">45</p>
                    <p className="text-xs text-muted-foreground">Day streak</p>
                  </div>
                  <div className="h-8 w-px bg-border" />
                  <div>
                    <p className="font-mono text-lg font-bold text-foreground">Top 5%</p>
                    <p className="text-xs text-muted-foreground">Global rank</p>
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-flow-col grid-rows-7 gap-1 overflow-x-auto pb-2">
                {heatmapValues.map((tone, index) => (
                  <div key={index} className={`size-3 rounded-sm ${tone}`} />
                ))}
              </div>
              <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
                <span>Less</span>
                <div className="size-3 rounded-sm bg-border" />
                <div className="size-3 rounded-sm bg-primary/30" />
                <div className="size-3 rounded-sm bg-primary/50" />
                <div className="size-3 rounded-sm bg-primary/80" />
                <span>More</span>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2 border-b border-border pb-2 text-sm text-muted-foreground">
            <Badge className="border border-primary/30 bg-primary/15 text-primary">Posts</Badge>
            <span>Replies</span>
            <span>Bookmarks</span>
            <span>Showcase</span>
          </div>

          <div className="space-y-4">
            {posts.map((post) => (
              <Card key={post.title} className="border-border bg-card/90">
                <CardContent className="space-y-4 p-6">
                  {post.pinned ? (
                    <Badge className="border border-primary/30 bg-primary/15 text-primary">
                      <Star className="mr-1 size-3.5" />
                      Pinned
                    </Badge>
                  ) : null}
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">alex.devparty · @alex_codes</p>
                    <h2 className="text-lg font-semibold text-foreground">{post.title}</h2>
                    <p className="text-sm text-muted-foreground">{post.body}</p>
                  </div>

                  <div className="flex max-w-md items-center justify-between text-xs text-muted-foreground">
                    <button className="inline-flex items-center gap-1 hover:text-foreground">
                      <MessageCircle className="size-4" /> {post.comments}
                    </button>
                    <button className="inline-flex items-center gap-1 hover:text-primary">
                      <Repeat2 className="size-4" /> {post.reposts}
                    </button>
                    <button className="inline-flex items-center gap-1 hover:text-red-300">
                      <Heart className="size-4" /> {post.likes}
                    </button>
                    <button className="inline-flex items-center gap-1 hover:text-foreground">
                      <Trophy className="size-4" /> {post.views}
                    </button>
                    <button className="inline-flex items-center gap-1 hover:text-foreground">
                      <Share2 className="size-4" />
                    </button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
