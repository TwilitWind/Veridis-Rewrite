/** tour 的分块：steps。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { showResponsivePage } from '../shell.js';
import { activeNavigationTarget, toolsPageTourTarget, feedbackPageTourTarget, aiAdvancedGenerationTourTarget, currentRulesetTourTarget, presetImportTourTarget, ruleToolsTourTarget, deepCleanLaunchTourTarget, deepCleanQuickSelectionTourTarget, deepCleanFinalSelectionTourTarget, deepCleanPresetTourTarget, deepCleanOptionsTourTarget, escapeHtml } from './tour-00-targets.js';

export const mainSteps = [
    { title: 'Veridis Rewrite 的五个区域', badge: '基础', body: '首页用于管理规则集和规则；AI 页面配置模型改写；净化页面包含标签作用范围和深度净化；工具页面包含预设绑定解析与附加功能；反馈页面用于运行日志、AI 上下文与提交反馈。\n\n电脑端在左侧栏切换，手机端在底部栏切换。', target: activeNavigationTarget },
    { page: 'overview', title: '当前规则集', badge: '基础', body: '这里显示当前查看和使用的净化规则集。\n\n规则集中的规则可以在下方添加、编辑、启用或停用。', target: currentRulesetTourTarget },
    { page: 'overview', title: '导入预设', badge: '基础', body: '可直接导入 AI 改写预设。预设可在帖子内下载；手机端点预设框右侧的竖向省略号，在菜单里选择导入。', target: presetImportTourTarget },
    { page: 'overview', title: '编辑规则', badge: '基础', body: '「添加」用于建立新的规则组，现有规则显示在下方。\n\n规则改动会在关闭插件或切换规则集时提示保存；搜索、批量编辑和反序排序用于规则管理。', target: ruleToolsTourTarget },
    { page: 'ai', title: 'AI 改写', badge: '按需', body: 'AI 页面包含 API、API Key、模型和「启用 AI 改写」设置。\n\n启用 AI 改写的规则会使用这里配置的连接和模型。', target: '#blai-ai-connection-title' },
    { page: 'ai', title: '其他生成参数', badge: '高级', body: '这里包含 Top P、Top K、Max Tokens、惩罚参数、重试、超时、单次条目和 Context 等生成与请求参数。\n\n它们分别控制采样范围、输出长度、请求行为和单次处理规模。', target: aiAdvancedGenerationTourTarget },
    { page: 'clean', title: '标签作用范围', badge: '可选', body: '这个设置用于限制 XML 标签内容的净化范围。\n\n「保护特定标签」会排除启用标签中的内容；「净化特定标签」只处理启用标签中的内容。\n\n在「保护特定标签」模式下，如果没有启用任何标签，不会额外限制净化范围，普通内容会照常净化。', target: '#blai-clean-scope-title' },
    { page: 'clean', title: '深度净化', badge: '高级', body: '深度净化批量处理已有的角色、聊天分支、User 设定、世界书和相关数据。', target: deepCleanLaunchTourTarget },
    { page: 'tools', title: '工具页', badge: '高级 / 按需', body: '这里包含预设绑定解析，以及合并在一起的「附加功能」：AI 改写快捷键、净化结果楼层数、数据库自动净化和简繁转换 (OpenCC)。', target: toolsPageTourTarget },
    { page: 'tools', title: '净化结果楼层数', badge: '按需', body: '控制可查看净化结果的最近消息数。\n\n只统计最近的非用户消息，通常是 AI 回复。这个值同时控制透视按钮的显示范围。\n\n调小会立即清理超出范围的记录；调大不会恢复已清理的记录。记录保存在聊天消息中，刷新后仍能看到。', target: 'label[for="blai-diff-limit-input"]' },
    { page: 'feedback', title: '反馈与诊断', badge: '排查问题 / 提交反馈', body: '排查 AI 改写问题时，可在「AI 上下文」查看本次实际发送给 AI 的内容和返回结果；这些内容只在本地显示。\n\n提交匿名反馈前会先展示完整 JSON 预览，只有你选择的诊断附件会随反馈发送。', target: feedbackPageTourTarget },
    { title: 'Veridis Rewrite 界面导览完成', body: '首页用于管理规则集和规则；\nAI 页面配置 AI 改写；\n净化页面包含标签作用范围和深度净化；\n工具页面包含预设绑定解析与附加功能；\n反馈页面用于运行日志、AI 上下文与提交反馈。', centered: true, finish: '完成导览' },
];

export const deepCleanSteps = [
    { title: '深度净化的两种处理路径', body: '深度净化先冻结选择并扫描，再按模式处理；扫描阶段只读不写。', centered: true, extra: '<div class="blai-tour-paths"><div><strong>程序改写</strong><span>规则预设 → 程序改写 → 直接应用 → 扫描确认 → 按批写入</span><small>执行确定性的程序规则，例如格式整理、标签处理和固定替换。扫描确认后按批写入对应资源。</small></div><div><strong>程序 + AI 改写</strong><span>规则预设 → 程序 + AI 改写 → 扫描 → 处理 → 审查 → 确认应用</span><small>程序改写后继续执行 AI 规则，并进入审查界面。审查中可以选用不同结果或直接修改最终文本。</small></div></div>' },
    { title: '先确认当前角色卡', body: '深度净化只处理当前角色卡关联的聊天记录与世界书；角色卡正文作为固定项一并处理，不出现在勾选列表里。\n\n群聊或没有打开角色卡时无法继续。\n\n这里只确定来源，真正要处理的内容在右侧勾选。', target: deepCleanQuickSelectionTourTarget },
    { title: '右侧勾选才是最终处理范围', body: '「处理范围」里的世界书与聊天记录勾选，才是真正会被处理的内容。\n\n点「开始深度净化」时会冻结当前勾选；之后仍可停下来修改，但扫描使用的是冻结时的选择。', target: deepCleanFinalSelectionTourTarget },
    { title: '深度净化预设', body: '帖子内提供「专供无AI无人工批改的深度清理使用」预设，对应「程序改写 + 直接应用」流程，内容以确定性规则为主。\n\nVeridis Rewrite 不会按预设名自动判断用途，实际使用的是这里选中的预设。', target: deepCleanPresetTourTarget },
    { title: '处理模式与应用方式', body: '「程序改写」只执行程序规则。\n\n「直接应用」在扫描确认后按批处理并写入；「批改后应用」先生成审查结果，再由审查界面确认最终内容。\n\n「程序 + AI 改写」在程序改写后继续执行 AI 规则，并进入审查流程。\n\n「消息 AI 范围」只影响 AI 对聊天消息的读取与处理范围。', target: deepCleanOptionsTourTarget },
    { title: '扫描', body: '点「启动深度净化」进入资源确认，再点「开始深度净化」冻结勾选并开始扫描。\n\n扫描只读取冻结内容，不会写入角色卡、聊天、世界书、人设或数据库。\n\n结果会说明扫描了多少内容项、命中多少项，以及待处理字符数。\n\n确认后，直接应用模式按批写入；需要审查的模式进入审查界面。', target: '#blai-deep-clean-scan' },
    { title: '审查界面', body: '需要审查的处理模式会进入这个界面。\n\n「Review」在完整正文上下文中显示差异。原文和净化后片段可以切换选择；当前采用的片段以及未变化正文都可以直接编辑。\n\n「原版 / 净化后 / 最终」分别显示冻结原文、初始处理结果和当前最终全文。\n\n「上一个 / 下一个」切换当前批中的内容项，旁边显示下一批处理状态。\n\n「正式应用本批修改」将当前批的最终结果写回对应资源。', preview: 'review', centered: true, finish: '完成深度净化导览' },
];

function previewHtml(kind) {
    if (kind !== 'review') return '';
    return `<div class="blai-tour-preview blai-tour-review-preview"><p class="blai-tour-preview-label">教学示例 · 不会读取或修改你的内容</p><div class="blai-tour-review-surface"><div class="blai-tour-review-main"><section class="blai-tour-review-area"><header class="blai-tour-review-head"><div><p>当前审核</p><strong>教学内容项 · 角色卡</strong></div><nav class="blai-tour-review-tabs" aria-label="教学示例审核视图"><span class="is-active">Review</span><span>原版</span><span>净化后</span><span>最终</span></nav></header><div class="blai-tour-review-document">她看向门口<del class="is-old">，停顿了一下</del><ins class="is-new">，随后移开视线</ins>。</div></section><aside class="blai-tour-review-lookahead"><strong>下一批</strong><span>正在准备……</span></aside></div><nav class="blai-tour-review-navigation"><span>上一个</span><strong>当前项 3 / 18</strong><span>下一个</span></nav><footer class="blai-tour-review-apply"><span>当前批 · <strong>18 个内容项</strong></span><b>正式应用本批修改</b></footer></div></div>`;
}

export function cardHtml(step, index, total) {
    const description = step.body.split('\n').map((line) => line ? `<p>${escapeHtml(line)}</p>` : '').join('');
    return `<section class="blai-tour-card ${step.centered || step.preview ? 'blai-tour-centered' : ''}" role="dialog" aria-modal="true" aria-labelledby="blai-tour-title"><div class="blai-tour-card-head"><span>步骤 ${index + 1} / ${total}</span>${step.badge ? `<b>${escapeHtml(step.badge)}</b>` : ''}</div><h2 id="blai-tour-title">${escapeHtml(step.title)}</h2><div class="blai-tour-copy">${description}</div>${step.extra || ''}${step.preview ? previewHtml(step.preview) : ''}<div class="blai-tour-actions"><button type="button" data-tour-action="previous" ${index === 0 ? 'disabled' : ''}>上一步</button>${step.finish ? `<button type="button" class="blai-tour-primary" data-tour-action="finish">${escapeHtml(step.finish)}</button>` : `<button type="button" class="blai-tour-primary" data-tour-action="next">下一步</button>`}<button type="button" data-tour-action="skip" aria-label="跳过并关闭导览">跳过</button></div></section>`;
}

export function welcomeHtml(kind) {
    const deepClean = kind === 'deep-clean';
    return `<section class="blai-tour-card blai-tour-centered" role="dialog" aria-modal="true" aria-labelledby="blai-tour-welcome-title"><p class="blai-tour-kicker">${deepClean ? '深度净化导览' : 'Veridis Rewrite 导览'}</p><h2 id="blai-tour-welcome-title">第一次使用 ${deepClean ? '深度净化' : 'Veridis Rewrite'}？</h2><div class="blai-tour-copy"><p>${deepClean ? '深度净化用于批量处理已有内容，包含程序处理、AI 改写和人工审查等处理路径。' : '导览说明 Veridis Rewrite 的主要界面区域与相关设置。'}</p>${deepClean ? '<p>导览覆盖扫描和审查界面，不会运行深度净化或修改内容。</p>' : ''}</div><div class="blai-tour-actions"><button type="button" class="blai-tour-primary" data-tour-action="start">开始导览</button><button type="button" data-tour-action="direct">直接使用</button></div></section>`;
}

export function removeLayer() {
    document.getElementById('blai-tour-layer')?.remove();
}

export function restoreTourPresentation(tour) {
    if (tour.kind === 'main' && tour.manual && tour.previousPage) showResponsivePage(tour.previousPage);
}

function clamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

function exclusionFor(targetRect, targetGap) {
    return {
        left: targetRect.left - targetGap,
        top: targetRect.top - targetGap,
        right: targetRect.right + targetGap,
        bottom: targetRect.bottom + targetGap,
        width: targetRect.width + targetGap * 2,
        height: targetRect.height + targetGap * 2,
    };
}

function popoverCandidate(side, exclusion, popover, viewport, margin) {
    const horizontal = side === 'right' || side === 'left';
    const primarySpace = side === 'bottom'
        ? viewport.height - margin - exclusion.bottom
        : side === 'top'
            ? exclusion.top - margin
            : side === 'right'
                ? viewport.width - margin - exclusion.right
                : exclusion.left - margin;
    const crossSpace = horizontal ? viewport.height - margin * 2 : viewport.width - margin * 2;
    const primarySize = horizontal ? popover.width : popover.height;
    const crossSize = horizontal ? popover.height : popover.width;
    // 先按可用空间定最终尺寸，再用最终尺寸算坐标。旧版用未收缩的宽度算 left，
    // 手机端目标贴左边缘时 left 会变成负数，提示框整块飞出屏幕。
    const maxWidth = Math.max(0, Math.floor(horizontal ? primarySpace : viewport.width - margin * 2));
    const maxHeight = Math.max(0, Math.floor(horizontal ? viewport.height - margin * 2 : primarySpace));
    const width = Math.min(popover.width, maxWidth);
    const height = Math.min(popover.height, maxHeight);
    const rawLeft = horizontal
        ? (side === 'right' ? exclusion.right : exclusion.left - width)
        : exclusion.left + (exclusion.width - width) / 2;
    const rawTop = horizontal
        ? exclusion.top + (exclusion.height - height) / 2
        : (side === 'bottom' ? exclusion.bottom : exclusion.top - height);
    const left = clamp(rawLeft, margin, viewport.width - margin - width);
    const top = clamp(rawTop, margin, viewport.height - margin - height);
    return {
        side,
        left,
        top,
        width,
        height,
        maxWidth,
        maxHeight,
        primarySpace,
        fits: primarySpace >= primarySize
            && crossSpace >= crossSize
            && Math.abs(rawLeft - left) < 0.5
            && Math.abs(rawTop - top) < 0.5,
    };
}

export function calculateTourPopoverPlacement(targetRect, popoverRect, viewport, { targetGap = 12, viewportMargin = 12, preferredSide = '' } = {}) {
    const exclusion = exclusionFor(targetRect, targetGap);
    const popover = { width: popoverRect.width, height: popoverRect.height };
    const sides = preferredSide ? [preferredSide] : ['bottom', 'top', 'right', 'left'];
    const candidates = sides.map((side) => popoverCandidate(side, exclusion, popover, viewport, viewportMargin));
    const placement = candidates.find((candidate) => candidate.fits);
    if (placement) return { ...placement, constrained: false };
    // 都不放得下时挑「可用面积」最大的方向，避免手机端选到宽度近乎为零的左右侧。
    const score = (candidate) => Math.min(popover.width, candidate.maxWidth) * Math.min(popover.height, candidate.maxHeight);
    const fallback = candidates.reduce((best, candidate) => score(candidate) > score(best) ? candidate : best);
    return { ...fallback, constrained: true };
}

/** 居中卡（欢迎页、完成页、错误页、preview）不依赖 CSS 的 top:50% + translate(-50%,-50%)：
 *  手机上这层受弹窗体系样式影响时 top 会被压成 0，卡片整块飞出屏幕上方。这里统一用
 *  视口中心算最终坐标，并把 transform 显式关掉。 */
