// Version comparison for update checks (pure: unit-tested without Electron).
/** "1.2.10" > "1.2.9"; pre-release suffixes are ignored for ordering. */
export function newerVersion(latest, current) {
  const p = (v) =>
    String(v || "")
      .replace(/^v/, "")
      .split("-")[0]
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const a = p(latest);
  const b = p(current);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}
