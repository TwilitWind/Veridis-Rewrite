/**
 * AI 改写诊断的显示层：中文标签表、时间线排版、面板就地刷新。
 * 三条约定：
 *   1. 正序 —— 先发生的事在上面，从上往下读就是时间顺序（旧版是倒序，因果读反）。
 *   2. 时间用本地时区 —— 旧版直接印 UTC，比本地慢 8 小时，会被当成旧日志。
 *   3. 连续重复的同类事件合并计数 —— 一次试运行会产生十几条一模一样的记录。
 * 阶段名、原因、模式、来源、结果全部走中文表；表里没有的值原样显示，便于反馈排查。
 */
import { debugLogLimit } from './debugStore.js';

const debugDisplayLabels = {
    generationId: '生成轮次',
    messageId: '消息序号',
    requestState: '请求状态',
    source: '来源',
    chatId: '会话 ID',
    validationMode: '校验模式',
    validationReason: '校验原因',
    mode: '模式',
    phase: '阶段',
    reason: '原因',
    status: '状态',
    attempt: '尝试次数',
    task: '任务',
    itemCount: '项目数',
    matchedAiRuleCount: '匹配 AI 规则',
    rawAiMatchCount: 'AI 原始匹配',
    sentenceTargetCount: '句子目标',
    index: '消息序号',
    changedTargets: '写回目标',
    changedSwipeCount: 'Swipe 修改',
    targetCount: '候选单元格',
    changedCount: '实际修改',
    persistenceTargetCount: '持久化目标',
    newEntryCount: '新增日志项',
    operationKindCounts: '操作类型计数',
    rowUpsertCount: '行写入操作',
    candidateCellCount: '结构候选单元格',
    beforeLength: '修改前长度',
    afterLength: '修改后长度',
    appliedCount: '应用项目',
    skippedCount: '跳过项目',
    result: '结果',
    hasPending: '有等待目标',
    active: '正在处理',
    chatId: '会话',
    chatLength: '会话消息数',
    postDeleteChatLength: '删除后消息数',
    postOperationChatLength: '生成后消息数',
    hostGenerationType: '生成类型',
    tailRole: '最后一条来自',
    tailSwipeId: 'Swipe 序号',
    tailSwipeCount: 'Swipe 总数',
    automaticTrigger: '自动触发',
    dryRun: '试运行',
    endpoint: '接口',
    helperGenerationId: '酒馆助手生成号',
    model: '模型',
    apiSource: '接口来源',
    responseFormat: '返回格式',
    sampling: '采样参数',
    promptLength: '提示词字数',
    timeoutMs: '超时',
    targetBound: '已绑定目标',
    outcome: '结果',
    failureCode: '失败代码',
    previousLength: '改动前字数',
    messageLength: '改动后字数',
    phase: '阶段',
    active: '正在处理',
};
// 阶段名中文表：日志里出现的每个阶段都要有对应说法，查不到时退回原始代号。
const debugStageDisplayLabels = {
    // 宿主与消息生命周期
    'generation-start-observed': '开始生成',
    'generation-start-ignored': '忽略这次生成开始',
    'generation-created': '建立生成会话',
    'generation-ended-observed': '生成结束',
    'generation-stopped-observed': '生成被中止',
    'generation-started-cancelled-active': '新生成顶替了旧会话',
    'message-received-observed': '收到一条消息',
    'message-bound': '已绑定到这条消息',
    'message-id-rejected': '消息序号无效',
    'message-target-confirmed': '已确认改写目标',
    'message-target-rejected': '改写目标无效',
    'message-swipe-ignored': '忽略 Swipe 切换',
    'message-deleted-observed': '消息被删除',
    'message-deletion-ignored': '这次删除与本轮无关',
    'message-deletion-target-invalidated': '改写目标被删除',
    'internal-message-mutation-rejected': '插件内部改动被拒',
    'internal-message-mutation-acknowledged': '插件内部改动已确认',
    'payload-rejected': '消息载荷被拒',
    'event-received': '收到终结事件',
    'finalization-deduped': '重复的终结事件已忽略',
    'stale-streaming-ui-end-skipped': '过期的流式收尾已跳过',
    'streaming-processor-install-failed': '流式处理器挂载失败',
    // AI 请求
    'pre-run-validation': '运行前校验',
    'manual-request': '手动触发改写',
    'task-ready': '任务就绪',
    'task-scheduled': '任务已排队',
    'task-deduped': '任务已存在，未重复执行',
    'task-cancelled': '任务已取消',
    'task-ended': '任务终止',
    'run-start': '开始改写',
    'run-skip': '跳过改写',
    'run-error': '改写出错',
    'run-cancelled': '改写已取消',
    'run-stale': '改写结果已过期',
    'run-stale-before-apply': '写回前发现已过期',
    'run-apply-failed': '写回失败',
    'run-no-change': '写回后没有变化',
    'run-success': '改写完成',
    'request-claimed': '请求已被受理',
    'request-group': '请求分组',
    'request-group-skip': '未分组请求',
    'request-aborted': '请求已中止',
    'request-error': '请求出错',
    'request-stale-before-fetch': '发送前发现已过期',
    'request-stale-after-fetch': '收到后已过期',
    retry: '重试请求',
    'fetch-start': '发送 AI 请求',
    'fetch-response': '收到 AI 响应',
    'fetch-success': '请求成功',
    'fetch-failure': '请求失败',
    'fetch-failure-ignored': '忽略这次请求失败',
    'response-content': 'AI 回复正文',
    'response-deferred': '延后写回',
    'parse-result': '解析结果',
    'parse-failed': '解析失败',
    'prompt-built': '提示词已生成',
    'not-sent': '未发送请求',
    'terminate-requested': '请求终止',
    // 写回与净化
    'content-snapshot-frozen': '内容快照已固定',
    'apply-start': '开始写回',
    'apply-success': '写回完成',
    'apply-skip': '跳过写回',
    'apply-deferred': '延后写回',
    'apply-flush': '立即写回',
    'apply-flush-skip': '不立即写回',
    'atomic-commit': '原子提交完成',
    'program-commit': '程序净化完成',
    'final-cleanse-ready': '终稿净化就绪',
    'final-cleanse-skip-request': '终稿净化未建请求',
    'final-cleanse-no-ai-task': '终稿净化没有 AI 任务',
    'final-cleanse-deferred-to-ai': '终稿净化交给 AI',
    'fallback-applied': '已执行回退净化',
    'fallback-skip': '跳过回退净化',
    'popup-preparing': '准备结果弹窗',
    'popup-cleared': '结果弹窗已清空',
    'popup-dismissed': '结果弹窗已关闭',
    // 数据库（Shujuku）
    'shujuku-program-commit': 'Shujuku 净化完成',
    'shujuku-program-check': 'Shujuku 净化检查',
    'shujuku-pending-armed': 'Shujuku 等待目标已建立',
    'shujuku-callback-received': 'Shujuku 更新回调',
};
// 原因值中文表：被拒/跳过时最需要看懂的就是这一栏。
const debugReasonDisplayLabels = {
    'dry-run': '酒馆在试运行，没有真正生成',
    'background-generation': '后台静默生成，不参与改写',
    'no-active-generation': '当时没有正在进行的生成会话',
    'generation-inactive': '生成会话已结束',
    'generation-missing': '找不到对应的生成会话',
    'generation-message-mismatch': '消息与本轮生成对不上',
    'generation-request-already-owned': '这一轮请求已被占用',
    'generation-request-not-scheduled': '这一轮请求还没排队',
    'generation-target-not-bound': '还没绑定到具体楼层',
    'superseded-by-new-generation': '被新的一次生成顶替',
    'chat-changed': '切换了聊天',
    'chat-reference-changed': '聊天引用已变化',
    'branch-changed': '切换了分支',
    'message-branch-changed': '消息分支已变化',
    'message-index-out-of-range': '消息序号超出范围',
    'invalid-message-id': '消息序号无效',
    'invalid-index': '序号无效',
    'invalid-rewrite-map': '改写映射无效',
    'message-not-assistant': '目标不是 AI 回复',
    'not-assistant-message': '目标不是 AI 回复',
    'message-not-bound': '还没绑定到具体楼层',
    'message-reference-changed': '消息对象已变',
    'message-ref-changed': '消息对象已变',
    'message-stage-changed': '消息所处的阶段变了',
    'message-program-stage-changed': '消息的程序净化阶段变了',
    'message-text-changed': '消息正文被改动过',
    'message-text-missing': '消息没有正文',
    'message-text-not-cleanse-result': '正文不是净化结果',
    'message-reverted': '消息已被还原',
    'not-latest-trackable-message': '不是可跟踪的最新楼层',
    'no-text-change': '正文没有变化',
    'other-message-deleted': '删的是别的楼层',
    'already-completed': '已经处理过了',
    'already-pending': '已经在等待处理',
    'content-identity-missing': '缺少内容标识',
    'item-locate-failed': '找不到要改的句子',
    'rewrite-count-mismatch': '改写条数对不上',
    'json-parse-error': 'JSON 解析失败',
    'not-json-object': '返回的不是 JSON 对象',
    'swipe-slot-not-materialized': 'Swipe 分支还没落盘',
    'target-message-deleted': '目标楼层被删除',
    'target-message-index-changed': '目标楼层位置变了',
    'target-message-swiped': '目标楼层切了 Swipe',
    'target-swipe-structure-changed': '目标楼层的 Swipe 结构变了',
    'target-message-structure-changed': '目标楼层结构变了',
    'target-invalidated': '目标已失效',
    'empty': '内容为空',
    'empty-message': '消息为空',
    migration: '迁移数据时',
};

