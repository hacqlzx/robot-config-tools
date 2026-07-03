import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import router from './router';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);

// React 渲染后移除启动 splash
declare global { interface Window { __removeSplash?: () => void; } }
setTimeout(() => window.__removeSplash?.(), 0);
