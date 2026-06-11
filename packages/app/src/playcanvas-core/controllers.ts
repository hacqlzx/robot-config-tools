/**
 * controllers.ts - 相机控制器（轨道模式/飞行模式）
 *
 * 本文件实现 PointerController 类，处理所有用户输入以控制场景相机。
 *
 * 支持的输入设备：
 * - 鼠标：左键/中键/右键拖拽、滚轮缩放
 * - 触摸：单指旋转、双指平移+缩放
 * - 键盘：WASD 飞行移动、Q/E 上升/下降、Shift/Ctrl 速度调节
 *
 * 两种控制模式：
 * 1. 轨道模式 (Orbit)：
 *    - 左键拖拽：旋转（围绕焦点旋转）
 *    - 右键拖拽：平移（默认）/ Shift+Ctrl→旋转 / Alt+Meta→缩放
 *    - 中键拖拽：旋转（默认）/ Shift→平移 / Ctrl→缩放
 *    - 滚轮：缩放（物理滚轮逐级缩放，触控板平滑缩放）
 *    - 双击/中键点击：聚焦到点击位置
 *
 * 2. 飞行模式 (Fly)：
 *    - 左键拖拽：观察（第一人称旋转）
 *    - 中键拖拽/右键(默认)：缩放
 *    - 右键+Shift/Ctrl：观察
 *    - 右键+Alt/Meta：缩放
 *    - 滚轮：前后移动
 *    - WASD：前后左右飞行
 *    - Q/E：上升/下降
 *    - Shift/Ctrl：加速/减速
 *
 * 技术要点：
 * - Pointer Events API：统一处理鼠标和触摸事件
 * - 滚轮分类：区分物理鼠标滚轮（逐格）和触控板（连续）以提供流畅的缩放体验
 * - 事件包裹：通过 wrap() 函数在触发时同时广播 'camera.controller' 事件
 * - 窗口失焦时自动清除按键状态，防止"粘键"问题
 */

import { Vec3 } from 'playcanvas';

import { Camera } from './camera';

// 模块级临时向量（内存复用）
const fromWorldPoint = new Vec3();    // 平移操作：起始世界位置
const toWorldPoint = new Vec3();      // 平移操作：目标世界位置
const worldDiff = new Vec3();         // 平移操作：世界空间位移
const moveVec = new Vec3();           // 飞行模式：移动向量

/**
 * 计算两个二维点之间的欧几里得距离。
 *
 * @returns 两点间的像素距离
 */
const dist = (x0: number, y0: number, x1: number, y1: number) => Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);

/**
 * PointerController 类 - 统一指针/触摸/键盘相机控制器。
 *
 * 在构造函数中注册所有输入事件监听器，并在 destroy() 中清理。
 * update() 方法每帧处理飞行模式的连续移动。
 */
class PointerController {
    /** 每帧更新函数（被 Camera.onUpdate 调用） */
    update: (deltaTime: number) => void;
    /** 销毁函数：移除所有事件监听器 */
    destroy: () => void;

