/**
 * 文件协议编解码使用的无状态小工具。
 * 外部 JSON 的字段不可信，因此入口统一接收 unknown，再在这里完成收窄和容错。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function valueText(value: unknown): string {
  return value == null ? "" : String(value);
}

export function positiveInt(value: unknown): number | null {
  // id 允许外部系统用数字或纯数字字符串表达，但不接受小数、负数和混合文本。
  if (typeof value !== "number" && !/^\d+$/.test(String(value ?? "").trim())) return null;
  const parsed = typeof value === "number" ? value : Number.parseInt(String(value).trim(), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export function asFiniteNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function formatTime(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCoord(value: number): string {
  if (!Number.isFinite(value)) return "0";
  // 固定精度后去掉无意义尾零，并消除浮点运算可能产生的 "-0"，保证协议文本稳定、便于 diff。
  const fixed = value.toFixed(6).replace(/\.?0+$/, "");
  return fixed === "-0" ? "0" : fixed;
}
