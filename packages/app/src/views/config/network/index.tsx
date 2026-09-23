import { useState, useRef, useEffect } from "react";
import { Alert, message } from "antd";
import { getNetworkList } from "@/api/config.js";
import { NetworkCard } from "./NetworkCard";
import { getRequestErrorMessage } from "@/services/http";
import { getConnectionStatus, subscribeBackendContext } from "@/stores/appContextStore";

export interface NetworkRecord {
  id: number;
  robotId: number | null;
  type: string | number;
  name: string;
  ip: string;
  subnetMask: string;
  gateway: string;
}

interface ApiResponse<T> {
  code: number;
  message: string | null;
  data: T;
  timestamp: string;
  success: boolean;
}

export default function NetworkConfig() {
  const [networkList, setNetworkList] = useState<NetworkRecord[]>([]);
  const fetchedRef = useRef(false);

  const fetchNetworks = async () => {
    try {
      const res = await getNetworkList();
      const body = res.data as ApiResponse<NetworkRecord[]>;
      if (body.success) {
        const networks = Array.isArray(body.data) ? body.data : [];
        setNetworkList(networks);
      } else {
        message.error(body.message || "获取网络列表失败");
      }
    } catch (err) {
      console.error("获取网络列表失败:", err);
      message.error(getRequestErrorMessage(err, "获取网络列表失败"));
    }
  };

  useEffect(() => {
    if (!fetchedRef.current && getConnectionStatus() === "connected") {
      fetchedRef.current = true;
      fetchNetworks();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IP 切换时重新加载
  useEffect(() => {
    return subscribeBackendContext(() => {
      if (getConnectionStatus() === "connected") fetchNetworks();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <Alert
        message="此操作为修改后台服务器IP/机器人本体IP"
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
      />
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {networkList.map((network) => (
          <NetworkCard key={network.id} record={network} />
        ))}
      </div>
    </div>
  );
}
