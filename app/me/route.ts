import { currentUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
/* The website's old address for your own profile. */
export async function GET() {
  const me = await currentUser();
  return new Response(null, { status: 307, headers: { location: me ? `/u/${me.id}` : "/signin" } });
}
