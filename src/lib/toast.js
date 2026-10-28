import { signal } from "@preact/signals";

export const toasts = signal([]);
let seq = 0;

export function toast(text, ms = 3500) {
  const id = ++seq;
  toasts.value = [...toasts.value.slice(-2), { id, text }];
  setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }, ms);
}
