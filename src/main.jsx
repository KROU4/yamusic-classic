import { render } from "preact";
import "./lib/api.js"; // first: grabs the launch key from the address
import "./lib/theme.js";
import { isDesktop, stepZoom, mini } from "./lib/desktop.js";
import "./styles/app.css";
import { App } from "./app.jsx";
import { shortcutsOpen } from "./lib/ui.js";
import * as player from "./player/engine.js";

// Zoom: Ctrl+plus/minus/0 (in the app; in the browser the browser handles it itself)
window.addEventListener("keydown", (e) => {
  if (!isDesktop || !e.ctrlKey || e.altKey) return;
  if (e.key === "=" || e.key === "+") stepZoom(1);
  else if (e.key === "-") stepZoom(-1);
  else if (e.key === "0") stepZoom(0);
  else return;
  e.preventDefault();
});

// Back/forward: Alt+arrows and the mouse side buttons, like in a browser
// (only in the app: a browser already does this itself, and handling it twice would jump two steps)
window.addEventListener("keydown", (e) => {
  if (!isDesktop || !e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.code === "ArrowLeft") history.back();
  if (e.code === "ArrowRight") history.forward();
});
window.addEventListener("mouseup", (e) => {
  if (!isDesktop) return;
  if (e.button === 3) history.back();
  if (e.button === 4) history.forward();
});

// Player hotkeys (don't fire while typing)
window.addEventListener("keydown", (e) => {
  const el = document.activeElement;
  // form controls keep their own keys (arrows in the EQ preset list, space on a select)
  if (["INPUT", "TEXTAREA", "SELECT"].includes(el?.tagName) || el?.isContentEditable || e.ctrlKey || e.metaKey || e.altKey) return;
  // "?" is Shift+7 in the Russian layout, so match the typed character as well as the physical key
  if (e.key === "?" || (e.code === "Slash" && e.shiftKey)) {
    if (mini.peek()) return; // the mini player has no room for the help
    shortcutsOpen.value = !shortcutsOpen.value;
    return;
  }
  const pos = player.position.value;
  switch (e.code) {
    case "Space":
      e.preventDefault();
      player.toggle();
      break;
    case "ArrowRight":
      e.preventDefault();
      e.shiftKey ? player.next() : player.seek(pos + 10);
      break;
    case "ArrowLeft":
      e.preventDefault();
      e.shiftKey ? player.prev() : player.seek(pos - 10);
      break;
    case "ArrowUp":
      e.preventDefault();
      player.setVolume(player.volume.value + 0.05);
      break;
    case "ArrowDown":
      e.preventDefault();
      player.setVolume(player.volume.value - 0.05);
      break;
    case "KeyL":
      if (player.current.value) player.like(player.current.value);
      break;
  }
});

render(<App />, document.getElementById("app"));