    /**
     * @param camera - 要控制的相机实例
     * @param target - 接收指针事件的 DOM 元素（画布容器）
     */
    constructor(camera: Camera, target: HTMLElement) {

        /**
         * 轨道旋转操作：
         * 将鼠标/触摸的像素位移转换为方位角和仰角的变化。
         *
         * @param dx - 水平像素位移
         * @param dy - 垂直像素位移
         */
        const orbit = (dx: number, dy: number) => {
            const azim = camera.azim - dx * camera.scene.config.controls.orbitSensitivity;
            const elev = camera.elevation - dy * camera.scene.config.controls.orbitSensitivity;
            camera.setAzimElev(azim, elev);
        };

        /**
         * 飞行注视操作：
         * 委托给 Camera.look() 方法实现第一人称旋转。
         */
        const look = (dx: number, dy: number) => {
            camera.look(dx, dy);
        };

        /**
         * 平移操作：
         * 使用屏幕坐标到世界坐标的投影，计算在缩放距离上的世界空间位移。
         *
         * 实现原理：
         * 1. 将当前屏幕位置投影到世界空间（在焦点距离处）
         * 2. 将移动后的屏幕位置也投影到世界空间
         * 3. 二者的世界空间差值即为相机应平移的位移量
         * 4. 平移焦点使相机"跟随"移动
         *
         * 这种方法的优势：无论缩放级别如何，平移感知与鼠标运动一致。
         *
         * @param x - 当前指针 x
         * @param y - 当前指针 y
         * @param dx - x 方向增量
         * @param dy - y 方向增量
         */
        const pan = (x: number, y: number, dx: number, dy: number) => {
            const c = camera.camera;
            // 当前焦点距离处的世界空间距离
            const distance = camera.distanceTween.value.distance * camera.sceneRadius / camera.fovFactor;

            c.screenToWorld(x, y, distance, fromWorldPoint);
            c.screenToWorld(x - dx, y - dy, distance, toWorldPoint);

            worldDiff.sub2(toWorldPoint, fromWorldPoint);
            worldDiff.add(camera.focalPoint);

            camera.setFocalPoint(worldDiff);
        };

        /**
         * 缩放操作：
         * 使用乘性缩放公式确保缩放感知均匀（近距离变化小，远距离变化大）。
         *
         * 公式: newDistance = currentDistance - (currentDistance * 0.999 + 0.001) * amount * sensitivity
         *
         * 0.001 小偏移确保即使在极近距离 (distance ≈ 0) 也能正常缩放。
         * dampingFactorFactor 设为 2 使缩放过渡稍快。
         *
         * @param amount - 缩放量（正值缩小，负值放大）
         */
        const zoom = (amount: number) => {
            camera.setDistance(camera.distance - (camera.distance * 0.999 + 0.001) * amount * camera.scene.config.controls.zoomSensitivity, 2);
        };

        // ── 鼠标状态 ──
        let pressedButton = -1;  // -1=无按键, 0=左键, 1=中键, 2=右键
        let x: number, y: number;

        // 中键点击检测（用于区分拖拽和单击聚焦）
        const CLICK_DRAG_THRESHOLD = 4;   // 鼠标移动超过此像素视为拖拽而非点击
        let mmbStartX = 0, mmbStartY = 0, mmbDragged = false;

        // ── 触摸状态 ──
        let touches: { id: number, x: number, y: number}[] = [];
        let midx: number, midy: number, midlen: number;  // 双指中点坐标和间距

        /**
         * 指针按下事件处理。
         *
         * 鼠标：记录按键类型和初始位置，设置指针捕获。
         * 触摸：跟踪所有活动触摸点，双指时计算中点和间距。
         */
        const pointerdown = (event: PointerEvent) => {
            if (event.pointerType === 'mouse') {
                // 如果已有按键按下，忽略新按键（不支持同时多键）
                if (pressedButton !== -1) {
                    return;
                }
                target.setPointerCapture(event.pointerId);
                pressedButton = event.button;
                x = event.offsetX;
                y = event.offsetY;
                // 中键：记录起始位置用于单击/拖拽判断
                if (pressedButton === 1) {
                    mmbStartX = x;
                    mmbStartY = y;
                    mmbDragged = false;
                }
            } else if (event.pointerType === 'touch') {
                // 首个触摸点时设置指针捕获
                if (touches.length === 0) {
                    target.setPointerCapture(event.pointerId);
                }
                touches.push({
                    x: event.offsetX,
                    y: event.offsetY,
                    id: event.pointerId
                });

                // 双指时记录中点和间距
                if (touches.length === 2) {
                    midx = (touches[0].x + touches[1].x) * 0.5;
                    midy = (touches[0].y + touches[1].y) * 0.5;
                    midlen = dist(touches[0].x, touches[0].y, touches[1].x, touches[1].y);
                }
            }
        };

        /**
         * 指针释放事件处理。
         *
         * 鼠标：
         * - 仅释放最初按下的按键
         * - 中键单击（无拖拽）→ 仅在轨道模式下聚焦
         * 触摸：移除对应触摸点，全部松开会释放指针捕获。
         */
        const pointerup = (event: PointerEvent) => {
            if (event.pointerType === 'mouse') {
                // 仅处理最初按下的按键的释放
                if (event.button === pressedButton) {
                    // 中键点击（无拖拽）在轨道模式下聚焦（飞行模式下中键用于缩放）
                    if (pressedButton === 1 && camera.controlMode === 'orbit' && !mmbDragged) {
                        camera.pickFocalPoint(event.offsetX / target.clientWidth, event.offsetY / target.clientHeight);
                    }
                    pressedButton = -1;
                    target.releasePointerCapture(event.pointerId);
                }
            } else {
                // 移除对应触摸点
                touches = touches.filter(touch => touch.id !== event.pointerId);
                if (touches.length === 0) {
                    target.releasePointerCapture(event.pointerId);
                }
            }
        };

        /**
         * 指针移动事件处理。
         *
         * 这是控制器最核心的方法，处理所有交互逻辑。
         *
         * 鼠标移动：
         * - 验证按键仍被按下（通过 event.buttons 位掩码检测）
         * - 根据 controlMode 和按键组合决定操作类型
         *
         * 触摸移动：
         * - 单指：旋转（轨道）或观察（飞行）
         * - 双指：平移 + 缩放（轨道）或前后移动（飞行）
         */
        const pointermove = (event: PointerEvent) => {
            if (event.pointerType === 'mouse') {
                // 未按下按键则不处理
                if (pressedButton === -1) {
                    return;
                }

                /**
                 * 验证被跟踪的按键仍然被按下。
                 * event.buttons 是位掩码：
                 * 1 = 左键, 4 = 中键, 2 = 右键
                 * 如果按键已释放（比如在窗口外松开），清理状态。
                 */
                const buttonMask = [1, 4, 2][pressedButton];
                if ((event.buttons & buttonMask) === 0) {
                    pressedButton = -1;
                    return;
                }

                const dx = event.offsetX - x;
                const dy = event.offsetY - y;
                x = event.offsetX;
                y = event.offsetY;

                if (camera.controlMode === 'fly') {
                    // 飞行模式下的鼠标映射
                    if (pressedButton === 0) {
                        // 左键：第一人称观察
                        look(dx, dy);
                    } else if (pressedButton === 1) {
                        // 中键：缩放
                        zoom(dy * -0.02);
                    } else if (pressedButton === 2) {
                        // 右键：默认平移，Shift/Ctrl→观察，Alt/Meta→缩放
                        const mod = event.shiftKey || event.ctrlKey ? 'look' :
                            (event.altKey || event.metaKey ? 'zoom' : 'pan');

                        if (mod === 'look') {
                            look(dx, dy);
                        } else if (mod === 'zoom') {
                            zoom(dy * -0.02);
                        } else {
                            pan(x, y, dx, dy);
                        }
                    }
                } else {
                    // 轨道模式下的鼠标映射（Blender 风格）
                    // 中键拖拽需要先检测是否超过拖拽阈值
                    if (pressedButton === 1 && !mmbDragged) {
                        if (dist(event.offsetX, event.offsetY, mmbStartX, mmbStartY) < CLICK_DRAG_THRESHOLD) {
                            return;  // 尚未达到拖拽阈值，保持单击状态
                        }
                        mmbDragged = true;
                    }

                    let mod: 'orbit' | 'pan' | 'zoom';
                    if (pressedButton === 2) {
                        // 右键：默认平移，Shift/Ctrl→旋转，Alt/Meta→缩放
                        mod = event.shiftKey || event.ctrlKey ? 'orbit' :
                            (event.altKey || event.metaKey ? 'zoom' : 'pan');
                    } else if (pressedButton === 1) {
                        // 中键：默认旋转，Shift→平移，Ctrl→缩放
                        mod = event.shiftKey ? 'pan' :
                            (event.ctrlKey ? 'zoom' : 'orbit');
                    } else {
                        // 左键：旋转
                        mod = 'orbit';
                    }

                    if (mod === 'orbit') {
                        orbit(dx, dy);
                    } else if (mod === 'zoom') {
                        zoom(dy * -0.02);
                    } else {
                        pan(x, y, dx, dy);
                    }
                }
            } else {
                // 触摸事件处理
                if (touches.length === 1) {
                    // 单指：旋转或观察
                    const touch = touches[0];
                    const dx = event.offsetX - touch.x;
                    const dy = event.offsetY - touch.y;
                    touch.x = event.offsetX;
                    touch.y = event.offsetY;

                    if (camera.controlMode === 'fly') {
                        look(dx, dy);
                    } else {
                        orbit(dx, dy);
                    }
                } else if (touches.length === 2) {
                    // 双指：平移 + 缩放
                    const touch = touches[touches.map(t => t.id).indexOf(event.pointerId)];
                    touch.x = event.offsetX;
                    touch.y = event.offsetY;

                    const mx = (touches[0].x + touches[1].x) * 0.5;
                    const my = (touches[0].y + touches[1].y) * 0.5;
                    const ml = dist(touches[0].x, touches[0].y, touches[1].x, touches[1].y);

                    if (camera.controlMode === 'fly') {
                        // 飞行模式：捏合缩放变为前后移动
                        const zoomDelta = (ml - midlen) * 0.01;
                        const worldTransform = camera.mainCamera.getWorldTransform();
                        const zAxis = worldTransform.getZ();
                        moveVec.copy(zAxis).mulScalar(-zoomDelta * camera.flySpeed);
                        const p = camera.focalPoint.add(moveVec);
                        camera.setFocalPoint(p);
                    } else {
                        pan(mx, my, (mx - midx), (my - midy));
                        zoom((ml - midlen) * 0.01);
                    }

                    midx = mx;
                    midy = my;
                    midlen = ml;
                }
            }
        };

        /**
         * 区分物理鼠标滚轮和触控板双指滚动手势。
         *
         * 问题背景：
         * - 物理鼠标滚轮：逐格滚动，每格触发一个事件（间距通常 > 50ms）
         * - 触控板双指：连续流式事件（约 60Hz，~16ms 间隔）
         * - Magic Mouse、高分辨率鼠标、macOS Shift 重映射会干扰逐事件判断
         *
         * 策略：
         * - 按"事件组"分类：相邻事件间隔 < 80ms 的视为同一组
         * - 一组中的第一个事件决定该组是滚轮还是触控板
         * - 组内后续事件继承分类结果
         *
         * Firefox 通过 deltaMode 区分（滚轮=line/page，触控板=pixel）。
         * Chrome/Safari 通过非标准 wheelDelta 属性区分（滚轮=±120 整数倍，触控板=任意值）。
         */
        const BURST_GAP_MS = 80;   // 事件组间隔阈值
        let lastWheelTime = -Infinity;
        let burstIsWheel = false;   // 当前事件组是否为物理滚轮

        /**
         * 滚轮事件分类器。
         *
         * @param event - 滚轮事件
         * @returns true 表示物理滚轮，false 表示触控板
         */
        const classifyWheel = (event: WheelEvent) => {
            // Firefox: 物理滚轮报告 line/page 增量模式；触控板报告 pixel 模式
            if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
                return true;
            }
            // Chrome / Safari: 非标准 wheelDeltaX/Y 属性保留原始滚轮刻度值
            // 物理滚轮: wheelDeltaY 始终为 ±120 的整数倍
            // 触控板 / Magic Mouse: 发出几乎永远不会对齐到 120 的任意值
            const e = event as WheelEvent & { wheelDeltaX?: number, wheelDeltaY?: number };
            if (typeof e.wheelDeltaY === 'number' && e.wheelDeltaY !== 0) {
                return e.wheelDeltaY % 120 === 0;
            }
            if (typeof e.wheelDeltaX === 'number' && e.wheelDeltaX !== 0) {
                return e.wheelDeltaX % 120 === 0;
            }
            // 最后的回退方案（不支持 wheelDelta* 的浏览器）
            const { deltaX, deltaY } = event;
            if (deltaX !== 0 && deltaY !== 0) {
                return false;     // 对角线运动 → 触控板
            }
            return Number.isInteger(deltaX) && Number.isInteger(deltaY);
        };

