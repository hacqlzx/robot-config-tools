/**
 * camera.ts - 相机系统
 *
 * 本文件实现了 SuperSplat 的核心相机系统，是用户与场景交互的主要入口。
 *
 * 核心功能包括：
 * 1. 轨道相机模式 (Orbit)：围绕焦点旋转、缩放、平移
 * 2. 飞行相机模式 (Fly)：WASD 飞行，右键/Shift/Ctrl 切换操作
 * 3. 渲染目标管理：创建和管理多层渲染管线所需的 RenderTarget
 *   - mainTarget: 主渲染目标（含颜色和深度）
 *   - splatTarget: 泼溅渲染目标（MRT 双缓冲，支持覆盖层输出）
 *   - colorTarget / workTarget: 辅助目标（用于拾取和像素读取）
 * 4. 离屏渲染模式：用于图像/视频导出时切换渲染目标尺寸
 * 5. 屏幕拾取：将屏幕坐标转换为世界空间射线，通过深度值进行场景交互
 *
 * 技术要点：
 * - 使用 TweenValue 实现平滑的相机过渡动画（阻尼效果）
 * - 自动适配渲染目标尺寸并响应画布大小变化
 * - 裁剪平面自适应场景包围盒，优化深度精度
 * - 支持正交/透视投影切换
 */


import {
    math,
    ADDRESS_CLAMP_TO_EDGE,
    ASPECT_MANUAL,
    FILTER_NEAREST,
    PIXELFORMAT_RGBA8,
    PIXELFORMAT_RGBA16F,
    PIXELFORMAT_DEPTH,
    PROJECTION_ORTHOGRAPHIC,
    PROJECTION_PERSPECTIVE,
    TONEMAP_ACES,
    TONEMAP_ACES2,
    TONEMAP_FILMIC,
    TONEMAP_HEJL,
    TONEMAP_LINEAR,
    TONEMAP_NEUTRAL,
    BoundingBox,
    Color,
    Entity,
    Mat4,
    Ray,
    RenderPass,
    RenderPassForward,
    RenderTarget,
    Texture,
    Vec3,
    Vec4
} from 'playcanvas';

import { PointerController } from './controllers';
import { Element, ElementType } from './element';
import { Picker } from './picker';
import { Serializer } from './serializer';
import { vertexShader, fragmentShader } from './shaders/blit-shader';
import { Splat } from './splat';
import { TweenValue } from './tween-value';
import { ShaderQuad, SimpleRenderPass } from './utils/simple-render-pass';

// 模块级临时向量（避免每帧在堆上分配新对象，提高性能）
const forwardVec = new Vec3();       // 前向向量
const cameraPosition = new Vec3();   // 相机位置
const ray = new Ray();               // 拾取射线
const vec = new Vec3();              // 通用临时向量
const vecb = new Vec3();             // 通用临时向量 B
const va = new Vec3();               // 通用临时向量 A
const m = new Mat4();                // 通用临时矩阵
const v4 = new Vec4();               // 通用临时四维向量

/**
 * 正确的取模运算（处理负数）。
 * JavaScript 的 % 对负数返回负数余数，此函数确保结果始终为非负。
 *
 * 例如：mod(-10, 360) = 350（而非 -10）
 *
 * @param n - 被除数
 * @param m - 除数
 * @returns 非负余数
 */
const mod = (n: number, m: number) => ((n % m) + m) % m;

/**
 * Camera 类 - 相机元素。
 *
 * 继承自 Element，作为场景元素参与统一的场景管理。
 * 通过方位角(azimuth)/仰角(elevation)/距离(distance) 三个球坐标参数控制相机，
 * 使用 TweenValue 实现平滑过渡动画。
 */
class Camera extends Element {
    /**
     * 根据方位角和仰角计算前向向量。
     *
     * 球坐标转笛卡尔坐标的公式：
     * - x = -cos(elev) * sin(azim)
     * - y = sin(elev)
     * - z = cos(elev) * cos(azim)
     *
     * 注意：azim=0, elev=0 时相机看向 -Z 方向。
     *
     * @param result - 存储结果的 Vec3
     * @param azim - 方位角度数（水平旋转）
     * @param elev - 仰角度数（垂直旋转）
     */
    static calcForwardVec(result: Vec3, azim: number, elev: number) {
        const ex = elev * math.DEG_TO_RAD;
        const ey = azim * math.DEG_TO_RAD;
        const s1 = Math.sin(-ex);
        const c1 = Math.cos(-ex);
        const s2 = Math.sin(-ey);
        const c2 = Math.cos(-ey);
        result.set(-c1 * s2, s1, c1 * c2);
    }

    /** 指针/触摸控制器（处理鼠标和触摸输入） */
    controller: PointerController;
    /** 焦点坐标的平滑过渡器（相机围绕此点旋转） */
    focalPointTween = new TweenValue({ x: 0, y: 0.5, z: 0 });
    /** 方位角和仰角的平滑过渡器 */
    azimElevTween = new TweenValue({ azim: 30, elev: -15 });
    /** 相机到焦点距离的平滑过渡器 */
    distanceTween = new TweenValue({ distance: 1 });

