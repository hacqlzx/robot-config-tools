export interface MenuItem {
  key: string;
  label: string;
  icon?: string;
}

export const menuConfig: MenuItem[] = [
  { key: '/space-edit', label: '空间编辑' },
  { key: '/image-edit', label: '图像编辑' },
  { key: '/screen-verify', label: '屏柜验证图' },
  { key: '/device-verify', label: '设备验证图' },
  { key: '/config', label: '配置' },
  { key: '/connection-test', label: '连接测试' },
  { key: '/db-test', label: 'DB测试' },
];