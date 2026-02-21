import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProfileNavLink } from "./profile-nav-link";

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
    fetchMe: vi.fn(),
    fetchForumProfile: vi.fn(),
    fetchForumPosts: vi.fn(),
  };
});

const fetchMeMock = vi.mocked(apiClient.fetchMe);
const fetchForumProfileMock = vi.mocked(apiClient.fetchForumProfile);
const fetchForumPostsMock = vi.mocked(apiClient.fetchForumPosts);

const makeQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: 0,
      },
    },
  });

describe("ProfileNavLink", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("prefetches profile summary and authored posts on hover", async () => {
    fetchMeMock.mockResolvedValue({
      user: {
        id: "11111111-1111-4111-8111-111111111111",
        email: "user@example.com",
      },
      session: {
        id: "session-1",
      },
      wallets: [],
      profile: null,
    });

    fetchForumProfileMock.mockResolvedValue({ profile: undefined });
    fetchForumPostsMock.mockResolvedValue({
      posts: [],
      nextCursor: null,
    });

    const queryClient = makeQueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <ProfileNavLink />
      </QueryClientProvider>
    );

    const link = await screen.findByRole("link", { name: /profile/i });
    await waitFor(() => {
      expect(link).toHaveAttribute("href", "/profile/11111111-1111-4111-8111-111111111111");
    });

    fireEvent.mouseEnter(link);

    await waitFor(() => {
      expect(fetchForumProfileMock).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
      expect(fetchForumPostsMock).toHaveBeenCalledWith({
        authorId: "11111111-1111-4111-8111-111111111111",
        limit: 12,
        cursor: undefined,
      });
    });

    fireEvent.focus(link);

    await waitFor(() => {
      expect(fetchForumProfileMock).toHaveBeenCalledTimes(1);
      expect(fetchForumPostsMock).toHaveBeenCalledTimes(1);
    });
  });
});
