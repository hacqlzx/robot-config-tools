export default function PlatformConfig() {
  const titleStyle: React.CSSProperties = {
    margin: 0,
    padding: "0 0 12px 0",
    fontSize: 16,
    borderLeft: "3px solid #1677ff",
    paddingLeft: 10,
    lineHeight: "24px",
  };

  return (
    <div>
      <h3 style={titleStyle}>后台</h3>
      <div style={{ height: 16 }} />
      <h3 style={titleStyle}>分析服务</h3>
      <div style={{ height: 16 }} />
      <h3 style={titleStyle}>上级主机</h3>
    </div>
  );
}
