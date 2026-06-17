/** Convert camelCase to snake_case */
export function toSnake(camel: string): string {
  return camel.replace(/[A-Z]/g, (m) => "_" + m.toLowerCase());
}