        /**
         * 滚轮事件处理。
         *
         * 处理逻辑：
         * - 飞行模式：滚轮前后移动焦点
         * - 物理滚轮（轨道模式）：缩放（逐格）
         * - 触控板 + Ctrl/Meta：缩放
         * - 触控板 + Shift：平移
         * - 触控板（默认）：旋转
         *
         * macOS Shift 重映射处理：
         * 某些浏览器（Safari/Firefox）在按住 Shift 时会将垂直滚轮重映射为 deltaX。
         * 只在 Shift 按住且 deltaY=0 时将 deltaX 作为滚轮偏移，避免误将水平滑动当缩放。
         */
        const wheel = (event: WheelEvent) => {
            // 事件组分类
            const now = performance.now();
            if (now - lastWheelTime > BURST_GAP_MS) {
                burstIsWheel = classifyWheel(event);
            }
            lastWheelTime = now;

            const { deltaX, deltaY } = event;

            // macOS Shift 重映射：Shift+垂直滚轮 → deltaX
            const wheelDelta = event.shiftKey && deltaY === 0 ? deltaX : deltaY;

            if (camera.controlMode === 'fly') {
                // 飞行模式：滚轮前后移动
                const factor = camera.flySpeed * 0.01;
                const worldTransform = camera.mainCamera.getWorldTransform();
                const zAxis = worldTransform.getZ();
                moveVec.copy(zAxis).mulScalar(wheelDelta * factor);
                const p = camera.focalPoint.add(moveVec);
                camera.setFocalPoint(p);
            } else if (burstIsWheel) {
                // 物理滚轮：标准缩放
                zoom(wheelDelta * -0.002);
            } else if (event.ctrlKey || event.metaKey) {
                // 触控板 + Ctrl/Meta：缩放
                zoom(deltaY * -0.02);
            } else if (event.shiftKey) {
                // 触控板 + Shift：平移
                pan(event.offsetX, event.offsetY, deltaX, deltaY);
            } else {
                // 触控板默认：旋转
                orbit(deltaX, deltaY);
            }

            event.preventDefault();
        };

