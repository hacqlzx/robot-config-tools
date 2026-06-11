/**
 * scene.ts - 场景管理器
 *
 * 本文件是 SuperSplat 的核心模块，负责管理整个 3D 场景的生命周期。
 * 核心功能包括：
 * - 管理场景元素（Element）的添加、移除和生命周期
 * - 维护渲染层（世界层/高斯泼溅层/辅助线层）和排序逻辑
 * - 处理画布自适应缩放（通过 ResizeObserver 监听容器变化）
 * - 每帧进行场景状态比对（SceneState），判断是否需要重新渲染
 * - 协调所有子系统：相机、数据处理、资产加载、网格、轮廓线等
 *
 * Scene 类是 PlayCanvas Application 的外壳，它将 PlayCanvas 的底层渲染能力
 * 封装为更高层的场景元素抽象，使得每个场景元素只需关注自身逻辑。
 */

import {
    EVENT_POSTRENDER_LAYER,
    EVENT_PRERENDER_LAYER,
    LAYERID_DEPTH,
    SORTMODE_CUSTOM,
    BoundingBox,
    CameraComponent,
    Color,
    Entity,
    Layer,
    GraphicsDevice,
    MeshInstance,
    Vec3
} from 'playcanvas';

import { AssetLoader } from './asset-loader';
import { Camera } from './camera';
import { CameraPoseGizmos } from './camera-pose-gizmos';
import { DataProcessor } from './data-processor';
import { Element, ElementType, ElementTypeList } from './element';
import { Events } from './events';
import { InfiniteGrid as Grid } from './infinite-grid';
import { Outline } from './outline';
import { PCApp } from './pc-app';
import { SceneConfig } from './scene-config';
import { SceneState } from './scene-state';
import { Splat } from './splat';
import { SplatOverlay } from './splat-overlay';
import { Underlay } from './underlay';

// 临时向量，用于 AABB 角点计算（模块级复用以避免每帧分配新向量）
const corner = new Vec3();

/**
 * 自定义排序函数：根据网格实例的 AABB 离相机最远角点进行排序。
 *
 * 对于半透明渲染，需要从后向前渲染才能正确混合。PlayCanvas 在设置
 * SORTMODE_CUSTOM 后，会调用此函数对 MeshInstance 数组进行排序。
 *
 * @param instances - 待排序的网格实例数组
 * @param numInstances - 实例数量
 * @param cameraPos - 相机世界空间位置
 * @param cameraDir - 相机前向方向向量
 */
const specialSort = (instances: MeshInstance[], numInstances: number, cameraPos: Vec3, cameraDir: Vec3) => {
    // 缓存每个实例计算出的最大投影距离，避免在排序比较时重复计算
    const distances = new Map<MeshInstance, number>();

    for (let i = 0; i < numInstances; i++) {
        const instance = instances[i];
        const { aabb } = instance;
        const { center, halfExtents } = aabb;

        // 遍历 AABB 的 8 个角点，找到沿相机视线方向的最远距离
        let maxDist = -Infinity;
        for (let cx = -1; cx <= 1; cx += 2) {
            for (let cy = -1; cy <= 1; cy += 2) {
                for (let cz = -1; cz <= 1; cz += 2) {
                    corner.set(
                        center.x + cx * halfExtents.x,
                        center.y + cy * halfExtents.y,
                        center.z + cz * halfExtents.z
                    );
                    // 将相机到角点的向量投影到相机前向方向上
                    const dist = (corner.x - cameraPos.x) * cameraDir.x +
                                    (corner.y - cameraPos.y) * cameraDir.y +
                                    (corner.z - cameraPos.z) * cameraDir.z;
                    if (dist > maxDist) {
                        maxDist = dist;
                    }
                }
            }
        }

        distances.set(instance, maxDist);
    }

    // 从后往前排序：距离大的（离相机远的）排在前面先渲染
    instances.sort((a, b) => distances.get(b) - distances.get(a));
};

/**
 * Scene 类 - 整个应用的主场景容器。
 *
 * 负责：
 * 1. 封装 PlayCanvas Application 并管理其生命周期
 * 2. 维护场景元素列表及其添加/移除
 * 3. 通过 SceneState 进行帧间状态比对，实现按需渲染
 * 4. 管理三个核心渲染层：世界层(World)、泼溅层(Splat)、辅助线层(Gizmo)
 * 5. 协调画布大小监听与设备恢复等事件
 */
class Scene {
    events: Events;
    config: SceneConfig;
    canvas: HTMLCanvasElement;
    app: PCApp;
    worldLayer: Layer;
    splatLayer: Layer;
    gizmoLayer: Layer;
    // 双缓冲场景状态，用于帧间比对判断哪些元素发生了变化
    sceneState = [new SceneState(), new SceneState()];
    elements: Element[] = [];
    boundStorage = new BoundingBox();
    boundDirty = true;
    forceRender = false;

