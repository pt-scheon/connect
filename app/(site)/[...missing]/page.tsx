import { notFound } from "next/navigation";

/* Every address that nothing else answers. With two root layouts there is no single one for a "not found" page to use. */
export default function Missing() {
  notFound();
}
