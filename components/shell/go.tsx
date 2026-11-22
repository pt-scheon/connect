"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentProps } from "react";
import { isPublicPage } from "@/lib/routes";

/* A link in the shell. Inside one root layout it moves without reloading. Crossing to the other layout it is a plain
   link, and so is any members' page for someone signed out: only a full request lets proxy.ts note the page to come
   back to after sign-in. */
export function Go({ signedIn, href, ...rest }: Omit<ComponentProps<"a">, "href"> & { signedIn: boolean; href: string }) {
  const to = isPublicPage(href.split(/[?#]/)[0]), here = isPublicPage(usePathname());
  return to === here && (signedIn || to) ? <Link href={href} {...rest} /> : <a href={href} {...rest} />;
}
