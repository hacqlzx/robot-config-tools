import axios, { AxiosResponse } from "axios";
import { getCurrentIp } from "../stores/backendStore";

const instance = axios.create({ timeout: 10000 });

// 请求拦截：统一注入 baseURL 和请求头
instance.interceptors.request.use((config) => {
  config.headers["req-id"] = Date.now().toString() + Math.random().toString(36).slice(2, 8);
  config.headers["Content-Type"] = "application/json";

  const ip = getCurrentIp();
  if (ip) {
    config.baseURL = `https://${ip}`;
  } else {
    console.warn("[http] IP not configured, request may fail:", config.url);
  }
  return config;
});

// 响应拦截：统一错误处理
instance.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err?.response?.data?.message || err.message || "请求失败";
    return Promise.reject(new Error(msg));
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
