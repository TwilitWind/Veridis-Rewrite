/** 重新净化的用户反馈：正文变化可直接看到，不再弹提示；未产生改写时说明原因。 */
import { showToast } from '../ui/notifications.js';

export function showRecleanseFeedback(textChanged) {
    if (textChanged) return;
    showToast('本次未产生改写：规则未命中或结果相同', undefined, 'info');
}
