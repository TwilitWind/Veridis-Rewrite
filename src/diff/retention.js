/** 在数据变更时应用配置的消息窗口，绝不在 DOM 投影期间应用。 */
import { getAppContext } from '../host/appContext.js';
import { getLatestAssistantMessageIndices } from './tracking.js';
import { pruneChatDiffMetadata } from './messageMeta.js';
import { markHostChatDirtyFromIndex } from '../integrations/tauriTavern.js';
import { queueIncrementalChatSave } from '../chat/persistence.js';
import { getCurrentDiffIndex, refreshDiffViewer } from './state.js';

export function maintainDiffRetention() {
    const { chat } = getAppContext();
    const retainedIndices = getLatestAssistantMessageIndices(chat);
    const firstChanged = pruneChatDiffMetadata(chat, retainedIndices);
    if (firstChanged < 0) return false;
    markHostChatDirtyFromIndex(firstChanged);
    queueIncrementalChatSave();
    const selectedIndex = getCurrentDiffIndex();
    if (selectedIndex >= 0 && !retainedIndices.includes(selectedIndex)) refreshDiffViewer(selectedIndex);
    return true;
}
