// BigCommerce single-click app (Phase B) credentials — distinct from the store API
// account used in Phase A. Set in the dev portal (devtools.bigcommerce.com).

export interface BcAppCreds {
  clientId: string;
  clientSecret: string;
}

export function bcAppCreds(env: Record<string, string | undefined> = process.env): BcAppCreds | null {
  const clientId = env.BC_APP_CLIENT_ID;
  const clientSecret = env.BC_APP_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}
