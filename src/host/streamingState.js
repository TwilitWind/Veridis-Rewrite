// 宿主终结前的闸门，仅由 lifecycleEvents.js 写入；不是 token 活动或 AI 任务生命周期。
// 在被跟踪的生成开始或宿主流式 token 时打开；在接受终结或宿主结束/停止时关闭。
// 帧数据属于 generationLifecycle.js。
export const streamingRuntimeState = {
    isStreamingGeneration: false,
};
