export function buildCabinetImageCacheKey(record: CabinetImagePackageRecord): string {
  const source = record.imageSource;
  if (!source) return `inline:${record.recordKey || `${record.robotCode || "default"}::${record.componentCode}`}`;
  return source.id;
}
