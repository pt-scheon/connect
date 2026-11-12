import { currentUser, baseUrl } from "@/lib/auth";
import { get, run, now, db } from "@/lib/db";
import { canMessage, toMsg } from "@/lib/chat";
import { allow, notify } from "@/lib/notify";
import { LIMITS, cleanName, save, sizeText, sniff } from "@/lib/files";

export const dynamic = "force-dynamic";

const no = (error: string, status = 400) => Response.json({ error }, { status });

/* Sends one attachment (and an optional caption) as a chat message. Multipart form: to, file, caption, w, h. */
export async function POST(req: Request) {
  // Only from our own pages: a form on another site cannot post here as you.
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || (new URL(origin).host !== host && origin !== new URL(baseUrl()).origin)) return no("Bad origin.", 403);
  const declared = Number(req.headers.get("content-length") || 0);
  if (declared > LIMITS.fileBytes + 64 * 1024) return no(`That file is over ${sizeText(LIMITS.fileBytes)}.`, 413);

  const me = await currentUser();
  let fd: FormData;
  try { fd = await req.formData(); } catch { return no("Could not read the upload."); }
  const to = Number(fd.get("to"));
  const ok = canMessage(me ?? null, to);
  if ("error" in ok) return no(ok.error, 403);
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return no("Pick a file.");
  if (file.size > LIMITS.fileBytes) return no(`That file is over ${sizeText(LIMITS.fileBytes)}.`, 413);
  if (!allow(`up:${me!.id}`, LIMITS.perHour, 3600)) return no(`You can send ${LIMITS.perHour} files an hour. Try again later.`, 429);
  const today = get("SELECT COALESCE(SUM(file_size),0) n FROM messages WHERE from_id=? AND file_key IS NOT NULL AND created_at>?", me!.id, now() - 86400).n;
  if (today + file.size > LIMITS.bytesPerDay) return no(`You have sent ${sizeText(today)} of files today. The limit is ${sizeText(LIMITS.bytesPerDay)} a day.`, 429);

  const bytes = Buffer.from(await file.arrayBuffer());
  const t = sniff(bytes, file.name);
  if (!t) return no("Send a photo (JPG, PNG, WebP, GIF), a PDF, a Word, PowerPoint or Excel file, or a text file.", 415);
  if (t.kind === "image" && bytes.length > LIMITS.imageBytes) return no(`Images can be up to ${sizeText(LIMITS.imageBytes)}.`, 413);

  const dim = (k: string) => { const v = Math.round(Number(fd.get(k))); return v > 0 && v <= 20000 ? v : null; };
  const caption = String(fd.get("caption") ?? "").trim().slice(0, 2000);
  const key = save(bytes);
  const first = !get("SELECT 1 FROM messages WHERE (from_id=? AND to_id=?) OR (from_id=? AND to_id=?) LIMIT 1", me!.id, to, to, me!.id);
  const id = db.transaction(() => Number(run(
    `INSERT INTO messages (from_id, to_id, text, kind, file_key, file_name, file_type, file_size, file_w, file_h, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    me!.id, to, caption, t.kind, key, cleanName(file.name, t.ext), t.mime, bytes.length,
    t.kind === "image" ? dim("w") : null, t.kind === "image" ? dim("h") : null, now()).lastInsertRowid))();
  if (first) notify(to, `${me!.name} sent you a ${t.kind === "image" ? "photo" : "file"}`, `/messages/${me!.id}`);
  return Response.json({ message: toMsg(get("SELECT * FROM messages WHERE id=?", id), me!.id) });
}
