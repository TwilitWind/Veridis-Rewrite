/**
 * 改写次数记录。
 *
 * 统计口径：按「当前消息」累计，程序改写与 AI 改写分别计数，总数为二者之和。
 * 计数点在真正提交文本的位置（cleanse.js / aiRewrite/apply.js），
 * 而不是调试日志或差异渲染处，因此重复打开透视弹窗不会重复计数。
 *
 * 存储放在消息自身的独立字段，不进入 diff 的阶段元数据：
 * 阶段元数据 schema 固定（originalMes / aiMes / programMes / reverted），
 * 混入统计字段会让 isCanonical / 迁移逻辑失效。
 */

const statsKey = '__blai_rewrite_stats';

function isObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function toCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** 读取消息的改写统计；没有记录时返回全 0。 */
export function getRewriteStats(msg) {
    const raw = isObject(msg) ? msg[statsKey] : null;
    const program = toCount(raw?.program);
    const ai = toCount(raw?.ai);
    return { total: program + ai, program, ai };
}

/**
 * 累加一次改写计数。
 * @param {object} msg 消息对象。
 * @param {'program'|'ai'} kind 改写来源。
 * @returns {boolean} 是否成功写入。
 */
export function recordRewriteStat(msg, kind) {
    if (!isObject(msg) || (kind !== 'program' && kind !== 'ai')) return false;
    const previous = isObject(msg[statsKey]) ? msg[statsKey] : {};
    msg[statsKey] = {
        program: toCount(previous.program) + (kind === 'program' ? 1 : 0),
        ai: toCount(previous.ai) + (kind === 'ai' ? 1 : 0),
    };
    return true;
}
