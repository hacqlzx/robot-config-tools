const CURRENT_IP_KEY = "backend_current_ip";

export type ConnectionStatus = "disconnected" | "connected" | "failed";

let _status: ConnectionStatus = "disconnected";
const listeners = new Set<() => void>();

export function getConnectionStatus(): ConnectionStatus {
  return _status;
}

export function setConnectionStatus(s: ConnectionStatus) {
  _status = s;
  listeners.forEach((fn) => fn());
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getCurrentIp(): string {
  return localStorage.getItem(CURRENT_IP_KEY) || "";
}

export function setCurrentIp(ip: string) {
  localStorage.setItem(CURRENT_IP_KEY, ip);
}
