/**
 * 透视弹窗说明文案的唯一来源。
 * 界面只在对应场景显示一小段；完整流程由标题旁的「改写说明」气泡承载。
 */
import { escapeHtml } from './compare.js';

/** 来源图例的唯一模板：净化对比（含计数）与深度清理顶栏（不含计数）共用。 */
export function renderSourceLegend(items) {
    return items.map((item) => {
        const key = String(item.key || '');
        const className = ['blai-diff-source', item.key === 'original' ? 'blai-diff-source-original' : '', item.key === 'manual' ? 'blai-diff-source-manual' : ''].filter(Boolean).join(' ');
        const data = key ? ` data-blai-diff-source="${escapeHtml(key)}"` : '';
        const title = escapeHtml(item.title || item.label || '');
        const count = item.countId ? ` <span class="blai-diff-stat" id="${escapeHtml(item.countId)}">0</span>` : '';
        return `<span class="${className}"${data} title="${title}"><i aria-hidden="true"></i>${escapeHtml(item.label || '')}${count}</span>`;
    }).join('');
}

const DIFF_SOURCE_LEGEND_ITEMS = [
    { key: 'original', label: '原文', title: '原文' },
    { key: 'program', label: '程序', title: '程序改写', countId: 'blai-diff-stat-program' },
    { key: 'ai', label: 'AI', title: 'AI 改写', countId: 'blai-diff-stat-ai' },
    { key: 'manual', label: '手改', title: '插件改写后的手动改动', countId: 'blai-diff-stat-manual' },
];

export function mountDiffSourceLegend() {
    const container = document.getElementById('blai-diff-sources');
    if (container) container.innerHTML = renderSourceLegend(DIFF_SOURCE_LEGEND_ITEMS);
}

const REWRITE_HELP_ROWS = [
    ['自动改写', 'AI 回复完成后，插件把净化前的文本记为原文，再按当前模式改写。'],
    ['新聊天旧消息', '没有改写记录时，可以把当前正文记为原文并立即改写。'],
    ['撤回后重新净化', '以当前正文为输入，保留你的手动改动；手改后的正文会作为本次对比的原文。'],
    ['撤回所选', '只处理勾选项；与手改重叠或无法定位的项会跳过。'],
    ['手改显示', '手改内容会直接标在正文里；连续的一段算 1 次，隔开的内容分别计数。'],
];

export function renderDiffRewriteHelpHtml() {
    return '<strong class="blai-info-popover-title">改写如何取文本</strong>'
        + REWRITE_HELP_ROWS.map(([label, detail]) => `<span><strong>${label}：</strong>${detail}</span>`).join('');
}

export function mountDiffRewriteHelp() {
    const panel = document.getElementById('blai-diff-rewrite-info-panel');
    if (panel) panel.innerHTML = renderDiffRewriteHelpHtml();
}

export function buildBaselineEmptyHtml() {
    return '<div class="blai-diff-empty">'
        + '<i class="fa-solid fa-circle-info" aria-hidden="true"></i>'
        + '这条消息还没有改写记录。确定正文写好后，可以把它记为原文并立即改写：'
        + '<button id="blai-diff-baseline-btn" type="button" class="blai-icon-btn blai-diff-baseline-btn" aria-label="按当前正文建立净化基线" title="按当前正文建立净化基线">建立基线</button>'
        + '</div>';
}

export function buildRevertedEmptyHtml(currentText) {
    const state = currentText === 'original'
        ? '当前显示为原文。'
        : '当前文本与保留原文不同。';
    return '<div class="blai-diff-empty">'
        + '<i class="fas fa-shield-halved" aria-hidden="true"></i>'
        + `此消息已撤回并处于免净化保护状态，${state}重新净化会以当前正文为输入，保留你的手动改动。`
        + '点击 <i class="fas fa-wand-magic-sparkles blai-diff-inline-icon"></i> 重新净化文本。'
        + '</div>';
}

export function buildRevertedHistoryLostHtml() {
    return '<div class="blai-diff-empty">'
        + '<i class="fas fa-shield-halved" aria-hidden="true"></i>'
        + '历史对比文本已超出保留范围。重新净化会以当前正文为输入，保留你的手动改动。'
        + '点击 <i class="fas fa-wand-magic-sparkles blai-diff-inline-icon"></i> 重新净化文本。'
        + '</div>';
}

export function buildManualEditHintHtml() {
    return '<div class="blai-diff-empty" data-diff-section="manual">'
        + '<i class="fa-solid fa-pen" aria-hidden="true"></i>'
        + '当前消息已被手动编辑；下方已标出手改内容。撤回会保留你的改动，与手改重叠或无法定位的改写项会跳过。'
        + '</div>';
}

export const DIFF_PICK_HINT = '手改覆盖或无法定位的项会跳过，正文中的手动改动会保留。';
