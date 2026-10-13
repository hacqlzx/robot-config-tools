export type WorkspaceTransitionGuard = (actionText: string) => Promise<boolean>;

const guards = new Set<WorkspaceTransitionGuard>();

/** 注册当前工作区的未保存修改检查；工作区卸载时应调用返回的清理函数。 */
export function registerWorkspaceTransitionGuard(guard: WorkspaceTransitionGuard): () => void {
  guards.add(guard);
  return () => { guards.delete(guard); };
}

/** 在项目、数据目录等全局上下文切换前，请求当前工作区确认。 */
export async function confirmWorkspaceTransition(actionText: string): Promise<boolean> {
  for (const guard of [...guards]) {
    if (!(await guard(actionText))) return false;
  }
  return true;
}
