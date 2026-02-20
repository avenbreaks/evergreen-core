"use client";

import { FormEvent, useState } from "react";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Camera, Fingerprint, Github, Globe, Save } from "lucide-react";

import { EvergreenHeader } from "@/components/layout/evergreen-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { fetchForumProfile, fetchMe, patchForumProfile } from "@/lib/api-client";

const navItems = [
  { label: "Public Profile", active: true },
  { label: "Account", active: false },
  { label: "ENS Identity", active: false },
  { label: "Security", active: false },
  { label: "Notifications", active: false },
];

export default function SettingsProfilePage() {
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [bio, setBio] = useState<string | null>(null);
  const [skills, setSkills] = useState(["Rust", "React", "Solidity"]);
  const [skillInput, setSkillInput] = useState("");
  const [githubUsername, setGithubUsername] = useState<string | null>(null);
  const [website, setWebsite] = useState<string | null>(null);
  const [location, setLocation] = useState<string | null>(null);
  const [organization, setOrganization] = useState<string | null>(null);
  const [brandingEmail, setBrandingEmail] = useState<string | null>(null);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [ensHandle, setEnsHandle] = useState<string | null>(null);
  const [githubSyncEnabled, setGithubSyncEnabled] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);

  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
  });

  const profileQuery = useQuery({
    queryKey: ["forum-profile", meQuery.data?.user?.id],
    queryFn: () => fetchForumProfile(meQuery.data?.user?.id || ""),
    enabled: Boolean(meQuery.data?.user?.id),
  });

  const profile = profileQuery.data?.profile;
  const displayNameValue = displayName ?? profile?.displayName ?? meQuery.data?.user?.name ?? "Alex Developer";
  const bioValue = bio ?? profile?.bio ?? "";
  const githubUsernameValue = githubUsername ?? profile?.githubUsername ?? "";
  const locationValue = location ?? profile?.location ?? "";
  const organizationValue = organization ?? profile?.organization ?? "";
  const websiteValue = website ?? profile?.websiteUrl ?? "";
  const brandingEmailValue = brandingEmail ?? profile?.brandingEmail ?? "";
  const walletAddressValue = walletAddress ?? profile?.displayWalletAddress ?? "";
  const ensHandleValue = ensHandle ?? profile?.displayEnsName ?? "alex_dev.eth";

  const saveMutation = useMutation({
    mutationFn: () =>
      patchForumProfile({
        displayName: displayNameValue || undefined,
        bio: bioValue || undefined,
        location: locationValue || undefined,
        organization: organizationValue || undefined,
        websiteUrl: websiteValue || undefined,
        githubUsername: githubUsernameValue || undefined,
        brandingEmail: brandingEmailValue || undefined,
        displayWalletAddress: walletAddressValue || undefined,
        displayEnsName: ensHandleValue || undefined,
      }),
    onSuccess: (payload) => {
      setStatusError(null);
      setStatusMessage("Forum profile synced to backend.");

      const profile = payload?.profile;
      if (!profile) {
        return;
      }

      setLocation(profile.location || "");
      setOrganization(profile.organization || "");
      setWebsite(profile.websiteUrl || "");
      setDisplayName(profile.displayName || "");
      setBio(profile.bio || "");
      setGithubUsername(profile.githubUsername || "");
      setBrandingEmail(profile.brandingEmail || "");
      setWalletAddress(profile.displayWalletAddress || "");
      setEnsHandle(profile.displayEnsName || "");
    },
    onError: (error) => {
      setStatusMessage(null);
      setStatusError(error instanceof Error ? error.message : "Failed to sync profile");
    },
  });

  const onSave = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatusMessage(null);
    setStatusError(null);
    saveMutation.mutate();
  };

  return (
    <div className="min-h-screen">
      <div className="grid-atmosphere fixed inset-0 -z-10 opacity-30" />
      <EvergreenHeader />

      <main className="mx-auto grid w-full max-w-[1450px] grid-cols-1 gap-6 px-4 pb-10 pt-6 md:grid-cols-[240px_1fr] sm:px-6 lg:px-8">
        <aside className="hidden rounded-xl border border-border bg-card/85 p-4 md:block">
          <p className="px-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Settings</p>
          <nav className="mt-3 space-y-1">
            {navItems.map((item) => (
              <button
                key={item.label}
                className={`w-full rounded-md px-3 py-2 text-left text-sm ${
                  item.active
                    ? "border-l-2 border-primary bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-background hover:text-foreground"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <form className="space-y-5" onSubmit={onSave}>
          <div className="space-y-1">
            <h1 className="text-3xl font-black tracking-tight">Public Profile</h1>
            <p className="text-sm text-muted-foreground">Manage your public presence and developer identity.</p>
            <p className="text-xs text-muted-foreground">
              {meQuery.data?.user
                ? `Signed in as ${meQuery.data.user.email || meQuery.data.user.id}`
                : "Sign in to sync profile changes with backend."}
            </p>
            {profileQuery.isPending ? <p className="text-xs text-muted-foreground">Loading current profile values...</p> : null}
            {profileQuery.isError ? (
              <p className="text-xs text-destructive">
                {profileQuery.error instanceof Error ? profileQuery.error.message : "Could not load profile from backend"}
              </p>
            ) : null}
          </div>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle>Profile picture</CardTitle>
              <CardDescription>PNG, JPG, or GIF up to 5 MB. Recommended square image.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <div className="relative flex size-24 items-center justify-center rounded-full border-2 border-border bg-background text-2xl font-black text-primary">
                AD
                <button
                  type="button"
                  className="absolute -bottom-1 -right-1 rounded-full border border-border bg-card p-2 text-muted-foreground hover:text-foreground"
                >
                  <Camera className="size-4" />
                </button>
              </div>
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Current avatar is visible on feed posts and profile cards.</p>
                <Button type="button" variant="outline" className="border-border bg-background hover:bg-secondary/60">
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle>Public identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display name</Label>
                  <Input
                    id="display-name"
                    value={displayNameValue}
                    onChange={(event) => setDisplayName(event.target.value)}
                    className="border-border bg-background"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ens-handle">ENS handle</Label>
                  <div className="relative">
                    <Input
                      id="ens-handle"
                      value={ensHandleValue}
                      onChange={(event) => setEnsHandle(event.target.value)}
                      className="border-border bg-card font-mono text-muted-foreground"
                    />
                    <Fingerprint className="absolute right-3 top-1/2 size-4 -translate-y-1/2 text-primary" />
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-bio">Bio</Label>
                <Textarea
                  id="profile-bio"
                  value={bioValue}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="Tell us about yourself..."
                  className="min-h-[110px] border-border bg-background"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="tech-stack">Tech stack</Label>
                <div className="rounded-lg border border-border bg-background p-2">
                  <div className="mb-2 flex flex-wrap gap-2">
                    {skills.map((skill) => (
                      <Badge key={skill} variant="outline" className="border-border bg-card text-xs">
                        {skill}
                        <button
                          type="button"
                          className="ml-1 text-muted-foreground hover:text-foreground"
                          onClick={() => setSkills((current) => current.filter((item) => item !== skill))}
                        >
                          x
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <Input
                    id="tech-stack"
                    value={skillInput}
                    onChange={(event) => setSkillInput(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key !== "Enter") {
                        return;
                      }
                      event.preventDefault();
                      const next = skillInput.trim();
                      if (!next) {
                        return;
                      }
                      setSkills((current) => (current.includes(next) ? current : [...current, next]));
                      setSkillInput("");
                    }}
                    placeholder="Type a skill and press Enter..."
                    className="border-border bg-card"
                  />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle>Social links</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="flex items-center rounded-lg border border-border bg-background">
                <span className="border-r border-border px-3 text-muted-foreground">
                  <Github className="size-4" />
                </span>
                <Input
                  value={githubUsernameValue}
                  onChange={(event) => setGithubUsername(event.target.value)}
                  placeholder="GitHub username"
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="flex items-center rounded-lg border border-border bg-background">
                <span className="border-r border-border px-3 text-muted-foreground">
                  <Globe className="size-4" />
                </span>
                <Input
                  value={websiteValue}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://website.com"
                  className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardHeader>
              <CardTitle>Backend forum profile fields</CardTitle>
              <CardDescription>This section syncs to `/api/profile/me` on save.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="profile-location">Location</Label>
                <Input
                  id="profile-location"
                  value={locationValue}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="Jakarta"
                  className="border-border bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-organization">Organization</Label>
                <Input
                  id="profile-organization"
                  value={organizationValue}
                  onChange={(event) => setOrganization(event.target.value)}
                  placeholder="Evergreen Labs"
                  className="border-border bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-branding-email">Branding email</Label>
                <Input
                  id="profile-branding-email"
                  type="email"
                  value={brandingEmailValue}
                  onChange={(event) => setBrandingEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="border-border bg-background"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-wallet">Display wallet address</Label>
                <Input
                  id="profile-wallet"
                  value={walletAddressValue}
                  onChange={(event) => setWalletAddress(event.target.value)}
                  placeholder="0x..."
                  className="border-border bg-background font-mono"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="border-border bg-card/90">
            <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-md border border-border bg-background p-2 text-muted-foreground">
                  <Github className="size-5" />
                </div>
                <div>
                  <p className="font-medium text-foreground">GitHub integration</p>
                  <p className="text-sm text-muted-foreground">Sync repositories and contribution stats to your profile.</p>
                </div>
              </div>
              <Switch checked={githubSyncEnabled} onCheckedChange={setGithubSyncEnabled} />
            </CardContent>
          </Card>

          <div className="sticky bottom-4 flex justify-end gap-3 rounded-lg border border-border bg-background/90 p-3 backdrop-blur md:static md:border-0 md:bg-transparent md:p-0">
            <Button type="button" variant="outline" className="border-border bg-background hover:bg-secondary/60">
              Cancel
            </Button>
            <Button type="submit" className="bg-primary text-primary-foreground hover:bg-primary/90" disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Save className="size-4 animate-pulse" /> : <Save className="size-4" />}
              Save changes
            </Button>
          </div>

          {statusError ? <p className="text-right text-sm text-destructive">{statusError}</p> : null}
          {statusMessage ? <p className="text-right text-sm text-primary">{statusMessage}</p> : null}
        </form>
      </main>
    </div>
  );
}
