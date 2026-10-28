import { render } from "preact";
import "./lib/api.js"; // first: grabs the launch key from the address
import "./lib/theme.js";
import { isDesktop, stepZoom } from "./lib/desktop.js";
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
window.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (e.code === "ArrowLeft") history.back();
  if (e.code === "ArrowRight") history.forward();
});
window.addEventListener("mouseup", (e) => {
  if (e.button === 3) history.back();
  if (e.button === 4) history.forward();
});

// Player hotkeys (don't fire while typing)
window.addEventListener("keydown", (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
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
    case "Slash":
      if (e.shiftKey) shortcutsOpen.value = !shortcutsOpen.value;
      break;
  }
});

render(<App />, document.getElementById("app"));
