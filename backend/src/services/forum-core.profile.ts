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

  const [extended, metrics] = await Promise.all([
    authDb.select().from(schema.profileExtended).where(eq(schema.profileExtended.userId, userId)).limit(1),
    authDb.select().from(schema.profileMetrics).where(eq(schema.profileMetrics.userId, userId)).limit(1),
  ]);

  return {
    profile: {
      userId: user.id,
      email: user.email,
      name: user.name,
      username: user.username,
      image: user.image,
      location: extended[0]?.location ?? null,
      organization: extended[0]?.organization ?? null,
      websiteUrl: extended[0]?.websiteUrl ?? null,
      brandingEmail: extended[0]?.brandingEmail ?? null,
      displayWalletAddress: extended[0]?.displayWalletAddress ?? null,
      displayEnsName: extended[0]?.displayEnsName ?? null,
      metrics: metrics[0] ?? null,
    },
  };
};

export const updateForumProfile = async (input: {
  userId: string;
  location?: string;
  organization?: string;
  websiteUrl?: string;
  brandingEmail?: string;
  displayWalletAddress?: string;
  displayEnsName?: string;
}) => {
  const now = new Date();
  const [existing] = await authDb
    .select()
    .from(schema.profileExtended)
    .where(eq(schema.profileExtended.userId, input.userId))
    .limit(1);

  const values = {
    userId: input.userId,
    location: input.location?.trim() || null,
    organization: input.organization?.trim() || null,
    websiteUrl: input.websiteUrl?.trim() || null,
    brandingEmail: input.brandingEmail?.trim() || null,
    displayWalletAddress: input.displayWalletAddress?.trim() || null,
    displayEnsName: input.displayEnsName?.trim()?.toLowerCase() || null,
    updatedAt: now,
  };

  if (existing) {
    await authDb.update(schema.profileExtended).set(values).where(eq(schema.profileExtended.userId, input.userId));
  } else {
    await authDb.insert(schema.profileExtended).values(values);
  }

  return getForumProfile(input.userId);
};
