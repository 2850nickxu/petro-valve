import { handleExtension } from "@/lib/bc-app/ext-response";

export const runtime = "nodejs";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handleExtension(req, `/app-panel/orders/${encodeURIComponent(id)}`);
}