        /**
         * 双击事件处理。
         *
         * 双击场景：切换到轨道模式并聚焦到点击位置。
         *
         * FIXME: Safari 将 canvas 作为 dblclick 的目标，但 Chrome 发送的是 target 元素。
         * 因此需要同时检测两者。
         */
        // 获取 PlayCanvas 画布元素用于双击检测兼容
        const canvas = camera.scene.app.graphicsDevice.canvas;

        const dblclick = (event: globalThis.MouseEvent) => {
            if (event.target === target || event.target === canvas) {
                // 飞行模式下双击：先切换到轨道模式再聚焦
                if (camera.controlMode === 'fly') {
                    camera.scene.events.fire('camera.setControlMode', 'orbit');
                }
                camera.pickFocalPoint(event.offsetX / target.clientWidth, event.offsetY / target.clientHeight);
            }
        };

        // ── 飞行模式按键状态 ──
        let flyForward = false;
        let flyBackward = false;
        let flyLeft = false;
        let flyRight = false;
        let flyDown = false;
        let flyUp = false;

        // 速度调节键状态
        let fastDown = false;    // Shift：加速 (×10)
        let slowDown = false;    // Ctrl：减速 (×0.1)

        /**
         * 窗口失焦时清除所有按键状态。
         * 防止用户 Alt+Tab 切换窗口后按键"粘住"（按键释放事件在另一个窗口触发）。
         */
        const clearAllKeys = () => {
            flyForward = false;
            flyBackward = false;
            flyLeft = false;
            flyRight = false;
            flyDown = false;
            flyUp = false;
            fastDown = false;
            slowDown = false;
        };

