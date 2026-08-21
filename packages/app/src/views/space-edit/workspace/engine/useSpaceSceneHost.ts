import { useEffect, useRef, useState } from "react";
import type {
  SpaceSceneAdapter,
  SpaceSceneAdapterFactory,
  SpaceSceneLifecycleState,
} from "./types";

interface UseSpaceSceneHostResult {
  hostRef: React.RefObject<HTMLDivElement>;
  state: SpaceSceneLifecycleState;
  error: Error | null;
}

export function useSpaceSceneHost(
  adapterFactory: SpaceSceneAdapterFactory | null,
  active = true,
): UseSpaceSceneHostResult {
  const hostRef = useRef<HTMLDivElement>(null);
  const adapterRef = useRef<SpaceSceneAdapter | null>(null);
  const [state, setState] = useState<SpaceSceneLifecycleState>("detached");
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    adapterRef.current?.setActive(active);
  }, [active]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !adapterFactory) {
      setState("detached");
      setError(null);
      return;
    }

    let disposed = false;
    const adapter = adapterFactory();
    adapterRef.current = adapter;
    adapter.setActive(active);
    setState("mounting");
    setError(null);

    const resizeObserver = new ResizeObserver(() => adapter.resize());
    resizeObserver.observe(host);

    void Promise.resolve(adapter.mount(host))
      .then(() => {
        if (!disposed) {
          adapter.setActive(active);
          adapter.resize();
          setState("ready");
        }
      })
      .catch((reason: unknown) => {
        if (disposed) return;
        setError(reason instanceof Error ? reason : new Error(String(reason)));
        setState("failed");
      });

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      adapterRef.current = null;
      void Promise.resolve(adapter.dispose()).catch((reason: unknown) => {
        console.error("[space-scene] adapter dispose failed", reason);
      });
    };
  }, [adapterFactory]);

  return { hostRef, state, error };
}
