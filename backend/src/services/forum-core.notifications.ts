import { and, desc, eq, isNull, lt, or } from "drizzle-orm";

import { authDb } from "@evergreen-devparty/auth";
import { schema } from "@evergreen-devparty/db";

import { HttpError } from "../lib/http-error";
import { summarizeNotification } from "./forum-core.shared";

export const listForumNotifications = async (input: {
  userId: string;
  limit?: number;
  unreadOnly?: boolean;
  cursor?: string;
}) => {
  const size = Math.max(1, Math.min(input.limit ?? 50, 200));
  const filters = [eq(schema.forumNotifications.recipientUserId, input.userId)];

  if (input.unreadOnly) {
    filters.push(isNull(schema.forumNotifications.readAt));
  }

  if (input.cursor) {
    const [cursorNotification] = await authDb
      .select({
        id: schema.forumNotifications.id,
        createdAt: schema.forumNotifications.createdAt,
      })
      .from(schema.forumNotifications)
      .where(
        and(
          eq(schema.forumNotifications.id, input.cursor),
          eq(schema.forumNotifications.recipientUserId, input.userId)
        )
      )
      .limit(1);

    if (cursorNotification) {
      const cursorFilter = or(
        lt(schema.forumNotifications.createdAt, cursorNotification.createdAt),
        and(
          eq(schema.forumNotifications.createdAt, cursorNotification.createdAt),
          lt(schema.forumNotifications.id, cursorNotification.id)
        )
      );

      if (cursorFilter) {
        filters.push(cursorFilter);
      }
    }
  }

  const rows = await authDb
    .select()
    .from(schema.forumNotifications)
    .where(and(...filters))
    .orderBy(desc(schema.forumNotifications.createdAt), desc(schema.forumNotifications.id))
    .limit(size);

  return {
    notifications: rows.map((row) => summarizeNotification(row)),
    nextCursor: rows.at(-1)?.id ?? null,
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

export const markAllForumNotificationsRead = async (input: { userId: string }) => {
  const now = new Date();
  const updatedRows = await authDb
    .update(schema.forumNotifications)
    .set({
      readAt: now,
    })
    .where(and(eq(schema.forumNotifications.recipientUserId, input.userId), isNull(schema.forumNotifications.readAt)))
    .returning({ id: schema.forumNotifications.id });

  return {
    read: true,
    updatedCount: updatedRows.length,
  };
};
