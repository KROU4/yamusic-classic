import { signal } from "@preact/signals";

/** Current account (uid is needed to tell own playlists from others'). */
export const me = signal(null);
