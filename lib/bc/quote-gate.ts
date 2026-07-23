// Pure quote-feature gating predicates (no I/O, no imports) — safe anywhere.
// Ported from the accelerator's lib/b2b/quote-gate.ts.

export interface QuoteConfig {
  featureEnabled: boolean;
  allowGuest: boolean;
  allowIndividual: boolean;
  allowCompany: boolean;
  onProductPage: boolean;
  onCartPage: boolean;
  defaultExpirationDays: number;
}

export type QuoteAudience = "guest" | "individual" | "company";

export function quoteAudience(session?: { b2bCompanyId?: number } | null): QuoteAudience {
  if (!session) return "guest";
  return session.b2bCompanyId ? "company" : "individual";
}

export function isQuoteAllowed(config: QuoteConfig, audience: QuoteAudience): boolean {
  if (!config.featureEnabled) return false;
  if (audience === "guest") return config.allowGuest;
  if (audience === "individual") return config.allowIndividual;
  return config.allowCompany;
}

export function isQuoteAllowedOnProduct(config: QuoteConfig, audience: QuoteAudience): boolean {
  return isQuoteAllowed(config, audience) && config.onProductPage;
}

export function isQuoteAllowedOnCart(config: QuoteConfig, audience: QuoteAudience): boolean {
  return isQuoteAllowed(config, audience) && config.onCartPage;
}