        /**
         * 飞行按键按下时自动切换到飞行模式。
         *
         * @param down - true 表示按下，false 表示释放
         */
        const handleFlyKey = (down: boolean) => {
            if (down && camera.controlMode !== 'fly') {
                camera.scene.events.fire('camera.setControlMode', 'fly');
            }
        };

        // 注册快捷键事件监听器
        const events = camera.scene.events;

        const onFlyForward = (down: boolean) => {
            flyForward = down;
            handleFlyKey(down);
        };
        const onFlyBackward = (down: boolean) => {
            flyBackward = down;
            handleFlyKey(down);
        };
        const onFlyLeft = (down: boolean) => {
            flyLeft = down;
            handleFlyKey(down);
        };
        const onFlyRight = (down: boolean) => {
            flyRight = down;
            handleFlyKey(down);
        };
        const onFlyDown = (down: boolean) => {
            flyDown = down;
            handleFlyKey(down);
        };
        const onFlyUp = (down: boolean) => {
            flyUp = down;
            handleFlyKey(down);
        };
        const onModifierFast = (down: boolean) => {
            fastDown = down;
        };
        const onModifierSlow = (down: boolean) => {
            slowDown = down;
        };

        events.on('camera.fly.forward', onFlyForward);
        events.on('camera.fly.backward', onFlyBackward);
        events.on('camera.fly.left', onFlyLeft);
        events.on('camera.fly.right', onFlyRight);
        events.on('camera.fly.down', onFlyDown);
        events.on('camera.fly.up', onFlyUp);
        events.on('camera.modifier.fast', onModifierFast);
        events.on('camera.modifier.slow', onModifierSlow);