    /** 仰角下限（度），默认 -90 度 */
    minElev = -90;
    /** 仰角上限（度），默认 90 度 */
    maxElev = 90;

    /** 场景半径（用于标准化距离计算） */
    sceneRadius = 1;

    /** 飞行模式下的移动速度 */
    flySpeed = 1;

    /** 控制模式：'orbit'(轨道) 或 'fly'(飞行) */
    controlMode: 'orbit' | 'fly' = 'orbit';

    /**
     * 飞行模式下注视时，存储需要保持不变的相机位置。
     * 当 azim/elev 平滑过渡时，相机位置始终返回此值，
     * 直到过渡完成。
     */
    lookCameraPos: Vec3 | null = null;

    /** 像素拾取器（用于选择场景元素） */
    picker: Picker;

    /** 主相机实体（PlayCanvas Entity） */
    mainCamera: Entity;

    // 渲染目标定义
    mainTarget: RenderTarget;    // 主渲染目标：颜色 + 深度
    splatTarget: RenderTarget;   // 泼溅 MRT 渲染目标：颜色 + 覆盖层输出
    colorTarget: RenderTarget;   // 纯颜色渲染目标（用于拾取等）
    workTarget: RenderTarget;    // 工作缓冲区（RGBA8，用于 CPU 像素读取）

    // 渲染通道（按执行顺序排列）
    clearPass: RenderPass;          // 第一步：清除目标
    mainPass: RenderPassForward;    // 第二步：渲染世界层
    splatPass: RenderPassForward;   // 第三步：渲染泼溅层（MRT）
    gizmoPass: RenderPassForward;   // 第四步：渲染辅助线层
    finalPass: SimpleRenderPass;    // 第五步：最终屏幕混合

    /** 离屏渲染时的尺寸覆盖（null 表示使用正常尺寸） */
    targetSizeOverride: { width: number, height: number } = null;

    /** 是否渲染覆盖层（离屏模式通常会关闭） */
    renderOverlays = true;

    /** 更新相机着色器 uniform 的回调（在 rebuildRenderTargets 中设置） */
    updateCameraUniforms: () => void;

    constructor() {
        super(ElementType.camera);

        // 创建相机实体并添加 camera 组件
        this.mainCamera = new Entity('Camera');
        this.mainCamera.addComponent('camera');
    }

    /** 设置/获取是否为正交投影模式 */
    set ortho(value: boolean) {
        if (value !== this.ortho) {
            this.camera.projection = value ? PROJECTION_ORTHOGRAPHIC : PROJECTION_PERSPECTIVE;
            this.scene.events.fire('camera.ortho', value);
        }
    }

    get ortho() {
        return this.camera.projection === PROJECTION_ORTHOGRAPHIC;
    }

    /** 设置/获取视场角（度数） */
    set fov(value: number) {
        this.camera.fov = value;
    }

    get fov() {
        return this.camera.fov;
    }

    /**
     * 设置色调映射算法。
     *
     * 支持的映射名称：linear, neutral, aces, aces2, filmic, hejl
     * 内部使用 PlayCanvas 的 TONEMAP_* 常量进行转换。
     */
    set tonemapping(value: string) {
        const mapping: Record<string, number> = {
            linear: TONEMAP_LINEAR,
            neutral: TONEMAP_NEUTRAL,
            aces: TONEMAP_ACES,
            aces2: TONEMAP_ACES2,
            filmic: TONEMAP_FILMIC,
            hejl: TONEMAP_HEJL
        };

        const tvalue = mapping[value];

        if (tvalue !== undefined && tvalue !== this.camera.toneMapping) {
            this.camera.toneMapping = tvalue;
            this.scene.events.fire('camera.tonemapping', value);
        }
    }

    get tonemapping() {
        switch (this.camera.toneMapping) {
            case TONEMAP_LINEAR: return 'linear';
            case TONEMAP_NEUTRAL: return 'neutral';
            case TONEMAP_ACES: return 'aces';
            case TONEMAP_ACES2: return 'aces2';
            case TONEMAP_FILMIC: return 'filmic';
            case TONEMAP_HEJL: return 'hejl';
        }
        return 'linear';
    }

    /** 设置/获取近裁剪平面距离 */
    set near(value: number) {
        this.camera.nearClip = value;
    }

    get near() {
        return this.camera.nearClip;
    }

    /** 设置/获取远裁剪平面距离 */
    set far(value: number) {
        this.camera.farClip = value;
    }

    get far() {
        return this.camera.farClip;
    }

    /** 获取焦点坐标（从 TweenValue 中读取目标值） */
    get focalPoint() {
        const t = this.focalPointTween.target;
        return new Vec3(t.x, t.y, t.z);
    }

    /** 获取方位角/仰角目标值 */
    get azimElev() {
        return this.azimElevTween.target;
    }

    get azim() {
        return this.azimElev.azim;
    }

    get elevation() {
        return this.azimElev.elev;
    }

    get distance() {
        return this.distanceTween.target.distance;
    }

