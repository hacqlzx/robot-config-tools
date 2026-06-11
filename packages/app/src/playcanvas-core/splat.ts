import {
    ADDRESS_CLAMP_TO_EDGE,
    FILTER_NEAREST,
    PIXELFORMAT_R8,
    PIXELFORMAT_R16U,
    Asset,
    BoundingBox,
    Color,
    Entity,
    GSplatData,
    GSplatResource,
    Mat4,
    Quat,
    Texture,
    Vec3
} from 'playcanvas';

import { Element, ElementType } from './element';
import { Serializer } from './serializer';
import { vertexShader, fragmentShader, gsplatCenter } from './shaders/splat-shader';
import { State } from './splat-state';
import { Transform } from './transform';
import { TransformPalette } from './transform-palette';

// 临时向量，复用避免频繁创建新对象导致 GC 压力
const vec = new Vec3();
const veca = new Vec3();
const vecb = new Vec3();

/**
 * 包围盒线框的顶点数据
 * 生成一个单位立方体的 12 条棱（每条棱用两个点表示），用于在渲染时绘制选择包围盒
 * 每条棱包含两个变体：标准长度 和 75% 长度（模拟更精细的角点效果）
 */
const boundingPoints =
    [-1, 1].map((x) => {
        return [-1, 1].map((y) => {
            return [-1, 1].map((z) => {
                return [
                    new Vec3(x, y, z), new Vec3(x * 0.75, y, z),
                    new Vec3(x, y, z), new Vec3(x, y * 0.75, z),
                    new Vec3(x, y, z), new Vec3(x, y, z * 0.75)
                ];
            });
        });
    }).flat(3);

/**
 * Splat - 3D 高斯泼溅（Gaussian Splatting）的核心数据类
 *
 * 该类封装了一个完整的 3DGS 资产，包括：
 * - PlayCanvas 的 GSplatData 原始数据（位置、旋转、缩放、颜色、球谐系数等）
 * - 编辑器状态数据（选中/锁定/删除标记）
 * - 变换调色板（批量管理每个 splat 的矩阵变换）
 * - 渲染材质参数（颜色校正、选择高亮等）
 * - 包围盒计算
 *
 * 继承自 Element，作为场景图中的可渲染元素节点存在。
 */
class Splat extends Element {
    /** PlayCanvas 资产引用，指向 .ply 文件的加载资源 */
    asset: Asset;
    /** 原始高斯泼溅数据，包含所有顶点属性和每个 splat 的信息 */
    splatData: GSplatData;
    /** 当前可见的 splat 数量（总数减去已删除的） */
    numSplats = 0;
    /** 已标记为删除的 splat 数量 */
    numDeleted = 0;
    /** 被锁定的 splat 数量 */
    numLocked = 0;
    /** 当前被选中的 splat 数量 */
    numSelected = 0;
    /** PlayCanvas 实体，挂载 gsplat 组件用于渲染 */
    entity: Entity;
    /** 变更计数器，用于序列化时判断是否有未保存的修改 */
    changedCounter = 0;
    /** 状态纹理：每个 splat 1 字节（R8 格式），保存选中/锁定/删除状态，上传到 GPU 供 shader 使用 */
    stateTexture: Texture;
    /** 变换索引纹理：每个 splat 2 字节（R16U 格式），指向变换调色板的索引 */
    transformTexture: Texture;
    /** 选中 splat 的包围盒（仅包含已选中的 splat） */
    selectionBoundStorage: BoundingBox;
    /** 局部空间包围盒（包含所有非删除的 splat） */
    localBoundStorage: BoundingBox;
    /** 世界空间包围盒 */
    worldBoundStorage: BoundingBox;

    /** 可见性标志 */
    _visible = true;
    /** 变换调色板：以查表方式管理多个 splat 的变换矩阵，节省 GPU 内存 */
    transformPalette: TransformPalette;

    /** 选择高亮的透明度（0=不可见，1=完全不透明） */
    selectionAlpha = 1;