const debugModeDisplayLabels = {
    normal: '普通生成',
    regenerate: '重新生成',
    continue: '继续生成',
    impersonate: '扮演生成',
    quiet: '后台静默生成',
    swipe: 'Swipe 生成',
    first_message: '首条消息',
};

const debugSourceDisplayLabels = {
    'message-cleanse': '普通消息',
    'manual-recleanse': '手动重净化',
    'ai-finalization': 'AI 终稿内程序净化',
    'ai-fallback': 'AI 回退程序净化',
    'shujuku-auto': '自动回调',
    'shujuku-direct': '直接改写',
};
const compactDebugStageFields = {
    'program-commit': ['source', 'messageId', 'changedTargets', 'changedSwipeCount', 'beforeLength', 'afterLength'],
    'apply-success': ['index', 'appliedCount', 'skippedCount'],
    'shujuku-program-commit': ['source', 'messageId', 'targetCount', 'changedCount'],
    'shujuku-program-check': [
        'source',
        'messageId',
        'persistenceTargetCount',
        'newEntryCount',
        'operationKindCounts',
        'rowUpsertCount',
        'candidateCellCount',
        'targetCount',
        'changedCount',
        'result',
    ],
    'shujuku-pending-armed': ['source', 'messageId'],
    'shujuku-callback-received': ['hasPending', 'active', 'messageId'],
};
const debugResultDisplayLabels = {
    'no-targets': '未取得候选单元格',
    'no-changes': '候选无需修改',
};
const firstDebugDisplayFields = ['generationId', 'messageId', 'requestState', 'source'];
const validationDebugDisplayFields = ['validationMode', 'validationReason'];

