/**
 * tween-value.ts — 缓动值（动画插值工具）
 *
 * 提供一个轻量级的属性值插值/过渡系统，用于在编辑器中对任意对象（如相机、
 * 元素变换等）的属性值做平滑动画过渡。不使用完整的动画库，仅处理值的线性插值。
 *
 * 核心设计：
 * - Interp 对象：提供多种缓动函数（easing functions），将 [0,1] 的归一化时间
 *   映射为非线性进度，使动画更自然
 * - Ops 类：根据值对象的键（key）列表，提供 clone/copy/lerp 三个通用操作，
 *   实现对任意结构的 JS 对象的属性值操作
 * - TweenValue 类：封装源值→目标值的过渡逻辑，每帧根据 deltaTime 自动更新
 *
 * 使用示例：
 * ```typescript
 * const camPos = new TweenValue({ x: 0, y: 0, z: 5 });
 * camPos.goto({ x: 10, y: 2, z: 3 }, 0.5); // 0.5 秒内过渡
 * // 每帧调用:
 * camPos.update(dt);
 * ```
 */

/**
 * 缓动函数集合
 *
 * 每个函数接收一个归一化时间 t（范围 [0, 1]），返回经过缓动处理后的进度值。
 * 输入和输出范围都是 [0, 1]（当 t=0 返回 0，t=1 返回 1）。
 * 通过改变中间值的分布速度来实现不同的动画感觉（缓入、缓出等）。
 */
const Interp = {
    /**
     * 正弦缓动（sinosidal easing）
     *
     * 公式：sin(t * π/2)
     * 特点：缓入效果，前半段较慢，后半段加速。
     * 视觉上像从静止开始逐渐加速的过程。
     */
    sinosidal: (n: number) => Math.sin((n * Math.PI) / 2.0),

    /**
     * 二次缓动（quadratic easing）
     *
     * 公式：n * (2 - n)
     * 特点：缓出效果，前半段快，后半段减速。
     * 等价于 2t - t²，曲线为开口向下的抛物线。
     */
    quadratic: (n: number) => n * (2 - n),

    /**
     * 四次缓动（quartic easing）
     *
     * 公式：1 - (1-n)⁴
     * 特点：强烈的缓出效果，开头非常快，末尾急剧减速。
     * 四次方使得减速阶段更加明显。
     */
    quartic: (n: number) => 1 - --n * n * n * n,

    /**
     * 五次缓动（quintic easing）
     *
     * 公式：(n-1)⁵ + 1
     * 特点：比四次更强的缓出效果，起始阶段速度最快，末尾最平滑。
     * 适合需要明显"刹车感"的动画。
     */
    quintic: (n: number) => Math.pow(n - 1, 5) + 1,

    /**
     * "脊椎骨"缓动（vertebrae easing）——自定义缓动曲线
     *
     * 公式：-((cos(n*π) + 1) / 2)² + 1
     * 特点：S 形曲线（先缓入再缓出）。cos 函数产生振荡，
     * 映射到 [0,1] 后平方取反，形成两端慢中间快的流速。
     * 视觉效果非常平滑，适合相机过渡等场景。
     */
    vertebrae: (n: number) => -Math.pow((Math.cos(n * Math.PI) + 1) / 2, 2) + 1
};

/**
 * 值操作工具类
 *
 * 根据目标值的键列表，提供对任意 JS 对象的通用操作（clone/copy/lerp）。
 * 设计动机：TweenValue 需要处理不同类型的值对象（可能是相机参数、颜色、
 * 变换矩阵等），Ops 通过反射遍历所有键来提供通用能力，避免为每种类型写特化代码。
 */
class Ops {
    /** 值对象的所有键名列表 */
    keys: string[];

    /**
     * @param value - 一个示例值对象，用于提取其键名列表
     *                后续所有操作都会遍历这些键
     */
    constructor(value: any) {
        this.keys = Object.keys(value);
    }

    /**
     * 浅克隆一个对象
     *
     * 遍历所有键，将源对象的属性值复制到新对象中。
     * 注意：只做浅拷贝，属性值本身不会被深度复制。
     *
     * @param obj - 要克隆的源对象
     * @returns 包含相同键值对的新对象
     */
    clone(obj: any) {
        const result: any = {};
        this.keys.forEach((key: string) => {
            result[key] = obj[key];
        });
        return result;
    }

