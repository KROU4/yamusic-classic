// Converts API responses into compact objects for the UI.

export function coverUrl(uri, size = 200) {
  if (!uri) return null;
  const clean = uri.replace("%%", `${size}x${size}`);
  return clean.startsWith("http") ? clean : `https://${clean}`;
}

const artistLite = (a) => ({ id: a.id, name: a.name, cover: coverUrl(a.cover?.uri, 200) });

export function normTrack(t) {
  if (!t || !t.id) return null;
  const album = t.albums?.[0];
  return {
    id: String(t.id),
    albumId: album ? String(album.id) : null,
    title: t.title,
    version: t.version || null,
    artists: (t.artists || []).map(artistLite),
    album: album ? { id: album.id, title: album.title, year: album.year || null } : null,
    cover: coverUrl(t.coverUri || album?.coverUri, 200),
    durationMs: t.durationMs || 0,
    explicit: t.contentWarning === "explicit",
    clean: t.contentWarning === "clean",
    available: t.available !== false,
    lyrics: {
      sync: !!t.lyricsInfo?.hasAvailableSyncLyrics,
      text: !!t.lyricsInfo?.hasAvailableTextLyrics,
    },
    // Yandex swaps the track for a "clean" or regional version and puts the original here
    substituted: t.substituted ? normTrack(t.substituted) : null,
    color: t.derivedColors?.accent || null,
    // integrated loudness (LUFS), used to even out volume between tracks
    loudness: typeof t.r128?.i === "number" ? t.r128.i : null,
  };
}

export function normAlbum(a) {
  if (!a) return null;
  return {
    id: a.id,
    title: a.title,
    version: a.version || null,
    year: a.year || null,
    type: a.type || "album",
    genre: a.genre || null,
    cover: coverUrl(a.coverUri, 300),
    trackCount: a.trackCount || 0,
    artists: (a.artists || []).map(artistLite),
    explicit: a.contentWarning === "explicit",
  };
}

export function normArtist(a) {
  if (!a) return null;
  return {
    id: a.id,
    name: a.name,
    cover: coverUrl(a.cover?.uri || a.ogImage, 300),
    genres: a.genres || [],
    tracks: a.counts?.tracks || 0,
  };
}

export function normPlaylist(p) {
  if (!p) return null;
  const cover = p.cover?.uri || p.cover?.itemsUri?.[0] || p.ogImage || null;
  return {
    uid: p.owner?.uid ?? p.uid,
    kind: p.kind,
    title: p.title,
    description: p.description || "",
    owner: p.owner?.name || p.owner?.login || "",
    trackCount: p.trackCount || 0,
    cover: coverUrl(cover, 300),
    durationMs: p.durationMs || 0,
    generatedType: p.generatedPlaylistType || null,
  };
}

export function normStation(s) {
  if (!s) return null;
  return {
    id: `${s.id.type}:${s.id.tag}`,
    type: s.id.type,
    tag: s.id.tag,
    name: s.name,
    color: s.icon?.backgroundColor || "#333",
    icon: coverUrl(s.icon?.imageUrl, 100),
    parent: s.parentId ? `${s.parentId.type}:${s.parentId.tag}` : null,
  };
}
