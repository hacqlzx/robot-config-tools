/**
 * pc-app.ts - SuperSplat 项目的 PlayCanvas 应用容器类
 *
 * @file 基于 PlayCanvas 引擎的 AppBase 进行定制化扩展，用于 3D Gaussian Splatting 编辑器。
 * 核心功能：
 *   1. 精简组件系统 — 只注册相机、光照、渲染、动画和 Gaussian Splatting 相关组件
 *   2. 精简资源处理器 — 只注册纹理、立方体贴图、容器、动画和 GSPLAT 相关资源处理器
 *   3. 通过 AppOptions 配置输入系统（键盘、鼠标、触控等）和脚本/资源加载路径前缀
 *
 * 设计决策：
 *   - 大量组件系统被注释掉（如刚体、碰撞体、UI 元素等），减少不必要的内存占用和初始化开销
 *   - 使用 @ts-ignore 注释忽略 PlayCanvas 内部某些类型定义不匹配的问题
 *   - options 参数使用 any 类型，因为 PlayCanvas 的类型定义可能不完整
 */
import {
    AppBase,
    AppOptions,
    AnimComponentSystem,
    RenderComponentSystem,
    CameraComponentSystem,
    LightComponentSystem,
    GSplatComponentSystem,
    RenderHandler,
    AnimClipHandler,
    AnimStateGraphHandler,
    ContainerHandler,
    CubemapHandler,
    GSplatHandler,
    TextureHandler
} from 'playcanvas';

/**
 * PCApp — 3D Gaussian Splatting 编辑器的核心应用实例
 *
 * 继承自 PlayCanvas 的 AppBase 基类。AppBase 是 PlayCanvas 引擎的应用生命周期管理器，
 * 负责组件系统、资源处理器的注册和运行时协调。
 *
 * 本类的职责：
 *   - 在构造函数中选择性地注册组件系统（ECS 中的"系统"层）
 *   - 在构造函数中选择性地注册资源处理器（负责加载 .splat、纹理等文件）
 *   - 将从外部传入的输入设备和图形设备实例注入应用
 */
class PCApp extends AppBase {
    /**
     * @param canvas - HTML Canvas 元素，PlayCanvas 将在其上渲染所有 3D 内容
     * @param options - 配置选项对象，包含以下可选字段：
     *   - graphicsDevice:   PlayCanvas 的 GraphicsDevice 实例（WebGL/WebGPU 的 GPU 设备抽象层）
     *   - elementInput:     ElementInput 实例，处理 DOM 元素上的输入事件
     *   - keyboard/mouse/touch/gamepads: PlayCanvas 输入设备控制器实例
     *   - scriptPrefix:     脚本资源的 URL 路径前缀
     *   - assetPrefix:      资源文件的 URL 路径前缀
     *   - scriptsOrder:     脚本加载的依赖顺序配置
     */
    constructor(canvas: HTMLCanvasElement, options: any) {
        super(canvas);

        const appOptions = new AppOptions();

        // 复用外部传入的 GraphicsDevice 实例（GPU 设备抽象），而不创建新的
        appOptions.graphicsDevice = options.graphicsDevice;
        // 注册精简的组件系统和资源处理器
        this.addComponentSystems(appOptions);
        this.addResourceHandles(appOptions);

        // 注入输入系统 — 将从 PCUI 框架接收到的输入设备传给 PlayCanvas
        appOptions.elementInput = options.elementInput;
        appOptions.keyboard = options.keyboard;
        appOptions.mouse = options.mouse;
        appOptions.touch = options.touch;
        appOptions.gamepads = options.gamepads;

        // 配置脚本和资源的加载路径前缀
        appOptions.scriptPrefix = options.scriptPrefix;
        appOptions.assetPrefix = options.assetPrefix;
        appOptions.scriptsOrder = options.scriptsOrder;

        // 以下为 PlayCanvas 引擎的完整功能选项，本项目暂未启用
        // 保留为注释以便后续按需扩展：
        // appOptions.soundManager = new SoundManager(options);  // 音频管理器
        // appOptions.lightmapper = Lightmapper;                 // 光照烘焙器
        // appOptions.batchManager = BatchManager;               // 批次合批管理器
        // appOptions.xr = XrManager;                            // XR（VR/AR）管理器

        // 初始化应用 — 此调用会触发所有组件系统和资源处理器的注册与启动
        this.init(appOptions);
    }

