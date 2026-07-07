interface ToggleableEntity {
  enabled?: boolean;
}

export function getCurrentModelPathFromRefs(
  entities: Map<string, ToggleableEntity>,
  filePaths: Map<string, string>,
): string {
  for (const [name, ent] of entities) {
    const path = filePaths.get(name);
    if (ent.enabled && path) return path;
  }
  return filePaths.values().next().value || "";
}
