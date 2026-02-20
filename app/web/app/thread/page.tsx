import Link from "next/link";

import { ArrowRight } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ThreadLandingPage() {
  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto w-full max-w-4xl px-4 pb-12 pt-10 sm:px-6 lg:px-8">
        <Card className="border-border bg-card/90">
          <CardHeader>
            <CardTitle className="text-2xl">Thread Hub</CardTitle>
            <CardDescription>
              Thread pages are now dynamic. Open any post from feed to load its real discussion route.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="bg-primary text-primary-foreground hover:bg-primary/90">
              <Link href="/feed">
                Go to feed
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
