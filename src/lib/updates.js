// App updates (desktop only): the shell checks GitHub Releases and reports its state here.
import { signal } from "@preact/signals";

const bridge = window.ymcDesktop || null;
export const canUpdate = !!bridge?.onUpdate;

/** { status: idle|checking|downloading|ready|available|latest|error|dev, version, current, portable, percent, url } */
export const update = signal(null);

if (canUpdate) {
  bridge.onUpdate((st) => (update.value = st));
  bridge
    .updateState()
    .then((st) => st && (update.value = st))
    .catch(() => {});
}

export const checkUpdate = () => bridge?.checkUpdate();
export const installUpdate = () => bridge?.installUpdate();

/** Something the user can act on: a downloaded installer or (portable) a newer release to download. */
export const updateReady = () => update.value?.status === "ready" || update.value?.status === "available";

export function updateLabel(st) {
  if (!st) return "";
  switch (st.status) {
    case "checking":
      return "Проверяем обновления…";
    case "downloading":
      return `Скачиваем версию ${st.version || ""}${st.percent ? ` · ${st.percent}%` : ""}`;
    case "ready":
      return `Версия ${st.version} скачана — установится при перезапуске`;
    case "available":
      return `Доступна версия ${st.version}`;
    case "latest":
      return `У вас последняя версия ${st.current}`;
    case "error":
      return "Не удалось проверить обновления";
    case "dev":
      return "Сборка для разработки — обновления не проверяются";
    default:
      return `Версия ${st.current || ""}`;
  }
}
