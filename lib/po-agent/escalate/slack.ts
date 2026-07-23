// Slack incoming-webhook post. Best-effort — returns false on any failure so escalation
// never throws.

export async function postSlack(webhookUrl: string, text: string): Promise<boolean> {
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}
