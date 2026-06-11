const CURRENT_IP_KEY = "backend_current_ip";

export function getCurrentIp(): string {
  return localStorage.getItem(CURRENT_IP_KEY) || "";
}

export function setCurrentIp(ip: string) {
  localStorage.setItem(CURRENT_IP_KEY, ip);
}
