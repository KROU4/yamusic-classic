// «Закрепить в боковом меню» button for album, artist and playlist pages.
import { Icon } from "./Icon.jsx";
import { isPinned, togglePin } from "../lib/pins.js";
import { toast } from "../lib/toast.js";

export function PinButton({ pin }) {
  const on = isPinned(pin);
  return (
    <button
      class={`btn ghost ${on ? "is-on" : ""}`}
      onClick={() => toast(togglePin(pin) ? "Закреплено в боковом меню" : "Откреплено")}
      aria-pressed={on}
      title={on ? "Открепить из бокового меню" : "Закрепить в боковом меню"}
    >
      <Icon name="pin" size={18} /> {on ? "Закреплено" : "Закрепить"}
    </button>
  );
}
