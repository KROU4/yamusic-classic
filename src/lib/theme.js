import { signal } from "@preact/signals";

const read = () => {
  try {
    return localStorage.getItem("ymc-theme") || "dark";
  } catch {
    return "dark";
  }
};

export const theme = signal(read());
const media = window.matchMedia("(prefers-color-scheme: light)");

function apply() {
  const t = theme.value === "system" ? (media.matches ? "light" : "dark") : theme.value;
  document.documentElement.dataset.theme = t;
}

export function setTheme(t) {
  theme.value = t;
  try {
    localStorage.setItem("ymc-theme", t);
  } catch {
    // без сохранения
  }
  apply();
}

media.addEventListener("change", apply);
apply();
