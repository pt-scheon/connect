"use client";

import { useEffect } from "react";

export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <section className="page-hero">
      <h1 className="display">That didn’t load.</h1>
      <p className="lead">Something broke on our side. Try again in a moment.</p>
      <button className="btn-line" onClick={() => retry()}>Try again <span aria-hidden="true">→</span></button>
    </section>
  );
}
