/**
 * 编辑器事件系统
 * 
 * 核心设计：
 * - 继承自 PlayCanvas 的 EventHandler，提供标准的事件发布/订阅机制
 * - 在此基础上扩展了"编辑器函数"（functions）的概念：
 *   允许各子系统注册命名函数，其他模块通过函数名调用
 * - 这是一种"服务定位器"模式的简化实现，避免了各模块间的直接依赖
 * 
 * 使用方式：
 * - events.on('eventName', callback)  —— 订阅事件
 * - events.fire('eventName', data)    —— 触发事件
 * - events.function('fnName', fn)     —— 注册函数
 * - events.invoke('fnName', ...args)  —— 调用函数
 */

import { EventHandler } from 'playcanvas';

/** 编辑器函数的类型定义：接收任意参数，返回任意值 */
type FunctionCallback = (...args: any[]) => any;

class Events extends EventHandler {
    /** 存储所有已注册的编辑器函数，key 为函数名，value 为回调 */
    functions = new Map<string, FunctionCallback>();

    /**
     * 注册一个编辑器函数
     * @param name - 函数名（全局唯一标识）
     * @param fn - 函数回调，接收任意参数
     * @throws 如果同名函数已存在则抛出错误，防止意外覆盖
     */
    function(name: string, fn: FunctionCallback) {
        if (this.functions.has(name)) {
            throw new Error(`error: function ${name} already exists`);
        }
        this.functions.set(name, fn);
    }

    /**
     * 调用已注册的编辑器函数
     * @param name - 要调用的函数名
     * @param args - 传递给函数的参数列表
     * @returns 函数的返回值，如果函数不存在则返回 undefined
     */
    invoke(name: string, ...args: any[]) {
        const fn = this.functions.get(name);
        if (!fn) {
            console.log(`error: function not found '${name}'`);
            return;
        }
        return fn(...args);
    }
}

export { Events };