    /**
     * 设置焦点坐标。
     *
     * 焦点是相机围绕旋转的 3D 世界空间点。
     * dampingFactorFactor 允许在某些操作中加速或减速过渡。
     *
     * @param point - 世界空间的焦点位置
     * @param dampingFactorFactor - 阻尼因子乘数（默认 1，值越小过渡越慢）
     */
    setFocalPoint(point: Vec3, dampingFactorFactor: number = 1) {
        this.lookCameraPos = null;
        this.focalPointTween.goto(point, dampingFactorFactor * this.scene.config.controls.dampingFactor);
    }

    /**
     * 飞行模式下的注视操作：围绕相机自身旋转，保持相机位置不变。
     *
     * 实现原理：
     * 1. 从当前焦距和方向反算相机位置
     * 2. 修改 azimuth/elevation
     * 3. 根据新方向反算新的焦点位置
     * 4. 锁定相机位置直到过渡完成
     *
     * @param dx - 水平鼠标移动量
     * @param dy - 垂直鼠标移动量
     */
    look(dx: number, dy: number) {
        const sensitivity = this.scene.config.controls.orbitSensitivity;
        const d = this.distance * this.sceneRadius / this.fovFactor;

        // 反算当前相机位置
        Camera.calcForwardVec(forwardVec, this.azim, this.elevation);
        const cameraPos = this.focalPoint.add(forwardVec.clone().mulScalar(d));

        const azim = this.azim - dx * sensitivity;
        const elev = this.elevation - dy * sensitivity;

        // 用新方向反算新焦点
        Camera.calcForwardVec(forwardVec, azim, elev);
        const focalPoint = cameraPos.clone().sub(forwardVec.clone().mulScalar(d));

        this.setAzimElev(azim, elev);
        this.focalPointTween.goto(focalPoint, this.scene.config.controls.dampingFactor);
        // 锁定相机位置：在过渡期间保持相机 pos 不变
        this.lookCameraPos = cameraPos;
    }

    /**
     * 设置方位角和仰角。
     *
     * 角度会自动处理环绕（azim 限制在 [0, 360)）和仰角夹持。
     * 设置角度后自动切换回透视投影模式。
     *
     * @param azim - 方位角（度）
     * @param elev - 仰角（度）
     * @param dampingFactorFactor - 阻尼因子乘数
     */
    setAzimElev(azim: number, elev: number, dampingFactorFactor: number = 1) {
        // 仰角限制在允许范围内
        azim = mod(azim, 360);
        elev = Math.max(this.minElev, Math.min(this.maxElev, elev));

        const t = this.azimElevTween;
        t.goto({ azim, elev }, dampingFactorFactor * this.scene.config.controls.dampingFactor);

        // 处理方位角环绕：确保过渡方向取最短路径
        // 例如从 350° 旋转到 10°，应该走 +20° 的方向（350→360→10）
        // 而不是走 -340° 的方向
        if (t.source.azim - azim < -180) {
            t.source.azim += 360;
        } else if (t.source.azim - azim > 180) {
            t.source.azim -= 360;
        }

        // 旋转后自动切换回透视模式
        this.ortho = false;
    }

    /**
     * 设置相机距离。
     *
     * 距离会被夹持在 minZoom 和 maxZoom 之间。
     *
     * @param distance - 目标距离
     * @param dampingFactorFactor - 阻尼因子乘数
     */
    setDistance(distance: number, dampingFactorFactor: number = 1) {
        this.lookCameraPos = null;

        const controls = this.scene.config.controls;

        // 距离限制在配置的范围
        distance = Math.max(controls.minZoom, Math.min(controls.maxZoom, distance));

        const t = this.distanceTween;
        t.goto({ distance }, dampingFactorFactor * controls.dampingFactor);
    }

    /**
     * 直接设置相机的姿态（位置 + 注视目标）。
     *
     * 这会将位置和目标转换为 azimuth/elevation/distance 球坐标表示。
     *
     * @param position - 相机世界空间位置
     * @param target - 注视目标世界空间位置
     * @param dampingFactorFactor - 阻尼因子乘数
     */
    setPose(position: Vec3, target: Vec3, dampingFactorFactor: number = 1) {
        vec.sub2(target, position);
        const l = vec.length();
        const azim = Math.atan2(-vec.x / l, -vec.z / l) * math.RAD_TO_DEG;
        const elev = Math.asin(vec.y / l) * math.RAD_TO_DEG;
        this.setFocalPoint(target, dampingFactorFactor);
        this.setAzimElev(azim, elev, dampingFactorFactor);
        this.setDistance(l / this.sceneRadius * this.fovFactor, dampingFactorFactor);
    }

    /**
     * 将世界空间坐标转换为标准化屏幕坐标 (0-1 范围)。
     *
     * 使用 MVP 矩阵（模型-视图-投影）进行变换，然后执行透视除法。
     * 返回的 x/y 范围为 [0,1]，z 为归一化设备坐标深度。
     *
     * @param world - 世界空间坐标
     * @param screen - 存储结果的 Vec3（x/y: 屏幕坐标, z: NDC 深度）
     */
    worldToScreen(world: Vec3, screen: Vec3) {
        const { camera } = this;
        m.mul2(camera.projectionMatrix, camera.viewMatrix);

        v4.set(world.x, world.y, world.z, 1);
        m.transformVec4(v4, v4);

        screen.x = v4.x / v4.w * 0.5 + 0.5;
        screen.y = 1.0 - (v4.y / v4.w * 0.5 + 0.5);  // Y 轴翻转
        screen.z = v4.z / v4.w;
    }

