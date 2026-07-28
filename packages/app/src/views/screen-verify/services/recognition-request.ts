const FALLBACK_TIMEOUT_MS = 120_000;

export type RecognitionRequestErrorCode = "cancelled" | "timeout" | "network";

export interface RecognitionRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export class RecognitionRequestError extends Error {
  constructor(
    readonly code: RecognitionRequestErrorCode,
    message: string,
    readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "RecognitionRequestError";
  }
}

export const DEFAULT_RECOGNITION_TIMEOUT_MS = resolveDefaultTimeoutMs();

export async function requestRecognitionText(
  input: RequestInfo | URL,
  init: RequestInit,
  options: RecognitionRequestOptions = {},
): Promise<{ response: Response; text: string }> {
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs ?? DEFAULT_RECOGNITION_TIMEOUT_MS);
  const controller = new AbortController();
  const externalSignal = options.signal;
  let timedOut = false;

  if (externalSignal?.aborted) throw createCancelledError();

  const handleExternalAbort = () => controller.abort();
  externalSignal?.addEventListener("abort", handleExternalAbort, { once: true });
  const timer = globalThis.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } catch (error) {
    if (externalSignal?.aborted) throw createCancelledError(error);
    if (timedOut) {
      throw new RecognitionRequestError(
        "timeout",
        `识别请求超时（${formatTimeoutSeconds(timeoutMs)} 秒）`,
        error,
      );
    }
    throw new RecognitionRequestError("network", "识别服务连接失败", error);
  } finally {
    globalThis.clearTimeout(timer);
    externalSignal?.removeEventListener("abort", handleExternalAbort);
  }
}

export function throwIfRecognitionCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw createCancelledError();
}

export function isRecognitionRequestCancelled(error: unknown): boolean {
  return error instanceof RecognitionRequestError && error.code === "cancelled";
}

function createCancelledError(originalError?: unknown): RecognitionRequestError {
  return new RecognitionRequestError("cancelled", "识别已取消", originalError);
}

function resolveDefaultTimeoutMs(): number {
  return normalizeTimeoutMs(Number(import.meta.env.VITE_RECOGNITION_TIMEOUT_MS));
}

function normalizeTimeoutMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return FALLBACK_TIMEOUT_MS;
  return Math.max(1_000, Math.trunc(value));
}

function formatTimeoutSeconds(timeoutMs: number): string {
  return Number((timeoutMs / 1_000).toFixed(1)).toString();
}
