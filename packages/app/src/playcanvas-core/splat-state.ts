/**
 * SplatState - 定义每个高斯点（Splat）的工作状态位标记
 *
 * 核心功能：
 * - 使用位掩码（bitmask）为每个高斯点标记不同状态
 * - 状态值采用 2 的幂次方，便于按位组合判断
 * - 状态存储在 splat 数据中的 'state' 通道，每个 splat 占 1 字节（Uint8）
 *
 * 位含义：
 * - bit 0 (值=1): selected  - 当前被选中
 * - bit 1 (值=2): locked    - 被锁定，不可编辑
 * - bit 2 (值=4): deleted   - 已删除（软删除，不立即移除数据）
 */

enum State {
    /** 选中状态：bit 0，值为 1 */
    selected = 1,
    /** 锁定状态：bit 1，值为 2。锁定后不可被选中或编辑 */
    locked = 2,
    /** 软删除状态：bit 2，值为 4。标记为删除但不立即从内存移除 */
    deleted = 4
}

export { State };
