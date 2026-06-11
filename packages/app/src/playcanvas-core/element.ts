/**
 * 场景元素基类（Element）
 * 
 * 核心设计：
 * - 场景中所有对象（3D模型、Splat点云、相机、阴影等）都继承自此类
 * - 提供统一的生命周期回调（add/remove、update、render 前后等）
 * - 每个元素有唯一 UID，通过自增计数器生成
 * - 采用模板方法模式：子类重写钩子方法实现具体行为
 * 
 * 元素类型说明：
 * - camera: 摄像机
 * - model:  3D模型
 * - splat:  Gaussian Splatting 点云（核心元素类型）
 * - shadow: 阴影相关
 * - debug:  调试用元素
 * - other:  其他类型
 */
import { BoundingBox, Quat, Vec3 } from 'playcanvas';

import { Serializer } from './serializer';

/** 枚举：场景中的元素类型 */
enum ElementType {
    camera = 'camera',
    model = 'model',
    splat = 'splat',
    pointcloud = 'pointcloud',
    shadow = 'shadow',
    debug = 'debug',
    other = 'other'
}

/** 用于迭代的所有元素类型列表 */
const ElementTypeList = [
    ElementType.camera,
    ElementType.model,
    ElementType.splat,
    ElementType.pointcloud,
    ElementType.shadow,
    ElementType.debug,
    ElementType.other
];

/** 全局自增 UID 计数器，确保每个元素有唯一的标识号 */
let nextUid = 1;

class Element {
    /** 元素类型 */
    type: ElementType;
    /** 所属的场景引用，初始为 null（尚未添加到场景时） */
    scene: any = null;
    /** 元素的唯一标识 ID */
    uid: number;

    /**
     * 构造元素实例
     * @param type - 元素类型，决定其行为和渲染方式
     */
    constructor(type: ElementType) {
        this.type = type;
        this.uid = nextUid++;
    }

    /** 销毁此元素，从场景中移除 */
    destroy() {
        if (this.scene) {
            this.scene.remove(this);
        }
    }

    /**
     * 将元素添加到场景时调用（由 Scene.add 触发）
     * 子类可重写以执行异步初始化（如加载资源），返回 Promise 即可
     */
    add(): void | Promise<void> {}

    /** 从场景中移除元素时调用 */
    remove() {}

    /**
     * 序列化此元素到 Serializer
     * @param serializer - 序列化器实例，子类将自身数据写入其中
     */
    serialize(serializer: Serializer) {}

    /**
     * 每帧更新回调
     * @param deltaTime - 距上一帧的时间间隔（秒），用于时间相关的动画
     */
    onUpdate(deltaTime: number) {}

    /** 每帧更新后回调（在所有 onUpdate 之后调用） */
    onPostUpdate() {}

    /** 渲染前回调（准备渲染状态） */
    onPreRender() {}

    /** 渲染后回调（清理或后处理） */
    onPostRender() {}

    /**
     * 当另一个元素被添加到场景时回调
     * @param element - 被添加的元素
     */
    onAdded(element: Element) {}

    /**
     * 当另一个元素从场景中移除时回调
     * @param element - 被移除的元素
     */
    onRemoved(element: Element) {}

    /**
     * 移动/旋转/缩放此元素
     * @param position - 可选，新位置
     * @param rotation - 可选，新旋转
     * @param scale - 可选，新缩放
     */
    move(position?: Vec3, rotation?: Quat, scale?: Vec3) {}

    /**
     * 获取此元素在世界空间中的包围盒
     * @returns 包围盒，如果没有可视化表示则返回 null
     */
    get worldBound(): BoundingBox | null {
        return null;
    }
}

export { ElementType, ElementTypeList, Element };
