/**
 * 规则稳定身份：用规则内容算指纹，不往用户数据里写入 id。
 * 这样预设导入导出、复制粘贴都不会丢失身份；规则被删除或修改后
 * 指纹自然改变，相关规则回查会明确显示「找不到」而不是退回猜测。
 */

function hashString(value = '') {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index++) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 备注不纳入指纹：用户改一句说明不该让规则「消失」。 */
export function computeRuleFingerprint(rule = {}, sub = {}) {
    const payload = JSON.stringify({
        name: String(rule?.name ?? ''),
        mode: String(sub?.mode ?? 'text'),
        targets: Array.isArray(sub?.targets) ? sub.targets.map((item) => String(item)) : [],
        replacements: Array.isArray(sub?.replacements) ? sub.replacements.map((item) => String(item)) : [],
    });
    return hashString(payload);
}

/** 在当前规则集里按指纹精确回查；返回可直接引用的下标与对象。 */
export function findRuleByFingerprint(rules, fingerprint = '') {
    if (!fingerprint) return null;
    const list = Array.isArray(rules) ? rules : [];
    for (let ruleIndex = 0; ruleIndex < list.length; ruleIndex++) {
        const rule = list[ruleIndex];
        const subs = Array.isArray(rule?.subRules) ? rule.subRules : [];
        for (let subRuleIndex = 0; subRuleIndex < subs.length; subRuleIndex++) {
            if (computeRuleFingerprint(rule, subs[subRuleIndex]) === fingerprint) {
                return { ruleIndex, subRuleIndex, rule, sub: subs[subRuleIndex] };
            }
        }
    }
    return null;
}
