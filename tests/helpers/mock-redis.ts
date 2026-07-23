import type { Redis } from "@/lib/redis";

// In-memory Redis implementing the subset of commands the PO agent uses, with
// Upstash-REST-compatible return values (e.g. SET NX → "OK" or null). No TTL
// expiry (EX args are accepted and ignored) — sufficient for unit tests.

type Entry =
  | { type: "string"; v: string }
  | { type: "zset"; v: Map<string, number> }
  | { type: "hash"; v: Map<string, string> };

export interface MockRedis extends Redis {
  /** Inspect raw storage (tests only). */
  _dump(): Map<string, Entry>;
  _size(): number;
}

export function createMockRedis(): MockRedis {
  const store = new Map<string, Entry>();

  function run(command: (string | number)[]): unknown {
    const parts = command.map(String);
    const cmd = parts[0].toUpperCase();
    const args = parts.slice(1);

    switch (cmd) {
      case "SET": {
        const [key, value, ...opts] = args;
        const up = opts.map((o) => o.toUpperCase());
        const nx = up.includes("NX");
        const xx = up.includes("XX");
        const exists = store.has(key);
        if (nx && exists) return null;
        if (xx && !exists) return null;
        store.set(key, { type: "string", v: value });
        return "OK";
      }
      case "GET": {
        const e = store.get(args[0]);
        return e && e.type === "string" ? e.v : null;
      }
      case "DEL": {
        let n = 0;
        for (const k of args) if (store.delete(k)) n++;
        return n;
      }
      case "EXISTS": {
        let n = 0;
        for (const k of args) if (store.has(k)) n++;
        return n;
      }
      case "INCR": {
        const e = store.get(args[0]);
        const cur = e && e.type === "string" ? parseInt(e.v, 10) || 0 : 0;
        const next = cur + 1;
        store.set(args[0], { type: "string", v: String(next) });
        return next;
      }
      case "ZADD": {
        const key = args[0];
        let e = store.get(key);
        if (!e || e.type !== "zset") {
          e = { type: "zset", v: new Map() };
          store.set(key, e);
        }
        let added = 0;
        // args after key are score/member pairs.
        for (let i = 1; i + 1 < args.length; i += 2) {
          const score = Number(args[i]);
          const member = args[i + 1];
          if (!e.v.has(member)) added++;
          e.v.set(member, score);
        }
        return added;
      }
      case "ZREM": {
        const key = args[0];
        const e = store.get(key);
        if (!e || e.type !== "zset") return 0;
        let n = 0;
        for (const m of args.slice(1)) if (e.v.delete(m)) n++;
        return n;
      }
      case "ZRANGE": {
        const key = args[0];
        const start = parseInt(args[1], 10);
        const stop = parseInt(args[2], 10);
        const rest = args.slice(3).map((a) => a.toUpperCase());
        const withScores = rest.includes("WITHSCORES");
        const rev = rest.includes("REV");
        const e = store.get(key);
        if (!e || e.type !== "zset") return [];
        let arr = [...e.v.entries()].sort((a, b) => a[1] - b[1] || (a[0] < b[0] ? -1 : 1));
        if (rev) arr = arr.reverse();
        const len = arr.length;
        const s = start < 0 ? Math.max(len + start, 0) : start;
        const en = stop < 0 ? len + stop : stop;
        const slice = arr.slice(s, en + 1);
        return withScores ? slice.flatMap(([m, sc]) => [m, String(sc)]) : slice.map(([m]) => m);
      }
      case "HINCRBY": {
        const [key, field, byRaw] = args;
        const by = Number(byRaw);
        let e = store.get(key);
        if (!e || e.type !== "hash") {
          e = { type: "hash", v: new Map() };
          store.set(key, e);
        }
        const cur = parseInt(e.v.get(field) ?? "0", 10) || 0;
        const next = cur + by;
        e.v.set(field, String(next));
        return next;
      }
      case "HGETALL": {
        const e = store.get(args[0]);
        if (!e || e.type !== "hash") return [];
        return [...e.v.entries()].flat();
      }
      case "EXPIRE":
      case "PEXPIRE":
        return store.has(args[0]) ? 1 : 0;
      case "TTL":
        return store.has(args[0]) ? -1 : -2;
      default:
        throw new Error(`mock-redis: unsupported command ${cmd}`);
    }
  }

  return {
    async cmd<T>(command: (string | number)[]): Promise<T> {
      return run(command) as T;
    },
    async pipeline<T>(commands: (string | number)[][]): Promise<T[]> {
      return commands.map((c) => run(c) as T);
    },
    _dump() {
      return store;
    },
    _size() {
      return store.size;
    },
  };
}