    /**
     * 将源对象的属性值复制到目标对象（浅拷贝）
     *
     * 直接修改 target 对象的属性值，不创建新对象。
     *
     * @param target - 要写入的目标对象
     * @param source - 提供属性值的源对象
     */
    copy(target: any, source: any) {
        this.keys.forEach((key: string) => {
            target[key] = source[key];
        });
    }

    /**
     * 线性插值（Lerp）
     *
     * 对每个键，在 a 和 b 的值之间按 t 进行线性插值：
     *   target[key] = a[key] + t * (b[key] - a[key])
     *
     * 当 t=0 时结果为 a，t=1 时结果为 b。
     *
     * @param target - 存放插值结果的目标对象
     * @param a - 起始值对象
     * @param b - 结束值对象
     * @param t - 插值因子，范围通常为 [0, 1]
     */
    lerp(target: any, a: any, b: any, t: number) {
        this.keys.forEach((key: string) => {
            target[key] = a[key] + t * (b[key] - a[key]);
        });
    }
}

/**
 * 缓动值类
 *
 * 管理一个多属性值对象从当前状态到目标状态的平滑过渡。
 * 典型的更新模式：调用 goto() 设定目标值，然后每帧调用 update(dt) 推进过渡。
 *
 * 过渡过程中使用五次缓动函数（quintic）来获得平滑的动画效果。
 */
class TweenValue {
    /** 值操作工具，根据 value 的键提供 clone/copy/lerp 能力 */
    ops: Ops;
    /** 当前值对象——外部代码读取这个值来获取实时状态 */
    value: any;
    /** 过渡起始值（goto 调用时的瞬时值） */
    source: any;
    /** 过渡目标值 */
    target: any;
    /** 过渡计时器，记录从开始到当前的累计时间（秒） */
    timer: number;
    /** 过渡总时长（秒），设为 0 表示瞬切 */ 
    transitionTime: number;

    /**
     * @param value - 要管理的值对象（会直接引用，不会被复制）
     *                该对象的所有可枚举键将被 Ops 记录，后续操作遍历这些键
     */
    constructor(value: any) {
        this.ops = new Ops(value);
        this.value = value;
        // 初始状态：源值和目标值都等于当前值
        this.source = this.ops.clone(value);
        this.target = this.ops.clone(value);
        this.timer = 0;
        this.transitionTime = 0;
    }

    /**
     * 开始过渡到目标值
     *
     * 将当前值设为过渡起点，设定目标值和过渡时长。
     * 如果 transitionTime 为 0，则直接跳转到目标值（无过渡动画）。
     *
     * @param target - 目标值对象，键名必须与 value 一致
     * @param transitionTime - 过渡时长（秒），默认 0.25 秒
     */
    goto(target: any, transitionTime = 0.25) {
        // 时长为 0 时直接跳转，不产生过渡动画
        if (transitionTime === 0) {
            this.ops.copy(this.value, target);
        }
        // 记录过渡起点（当前值）、终点（目标值）
        this.ops.copy(this.source, this.value);
        this.ops.copy(this.target, target);
        // 重置计时器
        this.timer = 0;
        this.transitionTime = transitionTime;
    }

    /**
     * 更新过渡进度（每帧调用）
     *
     * 根据 deltaTime 推进过渡计时器，计算当前进度百分比，
     * 应用五次缓动函数（quintic easing）后对值进行线性插值。
     * 过渡完成后直接将值设置为目标值，避免浮点精度累积误差。
     *
     * @param deltaTime - 本帧的时间增量（秒），通常来自 requestAnimationFrame
     */
    update(deltaTime: number) {
        if (this.timer < this.transitionTime) {
            // 推进计时器，不超过总时长
            this.timer = Math.min(this.timer + deltaTime, this.transitionTime);
            // 计算归一化进度 [0, 1]，应用五次缓动函数使动画更自然
            // 然后将缓动后的进度用于线性插值
            this.ops.lerp(this.value, this.source, this.target, Interp.quintic(this.timer / this.transitionTime));
        } else {
            // 过渡结束，直接设置为目标值（避免浮点精度累积导致微小误差）
            this.ops.copy(this.value, this.target);
        }
    }
}

export { TweenValue };
