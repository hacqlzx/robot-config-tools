/**
 * infinite-grid.ts - 无限网格模块
 *
 * @file 使用自定义着色器渲染一个无限延伸的参考网格，帮助用户在 3D 空间中感知位置和比例。
 * 网格被渲染在世界图层中（Gizmo 和场景物体之间），通过全屏四边形（QuadRender）实现，
 * 着色器根据相机位置和投影矩阵实时计算网格线的屏幕位置。
 *
 * 技术原理：
 *   - 使用一个覆盖全屏的四边形（QuadRender），在片元着色器中通过视线计算与世界空间的交点
 *   - 根据交点位置和空间划分逻辑绘制网格线
 *   - 这种方法的优势：无论相机多远都能看到网格（"无限"），没有传统的网格边界
 *   - 类似于 Blender、Unity 中的无限参考平面
 *
 * 渲染时机：
 *   - 在每帧世界图层的不透明通道渲染前执行（preRenderLayer 事件）
 *   - 仅在世界图层且透明通道为 false 时渲染
 *   - 相机覆盖层（renderOverlays）必须启用（默认始终启用）
 *
 * 正交投影支持：
 *   - 根据相机的朝向方向自动选择对应的参考平面
 *   - 看向 X 轴 → YZ 平面（plane=0）
 *   - 看向 -Z 轴（默认） → XY 平面（plane=1，也是默认平面）
 *   - 看向 Y 轴 → XZ 平面（plane=2）
 */
import {
    BLENDMODE_ONE,
    BLENDMODE_ONE_MINUS_SRC_ALPHA,
    BLENDMODE_SRC_ALPHA,
    BLENDEQUATION_ADD,
    CULLFACE_NONE,
    FUNC_LESSEQUAL,
    SEMANTIC_POSITION,
    BlendState,
    DepthState,
    Layer,
    QuadRender,
    ScopeSpace,
    Shader,
    ShaderUtils,
    Vec3,
    Mat4
} from 'playcanvas';

import { Element, ElementType } from './element';
import { Serializer } from './serializer';
import { vertexShader, fragmentShader } from './shaders/infinite-grid-shader';

/**
 * 批量设置着色器的 Uniform 变量（uniform 参数）
 *
 * 这是一个辅助函数，遍历 values 对象的键值对，
 * 在给定的 scope 中查找对应的 Shader Uniform，并逐一设置其值。
 *
 * 在 PlayCanvas 中，Shader 的 uniform 变量通过 ScopeSpace 管理。
 * 每个 uniform 变量在 scope 中有一个对应的 ScopeId，
 * 通过 resolve() 获取 ScopeId，然后调用 setValue() 设置值。
 *
 * @param scope - PlayCanvas 的 ScopeSpace 实例，管理着色器的全局参数
 * @param values - 键值对对象，键是 uniform 变量名，值是要设置的新值
 *   如 { plane: 1, view_position: [0,0,0], matrix_viewProjection: mat4.data }
 */
const resolve = (scope: ScopeSpace, values: any) => {
    for (const key in values) {
        scope.resolve(key).setValue(values[key]);
    }
};

/**
 * InfiniteGrid 类 — 无限参考网格
 *
 * 继承自 Element 基类，类型为 'debug'（调试/辅助元素）。
 * 在场景的世界图层中渲染一个无限延伸的参考平面网格，
 * 帮助用户在编辑 3D Gaussian Splatting 对象时感知空间方位。
 *
 * 属性说明：
 *   - shader:      自定义着色器程序（vertex + fragment）
 *   - quadRender:  全屏四边形渲染器，触发片元着色器对每个屏幕像素执行
 *   - blendState:  混合状态（用于网格的透明度混合）
 *   - depthState:  深度测试状态（LESSEQUAL + 写入深度）
 *   - visible:     网格的可见性开关
 */
