var version = "2.25.1";

/**
 * sw.ts - Service Worker（服务工作线程）
 *
 * 本模块是 SuperSplat 的 PWA Service Worker，实现离线缓存功能。
 *
 * 核心功能：
 * 1. 在 install 阶段预缓存所有静态资源（HTML/CSS/JS/图片/WebAssembly/国际化文件等）
 * 2. 在 activate 阶段清理旧版本的缓存，确保用户始终使用最新资源
 * 3. 在 fetch 阶段拦截网络请求，优先从缓存返回（Cache-First 策略）
 *
 * Service Worker 生命周期：
 *   install → 等待 → activate → 空闲/终止
 *
 * Cache-First 策略说明：
 * - 请求到达时，先查缓存，命中则直接返回（速度快、可离线）
 * - 缓存未命中时才走网络请求
 * - 这种方式适合静态资源（文件名带 hash/版本号，不会过时）
 *
 * 版本管理：
 * - 缓存名称包含 appVersion（来自 package.json），版本号变化时自动创建新缓存
 * - 旧缓存会在 activate 阶段被删除
 */
/**
 * 缓存存储名称
 * 通过 appVersion 做版本区分，当 package.json 中的 version 变更时，
 * 会自动创建新的缓存（如 superSplat-v1.0.2），旧的会在 activate 中被清理
 */
const cacheName = `superSplat-v${version}`;
/**
 * 需要预缓存的静态资源列表
 *
 * 为什么预缓存这些文件：
 * - Service Worker 只有在 install 事件后才能拦截请求
 * - 如果不在 install 时预缓存，用户第一次访问时这些文件仍需要网络
 * - 预缓存后，即使完全离线也能加载应用
 *
 * 包含的资源类型：
 * - ./ 根路径（index.html）
 * - CSS/JS 及 source map（便于调试）
 * - manifest.json（PWA 配置文件）
 * - 图标（192px 和 512px，用于桌面/任务栏图标）
 * - 截图（用于 PWA 安装提示）
 * - WebAssembly 文件（lodepng 用于 PNG 编解码，webp 用于 WebP 编解码）

 */
const cacheUrls = [
    './',
    './index.css',
    './index.html',
    './index.js',
    './index.js.map',
    './manifest.json',
    './static/icons/logo-192.png',
    './static/icons/logo-512.png',
    './static/images/screenshot-narrow.jpg',
    './static/images/screenshot-wide.jpg',
    './static/lib/lodepng/lodepng.js',
    './static/lib/lodepng/lodepng.wasm',
    './static/lib/webp/webp.mjs',
    './static/lib/webp/webp.wasm',
    './static/lib/laz-perf/laz-perf.js',
    './static/lib/laz-perf/laz-perf.wasm'
];
/**
 * install 事件 - Service Worker 安装阶段
 *
 * 这是 Service Worker 生命周期的第一步。
 * 在此阶段，我们打开（或创建）当前版本的缓存，并将所有静态资源添加到缓存中。
 *
 * event.waitUntil() 的作用：
 * - 告诉浏览器"在 promise 完成之前不要认为安装已完成"
 * - 如果缓存失败，整个 install 会失败，Service Worker 不会激活
 * - 这确保要么所有资源都缓存成功，要么全部失败（原子性保证）
 */
self.addEventListener('install', (event) => {
    console.log(`installing v${version}`);
    event.waitUntil(caches.open(cacheName)
        .then((cache) => {
        // 一次性添加所有资源到缓存（部分失败不会影响已成功的缓存）
        cache.addAll(cacheUrls);
    }));
});
/**
 * activate 事件 - Service Worker 激活阶段
 *
 * 当新的 Service Worker 开始控制页面时触发（旧 Service Worker 不再控制任何页面）。
 *
 * 清理策略：
 * - 遍历所有缓存名称，删除不属于当前版本的缓存
 * - 这确保用户不会因为旧缓存而加载过时的资源文件
 * - 清理操作是异步的，不会阻塞页面的正常使用
 */
self.addEventListener('activate', () => {
    console.log(`activating v${version}`);
    caches.keys().then((names) => {
        for (const name of names) {
            // 只保留当前版本的缓存，删除所有旧版本
            if (name !== cacheName) {
                caches.delete(name);
            }
        }
    });
});
/**
 * fetch 事件 - 拦截所有页面发出的网络请求
 *
 * Cache-First（缓存优先）策略的实现：
 * 1. 用 caches.match() 在缓存中查找匹配的响应
 * 2. 找到则直接返回缓存的响应（即时可用，支持离线）
 * 3. 未找到则使用 fetch() 发网络请求，返回网络响应
 *
 * 使用 ?? 空值合并运算符：
 * - caches.match() 返回 undefined 时（缓存未命中），才执行 fetch()
 * - 等同于: response ? response : fetch(event.request)
 *
 * event.respondWith() 告诉浏览器使用我们提供的 Response 对象
 * 来响应请求，类似于一个代理拦截器。
 */
self.addEventListener('fetch', (event) => {
    event.respondWith(caches.match(event.request)
        .then(response => response ?? fetch(event.request)));
});
//# sourceMappingURL=sw.js.map
