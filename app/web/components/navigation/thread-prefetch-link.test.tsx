import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ThreadPrefetchLink } from "./thread-prefetch-link";

import * as apiClient from "@/lib/api-client";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api-client")>();

  return {
    ...actual,
    fetchForumPostDetail: vi.fn(),
  };
});

const fetchForumPostDetailMock = vi.mocked(apiClient.fetchForumPostDetail);

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

describe("ThreadPrefetchLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prefetches thread detail once on first hover/focus", async () => {
    fetchForumPostDetailMock.mockResolvedValue({
      post: {
        id: "post-1",
        title: "Thread 1",
        slug: "thread-1",
        status: "published",
        isPinned: false,
        isLocked: false,
        commentCount: 0,
        reactionCount: 0,
        shareCount: 0,
        bookmarkCount: 0,
        lastActivityAt: "2026-02-21T00:00:00.000Z",
        createdAt: "2026-02-21T00:00:00.000Z",
        updatedAt: "2026-02-21T00:00:00.000Z",
        deletedAt: null,
        authorId: "author-1",
        contentMarkdown: "hello",
        contentPlaintext: "hello",
      },
      comments: [],
      commentsNextCursor: null,
    });

    const queryClient = makeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ThreadPrefetchLink postId="post-1">Open thread</ThreadPrefetchLink>
      </QueryClientProvider>
    );

    const link = screen.getByRole("link", { name: /open thread/i });
    fireEvent.mouseEnter(link);

    await waitFor(() => {
      expect(fetchForumPostDetailMock).toHaveBeenCalledWith("post-1", {
        commentsLimit: 20,
        commentsCursor: undefined,
      });
    });

    fireEvent.focus(link);
    fireEvent.mouseEnter(link);

    await waitFor(() => {
      expect(fetchForumPostDetailMock).toHaveBeenCalledTimes(1);
    });
  });
});
