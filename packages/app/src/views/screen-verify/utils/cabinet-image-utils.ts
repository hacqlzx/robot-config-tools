export function buildCabinetImageCacheKey(record: CabinetImagePackageRecord): string {
  const source = record.imageSource;
  if (!source) {
    return `inline:${record.recordKey || [
      record.robotCode || "default",
      record.stationCode || record.stationName || "default",
      record.areaCode || record.areaName || "default",
      record.bayCode || record.bayName || "default",
      record.mainDeviceCode || "default",
      record.componentCode || "default",
      record.calibrationId || record.imageName || "default",
    ].join("::")}`;
  }
  return source.id;
}
