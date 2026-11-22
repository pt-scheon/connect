/* A community's old address. Its public page is /colleges/<slug>. */
export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  return new Response(null, { status: 307, headers: { location: `/colleges/${encodeURIComponent((await params).slug)}` } });
}
