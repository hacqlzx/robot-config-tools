import axios, { AxiosResponse } from "axios";
import {
  getBackendIp,
  getConnectionStatus,
  setConnectionStatus,
} from "../stores/appContextStore";

const instance = axios.create({ timeout: 300000 });

/**
 * 后台请求统一异常。
 * 页面层只需要展示 message，不再暴露 axios 的长错误栈或底层网络细节。
 */
class BackendRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendRequestError";
  }
}

/**
 * 将 axios 错误压缩成面向用户的短提示。
 */
function getBackendHttpErrorMessage(error: any): string {
  const backendMessage = error?.response?.data?.message;
  if (typeof backendMessage === "string" && backendMessage.trim()) {
    return backendMessage;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "网络异常";
  }

  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
    return "请求超时";
  }

  if (error?.code === "ERR_NETWORK" || !error?.response) {
    return "后台连接失败";
  }

  const status = error.response.status;
  if (status === 401 || status === 403) return "访问受限";
  if (status === 404) return "接口不存在";
  if (status >= 500) return "后台异常";
  return `请求失败（${status}）`;
}

/** 供页面在保留业务兜底文案的同时展示统一的请求错误。 */
export function getRequestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/**
 * 请求拦截：统一注入 baseURL 和请求头。
 *
 * baseURL 每次请求都从 appContextStore 读取，保证切换后台 IP 后立即生效；
 * data 为 FormData 时不强制设置 Content-Type，让浏览器自动生成 boundary。
 */
instance.interceptors.request.use((config) => {
  config.headers["req-id"] = Date.now().toString() + Math.random().toString(36).slice(2, 8);
  if (!(config.data instanceof FormData)) {
    config.headers["Content-Type"] = "application/json";
  }

  const ip = getBackendIp();
  if (!ip) throw new BackendRequestError("请先连接后台");

  const connectionStatus = getConnectionStatus();
  if (connectionStatus === "failed") {
    throw new BackendRequestError("后台未连接");
  }
  if (connectionStatus !== "connected") {
    throw new BackendRequestError("后台未连接");
  }

  config.baseURL = `https://${ip}`;
  return config;
});

/**
 * 响应拦截：统一错误处理。
 * 网络不可达、超时等连接错误会同步标记后台连接失败。
 */
instance.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err instanceof BackendRequestError) return Promise.reject(err);

    const isConnectionFailure = err?.code === "ERR_NETWORK"
      || err?.code === "ECONNABORTED"
      || err?.code === "ETIMEDOUT"
      || !err?.response;
    if (isConnectionFailure && err?.code !== "ERR_CANCELED") {
      setConnectionStatus("failed");
    }

    return Promise.reject(new BackendRequestError(getBackendHttpErrorMessage(err)));
  },
);

const http = {
  /** 原始 axios 实例，用于需要完整响应的场景 */
  instance,

  /** GET 请求，params 会拼接到查询字符串。 */
  get: <T = any>(url: string, params?: Record<string, any>) =>
    instance.get<any, AxiosResponse<T>>(url, { params }),

  /** POST 请求，data 可以是 JSON 对象或 FormData。 */
  post: <T = any>(url: string, data?: any) =>
    instance.post<any, AxiosResponse<T>>(url, data),

  /** PUT 请求，主要用于后台配置更新。 */
  put: <T = any>(url: string, data?: any) =>
    instance.put<any, AxiosResponse<T>>(url, data),

  /** DELETE 请求。 */
  del: <T = any>(url: string) =>
    instance.delete<any, AxiosResponse<T>>(url),

  /** 完整 axios 配置入口，供上传下载等特殊请求使用。 */
  request: <T = any>(config: any) =>
    instance.request<any, AxiosResponse<T>>(config),
};

export default http;
