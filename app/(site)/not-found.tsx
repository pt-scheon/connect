import Link from "next/link";

export default function NotFound() {
  return (
    <section className="page-hero">
      <h1 className="display">Not here.</h1>
      <p className="lead">This page doesn’t exist, or it isn’t public.</p>
      <Link className="btn-line" href="/">Back to the start <span aria-hidden="true">→</span></Link>
    </section>
  );
}
