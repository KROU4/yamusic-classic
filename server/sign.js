// Подписи запросов, восстановленные из бандла официального клиента 5.124.1
// (модуль createSign: HMAC-SHA256, base64). Ключи — публичные константы плеера
// по платформам (config.player.secretKey), а не пользовательские секреты.
import crypto from "node:crypto";

export const PLAYER_KEYS = {
  web: "7tvSmFbyf5hJnIHhCimDDD",
  win32: "kzqU4XhfCaY6B6JTHODeq5",
  darwin: "uz0zSpaYCLmgk6C7YLdo5F",
  linux: "uVNvVMAvdrvjtwN0VlhEt2",
};

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest("base64");

export const nowSeconds = () => Math.floor(Date.now() / 1000);

/** get-file-info: data = ts + trackId(s) + quality + codecs.join("") + transports.join(""); последний символ base64 отрезается. */
export function fileInfoSign({ ts, trackId, quality, codecs, transports, key = PLAYER_KEYS.win32 }) {
  return hmac(key, `${ts}${trackId}${quality}${codecs.join("")}${transports.join("")}`).slice(0, -1);
}

/** tracks/{id}/lyrics: data = trackId + ts, base64 целиком. */
export function lyricsSign({ trackId, ts, key = PLAYER_KEYS.win32 }) {
  return hmac(key, `${trackId}${ts}`);
}
