/** 只是查看器的临时交互。比较结果由所选分支推导。 */
import { getAppContext } from '../host/appContext.js';
import { getMessageDiffMeta } from './messageMeta.js';

export const diffRuntimeState = {
    currentMessage: null,
    diffModalRefresh: null,
    diffModalClose: null,
    diffRelatedRuleMode: false,
    diffPickMode: false,
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
}

export function getDiffComparisonForMessage(index, section) {
    const msg = getAppContext().chat?.[index];
    const meta = getMessageDiffMeta(msg);
    if (!meta) return null;
    if (section === 'ai') {
        return meta.aiMes === null ? null : { oldText: meta.originalMes, newText: meta.aiMes };
    }
    return section === 'program'
        ? { oldText: meta.aiMes ?? meta.originalMes, newText: meta.programMes }
        : null;
}
