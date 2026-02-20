import { createDb, schema } from "@evergreen-devparty/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";

import { authEnv } from "./env";
import { sendResetPasswordEmail, sendVerificationEmail } from "./mail";

export const authDb = createDb(authEnv.databaseUrl);

const socialProviders =
  authEnv.githubClientId && authEnv.githubClientSecret
    ? {
        github: {
          clientId: authEnv.githubClientId,
          clientSecret: authEnv.githubClientSecret,
        },
      }
    : undefined;

const trustedProviders = ["email-password", "siwe", ...(socialProviders ? ["github"] : [])];

export const auth = betterAuth({
  appName: "Evergreen Devparty",
  baseURL: authEnv.betterAuthUrl,
  secret: authEnv.betterAuthSecret,
  trustedOrigins: authEnv.trustedOrigins,
  database: drizzleAdapter(authDb, {
    provider: "pg",
    schema: {
      ...schema,
      user: schema.users,
      account: schema.authAccounts,
      session: schema.authSessions,
      verification: schema.authVerifications,
    },
  }),
  account: {
    accountLinking: {
      enabled: true,
      trustedProviders,
      allowDifferentEmails: authEnv.security.allowDifferentLinkedEmails,
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: authEnv.security.requireEmailVerification,
    minPasswordLength: 8,
    sendResetPassword: async ({ user, url }) => {
      await sendResetPasswordEmail({
        email: user.email,
        name: user.name,
        url,
      });
    },
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendVerificationEmail({
        email: user.email,
        name: user.name,
        url,
      });
    },
    sendOnSignUp: true,
  },
  ...(socialProviders ? { socialProviders } : {}),
  rateLimit: {
    enabled: authEnv.rateLimit.enabled,
    storage: authEnv.rateLimit.storage,
  },
  advanced: {
    useSecureCookies: authEnv.nodeEnv === "production",
    disableCSRFCheck: false,
    disableOriginCheck: false,
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
  experimental: {
    joins: true,
  },
});
