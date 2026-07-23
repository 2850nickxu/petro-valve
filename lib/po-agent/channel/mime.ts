// RFC-2822 reply construction + base64url helpers for the Gmail API.

export function base64UrlEncode(input: string | Buffer | Uint8Array): string {
  return Buffer.from(input as Buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(padded, "base64");
}

export interface ReplyMime {
  from: string;
  to: string;
  subject: string;
  text: string;
  /** RFC Message-ID being replied to → In-Reply-To + appended to References. */
  inReplyTo?: string;
  references?: string;
}

/** Build a raw RFC-2822 message (base64url) suitable for users.messages.send. */
export function buildReplyRaw(m: ReplyMime): string {
  const references = [m.references, m.inReplyTo].filter(Boolean).join(" ");
  const headers = [
    `From: ${m.from}`,
    `To: ${m.to}`,
    `Subject: ${m.subject}`,
    ...(m.inReplyTo ? [`In-Reply-To: ${m.inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
  ];
  const raw = `${headers.join("\r\n")}\r\n\r\n${m.text}`;
  return base64UrlEncode(raw);
}
