/**
 * transform-palette.ts - 变换矩阵调色板
 *
 * @file 使用 GPU 纹理作为存储后端，高效管理大量 3x4 变换矩阵。
 * 这是一个关键的基础设施组件，用于在 GPU 着色器中批量访问变换数据。
 *
 * 核心设计：
 *   1. 将变换矩阵存储为 RGBA32F 格式的浮点纹理（每个像素 4 个 float32 通道）
 *   2. 每个 3x4 矩阵占用 3 个像素（12 个 float 值）
 *   3. 索引 0 始终为单位矩阵（恒等变换）
 *   4. 支持动态扩容（纹理高度翻倍）
 *   5. 提供简单的 alloc/free 接口管理矩阵槽位
 *
 * 数据布局说明：
 *   - 纹理宽度固定为 512 * 3 = 1536 像素（每行存储 512 个矩阵）
 *   - 每个矩阵占用 12 个连续的 float 值
 *   - 矩阵数据以转置后的 3x4 形式存储（适配 GPU 的内存读取模式）
 *   - idx 数组定义了从 Mat4（4x4，列主序）到纹理中 3x4（行主序）的映射关系
 *
 * 为什么用纹理而不是普通数组？
 *   - GPU 着色器可以直接采样纹理来读取变换数据
 *   - 支持上百万个矩阵的高效存储和访问
 *   - 动态扩容时只需重建纹理，旧数据自动迁移
 */
import {
    ADDRESS_CLAMP_TO_EDGE,
    PIXELFORMAT_RGBA32F,
    GraphicsDevice,
    Mat4,
    Texture
} from 'playcanvas';

/**
 * 索引映射数组：将 PlayCanvas Mat4（4x4，列主序存储）映射到纹理中的 3x4 布局
 *
 * Mat4 的数据存储在 data 数组中（列主序，即按列排列）：
 *   data = [col0x, col0y, col0z, col0w, col1x, col1y, col1z, col1w, col2x, col2y, col2z, col2w, col3x, col3y, col3z, col3w]
 *
 * idx 数组定义了从纹理读取/写入时的索引映射：
 *   dst[idx[i]] = texture_data[index * 12 + i]  // 读取时
 *   即：纹理中的第 i 个 float → Mat4 data 的第 idx[i] 个位置
 *
 * 映射关系（将行主序的纹理数据转为 Mat4 的列主序）：
 *   纹理[0]  → Mat4.data[0]   (列0 行0)
 *   纹理[1]  → Mat4.data[4]   (列1 行0)
 *   纹理[2]  → Mat4.data[8]   (列2 行0)
 *   纹理[3]  → Mat4.data[12]  (列3 行0)
 *   纹理[4]  → Mat4.data[1]   (列0 行1)
 *   ...以此类推
 */
const idx = [
    0, 4, 8, 12,
    1, 5, 9, 13,
    2, 6, 10, 14
];

// 纹理宽度 = 每行 512 个矩阵 × 每个矩阵 3 个像素（RGB 各4通道 = 12个float = 3个RGBA像素）
// 512 是一行中可存储的矩阵数量上限
const width = 512 * 3;

/**
 * TransformPalette 类 — 变换矩阵调色板
 *
 * 使用浮点纹理（RGBA32F）存储大量 3x4 变换矩阵，供 GPU 着色器采样使用。
 * 每个矩阵以非透视（不含投影）的 3x4 形式存储，即只存前三行和第四列（平移分量）。
 *
 * 接口说明：
 *   - getTransform(index, transform): 从索引 index 读取矩阵数据到 transform
 *   - setTransform(index, transform): 将 transform 的矩阵数据写入索引 index（并上传到 GPU）
 *   - alloc(num): 分配 num 个连续矩阵槽位，返回起始索引
 *   - free(num): 释放最后分配的 num 个槽位
 *   - texture: 只读属性，获取包含所有矩阵数据的 GPU 纹理
 */
class TransformPalette {
    /**
     * 从调色板读取第 index 个矩阵到给定的 Mat4 对象
     * @param index - 矩阵在调色板中的槽位索引
     * @param transform - 接收矩阵数据的 Mat4 对象（会被修改）
     */
    getTransform: (index: number, transform: Mat4) => void;

    /**
     * 将 Mat4 矩阵写入调色板的第 index 个槽位
     * 调用后自动上传纹理到 GPU（texture.upload()）
     * @param index - 矩阵在调色板中的槽位索引
     * @param transform - 要写入的 Mat4 矩阵
     */
    setTransform: (index: number, transform: Mat4) => void;

    /**
     * 分配矩阵槽位
     * 如果剩余空间不足，自动扩容（纹理高度翻倍）
     * @param num - 要分配的槽位数量，默认为 1
     * @returns 第一个槽位的索引（即分配的起始索引）
     */
    alloc: (num?: number) => number;

