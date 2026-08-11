import { getAllRobot } from "@/api/config.js";
import { getRobotRecords, setRobotRecords, type RobotRecordCacheItem } from "@/stores/appContextStore";

interface RobotListResponse {
  success: boolean;
  message?: string | null;
  data?: RobotRecordCacheItem[];
}

const ROBOT_REFRESH_DEDUP_MS = 2000;
let refreshPromise: Promise<RobotRecordCacheItem[]> | null = null;
let lastRefreshAt = 0;

/**
 * 统一刷新后台机器人列表。
 *
 * 触发点控制在：应用启动连接成功、后台切换/重新连接成功、机器人配置新增/编辑/删除/手动刷新。
 * 导入导出等业务页面只读取缓存，避免每次操作都实时查询机器人接口。
 */
export async function refreshRobotRecords(options?: { force?: boolean }): Promise<RobotRecordCacheItem[]> {
  if (refreshPromise) return refreshPromise;

  const cached = getRobotRecords();
  const recentlyRefreshed = Date.now() - lastRefreshAt < ROBOT_REFRESH_DEDUP_MS;
  if (!options?.force && recentlyRefreshed && cached.length > 0) {
    return cached;
  }

  refreshPromise = getAllRobot()
    .then((res) => {
      const body = res.data as RobotListResponse;
      if (!body.success) {
        throw new Error(body.message || "获取机器人列表失败");
      }
      const robots = Array.isArray(body.data) ? body.data : [];
      setRobotRecords(robots);
      lastRefreshAt = Date.now();
      return robots;
    })
    .finally(() => {
      refreshPromise = null;
    });

  return refreshPromise;
}
