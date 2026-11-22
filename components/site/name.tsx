/* Invented test people carry "(fake)" at the end of their name (backend lib/db.ts); here it is set small. */
export function Name({ name }: { name: string }) {
  const fake = name.endsWith(" (fake)");
  return <>{fake ? name.slice(0, -7) : name}{fake && <small className="fake-tag"> (fake)</small>}</>;
}
