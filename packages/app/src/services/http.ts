import axios, { AxiosResponse } from "axios";
import {
  getBackendIp,
  getConnectionStatus,
  setConnectionStatus,
} from "../stores/appContextStore";

const instance = axios.create({ timeout: 300000 });

class BackendRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackendRequestError";
  }
}

function getBackendHttpErrorMessage(error: any): string {
  const backendMessage = error?.response?.data?.message;
  if (typeof backendMessage === "string" && backendMessage.trim()) {
    return backendMessage;
  }

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return "当前设备无网络连接，请检查网络设置";
  }

  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
    return "后台请求超时，请检查网络或后台服务状态";
  }

  if (error?.code === "ERR_NETWORK" || !error?.response) {
    return "无法连接后台，请检查网络、后台地址或服务状态";
  }

  const status = error.response.status;
  if (status === 401 || status === 403) return "后台拒绝访问，请检查访问权限";
  if (status === 404) return "后台接口不存在或当前后台版本不支持此功能";
  if (status >= 500) return "后台服务异常，请稍后重试";
  return `后台请求失败（HTTP ${status}）`;
}

/** 供页面在保留业务兜底文案的同时展示统一的请求错误。 */
export function getRequestErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

// 请求拦截：统一注入 baseURL 和请求头
instance.interceptors.request.use((config) => {
  config.headers["req-id"] = Date.now().toString() + Math.random().toString(36).slice(2, 8);
  if (!(config.data instanceof FormData)) {
    config.headers["Content-Type"] = "application/json";
  }

  const ip = getBackendIp();
  if (!ip) throw new BackendRequestError("请先在设置中连接后台");

  const connectionStatus = getConnectionStatus();
  if (connectionStatus === "failed") {
    throw new BackendRequestError("后台未连接，请检查网络或在设置中重新连接");
  }
  if (connectionStatus !== "connected") {
    throw new BackendRequestError("后台连接尚未建立，请稍后重试或在设置中连接后台");
  }

  config.baseURL = `https://${ip}`;
  return config;
});

// 响应拦截：统一错误处理
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

  get: <T = any>(url: string, params?: Record<string, any>) =>
    instance.get<any, AxiosResponse<T>>(url, { params }),

  post: <T = any>(url: string, data?: any) =>
    instance.post<any, AxiosResponse<T>>(url, data),

  put: <T = any>(url: string, data?: any) =>
    instance.put<any, AxiosResponse<T>>(url, data),

  del: <T = any>(url: string) =>
    instance.delete<any, AxiosResponse<T>>(url),

  request: <T = any>(config: any) =>
    instance.request<any, AxiosResponse<T>>(config),
};

export default http;
