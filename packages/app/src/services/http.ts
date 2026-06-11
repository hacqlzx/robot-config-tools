import axios from "axios";
import { getCurrentIp } from "../stores/backendStore";

const instance = axios.create({ timeout: 10000 });

instance.interceptors.request.use((config) => {
  config.headers["req-id"] = Date.now().toString() + Math.random().toString(36).slice(2, 8);

  const ip = getCurrentIp();
  if (ip) {
    config.baseURL = `https://${ip}`;
  }
  return config;
});

export default instance;
