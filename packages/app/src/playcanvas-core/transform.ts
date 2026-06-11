/**
 * 三维空间变换类（Transform）
 * 
 * 核心功能：
 * - 封装位置（position）、旋转（rotation）、缩放（scale）三个分量
 * - 位置使用 Vec3（三维向量），缩放使用 Vec3（各轴独立缩放）
 * - 旋转使用 Quat（四元数），避免欧拉角的万向节锁问题
 * 
 * 设计说明：
 * - 这是一个纯粹的数据容器 + 工具方法类，不涉及矩阵运算
 * - 提供 copy（拷贝）、clone（克隆）、equals（精确相等）、equalsApprox（近似相等）等方法
 * - 广泛应用于场景元素的位姿管理
 */

import { Quat, Vec3 } from 'playcanvas';

class Transform {
    /** 位置向量，默认原点 (0, 0, 0) */
    position = new Vec3();
    /** 旋转四元数，默认无旋转（单位四元数） */
    rotation = new Quat();
    /** 缩放向量，默认各轴缩放为 1 */
    scale = new Vec3(1, 1, 1);

    /**
     * 构造一个 Transform 实例
     * @param position - 可选，初始位置（Vec3），不传则默认为原点
     * @param rotation - 可选，初始旋转（Quat），不传则为单位四元数
     * @param scale - 可选，初始缩放（Vec3），不传则为 (1,1,1)
     */
    constructor(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        this.set(position, rotation, scale);
    }

    /**
     * 设置变换的各个分量
     * @param position - 可选，要设置的位置
     * @param rotation - 可选，要设置的旋转
     * @param scale - 可选，要设置的缩放
     * 
     * 设计：只有传入对应参数时才会更新该分量，方便局部更新
     */
    set(position?: Vec3, rotation?: Quat, scale?: Vec3) {
        if (position) {
            this.position.copy(position);
        }
        if (rotation) {
            this.rotation.copy(rotation);
        }
        if (scale) {
            this.scale.copy(scale);
        }
    }

    /**
     * 从另一个 Transform 拷贝所有分量
     * @param transform - 源 Transform 对象
     */
    copy(transform: Transform) {
        this.position.copy(transform.position);
        this.rotation.copy(transform.rotation);
        this.scale.copy(transform.scale);
    }

    /**
     * 深拷贝当前 Transform，返回一个完全相同的新实例
     * @returns 新的 Transform 实例
     */
    clone() {
        return new Transform(this.position.clone(), this.rotation.clone(), this.scale.clone());
    }

    /**
     * 精确比较两个 Transform 是否完全相等
     * @param transform - 要比较的 Transform
     * @returns 三个分量都相等时返回 true
     */
    equals(transform: Transform) {
        return this.position.equals(transform.position) &&
               this.rotation.equals(transform.rotation) &&
               this.scale.equals(transform.scale);
    }

    /**
     * 近似比较两个 Transform（用于浮点数容差比较）
     * @param transform - 要比较的 Transform
     * @param epsilon - 容差值，默认 1e-6
     * @returns 三个分量都在容差范围内时返回 true
     */
    equalsApprox(transform: Transform, epsilon = 1e-6) {
        return this.position.equalsApprox(transform.position, epsilon) &&
               this.rotation.equalsApprox(transform.rotation, epsilon) &&
               this.scale.equalsApprox(transform.scale, epsilon);
    }

    /**
     * 直接与原始 Vec3/Quat 分量比较（精确）
     * @param position - 要比较的位置
     * @param rotation - 要比较的旋转
     * @param scale - 要比较的缩放
     */
    equalsTRS(position: Vec3, rotation: Quat, scale: Vec3) {
        return this.position.equals(position) &&
               this.rotation.equals(rotation) &&
               this.scale.equals(scale);
    }

    /**
     * 直接与原始 Vec3/Quat 分量比较（近似）
     * @param position - 要比较的位置
     * @param rotation - 要比较的旋转
     * @param scale - 要比较的缩放
     * @param epsilon - 容差值，默认 1e-6
     */
    equalsApproxTRS(position: Vec3, rotation: Quat, scale: Vec3, epsilon = 1e-6) {
        return this.position.equalsApprox(position, epsilon) &&
               this.rotation.equalsApprox(rotation, epsilon) &&
               this.scale.equalsApprox(scale, epsilon);
    }
}

export { Transform };
