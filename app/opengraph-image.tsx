import { ogCard, ogSize } from "./og";

export const size = ogSize;
export const contentType = "image/png";
export const alt = "Connect: build with people from your college";

/* Preview card for the home page and any page without its own. */
export default async function Image() {
  return ogCard({
    eyebrow: "For colleges",
    title: "Build with people from your college",
    subtitle: "Find teammates, ship real projects, and earn credit only for what ships, signed by your teammates.",
  });
}