    // 锁定渲染模式：用于视频录制时手动控制每帧是否渲染
    lockedRenderMode = false;
    lockedRender = false;

    // 画布尺寸变更信息（由 ResizeObserver 回调设置）
    canvasResize: {width: number; height: number} | null = null;
    // 实际渲染目标尺寸（会根据 pixelScale 缩放）
    targetSize = {
        width: 0,
        height: 0
    };

    dataProcessor: DataProcessor;
    assetLoader: AssetLoader;
    camera: Camera;
    cameraPoseGizmos: CameraPoseGizmos;
    splatOverlay: SplatOverlay;
    grid: Grid;
    outline: Outline;
    underlay: Underlay;

    contentRoot: Entity;
    cameraRoot: Entity;

    /**
     * 创建场景实例。
     *
     * @param events - 全局事件系统，用于场景内部通信
     * @param config - 场景配置对象，由 URL 参数和默认配置合并而来
     * @param canvas - 渲染目标画布元素
     * @param graphicsDevice - PlayCanvas 图形设备（WebGL/WebGPU 抽象）
     */
    constructor(
        events: Events,
        config: SceneConfig,
        canvas: HTMLCanvasElement,
        graphicsDevice: GraphicsDevice
    ) {
        this.events = events;
        this.config = config;
        this.canvas = canvas;

        // 配置 PlayCanvas 应用。我们渲染到离屏缓冲区，因此只需要最简单的后备缓冲区
        this.app = new PCApp(canvas, { graphicsDevice });

        // 禁止自动渲染——由本模块通过 renderNextFrame 手动控制渲染时机
        this.app.autoRender = false;
        // @ts-ignore
        this.app._allowResize = false;
        // 禁用集群光照（3DGS 使用自己的光照模型）
        this.app.scene.clusteredLightingEnabled = false;

        // 临时方案：禁用光照贴图首次烘焙，直到我们公开此选项
        // @ts-ignore
        this.app.off('prerender', this.app._firstBake, this.app);

        // 设置纹理加载器的跨域模式为匿名，允许从其他域加载纹理
        // @ts-ignore
        this.app.loader.getHandler('texture').imgParser.crossOrigin = 'anonymous';

        // 使用设备像素比以获得全分辨率 AR 模式后备缓冲区
        this.app.graphicsDevice.maxPixelRatio = window.devicePixelRatio;

        // 使用 ResizeObserver 监听画布容器尺寸变化。
        // 这是现代浏览器推荐的响应式尺寸监听方式，比 window.resize 更精确。
        const observer = new ResizeObserver((entries: ResizeObserverEntry[]) => {
            if (entries.length > 0) {
                const entry = entries[0];
                if (entry) {
                    if (entry.devicePixelContentBoxSize) {
                        // 非 Safari 浏览器：直接给出像素级精确的画布尺寸
                        this.canvasResize = {
                            width: entry.devicePixelContentBoxSize[0].inlineSize,
                            height: entry.devicePixelContentBoxSize[0].blockSize
                        };
                    } else if (entry.contentBoxSize.length > 0) {
                        // Safari 浏览器：需要自己根据 CSS 尺寸计算像素尺寸
                        const pixelRatio = window.devicePixelRatio;
                        this.canvasResize = {
                            width: Math.ceil(entry.contentBoxSize[0].inlineSize * pixelRatio),
                            height: Math.ceil(entry.contentBoxSize[0].blockSize * pixelRatio)
                        };
                    }
                }
                this.forceRender = true;
            }
        });

        observer.observe(window.document.getElementById('canvas-container'));

        // 配置深度层处理动态折射。
        // 将深度层移动插入到不透明渲染队列的第 2 位，使其提前渲染。
        const depthLayer = this.app.scene.layers.getLayerById(LAYERID_DEPTH);
        this.app.scene.layers.remove(depthLayer);
        this.app.scene.layers.insertOpaque(depthLayer, 2);

        // 注册 PlayCanvas 应用回调
        this.app.on('update', (deltaTime: number) => this.onUpdate(deltaTime));
        this.app.on('prerender', () => this.onPreRender());
        this.app.on('postrender', () => this.onPostRender());

        // 设备恢复时强制渲染（如 GPU 驱动重置后）
        this.app.graphicsDevice.on('devicerestored', () => {
            this.forceRender = true;
        });

        // 将层渲染事件转发为相机组件上的自定义事件，
        // 使其他模块可以监听相机的 preRenderLayer / postRenderLayer。
        this.app.scene.on(EVENT_PRERENDER_LAYER, (camera: CameraComponent, layer: Layer, transparent: boolean) => {
            camera.fire('preRenderLayer', layer, transparent);
        });

        this.app.scene.on(EVENT_POSTRENDER_LAYER, (camera: CameraComponent, layer: Layer, transparent: boolean) => {
            camera.fire('postRenderLayer', layer, transparent);
        });

        // 获取 PlayCanvas 默认的世界渲染层
        this.worldLayer = this.app.scene.layers.getLayerByName('World');

        // 泼溅渲染层：专用于 3D Gaussian Splatting 的 MRT（多渲染目标）渲染。
        // 使用自定义排序来确保高斯泼溅按后到前顺序正确渲染。
        this.splatLayer = new Layer({
            name: 'Splat',
            opaqueSortMode: SORTMODE_CUSTOM,
            transparentSortMode: SORTMODE_CUSTOM
        });
        this.splatLayer.customCalculateSortValues = specialSort;

        // 辅助线层：用于渲染 Gizmo 和辅助元素
        this.gizmoLayer = new Layer({ name: 'Gizmo' });

        const layers = this.app.scene.layers;
        layers.push(this.splatLayer);
        layers.push(this.gizmoLayer);

        // 创建数据处理和资产加载子系统
        this.dataProcessor = new DataProcessor(this.app.graphicsDevice);
        this.assetLoader = new AssetLoader(this.app, events);

        // 创建根实体——所有场景内容挂在 contentRoot 下，所有相机挂在 cameraRoot 下
        this.contentRoot = new Entity('contentRoot');
        this.app.root.addChild(this.contentRoot);

        this.cameraRoot = new Entity('cameraRoot');
        this.app.root.addChild(this.cameraRoot);

        // 创建场景元素实例——每个都是 Element 的子类，统一管理
        this.camera = new Camera();
        this.add(this.camera);

        this.cameraPoseGizmos = new CameraPoseGizmos();
        this.add(this.cameraPoseGizmos);

        this.splatOverlay = new SplatOverlay();
        this.add(this.splatOverlay);

        this.grid = new Grid();
        this.add(this.grid);

        this.outline = new Outline();
        this.add(this.outline);
        this.underlay = new Underlay();
        this.add(this.underlay);
    }