    /**
     * 释放最后分配的矩阵槽位
     * 注意：仅回退 nextIdx 指针，不清理数据；下次 alloc 时会覆盖
     * @param num - 要释放的槽位数量，默认为 1
     */
    free: (num?: number) => void;

    /** 存储所有矩阵数据的 GPU 纹理（只读访问） */
    texture: Texture;

    /**
     * @param device - PlayCanvas GraphicsDevice 实例（WebGL/WebGPU 设备抽象）
     * @param initialSize - 初始槽位数量，默认 4096
     *   会影响纹理的初始高度（height = ceil(initialSize / 512)）
     */
    constructor(device: GraphicsDevice, initialSize = 4096) {
        let texture: Texture;
        let data: Float32Array;

        /**
         * 重新分配存储纹理
         *
         * 当槽位用尽时，创建一个更大的纹理并迁移旧数据。
         * 扩容策略：高度翻倍（texture.height * 2），宽度保持不变。
         *
         * @param width - 新纹理宽度（始终为 512*3 = 1536）
         * @param height - 新纹理高度（槽位数量 / 512 向上取整）
         */
        const realloc = (width: number, height: number) => {
            // 创建新的 RGBA32F 纹理
            // RGBA32F: 每个像素 4 个通道，每个通道都是 32 位浮点数（float32）
            // mipmaps: false — 不需要 mipmap，因为我们是数据纹理不是颜色纹理
            // ADDRESS_CLAMP_TO_EDGE: 纹理坐标超出 [0,1] 时截断到边缘，防止采样错误
            const newTexture = new Texture(device, {
                name: 'transformPalette',
                width,
                height,
                format: PIXELFORMAT_RGBA32F,
                mipmaps: false,
                addressU: ADDRESS_CLAMP_TO_EDGE,
                addressV: ADDRESS_CLAMP_TO_EDGE
            });

            // lock() 返回 Float32Array，直接映射到 GPU 纹理内存（零拷贝）
            // unlock() 释放映射
            const newData = newTexture.lock() as Float32Array;
            newTexture.unlock();

            // 如果存在旧纹理，将旧数据复制到新纹理（扩容场景）
            if (texture) {
                newData.set(data);  // Float32Array.set() 高效批量复制

                texture.destroy();  // 销毁旧纹理，释放 GPU 内存
            }

            texture = newTexture;
            data = newData;
        };

        /**
         * 读取变换矩阵
         *
         * 从纹理数据的第 index 个槽位中读取 12 个 float 值，
         * 通过 idx 映射表还原为 Mat4 的列主序格式。
         *
         * 注意：只读取前 12 个值（3x4 矩阵），Mat4 其余 4 个元素保持原有值。
         */
        this.getTransform = (index: number, transform: Mat4) => {
            const dst = transform.data;
            for (let i = 0; i < 12; ++i) {
                dst[idx[i]] = data[index * 12 + i];
            }
        };

        /**
         * 写入变换矩阵
         *
         * 将 Mat4 的 12 个关键元素（前三行的 4 列）通过 idx 映射表
         * 转置写入纹理数据，然后上传到 GPU。
         */
        this.setTransform = (index: number, transform: Mat4) => {
            const src = transform.data;
            for (let i = 0; i < 12; ++i) {
                data[index * 12 + i] = src[idx[i]];
            }

            // 上传修改后的纹理数据到 GPU 显存
            texture.upload();
        };

        // 下一个可用槽位的索引。索引 0 被保留为恒等矩阵。
        let nextIdx = 1;

        /**
         * 分配矩阵槽位
         *
         * 当 nextIdx + num 超出当前纹理容量时，自动扩容。
         * 数据长度 / 12 = 当前可容纳的矩阵数量上限。
         * 扩容触发条件：nextIdx + num > data.length / 12
         */
        this.alloc = (num = 1) => {
            const result = nextIdx;

            // 空间不足则扩容：纹理高度翻倍
            while (nextIdx + num > data.length / 12) {
                realloc(width, texture.height * 2);
            }

            nextIdx += num;

            return result;
        };

        /**
         * 释放矩阵槽位
         *
         * 简单地回退 nextIdx 指针。不清理旧数据（会被下次 alloc 覆盖）。
         * 注意：此方法不释放 GPU 内存（纹理大小不变）。
         */
        this.free = (num = 1) => {
            nextIdx -= num;
        };

        // 定义只读属性 texture，通过 getter 返回内部纹理引用
        Object.defineProperty(this, 'texture', { get() {
            return texture;
        } });

        // 分配初始存储空间
        // 纹理高度 = ceil(initialSize / 512)，即每行 512 个矩阵的倍数
        realloc(width, Math.ceil(initialSize / (width / 3)));

        // 初始化索引 0 为恒等矩阵（Mat4.IDENTITY 是一个静态常量，值为 4x4 单位矩阵）
        this.setTransform(0, Mat4.IDENTITY);
    }
}

export { TransformPalette };
