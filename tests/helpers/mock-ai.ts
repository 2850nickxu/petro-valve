import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModel } from "ai";

// A language model that always returns the given object as JSON — lets us exercise the
// real generateObject/schema-validation path (ai/extract.ts) offline. The mock's
// doGenerate result type is strict; we cast at this test-only boundary.
export function fixtureModel(object: unknown): LanguageModel {
  const config = {
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text: JSON.stringify(object) }],
      warnings: [],
    }),
  } as any;
  return new MockLanguageModelV4(config) as unknown as LanguageModel;
}
