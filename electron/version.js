// Version comparison for update checks (pure: unit-tested without Electron).
/** "1.2.10" > "1.2.9"; a pre-release sorts before its final release. */
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
  // same numbers: the final release is newer than its own pre-release (0.3.0 > 0.3.0-rc.1)
  const pre = (v) => String(v || "").includes("-");
  return pre(current) && !pre(latest);
}