    // ---- 颜色校正参数 ----
    _name = '';
    /** 色调乘数（RGB），用于调整整体颜色倾向 */
    _tintClr = new Color(1, 1, 1);
    /** 色温偏移：正值偏暖（红），负值偏冷（蓝），范围约 -1 到 1 */
    _temperature = 0;
    /** 饱和度调节：0=灰度，1=原始，>1=更饱和 */
    _saturation = 1;
    /** 亮度偏移：正值提亮，负值变暗 */
    _brightness = 0;
    /** 黑点：暗部阈值，低于此值的颜色被裁剪为纯黑 */
    _blackPoint = 0;
    /** 白点：亮部阈值，高于此值的颜色被裁剪为纯白 */
    _whitePoint = 1;
    /** 整体透明度：用于淡入/淡出效果 */
    _transparency = 1;

    /** 测量点列表（用于距离测量工具） */
    measurePoints: Vec3[] = [];
    /** 当前选中的测量点索引，-1 表示无选中 */
    measureSelection = -1;

    /** 重建材质着色器的回调函数，传入球谐函数带宽数（SH bands） */
    rebuildMaterial: (bands: number) => void;

    /**
     * 构建一个 Splat 实例
     * @param asset - PlayCanvas 资产对象，必须已加载完成（resource 为 GSplatResource）
     * @param rotation - 初始旋转四元数，应用于整个 splat 实体
     */
    constructor(asset: Asset, rotation: Quat) {
        super(ElementType.splat);

        // 获取已加载的 splat 资源及其底层数据
        const splatResource = asset.resource as GSplatResource;
        const splatData = splatResource.gsplatData;
        const { device } = splatResource;

        // 用文件名作为默认显示名
        this._name = (asset.file as any).filename;
        this.asset = asset;
        this.splatData = splatData as GSplatData;
        this.numSplats = splatData.numSplats;

        // 创建实体并挂载 PlayCanvas 的 gsplat 渲染组件
        this.entity = new Entity('splatEntitiy');
        this.entity.setLocalRotation(rotation);
        this.entity.addComponent('gsplat', { asset });

        const instance = this.entity.gsplat.instance;

        // 添加自定义的 per-splat 状态通道（仅当 PLY 文件中没有 'state' 属性时才创建）
        // 每字节编码 3 个标记位：
        //   bit 0: selected（选中）
        //   bit 1: locked（锁定）
        //   bit 2: deleted（删除）
        if (!this.splatData.getProp('state')) {
            this.splatData.getElement('vertex').properties.push({
                type: 'uchar',
                name: 'state',
                storage: new Uint8Array(this.splatData.numSplats),
                byteSize: 1
            });
        }

        // 添加 per-splat 变换矩阵索引通道
        // 每个 splat 占 2 字节（ushort），值为变换调色板中的索引
        // 值为 0 表示使用默认恒等变换
        this.splatData.getElement('vertex').properties.push({
            type: 'ushort',
            name: 'transform',
            storage: new Uint16Array(this.splatData.numSplats),
            byteSize: 2
        });

        // 获取 splat 纹理的尺寸（所有 splat 数据压缩存储在纹理中）
        const { x: width, y: height } = (splatResource as any).textureDimensions;

        // 创建纹理的工厂函数：使用最近邻采样（因为纹理存储的是精确数值，不需要插值）
        const createTexture = (name: string, format: number) => {
            return new Texture(device, {
                name: name,
                width: width,
                height: height,
                format: format,
                mipmaps: false,                         // 不需要 mipmap
                minFilter: FILTER_NEAREST,              // 缩小用最近邻
                magFilter: FILTER_NEAREST,              // 放大用最近邻
                addressU: ADDRESS_CLAMP_TO_EDGE,        // 水平方向边缘钳制
                addressV: ADDRESS_CLAMP_TO_EDGE         // 垂直方向边缘钳制
            });
        };

        // 创建状态纹理（R8 格式：每个像素 1 字节，对应一个 splat 的状态）
        this.stateTexture = createTexture('splatState', PIXELFORMAT_R8);
        // 创建变换纹理（R16U 格式：每个像素 2 字节，对应变换调色板索引）
        this.transformTexture = createTexture('splatTransform', PIXELFORMAT_R16U);

        // 创建变换调色板（GPU 管理的变换矩阵数组）
        this.transformPalette = new TransformPalette(device);

        // 定义材质重建函数：在球谐带宽数变化时重新编译着色器
        // 使用 GSplat 材质中自定义的 GLSL 顶点/片元着色器
        this.rebuildMaterial = (bands: number) => {
            const { material } = instance;
            const { glsl } = material.shaderChunks;
            glsl.set('gsplatVS', vertexShader);
            glsl.set('gsplatPS', fragmentShader);
            glsl.set('gsplatCenterVS', gsplatCenter);

            // SH_BANDS 宏控制球谐函数展开的阶数（1/2/3），影响颜色精度
            material.setDefine('SH_BANDS', `${Math.min(bands, (instance.resource as GSplatResource).shBands)}`);
            material.setParameter('splatState', this.stateTexture);
            material.setParameter('splatTransform', this.transformTexture);
            material.update();
        };

        // 初始化包围盒对象
        this.selectionBoundStorage = new BoundingBox();
        // 局部空间 AABB 直接引用资源的原始包围盒数据
        this.localBoundStorage = instance.resource.aabb;
        // 世界空间包围盒引用 meshInstance 的内部 AABB（PlayCanvas 内部计算值）
        // @ts-ignore
        this.worldBoundStorage = instance.meshInstance._aabb;

        // 禁用 PlayCanvas 对 meshInstance 的自动 AABB 更新
        // 因为这个 meshInstance 使用实例化 GPU 渲染（gaussian splatting），
        // PlayCanvas 默认的包围盒计算方式不适用，会被覆盖
        // @ts-ignore
        instance.meshInstance._updateAabb = false;

        // 监听排序器更新事件（当 splat 排序发生变化时触发，需要重绘场景）
        instance.sorter.on('updated', () => {
            this.changedCounter++;
        });
    }

