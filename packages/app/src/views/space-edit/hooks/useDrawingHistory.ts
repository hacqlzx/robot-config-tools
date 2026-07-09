import { useCallback, useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";
import type { CabinetDrawing, CabinetDrawingSnapshot } from "./drawing/CabinetDrawing";
import type { ChargingAreaDrawing, ChargingAreaDrawingSnapshot } from "./drawing/ChargingAreaDrawing";
import type { DeviceAreaDrawing, DeviceAreaDrawingSnapshot } from "./drawing/DeviceAreaDrawing";
import type { PathDrawing, PathDrawingSnapshot } from "./drawing/PathDrawing";

export type DrawingHistoryScope = "cabinet" | "charging" | "device-area" | "path";

type DrawingSnapshot =
  | CabinetDrawingSnapshot
  | ChargingAreaDrawingSnapshot
  | DeviceAreaDrawingSnapshot
  | PathDrawingSnapshot;

interface DrawingHistoryEntry {
  scope: DrawingHistoryScope;
  label: string;
  before: DrawingSnapshot;
  after: DrawingSnapshot;
}

interface UseDrawingHistoryParams {
  cabinetDrawingRef: MutableRefObject<CabinetDrawing | null>;
  chargingDrawingRef: MutableRefObject<ChargingAreaDrawing | null>;
  deviceAreaDrawingRef: MutableRefObject<DeviceAreaDrawing | null>;
  pathDrawingRef: MutableRefObject<PathDrawing | null>;
}

const MAX_HISTORY = 100;

function snapshotEquals(a: DrawingSnapshot, b: DrawingSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function shouldSkipShortcutTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName?.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

export function useDrawingHistory({
  cabinetDrawingRef,
  chargingDrawingRef,
  deviceAreaDrawingRef,
  pathDrawingRef,
}: UseDrawingHistoryParams) {
  const entriesRef = useRef<DrawingHistoryEntry[]>([]);
  const indexRef = useRef(0);
  const restoringRef = useRef(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const restoreSnapshot = useCallback((scope: DrawingHistoryScope, snapshot: DrawingSnapshot) => {
    switch (scope) {
      case "cabinet":
        cabinetDrawingRef.current?.restoreSnapshot(snapshot as CabinetDrawingSnapshot);
        break;
      case "charging":
        chargingDrawingRef.current?.restoreSnapshot(snapshot as ChargingAreaDrawingSnapshot);
        break;
      case "device-area":
        deviceAreaDrawingRef.current?.restoreSnapshot(snapshot as DeviceAreaDrawingSnapshot);
        break;
      case "path":
        pathDrawingRef.current?.restoreSnapshot(snapshot as PathDrawingSnapshot);
        break;
    }
  }, [cabinetDrawingRef, chargingDrawingRef, deviceAreaDrawingRef, pathDrawingRef]);

  const record = useCallback((
    scope: DrawingHistoryScope,
    before: DrawingSnapshot,
    after: DrawingSnapshot,
    label = "绘制操作",
  ) => {
    if (restoringRef.current || snapshotEquals(before, after)) return;
    const next = entriesRef.current.slice(0, indexRef.current);
    next.push({ scope, before, after, label });
    if (next.length > MAX_HISTORY) next.shift();
    entriesRef.current = next;
    indexRef.current = next.length;
    refresh();
  }, [refresh]);

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    const entry = entriesRef.current[indexRef.current - 1];
    restoringRef.current = true;
    try {
      restoreSnapshot(entry.scope, entry.before);
      indexRef.current -= 1;
    } finally {
      restoringRef.current = false;
      refresh();
    }
  }, [restoreSnapshot]);

  const redo = useCallback(() => {
    if (indexRef.current >= entriesRef.current.length) return;
    const entry = entriesRef.current[indexRef.current];
    restoringRef.current = true;
    try {
      restoreSnapshot(entry.scope, entry.after);
      indexRef.current += 1;
    } finally {
      restoringRef.current = false;
      refresh();
    }
  }, [restoreSnapshot]);

  const clear = useCallback(() => {
    entriesRef.current = [];
    indexRef.current = 0;
    refresh();
  }, [refresh]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (shouldSkipShortcutTarget(e.target)) return;
      const key = e.key.toLowerCase();
      const isMod = e.ctrlKey || e.metaKey;
      if (!isMod) return;
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (key === "y") {
        e.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [redo, undo]);

  return {
    record,
    undo,
    redo,
    clear,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < entriesRef.current.length,
    version,
  };
}
