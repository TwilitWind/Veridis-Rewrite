/** 差异弹窗「没有改写项」空态的原因说明。
 *  独立于事件绑定模块，避免 events-00-core.js 超过行数闸门。 */
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';

export function buildEmptyRewriteHint() {
    const { extension_settings } = getAppContext();
    const settings = extension_settings?.[extensionName] || {};
    const aiEnabled = settings.aiRewrite?.enabled === true;
    const rules = Array.isArray(settings.rules) ? settings.rules : [];
    const aiModeCount = rules.reduce((count, rule) => count + (Array.isArray(rule?.subRules)
        ? rule.subRules.filter(sub => sub && sub.enabled !== false && sub.rewriteMode === 'ai').length
        : 0), 0);
    const reason = !aiEnabled && aiModeCount > 0
        ? `已关闭 AI 改写，${aiModeCount} 条 AI 模式规则不参与程序净化；当前规则在这条原文上没有程序命中。开启 AI 改写后重新净化即可生效。`
        : '当前规则在这条原文上没有命中任何替换项，原文与净化结果一致。';
    return `<div class="blai-diff-empty"><i class="fa-solid fa-circle-info" aria-hidden="true"></i>本次净化没有产生改写。${reason}</div>`;
}