    /**
     * 销毁 Splat 实例，释放所有 GPU 和 CPU 资源
     * 包括：实体、资产引用、资产卸载
     */
    destroy() {
        super.destroy();
        this.entity.destroy();
        this.asset.registry.remove(this.asset);
        this.asset.unload();
    }

    /**
     * 更新 splat 状态数据并同步到 GPU
     *
     * 工作流程：
     * 1. 将 CPU 端的 state 数组上传到状态纹理（GPU 可读）
     * 2. 重新统计各类 splat 的数量（选中/锁定/删除）
     * 3. 如果有 splat 被删除，重新计算排序映射；否则只更新包围盒
     *
     * @param changedState - 变更的状态掩码（来自 State 枚举），默认仅处理选中状态变更
     */
    async updateState(changedState = State.selected) {
        const state = this.splatData.getProp('state') as Uint8Array;

        // 将 CPU 端的状态数据上传到 GPU 纹理
        const data = this.stateTexture.lock();
        data.set(state);
        this.stateTexture.unlock();

        let numSelected = 0;
        let numLocked = 0;
        let numDeleted = 0;

        // 遍历所有 splat，统计各状态的数量
        for (let i = 0; i < state.length; ++i) {
            const s = state[i];
            if (s & State.deleted) {
                numDeleted++;
            } else if (s & State.locked) {
                numLocked++;
            } else if (s & State.selected) {
                numSelected++;
            }
        }

        // 有效 splat 数量 = 总数 - 已删除（已删除的 splat 不参与渲染）
        this.numSplats = state.length - numDeleted;
        this.numLocked = numLocked;
        this.numSelected = numSelected;
        this.numDeleted = numDeleted;

        // 处理 splat 增删情况：
        // - 有删除时：需要重建排序映射（排除已删除的 splat）
        // - 仅选中状态变更时：只需刷新包围盒
        if (changedState & State.deleted) {
            await this.updateSorting();
        } else {
            await this.updateLocalBounds();
        }

        // 强制重绘场景并通知事件系统
        this.scene.forceRender = true;
        this.scene.events.fire('splat.stateChanged', this);
    }

