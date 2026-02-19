import { and, desc, eq, isNull } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { summarizeNotification } from "./forum-core.shared";

export const listForumNotifications = async (input: {
  userId: string;
  limit?: number;
  unreadOnly?: boolean;
}) => {
  const size = Math.max(1, Math.min(input.limit ?? 50, 200));
  const rows = await authDb
    .select()
    .from(schema.forumNotifications)
    .where(
      and(
        eq(schema.forumNotifications.recipientUserId, input.userId),
        input.unreadOnly ? isNull(schema.forumNotifications.readAt) : undefined
      )
    )
    .orderBy(desc(schema.forumNotifications.createdAt))
    .limit(size);

  return {
    notifications: rows.map((row) => summarizeNotification(row)),
  };
};

export const markForumNotificationRead = async (input: { userId: string; notificationId: string }) => {
  const [notification] = await authDb
    .select()
    .from(schema.forumNotifications)
    .where(eq(schema.forumNotifications.id, input.notificationId))
    .limit(1);

  if (!notification || notification.recipientUserId !== input.userId) {
    throw new HttpError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
  }

  await authDb
    .update(schema.forumNotifications)
    .set({
      readAt: new Date(),
    })
    .where(eq(schema.forumNotifications.id, input.notificationId));

  return {
    notificationId: input.notificationId,
    read: true,
  };
};
