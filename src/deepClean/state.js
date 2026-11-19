// 负责当前内存中的深度净化阶段与冻结的/会话选择引用。
export const deepCleanRuntimeState = {
    deepCleanPhase: null,
    deepCleanSelection: null,
};