    /**
     * 更新 splat 的世界空间位置
     *
     * 在用户通过变换工具移动选中的 splat 后调用，
     * 从 GPU 读回计算后的位置数据，更新排序器的中心点信息
     */
    async updatePositions() {
        // 从数据处理器获取 GPU 计算后的最终位置（包含变换调色板的变换）
        const data = await this.scene.dataProcessor.calcPositions(this);

        // 更新渲染排序器的中心点（sorter.centers 在每帧渲染时用于计算视点排序）
        const state = this.splatData.getProp('state') as Uint8Array;
        const { sorter } = this.entity.gsplat.instance;
        const { centers } = sorter;
        for (let i = 0; i < this.splatData.numSplats; ++i) {
            if (state[i] === State.selected) {
                centers[i * 3 + 0] = data[i * 4];
                centers[i * 3 + 1] = data[i * 4 + 1];
                centers[i * 3 + 2] = data[i * 4 + 2];
            }
        }

        await this.updateSorting();

        this.scene.forceRender = true;
        this.scene.events.fire('splat.positionsChanged', this);
    }

    /**
     * 更新排序器的映射关系，排除被删除的 splat
     *
     * 当 splat 被软删除后，需要生成一个新的索引映射数组，
     * 使得排序器只处理未被删除的 splat，确保渲染正确
     */
    async updateSorting() {
        const state = this.splatData.getProp('state') as Uint8Array;

        let mapping;

        // 如果有已删除的 splat，创建一个映射排除它们
        // mapping[i] = 原始索引，表示排序结果的第 i 个元素对应原始数据中的哪个 splat
        if (this.numSplats !== state.length) {
            mapping = new Uint32Array(this.numSplats);
            let idx = 0;
            for (let i = 0; i < state.length; ++i) {
                if ((state[i] & State.deleted) === 0) {
                    mapping[idx++] = i;
                }
            }
        }

        // 应用映射到排序器（传入 null 表示无映射，使用默认 1:1 映射）
        this.entity.gsplat.instance.sorter.setMapping(mapping);

        // 排序变更后需要重新计算包围盒
        await this.updateLocalBounds();
    }

    /** 获取实体的世界变换矩阵 */
    get worldTransform() {
        return this.entity.getWorldTransform();
    }

    /** 设置名称（修改时触发事件通知 UI 更新） */
    set name(newName: string) {
        if (newName !== this.name) {
            this._name = newName;
            this.scene.events.fire('splat.name', this);
        }
    }

    get name() {
        return this._name;
    }

    /** 获取文件名（从资产中提取） */
    get filename() {
        return (this.asset.file as any).filename;
    }

    /**
     * 计算指定 splat 的世界空间位置
     *
     * 使用排序器维护的 centers 数据（而不是原始顶点位置），
     * 因为 centers 在编辑后会实时更新，反映最新的世界坐标
     *
     * @param splatId - splat 的索引号
     * @param result - 输出参数，结果写入此 Vec3
     * @returns 如果索引有效返回 true，否则返回 false
     */
    calcSplatWorldPosition(splatId: number, result: Vec3) {
        if (splatId >= this.splatData.numSplats) {
            return false;
        }

        // 从 sorter 的 centers 获取世界空间坐标
        const { sorter } = this.entity.gsplat.instance;
        const { centers } = sorter;

        result.set(
            centers[splatId * 3 + 0],
            centers[splatId * 3 + 1],
            centers[splatId * 3 + 2]
        );

        // 应用实体的世界变换（将局部空间位置变换到世界空间）
        this.worldTransform.transformPoint(result, result);

        return true;
    }

    /**
     * 将 splat 添加到场景中
     * - 挂载实体到场景内容根节点
     * - 分配到专用的 splat 渲染层（使用多渲染目标 MRT 技术）
     * - 初始化材质着色器
     * - 更新 splat 状态
     */
    async add() {
        // 将实体添加到场景根节点（scene.contentRoot）
        this.scene.contentRoot.addChild(this.entity);

        // splat 使用专用渲染层，与常规 3D 对象分离
        // 专用层由 splat 相机渲染，使用 MRT（多渲染目标）技术
        this.entity.gsplat.layers = [this.scene.splatLayer.id];

        // 注册球谐带宽变更事件（当用户切换 SH 阶数时重新编译着色器）
        this.scene.events.on('view.bands', this.rebuildMaterial, this);
        this.rebuildMaterial(this.scene.events.invoke('view.bands'));

        // 更新状态（如果从 PLY 加载的状态数据中有预设的选中/锁定/删除标记）
        await this.updateState();
    }

