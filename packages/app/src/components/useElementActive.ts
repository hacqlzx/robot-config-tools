import { useEffect, useState, type RefObject } from "react";

function getDocumentActive(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

/** 当前窗口或浏览器页签是否处于可见且聚焦状态。 */
export function useDocumentActive(): boolean {
  const [active, setActive] = useState(getDocumentActive);

  useEffect(() => {
    const update = (): void => setActive(getDocumentActive());
    update();
    window.addEventListener("focus", update);
    window.addEventListener("blur", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.removeEventListener("focus", update);
      window.removeEventListener("blur", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return active;
}

export function useElementActive(ref: RefObject<HTMLElement | null>): boolean {
  const [active, setActive] = useState(true);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      setActive(false);
      return;
    }

    const update = (): void => {
      setActive(element.clientWidth > 0 && element.clientHeight > 0);
    };

    update();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => {
        window.removeEventListener("resize", update);
      };
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [ref]);

  return active;
}
