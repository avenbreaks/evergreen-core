import { backendEnv } from "../../config/env";

import { countRecentSuccessfulAuthentications, countSuccessfulAuthenticationsForIp } from "./audit";

const hasSensitiveScope = (scopes: string[]): boolean =>
  scopes.some((scope) => {
    const normalized = scope.toLowerCase();
    return normalized.includes(":write") || normalized.includes(":admin") || normalized.startsWith("keys:");
  });

export type ApiKeyRiskEvaluation = {
  score: number;
  level: "low" | "medium" | "high";
  policyAction: "allow" | "throttle" | "block";
  reasons: string[];
};

export const evaluateApiKeyRisk = async (input: {
  keyId: string;
  ipAddress: string;
  failedAuthStreak: number;
  requiredScopes: string[];
}): Promise<ApiKeyRiskEvaluation> => {
  const reasons: string[] = [];
  let score = 0;

  const failedAuthStreak = Math.max(0, Math.floor(input.failedAuthStreak));
  if (failedAuthStreak >= 3) {
    const streakScore = Math.min(40, failedAuthStreak * 10);
    score += streakScore;
    reasons.push("failed_auth_streak");
  }

  const now = Date.now();
  const seenIpCount = await countSuccessfulAuthenticationsForIp({
    keyId: input.keyId,
    ipAddress: input.ipAddress,
    since: new Date(now - 30 * 24 * 60 * 60 * 1000),
  });

  if (seenIpCount === 0) {
    score += 20;
    reasons.push("new_ip");
  }

  const burstCount = await countRecentSuccessfulAuthentications({
    keyId: input.keyId,
    since: new Date(now - 60 * 1000),
  });

  if (burstCount >= backendEnv.apiKey.riskBurstThreshold) {
    score += 30;
    reasons.push("burst_traffic");
  }

  if (hasSensitiveScope(input.requiredScopes)) {
    score += 20;
    reasons.push("sensitive_scope");
  }

  if (score >= backendEnv.apiKey.riskHighThreshold) {
    return {
      score,
      level: "high",
      policyAction: "block",
      reasons,
    };
  }

  if (score >= backendEnv.apiKey.riskMediumThreshold) {
    return {
      score,
      level: "medium",
      policyAction: "throttle",
      reasons,
    };
  }

  return {
    score,
    level: "low",
    policyAction: "allow",
    reasons,
  };
};
