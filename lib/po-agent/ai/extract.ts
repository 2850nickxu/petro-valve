import { generateObject, type LanguageModel, type ModelMessage } from "ai";
import { z } from "zod";
import { EXTRACTION_SYSTEM } from "./prompts";
import { buildAttachmentParts, type Attachment, type ModelContentPart } from "./attachments";
import type { ExtractedPo } from "../types";

// Address fields are required strings (empty "" = absent) rather than 11 nullable unions
// each. Strict structured-output compilers cap union/nullable params (Anthropic: 16), and
// two nullable Address objects × 11 nullable fields alone would blow that budget. Absence
// of a whole address is still expressed by shipTo/billTo being null; a missing field within
// a present address is "" (normalized away by addressToCheckout's `|| undefined`).
const AddressSchema = z.object({
  firstName: z.string(),
  lastName: z.string(),
  company: z.string(),
  line1: z.string(),
  line2: z.string(),
  city: z.string(),
  state: z.string(),
  zip: z.string(),
  country: z.string(),
  phone: z.string(),
  email: z.string(),
});

export const ExtractedPoSchema = z.object({
  poNumber: z.string().nullable(),
  buyerNote: z.string().nullable(),
  paymentIntent: z.enum(["on_account", "credit_card", "unspecified"]),
  requestedShipDate: z.string().nullable(),
  shipTo: AddressSchema.nullable(),
  billTo: AddressSchema.nullable(),
  lines: z
    .array(
      z.object({
        rawText: z.string(),
        sku: z.string().nullable(),
        description: z.string().nullable(),
        quantity: z.number().int().positive().nullable(),
        statedUnitPrice: z.number().nullable(),
        statedTotal: z.number().nullable(),
      }),
    )
    .min(1),
  currency: z.string().nullable(),
  confidence: z.enum(["high", "medium", "low"]),
});

export type ExtractedPoParsed = z.infer<typeof ExtractedPoSchema>;

export interface ExtractInput {
  model: LanguageModel;
  subject?: string;
  bodyText?: string;
  attachments?: Attachment[];
  /** Clarification rounds: prior extraction to merge with the buyer's reply. */
  priorExtraction?: ExtractedPo;
  buyerReply?: string;
}

export interface RawUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export async function extractPo(
  input: ExtractInput,
): Promise<{ extracted: ExtractedPo; notes: string[]; usage?: RawUsage }> {
  const { parts, notes } = buildAttachmentParts(input.attachments ?? []);

  const content: ModelContentPart[] = [];
  const header = [input.subject ? `Subject: ${input.subject}` : "", input.bodyText ?? ""]
    .filter(Boolean)
    .join("\n\n");
  if (header) content.push({ type: "text", text: header });
  if (input.priorExtraction) {
    content.push({
      type: "text",
      text: `Prior extraction (apply the buyer's corrections and return the merged result):\n${JSON.stringify(
        input.priorExtraction,
      )}`,
    });
  }
  if (input.buyerReply) {
    content.push({ type: "text", text: `Buyer reply:\n${input.buyerReply}` });
  }
  content.push(...parts);
  if (!content.length) content.push({ type: "text", text: "(no content provided)" });

  // content is valid UserContent (text + file parts); the SDK's message union is broader.
  const messages = [{ role: "user", content }] as unknown as ModelMessage[];

  const { object, usage } = await generateObject({
    model: input.model,
    schema: ExtractedPoSchema,
    system: EXTRACTION_SYSTEM,
    messages,
  });

  const raw: RawUsage | undefined = usage
    ? { inputTokens: usage.inputTokens ?? 0, outputTokens: usage.outputTokens ?? 0, totalTokens: usage.totalTokens ?? 0 }
    : undefined;

  return { extracted: object as ExtractedPo, notes, usage: raw };
}
