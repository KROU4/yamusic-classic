import { useEffect, useState } from "preact/hooks";
import { cachedGet, peekCache } from "./api.js";

/** Загрузка данных страницы: сразу отдаёт закэшированное, затем обновляет. */
export function useLoad(path, ttlMs) {
  const [state, setState] = useState(() => {
    const cached = path ? peekCache(path) : null;
    return cached ? { data: cached, loading: false, error: null } : { data: null, loading: !!path, error: null };
  });
  useEffect(() => {
    if (!path) return;
    let alive = true;
    const cached = peekCache(path);
    setState({ data: cached || null, loading: !cached, error: null });
    cachedGet(path, ttlMs)
      .then((data) => alive && setState({ data, loading: false, error: null }))
      .catch((error) => alive && setState((s) => ({ data: s.data, loading: false, error })));
    return () => {
      alive = false;
    };
  }, [path]);
  return state;
}
