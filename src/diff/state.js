/** 只是查看器的临时交互。比较结果由所选分支推导。 */
import { getAppContext } from '../host/appContext.js';
import { getMessageDiffMeta } from './messageMeta.js';

export const diffRuntimeState = {
    currentMessage: null,
    diffModalRefresh: null,
    diffModalClose: null,
    diffRelatedRuleMode: false,
    diffPickMode: false,
    // 改写来源筛选与逐条定位：会话内状态，不持久化（跟随每次打开弹窗重建）。
    diffFilterEnabled: false,
    // 多选来源：空数组表示不筛选；关闭筛选行时清空。
    diffSelectedSources: [],
    diffNavIndex: -1,
};

export function getCurrentDiffIndex() {
    if (!diffRuntimeState.currentMessage) return -1;
    const chat = getAppContext().chat;
    return Array.isArray(chat) ? chat.indexOf(diffRuntimeState.currentMessage) : -1;
}

export function refreshDiffViewer(index) {
    const selectedIndex = getCurrentDiffIndex();
    if (selectedIndex < 0) {
        if (diffRuntimeState.currentMessage) resetDiffRuntimeState();
        return;
    }
    if (index === undefined || index === selectedIndex) diffRuntimeState.diffModalRefresh?.(selectedIndex);
}

export function resetDiffRuntimeState() {
    diffRuntimeState.diffModalClose?.();
    diffRuntimeState.currentMessage = null;
    diffRuntimeState.diffRelatedRuleMode = false;
    diffRuntimeState.diffPickMode = false;
    diffRuntimeState.diffFilterEnabled = false;
    diffRuntimeState.diffSelectedSources = [];
    diffRuntimeState.diffNavIndex = -1;
}

export function getDiffComparisonForMessage(index, section) {
    const msg = getAppContext().chat?.[index];
    const meta = getMessageDiffMeta(msg);
    if (!meta) return null;
    if (section === 'ai') {
        return meta.aiMes === null ? null : { oldText: meta.originalMes, newText: meta.aiMes };
    }
    if (section === 'program') {
        return { oldText: meta.aiMes ?? meta.originalMes, newText: meta.programMes };
    }
    // 手改只展示「插件结果 → 当前正文」的差异，不参与撤回。
    return section === 'manual'
        ? { oldText: meta.programMes, newText: String(msg?.mes ?? '') }
        : null;
}