        /**
         * 每帧更新飞行移动。
         *
         * 仅在飞行模式下有效。
         * 处理 W/A/S/D/Q/E 按键，计算移动向量并移动焦点。
         *
         * 移动方向参考：
         * - 前后：沿相机 Z 轴（投影到水平面）
         * - 左右：沿相机 X 轴（投影到水平面）
         * - 上下：沿世界 Y 轴
         *
         * @param deltaTime - 时间增量（秒）
         */
        this.update = (deltaTime: number) => {
            if (camera.controlMode !== 'fly') return;

            // 将有向按键状态转换为标量：正值=前进/右/上
            const forward = (flyForward ? 1 : 0) - (flyBackward ? 1 : 0);
            const strafe = (flyRight ? 1 : 0) - (flyLeft ? 1 : 0);
            const vertical = (flyUp ? 1 : 0) - (flyDown ? 1 : 0);

            if (forward || strafe || vertical) {
                // 速度调节器：快→×10，慢→×0.1，正常→×1
                const speedMod = fastDown ? 10 : (slowDown ? 0.1 : 1);
                const factor = deltaTime * camera.flySpeed * speedMod;
                const worldTransform = camera.worldTransform;

                moveVec.set(0, 0, 0);

                // 前后移动：沿水平前向（固定 Y 分量避免飞入地下/天空）
                if (forward) {
                    const zAxis = worldTransform.getZ();
                    zAxis.y = 0;                    // 投影到水平面
                    zAxis.normalize();
                    moveVec.add(zAxis.mulScalar(-forward * factor));
                }

                // 左右移动：沿水平右向
                if (strafe) {
                    const xAxis = worldTransform.getX();
                    xAxis.y = 0;                    // 投影到水平面
                    xAxis.normalize();
                    moveVec.add(xAxis.mulScalar(strafe * factor));
                }

                // 上下移动：沿世界空间 Y 轴
                if (vertical) {
                    moveVec.y += vertical * factor;
                }

                // 移动焦点（相机通过轨道计算跟随焦点）
                const p = camera.focalPoint.add(moveVec);
                camera.setFocalPoint(p);
            }
        };

        let destroy: () => void = null;

        /**
         * 事件包裹器：
         * 在添加 DOM 事件监听的同时，触发 'camera.controller' 事件通知其他模块。
         * 使用闭包维持 destroy 函数引用，支持逐步添加多个监听器。
         *
         * @param target - DOM 事件目标
         * @param name - 事件名称
         * @param fn - 事件处理函数
         * @param options - addEventListener 的选项（如 { passive: false }）
         */
        const wrap = (target: any, name: string, fn: any, options?: any) => {
            const callback = (event: any) => {
                // 触发控制器交互事件（用于隐藏 UI 提示等）
                camera.scene.events.fire('camera.controller', name);
                fn(event);
            };
            target.addEventListener(name, callback, options);
            // 更新 destroy 函数以包含最新监听器的移除逻辑
            destroy = () => {
                destroy?.();
                target.removeEventListener(name, callback);
            };
        };

        // 注册所有 DOM 事件监听器
        wrap(target, 'pointerdown', pointerdown);
        wrap(target, 'pointerup', pointerup);
        wrap(target, 'pointermove', pointermove);
        // wheel 使用 passive: false 以允许 preventDefault（防止页面滚动）
        wrap(target, 'wheel', wheel, { passive: false });
        wrap(target, 'dblclick', dblclick);
        // 窗口失焦时清除所有按键状态
        wrap(window, 'blur', clearAllKeys);

        /**
         * 销毁控制器，移除所有事件监听器。
         * 由 Camera.remove() 调用。
         */
        this.destroy = () => {
            destroy?.();
            // 注销所有快捷键事件监听器
            events.off('camera.fly.forward', onFlyForward);
            events.off('camera.fly.backward', onFlyBackward);
            events.off('camera.fly.left', onFlyLeft);
            events.off('camera.fly.right', onFlyRight);
            events.off('camera.fly.down', onFlyDown);
            events.off('camera.fly.up', onFlyUp);
            events.off('camera.modifier.fast', onModifierFast);
            events.off('camera.modifier.slow', onModifierSlow);
        };
    }
}

export { PointerController };
