"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

/* What the last action said (?ok= or ?err=), on public pages: signing out or deleting an account can end on one. */
export function SiteToast() {
  const q = useSearchParams(), path = usePathname(), router = useRouter();
  const [text, setText] = useState("");
  const said = q.get("err") || q.get("ok");
  useEffect(() => { if (said) { setText(said); router.replace(path, { scroll: false }); } }, [said, path, router]);
  useEffect(() => { if (!text) return; const t = setTimeout(() => setText(""), 7000); return () => clearTimeout(t); }, [text]);
  return text ? <p className="site-toast" role="status">{text}</p> : null;
}
