// Dependency-free Upstash Redis REST client (ported from the accelerator's
// lib/gate/redis.ts pattern). REST-based so there are no TCP pooling issues on
// serverless. Returns null when unconfigured so callers can degrade / fail closed.

export interface Redis {
  /** Run a single Redis command, e.g. cmd(["SET", "k", "v", "NX"]). */
  cmd<T = unknown>(command: (string | number)[]): Promise<T>;
  /** Run many commands in one round-trip; returns results in order. */
  pipeline<T = unknown>(commands: (string | number)[][]): Promise<T[]>;
}

function readCreds(env: Record<string, string | undefined>): { url?: string; token?: string } {
  return {
    url: env.UPSTASH_REDIS_REST_URL || env.KV_REST_API_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN || env.KV_REST_API_TOKEN,
  };
}

/**
 * Build a Redis client from env, or null when UPSTASH_REDIS_REST_URL/TOKEN (or their
 * KV_REST_API_* aliases) are absent. Cheap to call — no module-level caching, so tests
 * can vary env freely.
 */
export function getRedis(env: Record<string, string | undefined> = process.env): Redis | null {
  const { url, token } = readCreds(env);
  if (!url || !token) return null;

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  return {
    async cmd<T>(command: (string | number)[]): Promise<T> {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(command),
        cache: "no-store",
      });
      const json = (await res.json()) as { result?: T; error?: string };
      if (!res.ok || json.error) {
        throw new Error(`Redis error ${res.status}: ${json.error ?? "request failed"}`);
      }
      return json.result as T;
    },
    async pipeline<T>(commands: (string | number)[][]): Promise<T[]> {
      const res = await fetch(`${url}/pipeline`, {
        method: "POST",
        headers,
        body: JSON.stringify(commands),
        cache: "no-store",
      });
      const json = (await res.json()) as Array<{ result?: T; error?: string }>;
      if (!res.ok) {
        throw new Error(`Redis pipeline error ${res.status}`);
      }
      return json.map((r) => r.result as T);
    },
  };
}

/** True when Redis credentials are present in the environment. */
export function redisConfigured(env: Record<string, string | undefined> = process.env): boolean {
  const { url, token } = readCreds(env);
  return Boolean(url && token);
}