    /**
     * 从场景中移除 splat（不销毁数据，仅移除渲染实体）
     */
    remove() {
        this.scene.events.off('view.bands', this.rebuildMaterial, this);

        this.scene.contentRoot.removeChild(this.entity);
        this.scene.boundDirty = true;
    }

    /**
     * 序列化 splat 的元数据（用于保存项目文件 .sup 格式）
     * 注意：只序列化变换和渲染参数，不序列化原始 splat 顶点数据（顶点数据在 PLY 文件中）
     */
    serialize(serializer: Serializer) {
        serializer.packa(this.entity.getWorldTransform().data);
        serializer.pack(this.changedCounter);
        serializer.pack(this.visible);
        serializer.pack(this.tintClr.r, this.tintClr.g, this.tintClr.b);
        serializer.pack(this.temperature, this.saturation, this.brightness, this.blackPoint, this.whitePoint, this.transparency);
    }

    /**
     * 每帧渲染前调用，设置 GPU 材质参数
     *
     * 负责设置：
     * - 轮廓/环状选择效果
     * - 选中/未选中/锁定的颜色
     * - 颜色校正参数（黑点、白点、亮度、色调、色温、饱和度）
     * - 变换调色板纹理
     * - 渲染包围盒线框（当选中且有显示设置时）
     */
    onPreRender() {
        const events = this.scene.events;
        const selected = this.scene.camera.renderOverlays && events.invoke('selection') === this;
        const cameraMode = events.invoke('camera.mode');
        const cameraOverlay = events.invoke('camera.overlay');

        // 配置环状选择效果渲染
        const material = this.entity.gsplat.instance.material;
        // outlineMode: 0=正常颜色渲染, 1=仅显示轮廓
        material.setParameter('outlineMode', events.invoke('view.outlineSelection') ? 1 : 0);
        // ringSize: 在环形视图模式下绘制选择环，否则为 0
        material.setParameter('ringSize', (selected && cameraOverlay && cameraMode === 'rings') ? 0.04 : 0);

        // 获取各类 splat 的颜色配置
        const selectedClr = events.invoke('selectedClr');
        const unselectedClr = events.invoke('unselectedClr');
        const lockedClr = events.invoke('lockedClr');

        // 设置选择颜色：
        // - 未选中：透明
        // - 轮廓模式：透明（轮廓由 outline shader 单独绘制）
        // - 正常模式：使用配置的选中颜色
        if (!selected) {
            material.setParameter('selectedClr', [0, 0, 0, 0]);
        } else if (events.invoke('view.outlineSelection')) {
            material.setParameter('selectedClr', [0, 0, 0, 0]);
        } else {
            material.setParameter('selectedClr', [selectedClr.r, selectedClr.g, selectedClr.b, selectedClr.a * this.selectionAlpha]);
        }
        material.setParameter('unselectedClr', [unselectedClr.r, unselectedClr.g, unselectedClr.b, unselectedClr.a]);
        material.setParameter('lockedClr', [lockedClr.r, lockedClr.g, lockedClr.b, lockedClr.a]);

        // 计算颜色校正的偏移和缩放参数
        // offset = -黑点 + 亮度偏移
        // scale = 1 / (白点 - 黑点)，实现色阶拉伸
        const offset = -this.blackPoint + this.brightness;
        const scale = 1 / (this.whitePoint - this.blackPoint);

        material.setParameter('clrOffset', [offset, offset, offset]);
        material.setParameter('clrScale', [
            scale * this.tintClr.r * (1 + this.temperature),  // 红色通道：暖色增强
            scale * this.tintClr.g,                             // 绿色通道：不受色温影响
            scale * this.tintClr.b * (1 - this.temperature),    // 蓝色通道：冷色增强
            this.transparency                                     // 整体透明度
        ]);

        material.setParameter('saturation', this.saturation);
        // 变换调色板纹理：shader 通过 splat 索引查表获取变换矩阵
        material.setParameter('transformPalette', this.transformPalette.texture);

        // 绘制选定 splat 的包围盒线框
        if (this.visible && selected) {
            if (events.invoke('camera.bound')) {
                const bound = this.localBound;
                // 构造变换矩阵：将单位包围盒缩放到实际包围盒大小，然后变换到世界空间
                const scale = new Mat4().setTRS(bound.center, Quat.IDENTITY, bound.halfExtents);
                scale.mul2(this.entity.getWorldTransform(), scale);

                // 绘制 12 条棱（每条棱用 2 个端点表示，共 24 个点 = 12 对）
                for (let i = 0; i < boundingPoints.length / 2; i++) {
                    const a = boundingPoints[i * 2];
                    const b = boundingPoints[i * 2 + 1];
                    scale.transformPoint(a, veca);
                    scale.transformPoint(b, vecb);

                    this.scene.app.drawLine(veca, vecb, Color.WHITE, true, this.scene.worldLayer);
                }
            }
        }

        this.entity.enabled = this.visible;
    }

