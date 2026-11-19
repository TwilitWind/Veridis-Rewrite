/** 给「没有历史净化记录」的消息补建差异基线。 */
import { getAppContext } from '../host/appContext.js';
import { cleanseMessageDataAtIndex } from '../chat/cleanse.js';
import { refreshMessageDisplay } from '../chat/display.js';
import { queueIncrementalChatSave } from '../chat/persistence.js';
import { injectDiffButtons } from './view.js';
import { getMessageDiffMeta, isMessageDiffReverted } from './messageMeta.js';

/**
 * 把当前正文当作原文执行一次净化。
 * 新聊天里用户手工补写 <content> 时，生成阶段没有自动净化，
 * 因此没有阶段元数据；这里显式补建，使差异 / 撤回 / AI 改写可用。
 * @param {number} index 消息索引。
 * @returns {boolean} 是否写入了变更。
 */
export function establishDiffBaselineAtIndex(index) {
    const { chat } = getAppContext();
    const msg = Array.isArray(chat) && Number.isInteger(index) && index >= 0 && index < chat.length
        ? chat[index]
        : null;
    if (!msg || typeof msg.mes !== 'string') return false;
    if (getMessageDiffMeta(msg) || isMessageDiffReverted(msg)) return false;

    const changed = cleanseMessageDataAtIndex(index, {
        diffSourceMes: msg.mes,
        explicitRecleanse: true,
    });
    if (changed) {
        refreshMessageDisplay(index, { allowReloadFallback: true, emitRenderedEvent: 'auto' });
        injectDiffButtons([index]);
        queueIncrementalChatSave();
    }
    return changed;
}
