import type { FastifyInstance } from "fastify";

import type { ForumRouteContext } from "./deps";
import { notificationListQuerySchema, notificationParamsSchema } from "./schemas";

export const registerForumNotificationRoutes = (app: FastifyInstance, context: ForumRouteContext): void => {
  const { deps, forumWritePreHandler } = context;

  const writeSseEvent = (target: NodeJS.WritableStream, input: { event: string; data: unknown }) => {
    target.write(`event: ${input.event}\n`);
    target.write(`data: ${JSON.stringify(input.data)}\n\n`);
  };

  app.get(
    "/api/notifications",
    {
      preHandler: deps.requireAuthSessionMiddleware,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const query = notificationListQuerySchema.parse(request.query);

      return deps.listForumNotifications({
        userId: authSession.user.id,
        limit: query.limit,
        cursor: query.cursor,
        unreadOnly: query.unreadOnly,
      });
    }
  );

  app.get(
    "/api/notifications/stream",
    {
      preHandler: deps.requireAuthSessionMiddleware,
    },
    async (request, reply) => {
      const authSession = await deps.requireAuthSession(request);
      const userId = authSession.user.id;

      reply.hijack();
      reply.raw.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
      });
      reply.raw.flushHeaders?.();
      reply.raw.write("retry: 5000\n\n");

      let closed = false;
      let lastStateKey: string | null = null;

      const sendEvent = (event: string, data: unknown) => {
        if (closed || reply.raw.writableEnded) {
          return;
        }

        writeSseEvent(reply.raw, {
          event,
          data,
        });
      };

      const publishState = async (force = false) => {
        try {
          const snapshot = await deps.getForumNotificationStreamState({
            userId,
          });
          const currentStateKey = `${snapshot.latestNotificationId ?? "none"}:${snapshot.unreadCount}`;

          if (force || currentStateKey !== lastStateKey) {
            lastStateKey = currentStateKey;
            sendEvent("notifications", snapshot);
          }
        } catch {
          sendEvent("error", {
            message: "NOTIFICATION_STREAM_ERROR",
          });
        }
      };

      const pollTimer = setInterval(() => {
        void publishState();
      }, 2_000);

      const heartbeatTimer = setInterval(() => {
        sendEvent("ping", {
          at: new Date().toISOString(),
        });
      }, 15_000);

      await publishState(true);

      await new Promise<void>((resolve) => {
        const teardown = () => {
          if (closed) {
            return;
          }

          closed = true;
          clearInterval(pollTimer);
          clearInterval(heartbeatTimer);
          resolve();
        };

        request.raw.once("close", teardown);
        request.raw.once("end", teardown);
      });
    }
  );

  app.patch(
    "/api/notifications/read-all",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);

      return deps.markAllForumNotificationsRead({
        userId: authSession.user.id,
      });
    }
  );

  app.patch(
    "/api/notifications/:notificationId/read",
    {
      preHandler: forumWritePreHandler,
    },
    async (request) => {
      const authSession = await deps.requireAuthSession(request);
      const params = notificationParamsSchema.parse(request.params);

      return deps.markForumNotificationRead({
        userId: authSession.user.id,
        notificationId: params.notificationId,
      });
    }
  );
};