/* ---------------------------------------------------------------------------
 * 显示层：把结构化事件排成人能读的时间线。
 * 三条约定：
 *   1. 正序 —— 先发生的事在上面，从上往下读就是时间顺序（旧版是倒序，因果读反）。
 *   2. 时间用本地时区 —— 旧版直接印 UTC，比本地慢 8 小时，会被当成旧日志。
 *   3. 连续重复的同类事件合并计数 —— 一次试运行会产生十几条一模一样的记录。
 * 阶段名、原因、模式、来源、结果全部走中文表；表里没有的值原样显示，便于反馈排查。
 * ------------------------------------------------------------------------- */

const localizedValueFields = new Set(['source', 'result', 'reason', 'mode', 'hostGenerationType', 'tailRole']);

function localizeValue(value, field) {
    if (field === 'tailRole') return value === 'assistant' ? 'AI 回复' : value === 'user' ? '用户' : value;
    if (field === 'hostGenerationType') return debugModeDisplayLabels[value] || value;
    if (field === 'mode') return debugModeDisplayLabels[value] || value;
    if (field === 'reason') return debugReasonDisplayLabels[value] || value;
    if (field === 'source') return debugSourceDisplayLabels[value] || value;
    if (field === 'result') return debugResultDisplayLabels[value] || value;
    return value;
}

