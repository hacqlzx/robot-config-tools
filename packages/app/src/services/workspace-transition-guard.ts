export type WorkspaceTransitionGuard = (actionText: string) => Promise<boolean>;

let activeGuard: WorkspaceTransitionGuard | null = null;

/** 注册当前工作区的未保存修改检查；工作区卸载时应调用返回的清理函数。 */
export function registerWorkspaceTransitionGuard(guard: WorkspaceTransitionGuard): () => void {
  activeGuard = guard;
  return () => {
    if (activeGuard === guard) activeGuard = null;
  };
}

/** 在项目、数据目录等全局上下文切换前，请求当前工作区确认。 */
export function confirmWorkspaceTransition(actionText: string): Promise<boolean> {
  return activeGuard ? activeGuard(actionText) : Promise.resolve(true);
}
