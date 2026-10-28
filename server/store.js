// Простое JSON-хранилище в папке данных пользователя с отложенной записью.
import fs from "node:fs";
import path from "node:path";

export class JsonStore {
  constructor(file, defaults = {}) {
    this.file = file;
    this.data = structuredClone(defaults);
    try {
      Object.assign(this.data, JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      // первый запуск или повреждённый файл — начинаем с умолчаний
    }
    this.timer = null;
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.scheduleSave();
  }

  scheduleSave() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.saveNow(), 500);
    this.timer.unref?.();
  }

  saveNow() {
    clearTimeout(this.timer);
    const json = JSON.stringify(this.data);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, json);
      fs.renameSync(tmp, this.file);
    } catch {
      // на Windows rename иногда падает с EPERM (антивирус держит файл) — пишем напрямую
      try {
        fs.writeFileSync(this.file, json);
      } catch {
        // не удалось сохранить — попробуем при следующем изменении, бэкенд не падает
      }
    }
  }
}

/** История прослушиваний: трек -> время, «песня» -> время, плюс лента последних треков. */
export class PlayHistory {
  constructor(store, { maxEntries = 20000, tapeSize = 50 } = {}) {
    this.store = store;
    this.maxEntries = maxEntries;
    this.tapeSize = tapeSize;
    const raw = store.get("history") || {};
    this.tracks = new Map(Object.entries(raw.tracks || {}));
    this.songs = new Map(Object.entries(raw.songs || {}));
    this.tape = raw.tape || [];
  }

  record(track, songKey, now = Date.now()) {
    this.tracks.set(track.id, now);
    this.songs.set(songKey, now);
    this.tape = [...this.tape.filter((t) => t.id !== track.id), { id: track.id, artists: track.artists.map((a) => ({ id: a.id, name: a.name })), title: track.title, version: track.version }].slice(-this.tapeSize);
    this.trim(this.tracks);
    this.trim(this.songs);
    this.persist();
  }

  trim(map) {
    if (map.size <= this.maxEntries) return;
    const sorted = [...map.entries()].sort((a, b) => a[1] - b[1]);
    for (const [k] of sorted.slice(0, map.size - this.maxEntries)) map.delete(k);
  }

  clear() {
    this.tracks.clear();
    this.songs.clear();
    this.tape = [];
    this.persist();
  }

  persist() {
    this.store.set("history", {
      tracks: Object.fromEntries(this.tracks),
      songs: Object.fromEntries(this.songs),
      tape: this.tape,
    });
  }
}
