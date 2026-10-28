import { signal } from "@preact/signals";

/** Текущий аккаунт (uid нужен, чтобы отличать свои плейлисты от чужих). */
export const me = signal(null);