    /**
     * 获取相机焦点的参考点位置
     * 使用世界包围盒的中心点，而不是按 splat 密度加权的中心点
     */
    focalPoint() {
        // GSplatData 内置了计算加权平均位置的方法，但这里使用包围盒中心
        return this.worldBound.center;
    }

    /**
     * 移动/旋转/缩放整个 splat 实体
     *
     * @param position - 新的局部位置（Vec3，可选）
     * @param rotation - 新的局部旋转（Quat，可选）
     * @param scale - 新的局部缩放（Vec3，可选）
     */
    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        const entity = this.entity;
        if (position) {
            entity.setLocalPosition(position);
        }
        if (rotation) {
            entity.setLocalRotation(rotation);
        }
        if (scale) {
            entity.setLocalScale(scale);
        }

        this.updateWorldBound();

        this.scene.events.fire('splat.moved', this);
    }

    /**
     * 更新局部包围盒（异步，需要 GPU 读回数据）
     *
     * 通过数据处理器从 GPU 计算选中 splat 的包围盒和全部 splat 的包围盒，
     * 然后基于局部包围盒更新世界包围盒
     */
    async updateLocalBounds(): Promise<void> {
        await this.scene.dataProcessor.calcBound(this, this.selectionBoundStorage, this.localBoundStorage);
        this.updateWorldBound();
    }

    /**
     * 从局部包围盒更新世界包围盒（同步方法）
     *
     * 将通过实体世界变换矩阵将局部 AABB 变换到世界空间，
     * 得到世界空间包围盒，并标记场景包围盒需要更新
     */
    private updateWorldBound() {
        this.worldBoundStorage.setFromTransformedAabb(this.localBoundStorage, this.entity.getWorldTransform());
        this.scene.boundDirty = true;
    }

    /** 获取选中 splat 的包围盒（局部空间） */
    get selectionBound() {
        return this.selectionBoundStorage;
    }

    /** 获取所有 splat 的包围盒（局部空间） */
    get localBound() {
        return this.localBoundStorage;
    }

    /** 获取世界空间包围盒 */
    get worldBound() {
        return this.worldBoundStorage;
    }

    /** 设置可见性（触发事件通知 UI） */
    set visible(value: boolean) {
        if (value !== this.visible) {
            this._visible = value;
            this.scene?.events.fire('splat.visibility', this);
        }
    }

    get visible() {
        return this._visible;
    }

    /** 设置色调颜色（触发事件通知 UI） */
    set tintClr(value: Color) {
        if (!this._tintClr.equals(value)) {
            this._tintClr.set(value.r, value.g, value.b);
            this.scene.events.fire('splat.tintClr', this);
        }
    }

    get tintClr() {
        return this._tintClr;
    }

    /** 设置色温（触发事件通知 UI） */
    set temperature(value: number) {
        if (value !== this._temperature) {
            this._temperature = value;
            this.scene.events.fire('splat.temperature', this);
        }
    }

    get temperature() {
        return this._temperature;
    }

    /** 设置饱和度（触发事件通知 UI） */
    set saturation(value: number) {
        if (value !== this._saturation) {
            this._saturation = value;
            this.scene.events.fire('splat.saturation', this);
        }
    }

    get saturation() {
        return this._saturation;
    }

    /** 设置亮度（触发事件通知 UI） */
    set brightness(value: number) {
        if (value !== this._brightness) {
            this._brightness = value;
            this.scene.events.fire('splat.brightness', this);
        }
    }

    get brightness() {
        return this._brightness;
    }

    /** 设置黑点（触发事件通知 UI） */
    set blackPoint(value: number) {
        if (value !== this._blackPoint) {
            this._blackPoint = value;
            this.scene.events.fire('splat.blackPoint', this);
        }
    }

    get blackPoint() {
        return this._blackPoint;
    }

    /** 设置白点（触发事件通知 UI） */
    set whitePoint(value: number) {
        if (value !== this._whitePoint) {
            this._whitePoint = value;
            this.scene.events.fire('splat.whitePoint', this);
        }
    }

    get whitePoint() {
        return this._whitePoint;
    }

    /** 设置透明度（触发事件通知 UI） */
    set transparency(value: number) {
        if (value !== this._transparency) {
            this._transparency = value;
            this.scene.events.fire('splat.transparency', this);
        }
    }

    get transparency() {
        return this._transparency;
    }

    /**
     * 获取变换轴心点的位置、旋转和缩放
     *
     * 两种模式：
     * - 'center'：使用实体自身的变换作为轴心
     * - 'boundCenter'：使用包围盒中心作为轴心
     *
     * @param mode - 'center' 实体中心 | 'boundCenter' 包围盒中心
     * @param selection - true=仅选中 splat 的包围盒 | false=全部 splat 的包围盒
     * @param result - 输出参数，结果写入此 Transform
     */
    getPivot(mode: 'center' | 'boundCenter', selection: boolean, result: Transform) {
        const { entity } = this;
        switch (mode) {
            case 'center':
                // 轴心 = 实体自身的局部位置
                result.set(entity.getLocalPosition(), entity.getLocalRotation(), entity.getLocalScale());
                break;
            case 'boundCenter': {
                const bound = selection ? this.selectionBound : this.localBound;
                // 将局部空间的包围盒中心变换到局部空间（通过实体的局部变换）
                // 这里 entity.getLocalTransform() 返回的是局部变换矩阵
                entity.getLocalTransform().transformPoint(bound.center, vec);
                result.set(vec, entity.getLocalRotation(), entity.getLocalScale());
                break;
            }
        }
    }

    /**
     * 序列化为可保存的文档对象（用于 .sup 项目文件）
     * 返回纯 JS 对象，包含所有需要持久化的 splat 元数据
     */
    docSerialize() {
        const pack3 = (v: Vec3) => [v.x, v.y, v.z];
        const pack4 = (q: Quat) => [q.x, q.y, q.z, q.w];
        const packC = (c: Color) => [c.r, c.g, c.b, c.a];
        return {
            name: this.name,
            position: pack3(this.entity.getLocalPosition()),
            rotation: pack4(this.entity.getLocalRotation()),
            scale: pack3(this.entity.getLocalScale()),
            visible: this.visible,
            tintClr: packC(this.tintClr),
            temperature: this.temperature,
            saturation: this.saturation,
            brightness: this.brightness,
            blackPoint: this.blackPoint,
            whitePoint: this.whitePoint,
            transparency: this.transparency
        };
    }

    /**
     * 从文档对象反序列化恢复 splat 状态
     * @param doc - docSerialize 生成的纯 JS 对象
     */
    docDeserialize(doc: any) {
        const { name, position, rotation, scale, visible, tintClr, temperature, saturation, brightness, blackPoint, whitePoint, transparency } = doc;

        this.name = name;
        this.move(new Vec3(position), new Quat(rotation), new Vec3(scale));
        this.visible = visible;
        this.tintClr = new Color(tintClr[0], tintClr[1], tintClr[2], tintClr[3]);
        this.temperature = temperature ?? 0;
        this.saturation = saturation ?? 1;
        this.brightness = brightness;
        this.blackPoint = blackPoint;
        this.whitePoint = whitePoint;
        this.transparency = transparency;
    }
}

export { Splat };
