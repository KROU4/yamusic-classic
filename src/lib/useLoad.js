import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { cachedGet, dropCache, peekCache } from "./api.js";

/** Page data loading: serves the cached copy right away, then refreshes. */
export function useLoad(path, ttlMs) {
  const [state, setState] = useState(() => {
    const cached = path ? peekCache(path) : null;
    return cached ? { data: cached, loading: false, error: null } : { data: null, loading: !!path, error: null };
  });
  // number of the latest request: only the response to the newest one is applied (page change, repeated reload)
  const seq = useRef(0);
  const pathRef = useRef(path);
  pathRef.current = path;
  useEffect(
    () => () => {
      seq.current++; // component unmounted — all in-flight responses are stale
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
  /** Re-read the same path bypassing the cache, keeping current data (no spinner, no loss of scroll). */
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
