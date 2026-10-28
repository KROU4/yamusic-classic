export function duration(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${s}` : `${m}:${s}`;
}

export const seconds = (sec) => duration((sec || 0) * 1000);

export const artistNames = (track) => (track?.artists || []).map((a) => a.name).join(", ");

export function plural(n, one, few, many) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return `${n} ${one}`;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return `${n} ${few}`;
  return `${n} ${many}`;
}

export function totalDuration(tracks) {
  const ms = tracks.reduce((s, t) => s + (t.durationMs || 0), 0);
  const min = Math.round(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} ч ${min % 60} мин` : `${min} мин`;
}

export const ALBUM_TYPES = { single: "Сингл", compilation: "Сборник", podcast: "Подкаст", audiobook: "Аудиокнига" };
