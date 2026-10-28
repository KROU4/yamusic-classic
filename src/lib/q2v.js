// My Wave from a free-text prompt ("Query to Vibe"). There is no dedicated endpoint: the prompt becomes a
// rotor seed `q2v:<base64(protobuf { 1: string })>` and goes to rotor/session/new like any station.
// Building it locally (instead of asking search for it) works for any text: search only returns the seed
// for prompts its classifier likes, and only for accounts in the server-side experiment.
// Pure module (no DOM): the UI and the unit tests share it.

export const Q2V_PREFIX = "q2v:";
// Rotor accepted 160+ characters; longer prompts are untested, so the input stops here
export const MAX_PROMPT = 200;

export const PROMPT_EXAMPLES = [
  "Спокойный джаз для работы",
  "Энергичный рок для пробежки",
  "Что-нибудь мелодичное и танцевальное",
  "Хочу что-нибудь бодрое, но не слишком",
  "Музыка для дождливого вечера",
];

/** One line, single spaces, capped: newlines from a paste must not end up in the seed. */
export function normalizePrompt(text) {
  return String(text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_PROMPT)
    .trim();
}

function varint(n) {
  const out = [];
  while (n > 0x7f) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return out;
}

function toBase64(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin); // standard alphabet with padding, exactly what the server produces
}

/** Station id for a prompt; null for an empty prompt. */
export function q2vSeed(text) {
  const prompt = normalizePrompt(text);
  if (!prompt) return null;
  const utf8 = new TextEncoder().encode(prompt);
  return Q2V_PREFIX + toBase64([0x0a, ...varint(utf8.length), ...utf8]);
}

export const isPromptStation = (id) => typeof id === "string" && id.startsWith(Q2V_PREFIX);

/** Prompt text back from a q2v seed (field 1 of the protobuf); null when it isn't one. */
export function promptFromSeed(seed) {
  if (!isPromptStation(seed)) return null;
  try {
    const bin = atob(seed.slice(Q2V_PREFIX.length));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    if (bytes[0] !== 0x0a) return null;
    let len = 0;
    let shift = 0;
    let i = 1;
    for (; i < bytes.length; i++) {
      len |= (bytes[i] & 0x7f) << shift;
      shift += 7;
      if (!(bytes[i] & 0x80)) break;
    }
    const body = bytes.subarray(i + 1, i + 1 + len);
    if (body.length !== len) return null;
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

/** Caption for the UI: the server capitalises the first letter too. */
export function promptTitle(text) {
  const p = normalizePrompt(text);
  return p ? p[0].toLocaleUpperCase("ru") + p.slice(1) : "";
}

// A colour for the orb and the sidebar thumb, guessed from the words of the prompt: a calm prompt
// should not glow in workout red. Unknown words fall back to a stable hash, so a prompt keeps its colour.
const MOOD_WORDS = [
  ["calm", /спокойн|тих|сон|засып|медлен|расслаб|релакс|чил|chill|calm|lo-?fi|джаз|jazz|ambient|эмбиент|медитац|утр/i],
  ["sad", /грус|печал|меланхол|тоск|дожд|осен|sad|одинок/i],
  ["active", /бодр|энерг|рок|rock|метал|трен|бег|пробеж|спорт|драйв|workout|gym|run/i],
  ["fun", /весел|танц|вечерин|праздн|party|dance|поп|лет|disco|диско/i],
];
const MOODS = ["active", "fun", "calm", "sad"];

/** Settings-shaped palette hint for paletteFor(): { moodEnergy }. */
export function promptMood(text) {
  const p = normalizePrompt(text);
  for (const [mood, re] of MOOD_WORDS) if (re.test(p)) return { moodEnergy: mood };
  let h = 0;
  for (const ch of p) h = (h * 31 + ch.codePointAt(0)) >>> 0;
  return { moodEnergy: MOODS[h % MOODS.length] };
}

/** Sidebar pin for a prompt wave (pinKey keys it by the prompt, see pins.js). */
export const promptPin = (text) => ({ type: "wave", title: promptTitle(text), prompt: normalizePrompt(text) });
