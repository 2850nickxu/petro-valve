"use client";

import { useState } from "react";
import { Button, Inset, Panel } from "@/components/backbone";
import { useToast } from "@/components/ui/toast";

// Settings → Store: mint a single-use code that signs a Vercel preview deployment in as
// the current store (previews can't receive the BigCommerce app session). The code is
// entered on the preview's /preview-login page.

interface Issued {
  code: string;
  expiresAt: string;
  storeHash: string | null;
}

export function PreviewAccess() {
  const toast = useToast();
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      const res = await fetch("/api/staff/preview-access", { method: "POST" });
      const json = (await res.json().catch(() => ({}))) as Partial<Issued> & { error?: string };
      if (!res.ok || !json.code) throw new Error(json.error ?? `Request failed (${res.status})`);
      setIssued(json as Issued);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't create a code.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.code);
      toast.success("Code copied");
    } catch {
      toast.error("Copy failed — select the code and copy it manually.");
    }
  }

  const expires = issued ? new Date(issued.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <Panel
      title="Preview access"
      meta="Sign in to a branch preview deployment as this store."
      actions={
        <Button variant="secondary" size="micro" onClick={create} loading={busy}>
          {issued ? "Create another code" : "Create sign-in code"}
        </Button>
      }
      bodyStyle={{ gap: "var(--gap-group)" }}
    >
      <span style={{ fontSize: "var(--text-caption-size)", color: "var(--text-secondary)", lineHeight: 1.6 }}>
        Preview deployments can&apos;t use the BigCommerce sign-in. Create a code here, open the preview&apos;s{" "}
        <span style={{ fontFamily: "var(--font-mono)" }}>/staff</span> page, and enter it. Codes work once and
        expire after 10 minutes; the preview session lasts 12 hours.
      </span>
      {issued ? (
        <Inset label={`Expires at ${expires}${issued.storeHash ? ` · store ${issued.storeHash}` : " · global settings"}`}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "var(--space-3)", flexWrap: "wrap" }}>
            <span
              style={{ fontFamily: "var(--font-mono)", fontSize: 18, letterSpacing: "0.06em", color: "var(--text-primary)", userSelect: "all" }}
            >
              {issued.code}
            </span>
            <Button variant="ghost" size="micro" icon="copy" onClick={copy}>
              Copy
            </Button>
          </div>
        </Inset>
      ) : null}
    </Panel>
  );
}
