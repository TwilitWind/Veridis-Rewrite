// 负责深度净化生命周期：初始选择 → 冻结/资源读取 → 扫描 → 处理 → 复核或 Program 直接应用 → 应用 → 完成/停止/出错；它协调现有各阶段负责人，不实现具体资源的持久化。

// 聚合出口：实现已按依赖拓扑拆分到同目录的分块文件，对外接口保持不变。
export { startDeepCleanRun, getDeepCleanInitialSelection, setDeepCleanFinalSelection, setDeepCleanLocalOption, applyDeepCleanPreviewSelection } from './lifecycle/lifecycle-00-selection.js';
export { runDeepCleanScan, runDeepCleanProgramProcessing, getDeepCleanReviewSession, getDeepCleanLookaheadProgress, requestDeepCleanStop } from './lifecycle/lifecycle-01-scan.js';
export { runDeepCleanApply } from './lifecycle/lifecycle-02-apply.js';