    /**
     * 注册组件系统列表
     *
     * 组件系统是 ECS（实体-组件-系统）架构中的"系统"层。
     * 每个 ComponentSystem 负责管理一种类型的组件：
     *   - 存储该类型的所有组件实例
     *   - 每帧更新（update）组件的逻辑
     *   - 处理组件的创建和销毁
     *
     * 本项目只为 3DGS 编辑器保留了必要的组件系统：
     *   - AnimComponentSystem:    处理动画组件（如相机飞行动画）
     *   - RenderComponentSystem:   管理可渲染实体的渲染状态
     *   - CameraComponentSystem:   管理场景中的相机实体
     *   - LightComponentSystem:    管理场景中的光源
     *   - GSplatComponentSystem:  管理 Gaussian Splatting 点云的渲染（核心组件）
     *
     * @param appOptions - AppOptions 实例，其 componentSystems 属性将被设置
     */
    addComponentSystems(appOptions: AppOptions) {
        appOptions.componentSystems = [
            // 动画组件系统 — 驱动动画曲线、骨骼动画等
            // @ts-ignore
            AnimComponentSystem,
            // 渲染组件系统 — 管理可渲染实体的提交和可见性
            // @ts-ignore
            RenderComponentSystem,
            // 相机组件系统 — 管理场景中的观察者（视角）
            // @ts-ignore
            CameraComponentSystem,
            // 光照组件系统 — 管理方向光、点光源、聚光灯等
            // @ts-ignore
            LightComponentSystem,
            // Gaussian Splatting 组件系统 — 核心：管理 3DGS 点云数据的渲染
            GSplatComponentSystem
        ];
    }

    /**
     * 注册资源处理器列表
     *
     * 资源处理器负责加载、解析特定类型的资源文件，并创建对应的运行时对象。
     * 例如：
     *   - TextureHandler:    加载 PNG/JPG 等图片，上传到 GPU 创建纹理
     *   - GSplatHandler:     加载 .splat 文件，解析成 Gaussian 球体数据并上传到 GPU
     *   - AnimClipHandler:   加载 .anim 动画剪辑文件
     *
     * 本项目只为 3DGS 编辑器保留了必要的资源处理器，大幅减少了不需要的资源类型注册。
     *
     * @param appOptions - AppOptions 实例，其 resourceHandlers 属性将被设置
     */
    addResourceHandles(appOptions: AppOptions) {
        appOptions.resourceHandlers = [
            // 渲染处理器 — 处理渲染管道相关的通用资源
            // @ts-ignore
            RenderHandler,
            // 动画剪辑处理器 — 加载 .anim 文件，解析关键帧数据
            // @ts-ignore
            AnimClipHandler,
            // 动画状态图处理器 — 加载动画状态机资源（控制动画之间的切换）
            // @ts-ignore
            AnimStateGraphHandler,
            // 纹理处理器 — 加载图片文件并创建 GPU 纹理对象（2D 纹理、压缩纹理等）
            // @ts-ignore
            TextureHandler,
            // 立方体贴图处理器 — 加载 6 面图或以等距矩形投影的 HDR 环境贴图
            // @ts-ignore
            CubemapHandler,
            // 容器处理器 — 处理 .container 格式的资源打包文件
            // @ts-ignore
            ContainerHandler,
            // Gaussian Splatting 处理器 — 核心：加载 .splat 文件，解析 3DGS 数据
            // 包括位置、协方差矩阵、颜色（球谐系数）等属性
            GSplatHandler
        ];
    }
}

export { PCApp };
