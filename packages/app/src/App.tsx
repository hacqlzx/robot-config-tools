import { Layout } from "antd";
import { Outlet } from "react-router-dom";
import AppHeader from "./components/app-header";
import "./styles/title-bar.scss";

const { Content } = Layout;

export default function AppLayout() {
  return (
    <Layout style={{ height: "100vh", overflow: "hidden" }}>
      <AppHeader />
      <Content style={{ height: "calc(100vh - 48px)", padding: 0, background: "#f5f5f5", overflow: "hidden" }}>
        <div style={{ height: "100%", padding: 24, boxSizing: "border-box" }}>
          <Outlet />
        </div>
      </Content>
    </Layout>
  );
}