function formatDebugDisplayValue(value, field = '') {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? '是' : '否';
    if (typeof value === 'string') {
        const localized = localizedValueFields.has(field) ? localizeValue(value, field) : value;
        return String(localized).replace(/\r/g, '\\r').replace(/\n/g, '\\n');
    }
    if (typeof value === 'object') {
        // 采样参数这类小对象压成一行，避免一条事件撑出五六行。
        return Object.entries(value)
            .map(([key, item]) => `${debugDisplayLabels[key] || key} ${formatDebugDisplayValue(item, key)}`)
            .join(' · ');
    }
    return String(value);
}

// 空值不占位置：'原因 —' 这种行没有信息，只会拉长日志。
function hasDisplayValue(details, field) {
    return Object.hasOwn(details, field)
        && details[field] !== ''
        && details[field] !== null
        && details[field] !== undefined;
}

function formatDebugDisplayFields(details, fields) {
    return fields
        .filter(field => hasDisplayValue(details, field))
        .map(field => `${debugDisplayLabels[field] || field} ${formatDebugDisplayValue(details[field], field)}`)
        .join(' · ');
}

// 每一类事件只铺开真正有信息量的字段；冗余的 chatId / generationId 不重复打印。
const shownDebugFields = {
    'generation-start-observed': ['mode', 'automaticTrigger', 'tailRole', 'chatLength'],
    'generation-start-ignored': ['mode', 'reason'],
    'message-received-observed': ['messageId', 'hostGenerationType', 'chatLength'],
    'payload-rejected': ['source', 'reason'],
    'message-target-rejected': ['reason'],
    'message-target-confirmed': ['messageId', 'reason'],
    'message-swipe-ignored': ['index', 'reason'],
    'message-deleted-observed': ['postDeleteChatLength', 'messageId', 'outcome'],
    'internal-message-mutation-rejected': ['index', 'reason'],
    'internal-message-mutation-acknowledged': ['source', 'previousLength', 'messageLength'],
    'generation-ended-observed': ['postOperationChatLength'],
    'fetch-start': ['model', 'promptLength', 'timeoutMs', 'index'],
    'fetch-response': ['index'],
    'fetch-failure': ['reason'],
    'run-skip': ['reason'],
    'run-error': ['reason'],
    'run-cancelled': ['reason'],
    'run-stale': ['reason'],
    'task-cancelled': ['reason'],
    'task-deduped': ['reason'],
    'not-sent': ['reason'],
    'apply-skip': ['reason'],
    'parse-failed': ['reason'],
    'program-commit': ['source', 'messageId', 'changedTargets', 'changedSwipeCount', 'beforeLength', 'afterLength'],
    'apply-success': ['index', 'appliedCount', 'skippedCount'],
    'atomic-commit': ['index'],
    'pre-run-validation': ['validationMode', 'validationReason'],
};

