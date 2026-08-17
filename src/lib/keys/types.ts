/**
 * Gemini API Key Pool & Failover Data Models
 */

export type KeyStatus =
  | "available"
  | "active"
  | "rate_limited"
  | "quota_exceeded"
  | "invalid"
  | "disabled"
  | "error";

export interface GeminiApiKey {
  id: string;
  name: string;
  maskedKey: string;

  enabled: boolean;
  priority: number;

  status: KeyStatus;

  lastUsedAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  cooldownUntil?: string;

  requestCount: number;
  failureCount: number;

  createdAt: string;
}

export interface KeyTestResult {
  success: boolean;
  status: KeyStatus;
  message: string;
  latencyMs?: number;
}
