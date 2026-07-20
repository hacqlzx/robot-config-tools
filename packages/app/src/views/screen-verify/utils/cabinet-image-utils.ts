export function buildCabinetImageCacheKey(record: CabinetImagePackageRecord): string {
  const source = record.imageSource;
  if (!source) return `inline:${record.componentCode}`;
  return source.id;
}