export function calculateCenteredTourPlacement(popoverRect, viewport, { viewportMargin = 12 } = {}) {
    const maxWidth = Math.max(0, Math.floor(viewport.width - viewportMargin * 2));
    const maxHeight = Math.max(0, Math.floor(viewport.height - viewportMargin * 2));
    const width = Math.min(popoverRect.width, maxWidth);
    const height = Math.min(popoverRect.height, maxHeight);
    return {
        left: Math.round(clamp((viewport.width - width) / 2, viewportMargin, Math.max(viewportMargin, viewport.width - viewportMargin - width))),
        top: Math.round(clamp((viewport.height - height) / 2, viewportMargin, Math.max(viewportMargin, viewport.height - viewportMargin - height))),
        maxWidth,
        maxHeight,
        width,
        height,
    };
}

export function positionCenteredTour(card) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const margin = 12;
    card.style.setProperty('transform', 'none', 'important');
    card.style.setProperty('--blai-tour-popover-max-width', `${Math.max(0, viewport.width - margin * 2)}px`);
    card.style.setProperty('--blai-tour-popover-max-height', `${Math.max(0, viewport.height - margin * 2)}px`);
    const first = calculateCenteredTourPlacement(card.getBoundingClientRect(), viewport, { viewportMargin: margin });
    card.style.setProperty('--blai-tour-popover-max-width', `${first.maxWidth}px`);
    card.style.setProperty('--blai-tour-popover-max-height', `${first.maxHeight}px`);
    const placement = calculateCenteredTourPlacement(card.getBoundingClientRect(), viewport, { viewportMargin: margin });
    card.style.left = `${placement.left}px`;
    card.style.top = `${placement.top}px`;
    return placement;
}

export function positionTourPopover(card, targetRect) {
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const margin = 12;
    const options = { targetGap: 12, viewportMargin: margin };
    card.style.setProperty('--blai-tour-popover-max-width', `${Math.max(0, viewport.width - margin * 2)}px`);
    card.style.setProperty('--blai-tour-popover-max-height', `${Math.max(0, viewport.height - margin * 2)}px`);
    const first = calculateTourPopoverPlacement(targetRect, card.getBoundingClientRect(), viewport, options);
    card.style.setProperty('--blai-tour-popover-max-width', `${first.maxWidth}px`);
    card.style.setProperty('--blai-tour-popover-max-height', `${first.maxHeight}px`);
    // 变量生效后尺寸可能已收缩，按同一方向用最终尺寸再算一次坐标，保证四边都留在视口内。
    const placement = calculateTourPopoverPlacement(targetRect, card.getBoundingClientRect(), viewport, { ...options, preferredSide: first.side });
    card.style.left = `${Math.round(placement.left)}px`;
    card.style.top = `${Math.round(placement.top)}px`;
    return placement;
}

