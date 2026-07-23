// BYO AI provider. Switch providers by changing PO_AGENT_MODEL ("provider:model-id")
// and setting that provider's standard API-key env var — no code change. Each provider
// factory reads its own key lazily (ANTHROPIC_API_KEY / OPENAI_API_KEY /
// GOOGLE_GENERATIVE_AI_API_KEY), so building the registry needs no keys.

import { createProviderRegistry, type LanguageModel } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { openai } from "@ai-sdk/openai";
import { google } from "@ai-sdk/google";

// Azure can be added here (AZURE_RESOURCE_NAME / AZURE_API_KEY) — omitted until needed.
export const registry = createProviderRegistry({ anthropic, openai, google });

type ModelId = Parameters<typeof registry.languageModel>[0];

/** Resolve a "provider:model-id" string to a language model. */
export function poModel(modelId: string): LanguageModel {
  return registry.languageModel(modelId as ModelId);
}

/** Resolve the configured model from env. Throws if PO_AGENT_MODEL is unset. */
export function getPoModel(env: Record<string, string | undefined> = process.env): LanguageModel {
  const id = env.PO_AGENT_MODEL;
  if (!id) throw new Error("PO_AGENT_MODEL is not set (expected 'provider:model-id').");
  return poModel(id);
}

/** True when a model is configured (so the pipeline can fall back to heuristic extraction). */
export function hasConfiguredModel(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.PO_AGENT_MODEL);
}
