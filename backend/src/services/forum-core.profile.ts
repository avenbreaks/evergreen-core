import { eq } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { ensureProfileMetrics } from "./forum-core.shared";

export const getForumProfile = async (userId: string) => {
  const [user] = await authDb.select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user) {
    throw new HttpError(404, "USER_NOT_FOUND", "User not found");
  }

  await ensureProfileMetrics(userId);

  const [profileRows, extended, metrics] = await Promise.all([
    authDb.select().from(schema.profiles).where(eq(schema.profiles.userId, userId)).limit(1),
    authDb.select().from(schema.profileExtended).where(eq(schema.profileExtended.userId, userId)).limit(1),
    authDb.select().from(schema.profileMetrics).where(eq(schema.profileMetrics.userId, userId)).limit(1),
  ]);

  const profile = profileRows[0] ?? null;
  const extendedProfile = extended[0] ?? null;

  return {
    profile: {
      userId: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
      image: user.image,
      displayName: profile?.displayName ?? null,
      headline: profile?.headline ?? null,
      bio: profile?.bio ?? null,
      websiteUrl: extendedProfile?.websiteUrl ?? profile?.websiteUrl ?? null,
      githubUsername: profile?.githubUsername ?? null,
      location: extendedProfile?.location ?? profile?.location ?? null,
      organization: extendedProfile?.organization ?? null,
      brandingEmail: extendedProfile?.brandingEmail ?? null,
      displayWalletAddress: extendedProfile?.displayWalletAddress ?? null,
      displayEnsName: extendedProfile?.displayEnsName ?? null,
      metrics: metrics[0] ?? null,
    },
  };
};

export const updateForumProfile = async (input: {
  userId: string;
  displayName?: string;
  headline?: string;
  bio?: string;
  location?: string;
  organization?: string;
  websiteUrl?: string;
  githubUsername?: string;
  brandingEmail?: string;
  displayWalletAddress?: string;
  displayEnsName?: string;
}) => {
  const now = new Date();

  const [existingProfile, existingExtended] = await Promise.all([
    authDb
      .select({ userId: schema.profiles.userId })
      .from(schema.profiles)
      .where(eq(schema.profiles.userId, input.userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    authDb
      .select({ userId: schema.profileExtended.userId })
      .from(schema.profileExtended)
      .where(eq(schema.profileExtended.userId, input.userId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const profileValues = {
    userId: input.userId,
    displayName: input.displayName?.trim() || null,
    headline: input.headline?.trim() || null,
    bio: input.bio?.trim() || null,
    websiteUrl: input.websiteUrl?.trim() || null,
    githubUsername: input.githubUsername?.trim() || null,
    updatedAt: now,
  };

  if (existingProfile) {
    await authDb.update(schema.profiles).set(profileValues).where(eq(schema.profiles.userId, input.userId));
  } else {
    await authDb.insert(schema.profiles).values(profileValues);
  }

  const extendedValues = {
    userId: input.userId,
    location: input.location?.trim() || null,
    organization: input.organization?.trim() || null,
    websiteUrl: input.websiteUrl?.trim() || null,
    brandingEmail: input.brandingEmail?.trim() || null,
    displayWalletAddress: input.displayWalletAddress?.trim() || null,
    displayEnsName: input.displayEnsName?.trim()?.toLowerCase() || null,
    updatedAt: now,
  };

  if (existingExtended) {
    await authDb.update(schema.profileExtended).set(extendedValues).where(eq(schema.profileExtended.userId, input.userId));
  } else {
    await authDb.insert(schema.profileExtended).values(extendedValues);
  }

  return getForumProfile(input.userId);
};
