import axios, { type AxiosRequestConfig, type AxiosResponse } from "axios";
import { BrowserWindow, session } from "electron";
import https from "node:https";
import type { Readable } from "node:stream";

export type BackendRequestLogLevel = "info" | "warn";

export interface BackendRequestLog {
  level: BackendRequestLogLevel;
  label: string;
  requestId: string;
  url: string;
  attempt: number;
  status?: number;
  elapsedMs?: number;
  message?: string;
}

const BACKEND_REQUEST_LOG_CHANNEL = "backend-request:log";
const MAX_BACKEND_REQUEST_ATTEMPTS = 3;
const RETRYABLE_BACKEND_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const BACKEND_HTTPS_AGENT = new https.Agent({ rejectUnauthorized: false, keepAlive: true });

export async function requestBackendResource(
  url: string,
  options: Pick<AxiosRequestConfig, "signal" | "headers" | "responseType"> = {},
  label: string,
): Promise<AxiosResponse> {
  let lastError: unknown;
  const signal = options.signal;

  for (let attempt = 0; attempt < MAX_BACKEND_REQUEST_ATTEMPTS; attempt += 1) {
    const requestId = Date.now().toString() + Math.random().toString(36).slice(2, 8);
    const startedAt = Date.now();
    emitRequestLog({
      level: "info",
      label,
      requestId,
      url: redactRequestUrl(url),
      attempt: attempt + 1,
      message: "开始请求",
    });
    const cookieHeader = await getSessionCookieHeader(url);
    const headers = {
      "req-id": requestId,
      "Accept": "*/*",
      ...(options.headers as Record<string, string> | undefined),
      ...(cookieHeader ? { Cookie: cookieHeader } : {}),
    };

    try {
      const response = await axios.request({
        url,
        method: "GET",
        timeout: 6_000_000,
        signal,
        responseType: options.responseType || "json",
        headers,
        httpsAgent: BACKEND_HTTPS_AGENT,
        validateStatus: () => true,
      });

      emitRequestLog({
        level: "info",
        label,
        requestId,
        url: redactRequestUrl(url),
        attempt: attempt + 1,
        status: response.status,
        elapsedMs: Date.now() - startedAt,
      });

      if (RETRYABLE_BACKEND_STATUSES.has(response.status) && attempt < MAX_BACKEND_REQUEST_ATTEMPTS - 1) {
        emitRequestLog({
          level: "warn",
          label,
          requestId,
          url: redactRequestUrl(url),
          attempt: attempt + 1,
          status: response.status,
          message: "服务暂不可用，准备重试",
        });
        discardResponseBody(response.data);
        await delay(300 * (attempt + 1));
        if (signal?.aborted) throw new Error("请求已取消");
        continue;
      }
      return response;
    } catch (error: any) {
      lastError = error;
      const aborted = Boolean(signal?.aborted);
      emitRequestLog({
        level: "warn",
        label,
        requestId,
        url: redactRequestUrl(url),
        attempt: attempt + 1,
        elapsedMs: Date.now() - startedAt,
        message: error instanceof Error ? error.message : String(error),
      });
      if (aborted || attempt >= MAX_BACKEND_REQUEST_ATTEMPTS - 1) throw error;
      await delay(300 * (attempt + 1));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("后台请求失败");
}

async function getSessionCookieHeader(url: string): Promise<string> {
  try {
    const cookies = await session.defaultSession.cookies.get({ url });
    return cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  } catch (error) {
    console.warn("[后台请求][Axios] 读取后台会话 Cookie 失败", error);
    return "";
  }
}

export async function buildBackendResponseError(response: AxiosResponse, fallback: string): Promise<string> {
  const detail = await readBackendErrorMessage(response.data);
  return detail || `${fallback}（${response.status}）`;
}

function emitRequestLog(log: BackendRequestLog): void {
  const logger = log.level === "warn" ? console.warn : console.log;
  logger("[后台请求][Axios]", log);
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(BACKEND_REQUEST_LOG_CHANNEL, log);
    } catch (error) {
      console.warn("[后台请求][Axios] 转发请求日志失败", error);
    }
  }
}

function discardResponseBody(data: unknown): void {
  const destroy = (data as { destroy?: () => void } | null)?.destroy;
  if (typeof destroy === "function") destroy.call(data);
}

async function readBackendErrorMessage(data: unknown): Promise<string> {
  if (data && typeof (data as Readable).on === "function") {
    return readStreamErrorMessage(data as Readable);
  }

  const text = typeof data === "string"
    ? data
    : Buffer.isBuffer(data)
      ? data.toString("utf8")
      : "";
  if (text) {
    try {
      const body = JSON.parse(text);
      const message = body?.message || body?.msg || body?.error;
      if (typeof message === "string" && message.trim()) return message.trim();
    } catch {
      return text.length > 120 ? text.slice(0, 120) : text;
    }
  }

  const message = (data as any)?.message || (data as any)?.msg || (data as any)?.error;
  return typeof message === "string" ? message.trim() : "";
}

function readStreamErrorMessage(stream: Readable): Promise<string> {
  return new Promise((resolve) => {
    const maxLength = 120;
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;

    const finish = (destroy: boolean) => {
      if (settled) return;
      settled = true;
      stream.removeListener("data", onData);
      stream.removeListener("end", onEnd);
      stream.removeListener("error", onEnd);
      if (destroy) stream.destroy();
      const text = Buffer.concat(chunks).toString("utf8");
      void readBackendErrorMessage(text).then(resolve);
    };
    const onData = (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = maxLength - length;
      if (remaining > 0) {
        const part = buffer.subarray(0, remaining);
        chunks.push(part);
        length += part.length;
      }
      if (length >= maxLength) finish(true);
    };
    const onEnd = () => finish(false);

    stream.on("data", onData);
    stream.once("end", onEnd);
    stream.once("error", onEnd);
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function redactRequestUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return "<invalid-url>";
  }
}