function eventDisplayFields(stage, details) {
    if (stage === 'shujuku-program-check') {
        const present = compactDebugStageFields[stage].filter(field => hasDisplayValue(details, field));
        if (present.length > 0) return present;
    }
    const preferred = shownDebugFields[stage];
    if (preferred) {
        const present = preferred.filter(field => hasDisplayValue(details, field));
        if (present.length > 0) return present;
    }
    // 未登记的阶段：身份字段已省略，其余原样列出（值已中文化）。
    const rendered = [...firstDebugDisplayFields, 'chatId'];
    return Object.keys(details).filter(field => !rendered.includes(field));
}

// 日志时区跟随设备当前时区（不传 timeZone，交给 Intl 用系统设置）：
// 用户看到的就是自己设备上的钟，挂 VPN 不改设备的时区/区域设置，所以不受影响。
const debugClockFormatter = new Intl.DateTimeFormat('en-GB', {
    hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit',
});
const debugDateFormatter = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit',
});

export function getDebugLogTimeZoneLabel() {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
    } catch {
        return '';
    }
}

function formatTimeZonePart(formatter, isoTime, type) {
    const date = new Date(String(isoTime || ''));
    if (Number.isNaN(date.getTime())) return '';
    return formatter.formatToParts(date).find(part => part.type === type)?.value || '';
}

function formatClockLabel(isoTime) {
    const date = new Date(String(isoTime || ''));
    if (Number.isNaN(date.getTime())) return String(isoTime || '');
    return ['hour', 'minute', 'second'].map(type => formatTimeZonePart(debugClockFormatter, isoTime, type)).join(':');
}

function formatDateLabel(isoTime) {
    const date = new Date(String(isoTime || ''));
    if (Number.isNaN(date.getTime())) return '';
    return ['year', 'month', 'day'].map(type => formatTimeZonePart(debugDateFormatter, isoTime, type)).join('-');
}

// 只有一条"消息序号"的事件不必重复这一项，正文里已经说清了。
const redundantSingleFields = new Set(['index', 'messageId']);

function formatDebugDisplayEvent(event) {
    const details = event?.details && typeof event.details === 'object' ? event.details : {};
    const stage = String(event?.stage || '');
    let fields = eventDisplayFields(stage, details).filter(field => hasDisplayValue(details, field));
    if (fields.length === 1 && redundantSingleFields.has(fields[0])) fields = [];
    const heading = `${formatClockLabel(event?.time)}  ${debugStageDisplayLabels[stage] || stage}`;
    const line = formatDebugDisplayFields(details, fields);
    return line ? `${heading}\n    ${line}` : heading;
}

const quietTriggerReasons = new Set(['dry-run', 'background-generation', 'no-active-generation']);

// 判一件事是不是"空转"：宿主起了生成、消息到了、但没有进入改写流程。
// 这类事件一次对话里会刷十几条，整段合并成一行摘要，不逐条铺开。
function isQuietDebugEvent(event) {
    const stage = String(event?.stage || '');
    const details = event?.details && typeof event.details === 'object' ? event.details : {};
    if (stage === 'generation-start-ignored') return quietTriggerReasons.has(String(details.reason || ''));
    if (stage === 'payload-rejected') return String(details.reason || '') === 'no-active-generation';
    if (stage === 'message-received-observed') return !String(details.generationId || '');
    return false;
}

const quietClusterGapMs = 30_000;