    /** 启动 PlayCanvas 应用的主循环 */
    start() {
        this.app.start();
    }

    /** 清除场景中所有泼溅（Splat）元素 */
    clear() {
        const splats = this.getElementsByType(ElementType.splat);
        splats.forEach((splat) => {
            this.remove(splat);
            (splat as Splat).destroy();
        });
    }

    /**
     * 向场景中添加一个元素。
     *
     * 该方法会：
     * 1. 将元素的 scene 引用指向当前场景
     * 2. 调用元素的 add() 方法执行初始化
     * 3. 通知所有其他元素有新的元素加入
     * 4. 触发 'scene.elementAdded' 事件
     *
     * @param element - 要添加的场景元素
     */
    async add(element: Element) {
        if (!element.scene) {
            element.scene = this;
            await element.add();
            this.elements.push(element);

            // 通知现有元素：新元素已添加
            this.forEachElement(e => e !== element && e.onAdded(element));

            // 通知全局事件监听者
            this.events.fire('scene.elementAdded', element);
        }
    }

    /**
     * 从场景中移除一个元素。
     *
     * 执行顺序与添加相反：
     * 1. 从列表中移除
     * 2. 触发事件通知外部
     * 3. 通知其他元素
     * 4. 调用元素的 remove() 进行清理
     *
     * @param element - 要移除的场景元素
     */
    remove(element: Element) {
        if (element.scene === this) {
            this.elements.splice(this.elements.indexOf(element), 1);

            this.events.fire('scene.elementRemoved', element);

            this.forEachElement(e => e.onRemoved(element));

            element.remove();
            element.scene = null;
        }
    }

    /**
     * 获取场景的包围盒（懒计算 + 脏标记模式）。
     *
     * 遍历所有场景元素，合并各自的世界空间包围盒。
     * 使用 boundDirty 标记避免每帧重复计算——只有元素发生变化时才重算。
     * 计算完成后触发 'scene.boundChanged' 事件通知依赖方。
     *
     * @returns 场景的包围盒（BoundingBox）
     */
    get bound() {
        if (this.boundDirty) {
            let valid = false;
            this.forEachElement((e) => {
                const bound = e.worldBound;
                if (bound) {
                    if (!valid) {
                        // 第一个有效包围盒：直接复制
                        valid = true;
                        this.boundStorage.copy(bound);
                    } else {
                        // 后续包围盒：扩展合并
                        this.boundStorage.add(bound);
                    }
                }
            });

            this.boundDirty = false;
            this.events.fire('scene.boundChanged', this.boundStorage);
        }

        return this.boundStorage;
    }

    /**
     * 根据元素类型获取元素列表。
     *
     * @param elementType - 元素类型枚举值（如 ElementType.splat）
     * @returns 匹配类型的元素数组
     */
    getElementsByType(elementType: ElementType) {
        return this.elements.filter(e => e.type === elementType);
    }

