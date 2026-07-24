import { loadSettings } from "./settings-store";

// The effective environment = process.env with persisted settings layered on top
// (global, then per-store). Everything that reads config takes an env object, so passing
// effectiveEnv() threads the UI-configured values through without touching process.env.

type Env = Record<string, string | undefined>;

export async function effectiveEnv(storeHash?: string, base: Env = process.env): Promise<Env> {
  const global = await loadSettings("global").catch(() => ({}));
  const perStore = storeHash ? await loadSettings(`store:${storeHash}`).catch(() => ({})) : {};
  return { ...base, ...global, ...perStore };
}