function formatQuietCluster(cluster) {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    const startClock = formatClockLabel(first?.time);
    const endClock = formatClockLabel(last?.time);
    const span = cluster.length > 1 && startClock !== endClock ? `${startClock}–${endClock}` : startClock;
    const counts = new Map();
    for (const event of cluster) {
        const stageLabel = debugStageDisplayLabels[String(event?.stage || '')] || String(event?.stage || '');
        counts.set(stageLabel, (counts.get(stageLabel) || 0) + 1);
    }
    const breakdown = [...counts.entries()].map(([label, count]) => (count > 1 ? `${label}×${count}` : label)).join('、');
    // 取簇里出现最多的那条原因，避免落在没有原因字段的"收到消息"上。
    const reasonCounts = new Map();
    for (const event of cluster) {
        const reason = String(event?.details?.reason || '');
        if (quietTriggerReasons.has(reason)) reasonCounts.set(reason, (reasonCounts.get(reason) || 0) + 1);
    }
    const topReason = [...reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const reasonLabel = topReason ? localizeValue(topReason, 'reason') : '没有进入改写流程';
    return `⋯ ${span}  ${reasonLabel}\n    （合并 ${cluster.length} 条：${breakdown}）`;
}

// 顶栏与正文用同一个上限取数，条数才和看得到的内容一致。
export function countDebugDisplayEvents(events) {
    return (Array.isArray(events) ? events : []).slice(-debugLogLimit).length;
}

// 日期正序（默认）或倒序：倒序时日期分组与组内条目一起翻转，
// 保证「最近发生的在最上面」读起来仍然连贯。
let debugDisplayOrder = 'asc';

export function getDebugDisplayOrder() {
    return debugDisplayOrder;
}

export function setDebugDisplayOrder(order) {
    debugDisplayOrder = order === 'desc' ? 'desc' : 'asc';
    return debugDisplayOrder;
}

// 按日期切成若干段，每段带上该日期的事件条数（合并行按它代表的真实条数计）。
function buildDebugDateSections(list) {
    const sections = [];
    let section = null;
    let quietCluster = [];
    let previousTime = 0;

    const flushQuietCluster = () => {
        if (quietCluster.length === 0) return;
        section.blocks.push(formatQuietCluster(quietCluster));
        section.count += quietCluster.length;
        quietCluster = [];
    };

    for (const event of list) {
        const date = formatDateLabel(event?.time);
        const time = new Date(String(event?.time || '')).getTime();
        const gap = Number.isFinite(previousTime) && previousTime > 0 ? time - previousTime : 0;
        if (Number.isFinite(time)) previousTime = time;

        const dateChanged = !section || section.date !== date;
        if (dateChanged || gap > quietClusterGapMs) flushQuietCluster();
        if (dateChanged) {
            section = { date, count: 0, blocks: [] };
            sections.push(section);
        }

        if (isQuietDebugEvent(event)) {
            quietCluster.push(event);
            continue;
        }
        flushQuietCluster();
        section.blocks.push(formatDebugDisplayEvent(event));
        section.count += 1;
    }
    flushQuietCluster();
    return sections;
}

export function formatDebugDisplayEvents(events) {
    const list = (Array.isArray(events) ? events : []).slice(-debugLogLimit);
    if (list.length === 0) return '暂无运行事件。';

    const sections = buildDebugDateSections(list);
    const descending = debugDisplayOrder === 'desc';
    const orderedSections = descending ? [...sections].reverse() : sections;
    const lines = [];
    for (const section of orderedSections) {
        if (lines.length > 0) lines.push('');
        lines.push(`══════ ${section.date} · ${section.count} 条 ══════`);
        lines.push(...(descending ? [...section.blocks].reverse() : section.blocks));
    }
    return lines.join('\n');
}

export function refreshMountedDebugDisplay(events) {
    try {
        const element = document?.getElementById?.('blai-ai-debug-log');
        const workspace = element?.closest?.('#blai-feedback-workspace');
        const page = workspace?.closest?.('.page-panel[data-page="feedback"]');
        if (page?.classList?.contains('active')
            && workspace?.dataset?.feedbackView === 'runtime-log') {
            const list = Array.isArray(events) ? events.slice(-debugLogLimit) : [];
            element.textContent = formatDebugDisplayEvents(list);
            // 顶栏的事件条数跟正文同一份数据，就地更新，不重绘整个视图。
            const counter = document?.getElementById?.('blai-feedback-log-count');
            if (counter) counter.textContent = String(list.length);
        }
    } catch {
        // 忽略 DOM 缺失或不可用；运行时/存储日志仍然可用。
    }
}
