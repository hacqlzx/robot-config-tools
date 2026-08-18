import { useCallback, useRef, useState } from "react";
import type {
  SpaceDrawingHistoryScope,
  SpaceDrawingHistorySnapshot,
  SpaceSceneAdapter,
} from "../engine/types";

interface SpaceDrawingHistoryEntry {
  scope: SpaceDrawingHistoryScope;
  before: SpaceDrawingHistorySnapshot;
  after: SpaceDrawingHistorySnapshot;
  label: string;
}

interface UseSpaceDrawingHistoryParams {
  adapter: SpaceSceneAdapter;
  onRestore?: (scope: SpaceDrawingHistoryScope) => void;
}

const MAX_HISTORY = 100;

function snapshotEquals(left: SpaceDrawingHistorySnapshot, right: SpaceDrawingHistorySnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useSpaceDrawingHistory({ adapter, onRestore }: UseSpaceDrawingHistoryParams) {
  const entriesRef = useRef<SpaceDrawingHistoryEntry[]>([]);
  const indexRef = useRef(0);
  const restoringRef = useRef(false);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  const record = useCallback((
    scope: SpaceDrawingHistoryScope,
    before: SpaceDrawingHistorySnapshot,
    after: SpaceDrawingHistorySnapshot,
    label = "绘制操作",
  ) => {
    if (restoringRef.current || snapshotEquals(before, after)) return false;
    const next = entriesRef.current.slice(0, indexRef.current);
    next.push({ scope, before, after, label });
    if (next.length > MAX_HISTORY) next.shift();
    entriesRef.current = next;
    indexRef.current = next.length;
    refresh();
    return true;
  }, [refresh]);

  const restore = useCallback((entry: SpaceDrawingHistoryEntry, snapshot: SpaceDrawingHistorySnapshot) => {
    restoringRef.current = true;
    try {
      adapter.restoreDrawingHistorySnapshot(entry.scope, snapshot);
      onRestore?.(entry.scope);
    } finally {
      restoringRef.current = false;
      refresh();
    }
  }, [adapter, onRestore, refresh]);

  const undo = useCallback(() => {
    if (indexRef.current <= 0) return;
    const entry = entriesRef.current[indexRef.current - 1];
    indexRef.current -= 1;
    restore(entry, entry.before);
  }, [restore]);

  const redo = useCallback(() => {
    if (indexRef.current >= entriesRef.current.length) return;
    const entry = entriesRef.current[indexRef.current];
    indexRef.current += 1;
    restore(entry, entry.after);
  }, [restore]);

  const clear = useCallback(() => {
    entriesRef.current = [];
    indexRef.current = 0;
    refresh();
  }, [refresh]);

  const clearScope = useCallback((scope: SpaceDrawingHistoryScope) => {
    let removedBeforeIndex = 0;
    entriesRef.current = entriesRef.current.filter((entry, index) => {
      if (entry.scope !== scope) return true;
      if (index < indexRef.current) removedBeforeIndex += 1;
      return false;
    });
    indexRef.current = Math.max(0, indexRef.current - removedBeforeIndex);
    refresh();
  }, [refresh]);

  return {
    record,
    undo,
    redo,
    clear,
    clearScope,
    canUndo: indexRef.current > 0,
    canRedo: indexRef.current < entriesRef.current.length,
    version,
  };
}
