/**
 * 资源加载器 - 负责加载高斯泼溅（Gaussian Splat）资源文件
 *
 * 核心功能：
 * 1. 使用 @playcanvas/splat-transform 库解析 PLY/SPLAT/SOG 等格式
 * 2. 将解析后的高斯数据包装为 PlayCanvas GSplatResource 资源
 * 3. 创建 Splat 元素对象，包含资源和变换信息
 * 4. 管理加载过程中的 UI 状态（旋转器动画）
 *
 * 支持的格式（通过 splat-transform 间接支持）：
 * - .ply（标准点云格式）
 * - .splat（优化的二进制格式）
 * - .sog（Splat-Optimized Gaussian）
 * - .ksplat（KIRI 引擎格式）
 * - .spz（Niantic 压缩格式）
 */
import { ReadFileSystem } from '@playcanvas/splat-transform';
import { AppBase, Asset, GSplatResource } from 'playcanvas';

import { Events } from './events';
import { loadGSplatData, validateGSplatData } from './io';
import { Splat } from './splat';

/**
 * 资源加载器类
 *
 * 封装了从文件系统加载高斯泼溅数据的完整流程：
 * 1. 显示加载指示器
 * 2. 调用 loadGSplatData 解析文件
 * 3. 验证数据完整性
 * 4. 创建 PlayCanvas 资源并注册到资源系统
 * 5. 创建 Splat 场景元素
 * 6. 隐藏加载指示器
 *
 * @property app - PlayCanvas 应用实例，用于资源管理
 * @property events - 事件系统，用于触发 UI 状态更新
 */
// handles loading gsplat assets using splat-transform
class AssetLoader {
    app: AppBase;
    events: Events;

    constructor(app: AppBase, events: Events) {
        this.app = app;
        this.events = events;
    }

    /**
     * 加载高斯泼溅资源
     *
     * 处理流程：
     * 1. 非动画帧加载时显示加载旋转器
     * 2. 调用 loadGSplatData 解析文件（支持多种格式）
     * 3. 验证高斯数据完整性
     * 4. 创建 PlayCanvas Asset 并设置 GSplatResource
     * 5. 将资源包装为 Splat 场景元素返回
     * 6. 无论成功与否，最终都会隐藏加载旋转器
     *
     * @param filename - 文件名（用于确定解析格式）
     * @param fileSystem - 文件系统接口（支持本地文件、远程 URL 等）
     * @param animationFrame - 是否为动画帧加载（true 时不显示旋转器，且跳过重排序）
     * @param skipReorder - 是否跳过高斯点的 Morton 排序（已预排序的数据可跳过以提升性能）
     * @returns 包含高斯泼溅资源和变换的 Splat 对象
     */
    async load(filename: string, fileSystem: ReadFileSystem, animationFrame?: boolean, skipReorder?: boolean) {
        // 非动画帧时显示加载指示器
        if (!animationFrame) {
            this.events.fire('startSpinner');
        }

        try {
            /**
             * 加载 GISplat 数据
             * skipReorder 条件：动画帧（需要速度）或明确要求跳过（已排序的数据）
             * loadGSplatData 会根据文件扩展名自动选择正确的解析器
             */
            // Skip reordering for animation frames (speed) or when explicitly requested (already ordered)
            const { gsplatData, transform } = await loadGSplatData(filename, fileSystem, skipReorder || animationFrame);

            // 验证加载的高斯数据是否有效（检查必需字段、数据大小等）
            validateGSplatData(gsplatData);

            // 创建 PlayCanvas 资源。
            // 'gsplat' 类型是 PlayCanvas 中用于高斯泼溅的特殊资源类型。
            // url 使用时间戳确保唯一性（避免与现有资源冲突）。
            const asset = new Asset(filename, 'gsplat', { url: `local-asset-${Date.now()}`, filename });

            // 将资源注册到 PlayCanvas 的资源管理系统
            this.app.assets.add(asset);

            // 创建 GSplatResource：这是 PlayCanvas 用于渲染高斯泼溅的 GPU 资源。
            // GSplatResource 会将 gsplatData 上传到 GPU 缓冲区以供着色器使用。
            asset.resource = new GSplatResource(this.app.graphicsDevice, gsplatData);

            // 创建 Splat 场景元素，包含资源引用和初始旋转（从 PLY 变换中提取）
            return new Splat(asset, transform.rotation);
        } finally {
            // 无论成功或失败，确保隐藏加载指示器
            if (!animationFrame) {
                this.events.fire('stopSpinner');
            }
        }
    }
}

export { AssetLoader };
