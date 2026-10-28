import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { cachedGet, dropCache, peekCache } from "./api.js";

/** Загрузка данных страницы: сразу отдаёт закэшированное, затем обновляет. */
export function useLoad(path, ttlMs) {
  const [state, setState] = useState(() => {
    const cached = path ? peekCache(path) : null;
    return cached ? { data: cached, loading: false, error: null } : { data: null, loading: !!path, error: null };
  });
  // номер последнего запроса: применяется только ответ на самый свежий (смена страницы, повторный reload)
  const seq = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(
    () => () => {
      seq.current++; // компонент размонтирован — все ответы в полёте устарели
    },
    [],
  );
  useEffect(() => {
    if (!path) return;
    const my = ++seq.current;
    const cached = peekCache(path);
    setState({ data: cached || null, loading: !cached, error: null });
    cachedGet(path, ttlMs)
      .then((data) => my === seq.current && setState({ data, loading: false, error: null }))
      .catch((error) => my === seq.current && setState((s) => ({ data: s.data, loading: false, error })));
  }, [path]);
  /** Перечитать тот же путь мимо кэша, не сбрасывая текущие данные (без спиннера и потери прокрутки). */
  const reload = useCallback(() => {
    const p = pathRef.current;
    if (!p) return Promise.resolve();
    const my = ++seq.current;
    dropCache(p);
    return cachedGet(p, ttlMs)
      .then((data) => my === seq.current && setState({ data, loading: false, error: null }))
      .catch((error) => my === seq.current && setState((s) => ({ data: s.data, loading: false, error })));
  }, [ttlMs]);
  return { ...state, reload };
}
