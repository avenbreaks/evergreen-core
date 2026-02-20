import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { recordForumActionMetric } from "./forum-metrics";
import { assertCanPinPost } from "./forum-permissions";
import {
  createNotification,
  ensureProfileMetrics,
  ensureUserExists,
  getCommentById,
  getPostById,
} from "./forum-core.shared";

export const toggleForumReaction = async (input: {
  userId: string;
  targetType: "post" | "comment";
  targetId: string;
  reactionType: string;
}) => {
  const reactionType = input.reactionType.trim().toLowerCase();
  if (!reactionType) {
    throw new HttpError(400, "INVALID_REACTION", "Reaction type is required");
  }

  const now = new Date();
  let postId: string | null = null;
  let commentId: string | null = null;
  let recipientUserId: string | null = null;

  if (input.targetType === "post") {
    const post = await getPostById(input.targetId);
    postId = post.id;
    recipientUserId = post.authorId;
  } else {
    const comment = await getCommentById(input.targetId);
    postId = comment.postId;
    commentId = comment.id;
    recipientUserId = comment.authorId;
  }

  const [existing] = await authDb
    .select({ id: schema.forumReactions.id })
    .from(schema.forumReactions)
    .where(
      and(
        eq(schema.forumReactions.targetType, input.targetType),
        input.targetType === "post"
          ? eq(schema.forumReactions.postId, postId as string)
          : eq(schema.forumReactions.commentId, commentId as string),
        eq(schema.forumReactions.userId, input.userId),
        eq(schema.forumReactions.reactionType, reactionType)
      )
    )
    .limit(1);

  if (existing) {
    await authDb.delete(schema.forumReactions).where(eq(schema.forumReactions.id, existing.id));

    if (input.targetType === "post") {
      await authDb
        .update(schema.forumPosts)
        .set({
          reactionCount: sql`GREATEST(${schema.forumPosts.reactionCount} - 1, 0)`,
          updatedAt: now,
        })
        .where(eq(schema.forumPosts.id, postId as string));
    } else {
      await authDb
        .update(schema.forumComments)
        .set({
          reactionCount: sql`GREATEST(${schema.forumComments.reactionCount} - 1, 0)`,
          updatedAt: now,
        })
        .where(eq(schema.forumComments.id, commentId as string));
    }

    recordForumActionMetric("reaction_toggle");

    return {
      active: false,
      reactionType,
      targetType: input.targetType,
      targetId: input.targetId,
    };
  }

  await authDb.insert(schema.forumReactions).values({
    id: randomUUID(),
    targetType: input.targetType,
    postId,
    commentId,
    userId: input.userId,
    reactionType,
    createdAt: now,
  });

  if (input.targetType === "post") {
    await authDb
      .update(schema.forumPosts)
      .set({
        reactionCount: sql`${schema.forumPosts.reactionCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumPosts.id, postId as string));
  } else {
    await authDb
      .update(schema.forumComments)
      .set({
        reactionCount: sql`${schema.forumComments.reactionCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumComments.id, commentId as string));
  }

  await ensureProfileMetrics(input.userId);
  await authDb
    .update(schema.profileMetrics)
    .set({
      reactionGivenCount: sql`${schema.profileMetrics.reactionGivenCount} + 1`,
      updatedAt: now,
    })
    .where(eq(schema.profileMetrics.userId, input.userId));

  if (recipientUserId) {
    await ensureProfileMetrics(recipientUserId);
    await authDb
      .update(schema.profileMetrics)
      .set({
        reactionReceivedCount: sql`${schema.profileMetrics.reactionReceivedCount} + 1`,
        engagementScore: sql`${schema.profileMetrics.engagementScore} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.profileMetrics.userId, recipientUserId));

    await createNotification({
      recipientUserId,
      actorUserId: input.userId,
      type: "reaction",
      postId,
      commentId,
      payload: {
        reactionType,
      },
    });
  }

  recordForumActionMetric("reaction_toggle");

  return {
    active: true,
    reactionType,
    targetType: input.targetType,
    targetId: input.targetId,
  };
};

export const createForumShare = async (input: {
  userId: string;
  postId: string;
  shareComment?: string;
}) => {
  const post = await getPostById(input.postId);
  if (post.authorId === input.userId) {
    throw new HttpError(400, "INVALID_SHARE_TARGET", "Cannot share your own post");
  }

  const now = new Date();

  await authDb.insert(schema.forumShares).values({
    id: randomUUID(),
    postId: post.id,
    userId: input.userId,
    shareComment: input.shareComment?.trim() || null,
    createdAt: now,
  });

  await authDb
    .update(schema.forumPosts)
    .set({
      shareCount: sql`${schema.forumPosts.shareCount} + 1`,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, post.id));

  await createNotification({
    recipientUserId: post.authorId,
    actorUserId: input.userId,
    type: "share",
    postId: post.id,
  });

  return {
    shared: true,
    postId: post.id,
  };
};

export const toggleForumBookmark = async (input: {
  userId: string;
  postId: string;
  pinned?: boolean;
}) => {
  const post = await getPostById(input.postId);
  const now = new Date();

  const [existing] = await authDb
    .select()
    .from(schema.forumBookmarks)
    .where(and(eq(schema.forumBookmarks.userId, input.userId), eq(schema.forumBookmarks.postId, post.id)))
    .limit(1);

  if (!existing) {
    await authDb.insert(schema.forumBookmarks).values({
      userId: input.userId,
      postId: post.id,
      isPinned: Boolean(input.pinned),
      createdAt: now,
      updatedAt: now,
    });

    await authDb
      .update(schema.forumPosts)
      .set({
        bookmarkCount: sql`${schema.forumPosts.bookmarkCount} + 1`,
        updatedAt: now,
      })
      .where(eq(schema.forumPosts.id, post.id));

    return {
      bookmarked: true,
      pinned: Boolean(input.pinned),
      postId: post.id,
    };
  }

  if (input.pinned !== undefined) {
    await authDb
      .update(schema.forumBookmarks)
      .set({
        isPinned: input.pinned,
        updatedAt: now,
      })
      .where(and(eq(schema.forumBookmarks.userId, input.userId), eq(schema.forumBookmarks.postId, post.id)));

    return {
      bookmarked: true,
      pinned: input.pinned,
      postId: post.id,
    };
  }

  await authDb
    .delete(schema.forumBookmarks)
    .where(and(eq(schema.forumBookmarks.userId, input.userId), eq(schema.forumBookmarks.postId, post.id)));

  await authDb
    .update(schema.forumPosts)
    .set({
      bookmarkCount: sql`GREATEST(${schema.forumPosts.bookmarkCount} - 1, 0)`,
      updatedAt: now,
    })
    .where(eq(schema.forumPosts.id, post.id));

  return {
    bookmarked: false,
    pinned: false,
    postId: post.id,
  };
};

export const toggleForumFollow = async (input: {
  followerUserId: string;
  followeeUserId: string;
}) => {
  if (input.followerUserId === input.followeeUserId) {
    throw new HttpError(400, "INVALID_FOLLOW", "Cannot follow yourself");
  }

  await ensureUserExists(input.followeeUserId);
  await ensureProfileMetrics(input.followerUserId);
  await ensureProfileMetrics(input.followeeUserId);

  const [existing] = await authDb
    .select()
    .from(schema.forumFollows)
    .where(
      and(
        eq(schema.forumFollows.followerId, input.followerUserId),
        eq(schema.forumFollows.followeeId, input.followeeUserId)
      )
    )
    .limit(1);

  if (existing) {
    await authDb
      .delete(schema.forumFollows)
      .where(
        and(
          eq(schema.forumFollows.followerId, input.followerUserId),
          eq(schema.forumFollows.followeeId, input.followeeUserId)
        )
      );

    await authDb
      .update(schema.profileMetrics)
      .set({
        followingCount: sql`GREATEST(${schema.profileMetrics.followingCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profileMetrics.userId, input.followerUserId));

    await authDb
      .update(schema.profileMetrics)
      .set({
        followerCount: sql`GREATEST(${schema.profileMetrics.followerCount} - 1, 0)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.profileMetrics.userId, input.followeeUserId));

    return {
      following: false,
      followeeUserId: input.followeeUserId,
    };
  }

  await authDb.insert(schema.forumFollows).values({
    followerId: input.followerUserId,
    followeeId: input.followeeUserId,
    createdAt: new Date(),
  });

  await authDb
    .update(schema.profileMetrics)
    .set({
      followingCount: sql`${schema.profileMetrics.followingCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.profileMetrics.userId, input.followerUserId));

  await authDb
    .update(schema.profileMetrics)
    .set({
      followerCount: sql`${schema.profileMetrics.followerCount} + 1`,
      engagementScore: sql`${schema.profileMetrics.engagementScore} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(schema.profileMetrics.userId, input.followeeUserId));

  await createNotification({
    recipientUserId: input.followeeUserId,
    actorUserId: input.followerUserId,
    type: "follow",
  });

  return {
    following: true,
    followeeUserId: input.followeeUserId,
  };
};

export const setForumPostPinned = async (input: {
  userId: string;
  postId: string;
  pinned: boolean;
}) => {
  const { post } = await assertCanPinPost({
    actorUserId: input.userId,
    postId: input.postId,
  });

  await authDb
    .update(schema.forumPosts)
    .set({
      isPinned: input.pinned,
      updatedAt: new Date(),
    })
    .where(eq(schema.forumPosts.id, post.id));

  return {
    postId: post.id,
    pinned: input.pinned,
  };
};
