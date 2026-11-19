/** 只负责检测 MVU 是否活跃；MVU 自己负责其请求与消息更新。 */
import { getGlobalObject } from '../host/context.js';

function getMvuGlobalApi() {
    const root = getGlobalObject();
    if (root?.Mvu && typeof root.Mvu === 'object') return root.Mvu;
    try {
        const parentApi = root?.parent?.Mvu;
        if (parentApi && typeof parentApi === 'object') return parentApi;
    } catch {
        // 在 SillyTavern 宿主之外，跨窗口访问可能失败。
    }
    return null;
}

export function getMvuIntegrationSignal() {
    return getMvuGlobalApi() ? 'detected' : 'not_detected';
}
