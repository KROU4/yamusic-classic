import { useEffect, useState } from "preact/hooks";
import { route } from "./lib/router.js";
import { api } from "./lib/api.js";
import { toasts } from "./lib/toast.js";
import { Header } from "./components/Header.jsx";
import { PlayerBar } from "./components/PlayerBar.jsx";
import { SidePanel } from "./components/SidePanels.jsx";
import { Home } from "./pages/Home.jsx";
import { AlbumPage, ArtistPage, PlaylistPage } from "./pages/Entities.jsx";
import { SearchPage, CollectionPage, ChartPage, NewPage, RadioPage } from "./pages/Lists.jsx";
import { SettingsPage } from "./pages/Settings.jsx";
import { Loading } from "./components/States.jsx";
import * as player from "./player/engine.js";

function Page({ me, reconnect }) {
  const { name, params } = route.value;
  switch (name) {
    case "search":
      return <SearchPage q={params.q} />;
    case "album":
      return <AlbumPage id={params.id} key={params.id} />;
    case "artist":
      return <ArtistPage id={params.id} key={params.id} />;
    case "playlist":
      return <PlaylistPage uid={params.uid} kind={params.kind} key={`${params.uid}-${params.kind}`} />;
    case "collection":
      return <CollectionPage tab={params.tab || "likes"} />;
    case "chart":
      return <ChartPage />;
    case "new":
      return <NewPage />;
    case "radio":
      return <RadioPage />;
    case "settings":
      return <SettingsPage me={me} onReconnect={reconnect} />;
    default:
      return <Home />;
  }
}

function NoSession({ onRetry }) {
  return (
    <div class="nosession">
      <div class="logo-mark big">▶</div>
      <h1>Нужна сессия Яндекс Музыки</h1>
      <p>
        Клиент использует вход из официального приложения Яндекс Музыки на этом компьютере. Откройте его, войдите в аккаунт (один раз) и нажмите «Повторить».
      </p>
      <button class="btn primary" onClick={onRetry}>
        Повторить
      </button>
    </div>
  );
}

export function App() {
  const [me, setMe] = useState(null);
  const load = () => api.get("/me").then(setMe).catch(() => setMe({ authorized: false }));
  const reconnect = () => api.post("/reconnect").then(setMe).catch(() => setMe({ authorized: false }));

  useEffect(() => {
    load();
    player.restoreQueue();
  }, []);

  if (!me) return <Loading />;
  if (!me.authorized || player.authError.value)
    return (
      <NoSession
        onRetry={() => {
          player.authError.value = false;
          reconnect();
        }}
      />
    );
  return (
    <div class="layout">
      <Header me={me} />
      <div class="body">
        <main class="main" id="main">
          <Page me={me} reconnect={reconnect} />
        </main>
        <SidePanel />
      </div>
      <PlayerBar />
      <div class="toasts" aria-live="polite">
        {toasts.value.map((t) => (
          <div key={t.id} class="toast">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
