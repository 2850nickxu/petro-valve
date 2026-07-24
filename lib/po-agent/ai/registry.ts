// BYO AI provider. The model is chosen by PO_AGENT_MODEL ("provider:model-id") and the
// provider API key is read from the (effective) env — so a key entered in the admin
// Settings UI works the same as one set via env. Switch providers by changing two values.

import type { LanguageModel } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

type Env = Record<string, string | undefined>;

/** Resolve a "provider:model-id" string to a language model, keyed from env. */
export function poModel(modelId: string, env: Env = process.env): LanguageModel {
  const idx = modelId.indexOf(":");
  const provider = idx >= 0 ? modelId.slice(0, idx) : modelId;
  const model = idx >= 0 ? modelId.slice(idx + 1) : modelId;
  switch (provider) {
    case "anthropic":
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model);
    case "openai":
      return createOpenAI({ apiKey: env.OPENAI_API_KEY })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY })(model);
    default:
      throw new Error(`Unknown AI provider "${provider}" in PO_AGENT_MODEL.`);
  }
}

/** Resolve the configured model from env. Throws if PO_AGENT_MODEL is unset. */
export function getPoModel(env: Env = process.env): LanguageModel {
  const id = env.PO_AGENT_MODEL;
  if (!id) throw new Error("PO_AGENT_MODEL is not set (expected 'provider:model-id').");
  return poModel(id, env);
}

/** True when a model AND its provider key are configured (else use heuristic extraction). */
export function hasConfiguredModel(env: Env = process.env): boolean {
  const id = env.PO_AGENT_MODEL;
  if (!id) return false;
  const provider = id.slice(0, id.indexOf(":") >= 0 ? id.indexOf(":") : id.length);
  const key =
    provider === "anthropic"
      ? env.ANTHROPIC_API_KEY
      : provider === "openai"
        ? env.OPENAI_API_KEY
        : provider === "google"
          ? env.GOOGLE_GENERATIVE_AI_API_KEY
          : undefined;
  return Boolean(key);
}
