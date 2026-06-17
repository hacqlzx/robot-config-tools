path = r"D:\dev\code\robotConfigTools\packages\app\src\views\app-header\index.tsx"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# 1. Add import for axios/http
content = content.replace(
    'import BackendModal from "@/views/backend-modal";',
    'import BackendModal from "@/views/backend-modal";\nimport http from "@/services/http";'
)

# 2. Add station state + localStorage key
content = content.replace(
    'const SELECTED_PROJECT_KEY = "selectedProject";',
    'const SELECTED_PROJECT_KEY = "selectedProject";\nconst SELECTED_STATION_KEY = "selectedStation";'
)

# 3. Add station state and fetch logic
old_piece = '''  const [connStatus, setConnStatus] = useState<ConnectionStatus>(getConnectionStatus);
  const [messageApi, contextHolder] = message.useMessage();'''
new_piece = '''  const [connStatus, setConnStatus] = useState<ConnectionStatus>(getConnectionStatus);
  const [messageApi, contextHolder] = message.useMessage();
  const [stationList, setStationList] = useState<{ id: number; stationName: string; stationCode: string; voltName: string; stationTypeDesc: string }[]>([]);
  const [selectedStationId, setSelectedStationId] = useState<number | null>(() => {
    try { return Number(localStorage.getItem(SELECTED_STATION_KEY)) || null; } catch { return null; }
  });
  const [stationLoading, setStationLoading] = useState(false);'''
content = content.replace(old_piece, new_piece)

# 4. Add fetch stations function + sync localStorage
old_piece2 = '''  useEffect(() => {
    return subscribe(() => setConnStatus(getConnectionStatus()));
  }, []);'''
new_piece2 = '''  useEffect(() => {
    return subscribe(() => setConnStatus(getConnectionStatus()));
  }, []);

  // 同步 selectedStationId 到 localStorage
  useEffect(() => {
    try {
      if (selectedStationId) localStorage.setItem(SELECTED_STATION_KEY, String(selectedStationId));
      else localStorage.removeItem(SELECTED_STATION_KEY);
    } catch { /* ignore */ }
  }, [selectedStationId]);

  // 获取厂站列表（连接成功后自动拉取）
  const fetchStations = useCallback(async () => {
    if (connStatus !== "connected") return;
    setStationLoading(true);
    try {
      const res = await http.get("/robot/tool/facInfo/get");
      if (res.data?.success && Array.isArray(res.data.data)) {
        setStationList(res.data.data);
      }
    } catch { /* ignore */ }
    setStationLoading(false);
  }, [connStatus]);

  useEffect(() => { fetchStations(); }, [fetchStations]);'''
content = content.replace(old_piece2, new_piece2)

# 5. Replace the empty station Select
content = content.replace(
    '<Select placeholder="选择厂站" style={{ width: 120 }} size="small" options={[]} />',
    '<Select placeholder="选择厂站" style={{ width: 160 }} size="small" loading={stationLoading} value={selectedStationId} onChange={(v) => setSelectedStationId(v)} allowClear options={stationList.map((s) => ({ label: s.stationName, value: s.id }))} />'
)

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
print("app-header updated: station selector wired")