    /** 获取 PlayCanvas 图形设备 */
    get graphicsDevice() {
        return this.app.graphicsDevice;
    }

    /** 遍历所有场景元素执行指定操作 */
    private forEachElement(action: (e: Element) => void) {
        this.elements.forEach(action);
    }

    /**
     * 每帧更新回调（由 PlayCanvas 的 update 事件触发）。
     *
     * 这是场景的主更新循环，执行顺序：
     * 1. 让所有元素更新
     * 2. 触发全局 'update' 事件
     * 3. 序列化当前帧的状态并与上一帧比对
     * 4. 根据比对结果决定是否需要渲染
     * 5. 触发按类型的 'updated:*' 事件
     * 6. 让所有元素执行后更新
     *
     * @param deltaTime - 自上一帧以来的时间增量（秒）
     */
    private onUpdate(deltaTime: number) {
        this.forEachElement(e => e.onUpdate(deltaTime));

        this.events.fire('update', deltaTime);

        // 双缓冲状态比对机制：
        // 使用当前帧号 % 2 来交替使用两个 SceneState，比对前后两帧差异。
        // 这样可以高效检测哪些类型的元素发生了变化（新增/移除/移动/状态改变）。
        const i = this.app.frame % 2;
        const state = this.sceneState[i];
        state.reset();
        this.forEachElement(e => state.pack(e));

        // 与前一个状态的比对结果
        const result = state.compare(this.sceneState[1 - i]);

        // 收集所有发生变化的元素类型
        const all = new Set([...result.added, ...result.removed, ...result.moved, ...result.changed]);

        // 决定本帧是否需要渲染：
        // - 如果处于锁定渲染模式（视频录制），使用 lockedRender 标志
        // - 否则，如果任何元素类型发生变化或 forceRender 被标记，则渲染
        if (this.lockedRenderMode) {
            this.app.renderNextFrame = this.lockedRender;
            this.lockedRender = false;
        } else if (!this.app.renderNextFrame) {
            this.app.renderNextFrame = this.forceRender || all.size > 0;
        }
        this.forceRender = false;

        // 触发按类型的更新事件，让 UI 等按需响应特定类型的变化
        ElementTypeList.forEach((type) => {
            if (all.has(type)) {
                this.events.fire(`updated:${type}`);
            }
        });

        this.forEachElement(e => e.onPostUpdate());
    }

    /**
     * 渲染前回调——在 GPU 渲染管线启动前执行。
     *
     * 主要工作：
     * - 应用画布尺寸变更（ResizeObserver 检测到的）
     * - 根据 pixelScale 计算实际渲染目标尺寸
     * - 调用各元素的 preRender 方法
     * - 触发 'prerender' 事件
     * - 可选的调试包围盒绘制
     */
    private onPreRender() {
        // 应用画布尺寸变更到实际画布元素
        if (this.canvasResize) {
            this.canvas.width = this.canvasResize.width;
            this.canvas.height = this.canvasResize.height;
            this.canvasResize = null;
        }

        // 计算渲染目标尺寸（应用像素缩放因子以支持性能/质量调节）
        this.targetSize.width = Math.ceil(this.app.graphicsDevice.width / this.config.camera.pixelScale);
        this.targetSize.height = Math.ceil(this.app.graphicsDevice.height / this.config.camera.pixelScale);

        this.forEachElement(e => e.onPreRender());

        this.events.fire('prerender', this.camera.worldTransform);

        // 调试功能：绘制场景包围盒
        if (this.config.debug.showBound) {
            // 绘制单个泼溅元素的包围盒
            this.forEachElement((e: Element) => {
                if (e.type === ElementType.splat) {
                    const splat = e as Splat;

                    // 红色：本地空间包围盒（带实体变换）
                    const local = splat.localBound;
                    this.app.drawWireAlignedBox(
                        local.getMin(),
                        local.getMax(),
                        Color.RED,
                        true,
                        undefined,
                        splat.entity.getWorldTransform());

                    // 绿色：世界空间包围盒
                    const world = splat.worldBound;
                    this.app.drawWireAlignedBox(
                        world.getMin(),
                        world.getMax(),
                        Color.GREEN);
                }
            });

            // 蓝色：整个场景的包围盒
            this.app.drawWireAlignedBox(this.bound.getMin(), this.bound.getMax(), Color.BLUE);
        }
    }

    /**
     * 渲染后回调——GPU 渲染完成后执行。
     *
     * 调用各元素的 onPostRender 并触发 'postrender' 事件，
     * render.ts 依赖此事件来完成离屏捕获。
     */
    private onPostRender() {
        this.forEachElement(e => e.onPostRender());

        this.events.fire('postrender');
    }
}

export type { SceneConfig };
export { Scene };
