import type { Extractor } from "../channel/types";
import { extractPo } from "./extract";
import { heuristicExtract } from "./mock-provider";
import { buildAttachmentParts } from "./attachments";
import { getPoModel, hasConfiguredModel } from "./registry";

// Resolve the extraction function: the real LLM extractor when PO_AGENT_MODEL is set,
// otherwise the dependency-free heuristic so the demo runs with zero AI keys.

export function resolveExtractor(env: Record<string, string | undefined> = process.env): Extractor {
  if (hasConfiguredModel(env)) {
    const model = getPoModel(env);
    const modelId = env.PO_AGENT_MODEL ?? "unknown";
    return async (msg, prior) => {
      const r = await extractPo({
        model,
        subject: msg.subject,
        bodyText: msg.bodyText,
        attachments: msg.attachments,
        priorExtraction: prior?.priorExtraction,
        buyerReply: prior?.buyerReply,
      });
      return {
        extracted: r.extracted,
        notes: r.notes,
        usage: r.usage ? { model: modelId, ...r.usage } : undefined,
      };
    };
  }

  return async (msg, prior) => {
    const { parts } = buildAttachmentParts(msg.attachments);
    const extraText = parts
      .filter((p): p is { type: "text"; text: string } => p.type === "text")
      .map((p) => p.text)
      .join("\n");
    const bodyText = [msg.bodyText, prior?.buyerReply].filter(Boolean).join("\n");
    const extracted = heuristicExtract({ subject: msg.subject, bodyText, extraText });

    // Merge: a short reply (e.g. "CONFIRM") has no SKUs — carry forward the prior PO so a
    // clarification/confirmation reply doesn't wipe the original line items. (The real LLM
    // extractor does this via the merge prompt.)
    if (prior?.priorExtraction && extracted.lines.every((l) => !l.sku)) {
      return {
        extracted: {
          ...prior.priorExtraction,
          paymentIntent:
            extracted.paymentIntent !== "unspecified"
              ? extracted.paymentIntent
              : prior.priorExtraction.paymentIntent,
          poNumber: prior.priorExtraction.poNumber ?? extracted.poNumber,
        },
        notes: [],
      };
    }
    return { extracted, notes: [] };
  };
}
