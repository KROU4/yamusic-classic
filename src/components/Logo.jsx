// The YM Classic mark (build/logo.svg) inline, so the record takes the accent colour chosen in Settings.
let uid = 0;

export function Logo({ size = 30, class: cls = "" }) {
  // gradient ids must be unique per instance: the sidebar and Settings show the mark at the same time
  const id = `logo-sheen-${++uid}`;
  return (
    <svg class={`logo-mark ${cls}`} width={size} height={size} viewBox="0 0 512 512" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id={id} cx="34%" cy="28%" r="80%">
          <stop offset="0" stop-color="#fff" stop-opacity="0.35" />
          <stop offset="0.55" stop-color="#fff" stop-opacity="0" />
          <stop offset="1" stop-color="#000" stop-opacity="0.12" />
        </radialGradient>
      </defs>
      <circle cx="256" cy="256" r="236" fill="var(--accent)" />
      <circle cx="256" cy="256" r="236" fill={`url(#${id})`} />
      <path d="M291.73 73.46 A186 186 0 1 0 434.69 205.82" fill="none" stroke="#161616" stroke-width="18" stroke-linecap="round" />
      <path d="M220.28 393.76 A142 142 0 1 0 121.53 302.27" fill="none" stroke="#161616" stroke-width="18" stroke-linecap="round" />
      <circle cx="256" cy="256" r="94" fill="#161616" />
      <path d="M236 217 L236 295 L299 256 Z" fill="var(--accent)" stroke="var(--accent)" stroke-width="18" stroke-linejoin="round" />
    </svg>
  );
}
