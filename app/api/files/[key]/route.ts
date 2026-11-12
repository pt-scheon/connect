import { currentUser } from "@/lib/auth";
import { get } from "@/lib/db";
import { read } from "@/lib/files";

export const dynamic = "force-dynamic";

/* A chat attachment. Only the two people in that conversation can open it. */
export async function GET(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const me = await currentUser();
  const key = (await params).key;
  const m = me ? get("SELECT * FROM messages WHERE file_key=? AND (from_id=? OR to_id=?)", key, me.id, me.id) : null;
  const bytes = m ? read(key) : null;
  if (!m || !bytes) return new Response("Not found", { status: 404 });
  const inline = m.kind === "image" || m.file_type === "application/pdf";
  const download = new URL(req.url).searchParams.has("download");
  const name = encodeURIComponent(m.file_name);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": m.file_type,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `${inline && !download ? "inline" : "attachment"}; filename*=UTF-8''${name}`,
      "Cache-Control": "private, max-age=604800, immutable",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      // Even if a file were opened directly, it cannot run scripts or load anything. (Chrome will not show a PDF
      // inside a sandbox, and PDFs are shown by the browser's own viewer, so they skip it.)
      "Content-Security-Policy": m.file_type === "application/pdf" ? "frame-ancestors 'none'"
        : "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
    },
  });
}
