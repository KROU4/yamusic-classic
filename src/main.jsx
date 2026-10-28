import { render } from "preact";
import "./lib/api.js"; // первым: забирает ключ запуска из адреса
import "./lib/theme.js";
import "./lib/desktop.js";
import "./styles/app.css";
import { App } from "./app.jsx";
import * as player from "./player/engine.js";

// Горячие клавиши плеера (не срабатывают при вводе текста)
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
  }
});

render(<App />, document.getElementById("app"));
