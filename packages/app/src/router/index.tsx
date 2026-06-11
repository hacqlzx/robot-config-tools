import { createBrowserRouter, Navigate } from 'react-router-dom';
import AppLayout from '../App';
import SpaceEdit from '../pages/space-edit';
import ImageEdit from '../pages/image-edit';
import ScreenVerify from '../pages/screen-verify';
import DeviceVerify from '../pages/device-verify';
import Config from '../pages/config';
import ConnectionTest from '../pages/connection-test';

const router = createBrowserRouter([
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/space-edit" replace /> },
      { path: 'space-edit', element: <SpaceEdit /> },
      { path: 'image-edit', element: <ImageEdit /> },
      { path: 'screen-verify', element: <ScreenVerify /> },
      { path: 'device-verify', element: <DeviceVerify /> },
      { path: 'config', element: <Config /> },
      { path: 'connection-test', element: <ConnectionTest /> },
    ],
  },
]);

export default router;
