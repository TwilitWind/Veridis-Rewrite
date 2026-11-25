/** 重新净化的用户反馈：按正文是否真的变化给提示，不把元数据变化当成改写成功。 */
import { showToast } from '../ui/notifications.js';

export function showRecleanseFeedback(textChanged) {
    showToast(
        textChanged ? '已按当前程序规则重新净化' : '已重新净化：这条原文没有程序规则命中',
        undefined,
        textChanged ? 'success' : 'info',
    );
}
