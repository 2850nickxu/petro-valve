import { describe, it, expect, vi, afterEach } from "vitest";
import { getRedis, redisConfigured } from "@/lib/redis";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

describe("getRedis configuration gate", () => {
  it("returns null when unconfigured", () => {
    expect(getRedis({})).toBeNull();
    expect(redisConfigured({})).toBe(false);
  });

  it("accepts UPSTASH_* and KV_REST_API_* aliases", () => {
    expect(getRedis({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" })).not.toBeNull();
    expect(getRedis({ KV_REST_API_URL: "https://x", KV_REST_API_TOKEN: "t" })).not.toBeNull();
    expect(redisConfigured({ UPSTASH_REDIS_REST_URL: "https://x", UPSTASH_REDIS_REST_TOKEN: "t" })).toBe(true);
  });
});

describe("Redis REST command shaping", () => {
  it("cmd POSTs the command array with bearer auth and returns result", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ result: "OK" }),
    })) as unknown as typeof fetch;
    globalThis.fetch = fetchMock;

    const redis = getRedis({ UPSTASH_REDIS_REST_URL: "https://db.example", UPSTASH_REDIS_REST_TOKEN: "secret" })!;
    const result = await redis.cmd<string>(["SET", "k", "v", "NX"]);

    expect(result).toBe("OK");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://db.example");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret");
    expect(JSON.parse(init.body as string)).toEqual(["SET", "k", "v", "NX"]);
  });

  it("cmd throws on an error envelope", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ error: "WRONGTYPE" }),
    })) as unknown as typeof fetch;
    const redis = getRedis({ UPSTASH_REDIS_REST_URL: "https://db", UPSTASH_REDIS_REST_TOKEN: "t" })!;
    await expect(redis.cmd(["GET", "k"])).rejects.toThrow(/WRONGTYPE/);
  });

  it("pipeline POSTs to /pipeline and maps results in order", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => [{ result: "OK" }, { result: 3 }],
    })) as unknown as typeof fetch;
    const redis = getRedis({ UPSTASH_REDIS_REST_URL: "https://db", UPSTASH_REDIS_REST_TOKEN: "t" })!;
    const results = await redis.pipeline([
      ["SET", "a", "1"],
      ["INCR", "n"],
    ]);
    expect(results).toEqual(["OK", 3]);
  });
});
