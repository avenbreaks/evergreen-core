import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import NotificationsPage from "./page";
import * as apiClient from "@/lib/api-client";

vi.mock("@/components/layout/evergreen-header", () => ({
  EvergreenHeader: () => <div data-testid="evergreen-header" />,
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();

  return {
    ...actual,
    fetchSession: vi.fn(),
    fetchForumNotifications: vi.fn(),
    markForumNotificationRead: vi.fn(),
    markAllForumNotificationsRead: vi.fn(),
  };
});

const fetchSessionMock = vi.mocked(apiClient.fetchSession);
const fetchForumNotificationsMock = vi.mocked(apiClient.fetchForumNotifications);
const markForumNotificationReadMock = vi.mocked(apiClient.markForumNotificationRead);
const markAllForumNotificationsReadMock = vi.mocked(apiClient.markAllForumNotificationsRead);

const authSession: apiClient.AuthSession = {
  user: {
    id: "user-1",
    email: "user@example.com",
  },
  session: {
    id: "session-1",
  },
};

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
      mutations: {
        retry: false,
      },
    },
  });

const renderPage = () => {
  const queryClient = makeQueryClient();

  return render(
    <QueryClientProvider client={queryClient}>
      <NotificationsPage />
    </QueryClientProvider>
  );
};

describe("NotificationsPage", () => {
  beforeEach(() => {
    fetchSessionMock.mockResolvedValue(authSession);
    markForumNotificationReadMock.mockResolvedValue({
      notificationId: "notif-1",
      read: true,
    });
    markAllForumNotificationsReadMock.mockResolvedValue({
      read: true,
      updatedCount: 1,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows sign-in prompt and skips notification fetch for guests", async () => {
    fetchSessionMock.mockResolvedValue(null);

    renderPage();

    expect(await screen.findByText(/You need to sign in first/i)).toBeInTheDocument();
    expect(fetchForumNotificationsMock).not.toHaveBeenCalled();
  });

  it("loads additional pages when requesting more notifications", async () => {
    const firstPage: apiClient.ForumNotificationsPayload = {
      notifications: [
        {
          id: "notif-1",
          recipientUserId: "user-1",
          actorUserId: "user-2",
          type: "mention",
          postId: "post-1",
          commentId: null,
          payload: {},
          readAt: null,
          createdAt: "2026-02-21T00:00:00.000Z",
        },
      ],
      nextCursor: "cursor-1",
    };

    const secondPage: apiClient.ForumNotificationsPayload = {
      notifications: [
        {
          id: "notif-2",
          recipientUserId: "user-1",
          actorUserId: "user-3",
          type: "share",
          postId: "post-2",
          commentId: null,
          payload: {},
          readAt: null,
          createdAt: "2026-02-20T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    };

    fetchForumNotificationsMock.mockImplementation(async (input = {}) => {
      if (input.cursor === "cursor-1") {
        return secondPage;
      }

      return firstPage;
    });

    renderPage();

    expect(await screen.findByText("You were mentioned in a discussion.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load more notifications/i }));

    await waitFor(() => {
      expect(fetchForumNotificationsMock).toHaveBeenCalledWith({
        limit: 25,
        cursor: "cursor-1",
        unreadOnly: false,
      });
    });

    expect(await screen.findByText("Your post was shared.")).toBeInTheDocument();
  });

  it("triggers mark read actions for single and all notifications", async () => {
    fetchForumNotificationsMock.mockResolvedValue({
      notifications: [
        {
          id: "notif-1",
          recipientUserId: "user-1",
          actorUserId: "user-2",
          type: "reaction",
          postId: "post-1",
          commentId: null,
          payload: {},
          readAt: null,
          createdAt: "2026-02-21T00:00:00.000Z",
        },
      ],
      nextCursor: null,
    });

    renderPage();

    expect(await screen.findByText("Your content received a new reaction.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Mark read$/i }));
    await waitFor(() => {
      expect(markForumNotificationReadMock).toHaveBeenCalledWith("notif-1");
    });

    fireEvent.click(screen.getByRole("button", { name: /Mark all read/i }));
    await waitFor(() => {
      expect(markAllForumNotificationsReadMock).toHaveBeenCalledTimes(1);
    });
  });
});
