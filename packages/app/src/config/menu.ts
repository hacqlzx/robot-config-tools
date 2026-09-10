export interface MenuItem {
  key: string;
  label: string;
  icon?: string;
}

export const menuConfig: MenuItem[] = [
  { key: '/space-edit', label: '空间编辑' },
  // { key: '/realtime-monitor', label: '实时监控' },
  { key: '/image-edit', label: '勘察图片标注' },
  { key: '/screen-verify', label: '屏柜图像标注' },
  { key: '/device-verify', label: '设备验证图' },
  { key: '/import-export', label: '导入导出' },
  { key: '/config', label: '运维' }
];
