// 负责内存中的 AI 改写任务/调试/应用运行时状态；不负责生成或应用行为。
export const aiRewriteState = {
    activeController: null,
    activeTask: null,
    statusToast: null,
    statusTask: null,
    statusDismissedTask: null,
    debugEvents: [],
    criticalDebugEvents: [],
    runningTask: null,
    finalCleanseSequence: 0,
    finalCleanseByMessageKey: new Map(),
    pendingApply: null,
};