class InfiniteGrid extends Element {
    /** 网格的顶点/片元着色器 */
    shader: Shader;
    /** 全屏四边形渲染器 */
    quadRender: QuadRender;
    /** 混合状态：决定网格颜色如何与场景已有像素混合 */
    blendState = new BlendState(false);
    /** 深度状态：FUNC_LESSEQUAL 使网格在已有物体的前方或等深处都可见 */
    depthState = new DepthState(FUNC_LESSEQUAL, true);

    /** 网格可见性开关（true 显示，false 隐藏） */
    visible = true;

    constructor() {
        super(ElementType.debug);
    }

    /**
     * 初始化网格效果
     *
     * 创建着色器程序、全屏四边形渲染器，并在相机上注册渲染回调。
     * 此方法在 Element 被添加到场景时调用。
     *
     * 流程：
     *   1. 编译顶点/片元着色器 → Shader 对象
     *   2. 创建 QuadRender 实例（使用该 Shader）
     *   3. 配置混合模式和深度状态
     *   4. 监听相机 preRenderLayer 事件，在正确的时机渲染网格
     */
    add() {
        const device = this.scene.app.graphicsDevice;

        // 使用 PlayCanvas 的 ShaderUtils 编译 GLSL 着色器
        // uniqueName: GPU 调试工具中的标识名
        // vertexGLSL/fragmentGLSL: 从外部文件导入的 GLSL 源代码
        this.shader = ShaderUtils.createShader(device, {
            uniqueName: 'infinite-grid',
            attributes: {
                vertex_position: SEMANTIC_POSITION  // 顶点位置属性
            },
            vertexGLSL: vertexShader,
            fragmentGLSL: fragmentShader
        });

        // 创建全屏四边形渲染器
        // QuadRender 渲染一个覆盖整个屏幕的矩形（两个三角形）
        // 每个像素都会执行一次片元着色器，在片元着色器中计算网格
        this.quadRender = new QuadRender(this.shader);

        /**
         * 创建混合状态 — 设置 GPU 的 Alpha 混合模式
         *
         * BLENDEQUATION_ADD: 加法混合公式
         * BLENDMODE_SRC_ALPHA: 源混合因子 = 源 Alpha
         * BLENDMODE_ONE_MINUS_SRC_ALPHA: 目标混合因子 = 1 - 源 Alpha
         * 最终颜色 = srcAlpha * srcColor + (1 - srcAlpha) * dstColor
         * 这是标准的 Alpha 混合，实现网格线的半透明效果
         *
         * 第二个混合状态（BLENDMODE_ONE / BLENDMODE_ONE_MINUS_SRC_ALPHA）控制
         * Alpha 通道本身的混合方式
         */
        const blendState = new BlendState(
            true,
            BLENDEQUATION_ADD, BLENDMODE_SRC_ALPHA, BLENDMODE_ONE_MINUS_SRC_ALPHA,
            BLENDEQUATION_ADD, BLENDMODE_ONE, BLENDMODE_ONE_MINUS_SRC_ALPHA
        );

        // 相机位置缓存数组（避免每帧创建新数组）
        const view_position = [0, 0, 0];
        const viewProjectionMatrix = new Mat4();
        let plane;

        /**
         * PlayCanvas 相机事件：preRenderLayer
         *
         * 在相机开始渲染某个图层之前触发。
         * 我们在此设置网格着色器的 uniform 变量并执行渲染。
         *
         * @param layer - 即将渲染的图层对象
         * @param transparent - 是否正在渲染透明通道（false = 不透明通道）
         */
        this.scene.camera.camera.on('preRenderLayer', (layer: Layer, transparent: boolean) => {
            const { scene } = this;

            // 渲染条件检查：
            // 1. 网格必须可见
            // 2. 必须是世界图层（而非 Gizmo 图层）
            // 3. 必须是不透明通道（网格在不透明通道渲染，位于场景物体之前）
            // 4. 相机覆盖层必须启用
            if (this.visible && layer === scene.worldLayer && !transparent && scene.camera.renderOverlays) {
                const { camera } = scene;

                // 设置 GPU 管线状态
                device.setBlendState(blendState);         // Alpha 混合模式
                device.setCullMode(CULLFACE_NONE);        // 禁用面剔除（渲染四边形两面）
                device.setDepthState(DepthState.WRITEDEPTH); // 写入深度缓冲
                device.setStencilState(null, null);       // 禁用模板测试

                /**
                 * 正交投影模式下选择正确的参考平面
                 *
                 * 在正交投影中，相机朝向决定了应该显示哪个参考平面。
                 * 通过比较相机朝向向量与世界坐标轴来确定平面：
                 *
                 *   cmp 函数：检查向量 a 和 b 是否平行（点积的绝对值接近 1.0）
                 *   - 看向 X 轴方向 → plane = 0（YZ 平面，如三视图的"前视图"）
                 *   - 看向 -Z 轴方向 → plane = 2（XY 平面，如"顶视图"）
                 *   - 默认（看向 Y 轴或其它） → plane = 1（XZ 平面，如"透视图"中的地面）
                 */
                if (camera.ortho) {
                    // cmp: 检查两个向量是否平行
                    // 1.0 - |dot(a, b)| < 1e-03 → 差值小于千分之一时认为平行
                    const cmp = (a:Vec3, b: Vec3) => 1.0 - Math.abs(a.dot(b)) < 1e-03;
                    // camera.worldTransform.getZ() 获取相机世界空间中的朝向（Z 轴方向）
                    const z = camera.worldTransform.getZ();
                    plane = cmp(z, Vec3.RIGHT) ? 0 : (cmp(z, Vec3.BACK) ? 2 : 1);
                } else {
                    // 透视投影中默认使用 XZ 平面（水平地面）
                    // 这是最常见的视角下的参考平面
                    plane = 1;
                }

                // 获取相机在世界空间中的位置
                const p = camera.position;
                view_position[0] = p.x;
                view_position[1] = p.y;
                view_position[2] = p.z;

                /**
                 * 计算视图投影矩阵
                 *
                 * viewProjectionMatrix = projectionMatrix × viewMatrix
                 * 这是 GPU 渲染管道中从世界空间变换到裁剪空间的核心矩阵。
                 *
                 * camera.camera.projectionMatrix: 投影矩阵（透视/正交）
                 * camera.camera.viewMatrix: 视图矩阵（相机的位置和朝向）
                 * mul2: 将两个矩阵相乘，结果存入 viewProjectionMatrix
                 *
                 * 在着色器中，此矩阵用于将世界空间坐标转换到屏幕空间，
                 * 从而实现准确的网格透视效果。
                 */
                viewProjectionMatrix.mul2(camera.camera.projectionMatrix, camera.camera.viewMatrix);

                // 批量设置着色器的 uniform 变量
                resolve(device.scope, {
                    plane,                                      // 参考平面索引（0=YZ, 1=XZ, 2=XY）
                    view_position,                              // 相机世界空间位置 [x, y, z]
                    matrix_viewProjection: viewProjectionMatrix.data  // 视图投影矩阵（16 个 float）
                });

                // 绘制全屏四边形，触发片元着色器执行
                this.quadRender.render();
            }
        });
    }

    /**
     * 移除网格效果
     *
     * 销毁着色器和四边形渲染器，释放 GPU 资源。
     * 事件监听器在相机销毁时自动清理，无需手动处理。
     */
    remove() {
        this.shader.destroy();
        this.quadRender.destroy();
    }

    /**
     * 序列化网格数据
     *
     * 将网格的可见性状态打包到文档数据中，以便保存和恢复。
     *
     * @param serializer - 序列化器实例，用于打包数据
     */
    serialize(serializer: Serializer): void {
        serializer.pack(this.visible);
    }
}

export { InfiniteGrid };
