import { useEffect, useState, type RefObject } from "react";

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
