/* The website's old address for editing your profile. */
export function GET() {
  return new Response(null, { status: 307, headers: { location: "/onboarding?edit=1" } });
}
