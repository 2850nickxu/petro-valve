import { notFound } from "next/navigation";
import { Button, InlineMessage, Panel, TextField } from "@/components/backbone";
import { isPreviewDeployment } from "@/lib/po-agent/preview-access";

// Sign-in for Vercel preview deployments. A preview can't receive the BigCommerce app
// session, so an operator mints a single-use code on production (Settings → Store →
// Preview access) and enters it here. Exists only on previews.

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  invalid: "That code is invalid, expired, or already used. Create a new one on production.",
  redis: "Redis isn't configured on this preview, so codes can't be checked.",
};

export default async function PreviewLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  if (!isPreviewDeployment()) notFound();
  const sp = await searchParams;
  const error = sp.error ? (ERRORS[sp.error] ?? ERRORS.invalid) : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--surface-page)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--page-pad)",
        fontFamily: "var(--font-ui)",
        color: "var(--text-primary)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <Panel title="Sign in to this preview" bodyStyle={{ gap: "var(--gap-group)" }}>
          <p style={{ margin: 0, fontSize: "var(--text-body-size)", lineHeight: "var(--text-body-line)", color: "var(--text-secondary)" }}>
            Open the PO agent on production, go to Settings → Store → Preview access, and create a sign-in code.
            Codes work once and expire after 10 minutes.
          </p>
          {error ? <InlineMessage tone="danger">{error}</InlineMessage> : null}
          <form method="post" action="/api/preview-login" style={{ display: "flex", flexDirection: "column", gap: "var(--gap-group)" }}>
            <input type="hidden" name="next" value={sp.next ?? "/staff"} />
            <TextField
              label="Sign-in code"
              name="code"
              placeholder="XXXX-XXXX-XXXX-XXXX"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              mono
              required
            />
            <Button type="submit" variant="primary" block>
              Sign in
            </Button>
          </form>
        </Panel>
      </div>
    </main>
  );
}