    /**
     * 添加相机到场景（Element 生命周期方法）。
     *
     * 初始化内容：
     * - 创建所有渲染目标和渲染通道
     * - 应用场景配置（色调映射、曝光、FOV、初始姿态）
     * - 创建 PointerController 和 Picker
     * - 注册场景边界变化监听
     * - 处理 URL 查询参数中的相机初始值
     */
    add() {
        const { camera, scene } = this;

        scene.cameraRoot.addChild(this.mainCamera);

        // 配置相机渲染所有三个层
        this.mainCamera.camera.layers = [
            scene.worldLayer.id,
            scene.splatLayer.id,
            scene.gizmoLayer.id
        ];

        // 使用手动宽高比模式——由 targetSize 动态计算
        camera.aspectRatioMode = ASPECT_MANUAL;

        // 创建渲染通道
        const device = scene.graphicsDevice;
        const { app } = scene;
        const renderer = app.renderer;
        const composition = app.scene.layers;

        // clearPass: 清除渲染目标
        this.clearPass = new RenderPass(device);
        // mainPass: 渲染世界层
        this.mainPass = new RenderPassForward(device, composition, app.scene, renderer);
        // splatPass: 渲染泼溅层
        this.splatPass = new RenderPassForward(device, composition, app.scene, renderer);
        // gizmoPass: 渲染辅助线层
        this.gizmoPass = new RenderPassForward(device, composition, app.scene, renderer);
        // finalPass: 最终屏幕混合通道（使用自定义 blit shader）
        this.finalPass = new SimpleRenderPass(device,
            new ShaderQuad(device, vertexShader, fragmentShader, 'final-blit'), {
                vars: () => {
                    return {
                        srcTexture: this.mainTarget.colorBuffer
                    };
                }
            });

        const target = document.getElementById('canvas-container');
        // 创建指针/触摸控制器
        this.controller = new PointerController(this, target);

        // 应用场景配置
        const config = scene.config;
        const controls = config.controls;

        // 将极角（弧度）转换为仰角（度）
        // PlayCanvas 极角 0 = 顶视图，我们保持 -90° 到 +90° 的仰角范围
        this.minElev = (controls.minPolarAngle * 180) / Math.PI - 90;
        this.maxElev = (controls.maxPolarAngle * 180) / Math.PI - 90;

        // 设置色调映射
        camera.toneMapping = {
            linear: TONEMAP_LINEAR,
            filmic: TONEMAP_FILMIC,
            hejl: TONEMAP_HEJL,
            aces: TONEMAP_ACES,
            aces2: TONEMAP_ACES2,
            neutral: TONEMAP_NEUTRAL
        }[config.camera.toneMapping];

        // 设置曝光度
        scene.app.scene.exposure = config.camera.exposure;

        this.fov = config.camera.fov;

        // 设置初始相机姿态（阻尼因子为 0 表示立即跳转）
        this.setAzimElev(controls.initialAzim, controls.initialElev, 0);
        this.setDistance(controls.initialZoom, 0);

        // 创建像素拾取器
        this.picker = new Picker(scene);

        scene.events.on('scene.boundChanged', this.onBoundChanged, this);

        /**
         * 更新相机相关的着色器 uniform 变量。
         *
         * 将相机的近平面和远平面信息以世界空间坐标的形式
         * 写入着色器 uniform，供泼溅渲染使用（用于深度计算和裁剪）。
         */
        this.updateCameraUniforms = () => {
            const device = scene.graphicsDevice;
            const entity = this.mainCamera;
            const camera = entity.camera;

            // 辅助函数：将 Vec3 值写入着色器 uniform
            const set = (name: string, vec: Vec3) => {
                device.scope.resolve(name).setValue([vec.x, vec.y, vec.z]);
            };

            // 获取相机视锥体在世界空间中的 8 个角点
            const points = camera.camera.getFrustumCorners(-100);
            const worldTransform = this.worldTransform;
            for (let i = 0; i < points.length; i++) {
                worldTransform.transformPoint(points[i], points[i]);
            }

            // 近平面信息
            // points[0..3] 是近平面角点，points[4..7] 是远平面角点
            if (camera.projection === PROJECTION_PERSPECTIVE) {
                // 透视：近平面原点 = 相机位置，方向向量为零（该点为奇点）
                set('near_origin', worldTransform.getTranslation());
                set('near_x', Vec3.ZERO);
                set('near_y', Vec3.ZERO);
            } else {
                // 正交：近平面是一个矩形
                set('near_origin', points[3]);
                set('near_x', va.sub2(points[0], points[3]));
                set('near_y', va.sub2(points[2], points[3]));
            }

            // 远平面信息（透视图和正交图通用）
            set('far_origin', points[7]);
            set('far_x', va.sub2(points[4], points[7]));
            set('far_y', va.sub2(points[6], points[7]));
        };

        // 支持通过 URL 查询参数设定初始相机位置
        // 例如 ?focal=0,0.5,0&angles=-45,-10&distance=2
        const url = new URL(location.href);
        const focal = url.searchParams.get('focal');
        if (focal) {
            const parts = focal.toString().split(',');
            if (parts.length === 3) {
                this.setFocalPoint(new Vec3(parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2])), 0);
            }
        }
        const angles = url.searchParams.get('angles');
        if (angles) {
            const parts = angles.toString().split(',');
            if (parts.length === 2) {
                this.setAzimElev(parseFloat(parts[0]), parseFloat(parts[1]), 0);
            }
        }
        const distance = url.searchParams.get('distance');
        if (distance) {
            this.setDistance(parseFloat(distance), 0);
        }
    }

    /**
     * 从场景中移除相机（Element 生命周期方法）。
     *
     * 销毁控制器、渲染通道、拾取器，并从场景树中移除相机实体。
     */
    remove() {
        const { scene } = this;

        this.controller.destroy();
        this.controller = null;

        // 清理渲染通道
        this.clearPass?.destroy();
        this.mainPass?.destroy();
        this.splatPass?.destroy();
        this.gizmoPass?.destroy();
        this.finalPass?.destroy();
        this.camera.framePasses = null;

        scene.cameraRoot.removeChild(this.mainCamera);

        this.picker.destroy();
        this.picker = null;

        scene.events.off('scene.boundChanged', this.onBoundChanged, this);
    }

    /**
     * 响应场景边界变化。
     *
     * 当场景包围盒改变时（如加载新的泼溅文件）：
     * 1. 更新 sceneRadius（用于距离标准化计算）
     * 2. 保持相机当前位置不变：根据新半径调整距离值
     *
     * 设计的核心：距离值是相对于 sceneRadius 的标准化值，
     * 因此当场景变大时，实际世界空间距离也自动变大，而缩放感知不变。
     *
     * @param bound - 新的场景包围盒
     */
    onBoundChanged(bound: BoundingBox) {
        const prevDistance = this.distanceTween.value.distance * this.sceneRadius;
        this.sceneRadius = Math.max(1e-03, bound.halfExtents.length());
        this.setDistance(prevDistance / this.sceneRadius, 0);
    }

    /**
     * 序列化相机状态（用于帧间变化检测）。
     *
     * 将世界变换矩阵、FOV、色调映射、目标尺寸等打包为浮点数组。
     */
    serialize(serializer: Serializer) {
        serializer.packa(this.worldTransform.data);
        serializer.pack(
            this.fov,
            this.tonemapping,
            this.targetSize.width,
            this.targetSize.height
        );
    }

    /**
     * 重建渲染目标。
     *
     * 当画布尺寸改变或首次初始化时调用。
     * 创建或调整以下渲染目标的尺寸：
     * - mainTarget: 主目标（float16 颜色 + 深度）
     * - splatTarget: MRT 目标（共享的 float16 颜色 + RGBA8 覆盖层 + 深度）
     * - colorTarget: 纯颜色目标
     * - workTarget: 工作缓冲区（RGBA8，用于 CPU 读取和覆盖层）
     *
     * 同时设置相机参数（宽高比、水平FOV标记）并触发 'camera.resize' 事件。
     */
    rebuildRenderTargets() {
        const { width, height } = this.targetSize;
        const { mainTarget, scene } = this;

        // 无变化则跳过
        if (mainTarget && mainTarget.width === width && mainTarget.height === height) {
            return;
        }

        if (!mainTarget) {
            // 首次创建渲染目标
            const { graphicsDevice } = scene;

            /**
             * 创建纹理的辅助函数。
             * 设置最近邻过滤和边缘夹持，因为这是渲染目标而非采样纹理。
             */
            const createTexture = (name: string, width: number, height: number, format: number) => {
                return new Texture(graphicsDevice, {
                    name,
                    width,
                    height,
                    format,
                    mipmaps: false,
                    minFilter: FILTER_NEAREST,
                    magFilter: FILTER_NEAREST,
                    addressU: ADDRESS_CLAMP_TO_EDGE,
                    addressV: ADDRESS_CLAMP_TO_EDGE
                });
            };

            // 创建颜色和深度缓冲区
            // PIXELFORMAT_RGBA16F: 半精度浮点，用于 HDR 颜色
            // PIXELFORMAT_RGBA8: 标准 RGBA，用于工作缓冲
            // PIXELFORMAT_DEPTH: 深度缓冲区
            const colorBuffer = createTexture('cameraColor', width, height, PIXELFORMAT_RGBA16F);
            const workBuffer = createTexture('workColor', width, height, PIXELFORMAT_RGBA8);
            const depthBuffer = createTexture('cameraDepth', width, height, PIXELFORMAT_DEPTH);

            // 主渲染目标：float16 颜色 + 深度
            this.mainTarget = new RenderTarget({
                colorBuffer,
                depthBuffer,
                flipY: false,
                autoResolve: false   // 不需要自动 MSAA 解析
            });

            // 泼溅 MRT 渲染目标：两个颜色缓冲区（共享）
            // RT0: 主颜色（float16），RT1: 覆盖层输出（RGBA8）
            this.splatTarget = new RenderTarget({
                colorBuffers: [
                    colorBuffer,        // RT0: 主颜色（与 mainTarget 共享）
                    workBuffer          // RT1: 覆盖层输出（与 workTarget 共享）
                ],
                depthBuffer,
                flipY: false,
                autoResolve: false
            });

            this.colorTarget = new RenderTarget({
                colorBuffer,
                depth: false,
                autoResolve: false
            });

            // 工作缓冲区（用于拾取、覆盖层输出等操作）
            this.workTarget = new RenderTarget({
                colorBuffer: workBuffer,
                depth: false,
                autoResolve: false
            });

            // 为拾取器设置渲染目标
            this.picker.setRenderTargets(this.colorTarget, this.workTarget);

            // 配置清除通道
            this.clearPass.init(this.splatTarget);
            // 清除为全透明黑色
            this.clearPass.setClearColor(new Color(0, 0, 0, 0));
            this.clearPass.setClearDepth(1);
            this.clearPass.setClearStencil(0);

            // 配置主渲染通道：渲染世界层（不透明 + 透明）
            this.mainPass.init(this.mainTarget);
            this.mainPass.addLayer(this.camera, scene.worldLayer, false, false);
            this.mainPass.addLayer(this.camera, scene.worldLayer, true, false);

            // 配置泼溅渲染通道：渲染到 MRT 目标（不透明 + 透明）
            // 注意：不清除——清除由 clearPass 完成
            this.splatPass.init(this.splatTarget);
            this.splatPass.addLayer(this.camera, scene.splatLayer, false, false);
            this.splatPass.addLayer(this.camera, scene.splatLayer, true, false);

            // 配置辅助线渲染通道
            this.gizmoPass.init(this.mainTarget);
            this.gizmoPass.addLayer(this.camera, scene.gizmoLayer, false, false);
            this.gizmoPass.addLayer(this.camera, scene.gizmoLayer, true, false);
            // 辅助线渲染前清除深度和模板（确保叠加在场景之上）
            this.gizmoPass.renderActions[0].clearDepth = true;
            this.gizmoPass.renderActions[0].clearStencil = true;

            this.finalPass.init(null);

            // 赋给相机：按此顺序依次执行渲染通道
            this.camera.framePasses = [this.clearPass, this.mainPass, this.splatPass, this.gizmoPass, this.finalPass];
        } else {
            // 调整现有渲染目标的尺寸
            const { splatTarget, colorTarget, workTarget } = this;

            mainTarget.resize(width, height);
            workTarget.resize(width, height);
            colorTarget.resize(width, height);
            splatTarget.resize(width, height);
        }

        // 更新相机参数
        this.camera.horizontalFov = width > height;  // 宽画布 = 水平 FOV
        this.camera.aspectRatio = width / height;
        scene.events.fire('camera.resize', { width, height });
    }

    /**
     * 每帧更新相机状态。
     *
     * 1. 更新控制器（处理鼠标/触摸输入）
     * 2. 更新三个 TweenValue（焦点、角度、距离的平滑过渡）
     * 3. 根据球坐标计算实际相机位置和朝向
     * 4. 更新裁剪平面
     * 5. 更新正交高度和投影矩阵
     *
     * @param deltaTime - 时间增量（秒）
     */
    onUpdate(deltaTime: number) {
        // 处理输入
        this.controller.update(deltaTime);

        // 更新平滑过渡值
        this.focalPointTween.update(deltaTime);
        this.azimElevTween.update(deltaTime);
        this.distanceTween.update(deltaTime);

        const azimElev = this.azimElevTween.value;
        const distance = this.distanceTween.value;

        Camera.calcForwardVec(forwardVec, azimElev.azim, azimElev.elev);

        if (this.lookCameraPos) {
            // 飞行注视模式：保持相机位置不变
            cameraPosition.copy(this.lookCameraPos);
            // 过渡完成后清除锁定
            if (this.azimElevTween.timer >= this.azimElevTween.transitionTime) {
                this.lookCameraPos = null;
            }
        } else {
            // 标准轨道模式：从前向向量和距离计算相机位置
            cameraPosition.copy(forwardVec);
            // 距离 = 标准化距离 * sceneRadius / fovFactor
            // fovFactor 的除法确保不同 FOV 下场景看起来大小一致
            cameraPosition.mulScalar(distance.distance * this.sceneRadius / this.fovFactor);
            cameraPosition.add(this.focalPointTween.value);
        }

        this.mainCamera.setLocalPosition(cameraPosition);
        this.mainCamera.setLocalEulerAngles(azimElev.elev, azimElev.azim, 0);

        // 自动调整裁剪平面以适应场景包围盒
        this.fitClippingPlanes(this.mainCamera.getLocalPosition(), this.mainCamera.forward);

        const { camera } = this.mainCamera;
        const { targetSize } = this;

        // 更新正交高度：使正交和透视下的场景大小感知一致
        camera.orthoHeight = this.distanceTween.value.distance * this.sceneRadius / this.fovFactor * (this.fov / 90) * (camera.horizontalFov ? targetSize.height / targetSize.width : 1);
        camera.camera._updateViewProjMat();
    }

    /**
     * 自动调整近远裁剪平面以适应场景包围盒。
     *
     * 原理：
     * - 计算相机到包围盒中心沿视线方向的距离
     * - 基于场景半径和安全因子设置近远平面
     * - 当相机在包围盒内时，使用 near = far / 16384 来保持足够精度
     *
     * 这样可以在保证不裁剪场景的前提下最大化深度缓冲区精度。
     *
     * @param cameraPosition - 相机世界位置
     * @param forwardVec - 相机前向方向
     */
    fitClippingPlanes(cameraPosition: Vec3, forwardVec: Vec3) {
        const bound = this.scene.bound;
        const boundRadius = bound.halfExtents.length();

        vec.sub2(bound.center, cameraPosition);
        const dist = vec.dot(forwardVec);

        if (dist > 0) {
            // 场景在相机前方
            this.far = dist + boundRadius;
            // 如果相机在包围盒内，设置一个合理的最小近平面
            this.near = Math.max(1e-6, dist < boundRadius ? this.far / (1024 * 16) : dist - boundRadius);
        } else {
            // 场景在相机后方
            this.far = boundRadius * 2;
            this.near = this.far / (1024 * 16);
        }
    }

    /** 渲染前：重建渲染目标并更新相机 uniform */
    onPreRender() {
        this.rebuildRenderTargets();
        this.updateCameraUniforms();
    }

    onPostRender() {

    }

    /**
     * 将相机聚焦到指定的区域。
     *
     * 如果没有提供 options，自动聚焦到第一个泼溅的焦点或场景包围盒中心。
     *
     * @param options - 可选的聚焦配置
     * @param options.focalPoint - 焦点世界空间位置
     * @param options.radius - 焦点区域半径（影响缩放级别）
     * @param options.speed - 过渡速度（0 = 即时跳转）
     */
    focus(options?: { focalPoint: Vec3, radius: number, speed: number }) {
        /**
         * 获取第一个泼溅元素的焦点（如果有的话）。
         * 泼溅可能提供自定义的焦点位置（如其中心点）。
         */
        const getSplatFocalPoint = () => {
            for (const element of this.scene.elements) {
                if (element.type === ElementType.splat) {
                    const focalPoint = (element as Splat).focalPoint?.();
                    if (focalPoint) {
                        return focalPoint;
                    }
                }
            }
        };

        const focalPoint = options ? options.focalPoint : (getSplatFocalPoint() ?? this.scene.bound.center);
        const focalRadius = options ? options.radius : this.scene.bound.halfExtents.length();

        const fdist = focalRadius / this.sceneRadius;

        this.setDistance(isFinite(fdist) ? fdist : 1, options?.speed ?? 0);
        this.setFocalPoint(focalPoint, options?.speed ?? 0);
    }

    /**
     * 视场角因子。
     *
     * 用于将标准化距离转换为世界空间距离，确保不同 FOV 下场景大小感知一致。
     * 使用较大轴的 FOV（始终是 this.fov），使得相机距离不随视口宽高比变化。
     */
    get fovFactor() {
        return Math.sin(this.fov * math.DEG_TO_RAD * 0.5);
    }

    /**
     * 根据屏幕坐标创建一条世界空间射线。
     *
     * 用于拾取：将屏幕上的鼠标位置转换为从相机发出的射线，
     * 可用于射线-场景求交。
     *
     * @param screenX - 屏幕 x 坐标（画布像素坐标系）
     * @param screenY - 屏幕 y 坐标（画布像素坐标系）
     * @param ray - 存储结果的 Ray 对象
     */
    getRay(screenX: number, screenY: number, ray: Ray) {
        const { camera, ortho } = this;
        const cameraPos = this.mainCamera.getPosition();

        if (ortho) {
            // 正交模式：从近平面和远平面反算方向
            camera.screenToWorld(screenX, screenY, -1.0, vec);
            camera.screenToWorld(screenX, screenY, 1.0, vecb);
            vecb.sub(vec).normalize();
            ray.set(vec, vecb);
        } else {
            // 透视模式：从相机位置和屏幕点反算方向
            camera.screenToWorld(screenX, screenY, 1.0, vec);
            vec.sub(cameraPos).normalize();
            ray.set(cameraPos, vec);
        }
    }

    /**
     * 使用深度拾取在屏幕坐标处与场景求交。
     *
     * 这是两步过程：
     * 1. 遍历所有泼溅，读取它们在该位置的深度值，找到最近的
     * 2. 将深度值转换回世界空间位置
     *
     * @param x - 标准化屏幕坐标 x（0-1 范围）
     * @param y - 标准化屏幕坐标 y（0-1 范围）
     * @returns 求交结果（泼溅对象、世界位置、距离），或 null
     */
    async intersect(x: number, y: number) {
        const { scene } = this;
        const splats = scene.getElementsByType(ElementType.splat);

        let closestDepth = Infinity;
        let closestSplat: Splat | null = null;

        // 遍历所有泼溅，找到该屏幕位置深度最小的
        for (let i = 0; i < splats.length; ++i) {
            const splat = splats[i] as Splat;

            this.picker.prepareDepth(splat);
            const normalizedDepth = await this.picker.readDepth(x, y);

            if (normalizedDepth !== null && normalizedDepth < closestDepth) {
                closestDepth = normalizedDepth;
                closestSplat = splat;
            }
        }

        if (!closestSplat) {
            return null;
        }

        // 将归一化深度 (0-1) 转换为线性深度
        const linearDepth = closestDepth * (this.far - this.near) + this.near;

        // 将标准化坐标转换为画布像素坐标
        const screenX = x * scene.canvas.clientWidth;
        const screenY = y * scene.canvas.clientHeight;

        // 使用射线和深度反算世界空间位置
        this.getRay(screenX, screenY, ray);
        const t = linearDepth / ray.direction.dot(this.mainCamera.forward);
        const position = new Vec3();
        position.copy(ray.origin).add(vec.copy(ray.direction).mulScalar(t));

        return {
            splat: closestSplat,
            position: position,
            distance: t
        };
    }

    /**
     * 在屏幕位置与场景求交并将相机聚焦到交点。
     *
     * 用户双击或中键点击场景时调用此方法。
     *
     * @param x - 标准化屏幕坐标 x（0-1）
     * @param y - 标准化屏幕坐标 y（0-1）
     */
    async pickFocalPoint(x: number, y: number) {
        const result = await this.intersect(x, y);
        if (result) {
            const { scene } = this;

            this.setFocalPoint(result.position);
            this.setDistance(result.distance / this.sceneRadius * this.fovFactor);
            scene.events.fire('camera.focalPointPicked', {
                camera: this,
                splat: result.splat,
                position: result.position
            });
        }
    }

    /**
     * 像素拾取准备：将泼溅渲染为 ID 缓冲区用于选择。
     *
     * @param splat - 要准备拾取的泼溅
     * @param mode - 拾取模式：·add'(添加到选择)、'remove'(从选择中移除)、'set'(设置选择)
     */
    pickPrep(splat: Splat, mode: 'add' | 'remove' | 'set') {
        this.picker.prepareId(splat, mode);
    }

    /**
     * 在屏幕坐标处读取拾取 ID（选择泼溅）。
     *
     * @param x - 标准化屏幕坐标 x（0-1）
     * @param y - 标准化屏幕坐标 y（0-1）
     * @returns 读取到的拾取 ID
     */
    pick(x: number, y: number) {
        return this.picker.readId(x, y);
    }

    /**
     * 在屏幕矩形区域内批量读取拾取 ID（框选）。
     *
     * @param x - 左上角 x
     * @param y - 左上角 y
     * @param width - 矩形宽度
     * @param height - 矩形高度
     * @returns 读取到的拾取 ID 集合
     */
    pickRect(x: number, y: number, width: number, height: number) {
        return this.picker.readIds(x, y, width, height);
    }

    /**
     * 序列化相机配置（用于保存到 .splat 文档）。
     *
     * @returns 包含焦点、角度、距离、FOV、色调映射的对象
     */
    docSerialize() {
        const pack3 = (v: Vec3) => [v.x, v.y, v.z];

        return {
            focalPoint: pack3(this.focalPointTween.target),
            azim: this.azim,
            elev: this.elevation,
            distance: this.distance,
            fov: this.fov,
            tonemapping: this.tonemapping
        };
    }

    /**
     * 从序列化数据恢复相机配置。
     *
     * @param settings - 包含相机配置的对象
     */
    docDeserialize(settings: any) {
        this.setFocalPoint(new Vec3(settings.focalPoint), 0);
        this.setAzimElev(settings.azim, settings.elev, 0);
        this.setDistance(settings.distance, 0);
        this.fov = settings.fov;
        this.tonemapping = settings.tonemapping;
    }

    /**
     * 进入离屏渲染模式。
     *
     * 在此模式下：
     * - 渲染目标使用指定的覆写尺寸
     * - 最终屏幕混合通道被禁用（不输出到画布）
     * - 仅渲染到离屏 RenderTarget
     *
     * @param width - 离屏目标宽度
     * @param height - 离屏目标高度
     */
    startOffscreenMode(width: number, height: number) {
        this.targetSizeOverride = { width, height };
        this.finalPass.enabled = false;
        this.rebuildRenderTargets();
        this.onUpdate(0);
    }

    /**
     * 退出离屏渲染模式，恢复正常渲染。
     */
    endOffscreenMode() {
        this.targetSizeOverride = null;
        this.finalPass.enabled = true;
        this.rebuildRenderTargets();
        this.onUpdate(0);
    }

    /** 获取当前的渲染目标尺寸（正常模式或离屏模式） */
    get targetSize() {
        return this.targetSizeOverride ?? this.scene.targetSize;
    }

    /** 获取 PlayCanvas CameraComponent */
    get camera() {
        return this.mainCamera.camera;
    }

    /** 获取相机实体的世界变换矩阵 */
    get worldTransform() {
        return this.mainCamera.getWorldTransform();
    }

    /** 获取相机世界空间位置 */
    get position() {
        return this.mainCamera.getPosition();
    }

    /** 获取相机前向方向 */
    get forward() {
        return this.mainCamera.forward;
    }
}

export { Camera };
