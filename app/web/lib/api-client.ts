export type AuthSession = {
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  session?: {
    id: string;
    expiresAt?: string | Date;
  } | null;
} | null;

export type MePayload = {
  user: {
    id: string;
    name?: string | null;
    email?: string | null;
  };
  profile?: {
    userId?: string;
    displayName?: string | null;
    bio?: string | null;
  } | null;
  wallets?: Array<{
    address: string;
    isPrimary: boolean;
  }>;
} | null;

export type NetworkPayload = {
  network?: {
    name?: string;
    chainId?: number;
  };
};

export type EnsTldsPayload = {
  tlds: string[];
};

export type EnsCheckPayload = {
  domainName?: string;
  available?: boolean;
  [key: string]: unknown;
};

const parseJson = async <T>(response: Response): Promise<T | null> => {
  const text = await response.text();
  if (!text) {
    return null;
  }

  return JSON.parse(text) as T;
};

export const fetchSession = async (): Promise<AuthSession> => {
  const response = await fetch("/api/auth/session", {
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Session request failed (${response.status})`);
  }

  return parseJson<AuthSession>(response);
};

export const fetchMe = async (): Promise<MePayload> => {
  const response = await fetch("/api/me", {
    cache: "no-store",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Profile request failed (${response.status})`);
  }

  return parseJson<MePayload>(response);
};

export const fetchNetwork = async (): Promise<NetworkPayload> => {
  const response = await fetch("/api/network", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Network request failed (${response.status})`);
  }

  const payload = await parseJson<NetworkPayload>(response);
  return payload ?? {};
};

export const postJson = async <TResponse>(url: string, payload: unknown): Promise<TResponse | null> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await parseJson<TResponse>(response);

  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data && typeof (data as { message?: unknown }).message === "string"
        ? (data as { message: string }).message
        : `Request failed (${response.status})`;

    throw new Error(message);
  }

  return data;
};

export const fetchEnsTlds = async (): Promise<EnsTldsPayload> => {
  const response = await fetch("/api/ens/tlds", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`ENS tlds request failed (${response.status})`);
  }

  const data = await parseJson<EnsTldsPayload>(response);
  return data ?? { tlds: [] };
};

export const postEnsCheck = async (payload: {
  label: string;
  tld: string;
  durationSeconds?: number;
}): Promise<EnsCheckPayload> => {
  const data = await postJson<EnsCheckPayload>("/api/ens/check", payload);
  return data ?? {};
};

export const requestPasswordReset = async (payload: { email: string; redirectTo?: string }) => {
  return postJson<{ status?: boolean; message?: string }>("/api/password/forgot-password", payload);
};

export const submitResetPassword = async (payload: { token: string; newPassword: string }) => {
  return postJson<{ status?: boolean; message?: string }>("/api/password/reset-password", payload);
};
