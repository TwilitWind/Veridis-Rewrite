/** view 的分块：apply。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { getDeepCleanReviewEntry } from '../review.js';
import { deepCleanRuntimeState } from '../state.js';
import { deepCleanSafeHtml, setDeepCleanWorkspaceHeader, deepCleanHeaderCloseAction, deepCleanHeaderStopAction, deepCleanReviewIdentity, deepCleanBatchSummaryHtml, renderDeepCleanResourcePanel, showInitialSelectionError } from './view-00-selection.js';
import { deepCleanLookaheadHtml, deepCleanProtectionLabel, renderDeepCleanReviewViewSwitcher, renderDeepCleanReviewView } from './view-01-progress.js';

export function renderDeepCleanReview(session, lookaheadProgress = null) {
    if (!session) return;
    const total = session.reviewItemIndexes.length;
    const stopAction = deepCleanHeaderStopAction();
    if (total === 0) {
        setDeepCleanWorkspaceHeader('审核 0 / 0', '本批没有需要审核的文本变更。', stopAction);
        $('#blai-deep-clean-content').html(`
            <section class="blai-deep-clean-review-shell" aria-label="深度清理审核">
                <div class="blai-deep-clean-review-main">
                    <section class="blai-deep-clean-review-area"><p class="blai-deep-clean-empty">所有最终候选均与冻结原文相同。</p></section>
                    <aside id="blai-deep-clean-lookahead" class="blai-deep-clean-batch-summary" aria-live="polite">${deepCleanLookaheadHtml(lookaheadProgress)}</aside>
                </div>
                <nav class="blai-deep-clean-review-navigation" aria-label="审核内容项导航"><span></span><strong>当前项 0 / 0</strong><span></span></nav>
                <footer class="blai-deep-clean-review-apply">
                    <p>当前批 · <strong>0 个内容项</strong></p>
                    <button id="blai-deep-clean-apply" type="button" aria-label="正式应用本批修改" title="正式应用本批修改">应用本批</button>
                </footer>
            </section>
        `);
        return;
    }
    const itemIndex = session.currentItemIndex;
    const position = session.reviewItemIndexes.indexOf(itemIndex);
    const item = session.processedRun?.contentItems?.[itemIndex];
    const entry = getDeepCleanReviewEntry(session, itemIndex);
    if (!item || !entry || position < 0) return;
    const viewMode = ['review', 'original', 'cleaned', 'final'].includes(session.viewMode)
        ? session.viewMode
        : 'review';
    setDeepCleanWorkspaceHeader(`审核 ${position + 1} / ${total}`, '', stopAction);
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-review-shell" aria-label="深度清理审核">
            <div class="blai-deep-clean-review-main">
                <section class="blai-deep-clean-review-area">
                    <header class="blai-deep-clean-review-head">
                        <div>
                            <p>当前审核</p>
                            <h3>${deepCleanSafeHtml(deepCleanReviewIdentity(item))}</h3>
                            ${deepCleanProtectionLabel(item) ? `<span class="blai-deep-clean-review-protection">${deepCleanProtectionLabel(item)}</span>` : ''}
                        </div>
                        ${renderDeepCleanReviewViewSwitcher(viewMode)}
                    </header>
                    <div class="blai-deep-clean-review-scroll">
                        ${renderDeepCleanReviewView(session, itemIndex, item, entry)}
                    </div>
                </section>
                <aside id="blai-deep-clean-lookahead" class="blai-deep-clean-batch-summary" aria-live="polite">${deepCleanLookaheadHtml(lookaheadProgress)}</aside>
            </div>
            <nav class="blai-deep-clean-review-navigation" aria-label="审核内容项导航">
                <button type="button" data-deep-clean-review-nav="previous" aria-label="上一个" title="上一个" ${position === 0 ? 'disabled' : ''}><i class="fa-solid fa-chevron-up" aria-hidden="true"></i></button>
                <strong>当前项 ${position + 1} / ${total}</strong>
                <button type="button" data-deep-clean-review-nav="next" aria-label="下一个" title="下一个" ${position === total - 1 ? 'disabled' : ''}><i class="fa-solid fa-chevron-down" aria-hidden="true"></i></button>
            </nav>
            <footer class="blai-deep-clean-review-apply">
                <p>当前批 · <strong>${total} 个内容项</strong></p>
                <button id="blai-deep-clean-apply" type="button" aria-label="正式应用本批修改" title="正式应用本批修改">应用本批</button>
            </footer>
        </section>
    `);
}

function deepCleanApplyResourceTypeLabel(resourceType) {
    return {
        character: '角色卡',
        'chat-branch': '聊天记录',
        'persona-settings': 'User 设定',
        'world-book': '世界书',
    }[resourceType] || resourceType;
}

function deepCleanApplyStatusLabel(status) {
    return { applied: '已应用', failed: '失败' }[status] || status;
}

export function renderDeepCleanApplyProgress(progress = {}) {
    const completed = Number(progress.completed) || 0;
    const total = Number(progress.total) || 0;
    const detail = progress.resourceKey
        ? `${deepCleanApplyResourceTypeLabel(progress.resourceType)} · ${progress.resourceKey} · ${deepCleanApplyStatusLabel(progress.status)}`
        : '正在准备正式持久化单元';
    const session = deepCleanRuntimeState.deepCleanSelection?.currentReviewSession;
    const batch = session?.processedRun?.reviewBatch || {};
    setDeepCleanWorkspaceHeader('正在正式应用', '进度按已完成的真实持久化单元计算。');
    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-processing" aria-label="深度清理正式应用进度">
            <main class="blai-deep-clean-processing-main">
                <div class="blai-deep-clean-processing-intro"><h3>正式应用</h3><p>${deepCleanSafeHtml(detail)}</p></div>
                <ol class="blai-deep-clean-pipeline"><li class="is-active"><span class="blai-deep-clean-pipeline-marker"></span><div><strong>正在持久化审核决定</strong><span>${completed} / ${total}</span>${total > 0 ? `<progress class="is-determinate" value="${completed}" max="${total}" aria-label="正式应用进度"></progress>` : ''}</div></li></ol>
                <button id="blai-deep-clean-stop" class="blai-deep-clean-secondary-action" type="button">停止处理</button>
            </main>
            ${deepCleanBatchSummaryHtml({ title: '当前批', itemIndexes: batch.itemIndexes, sourceCharacterCount: batch.sourceCharacterCount, status: '正在应用审核决定', emptyText: '没有可显示的内容项。' })}
        </div>
    `);
}

export function renderDeepCleanInitialSelection(selection, presets = {}) {
    if (!selection) return;
    const { inventory } = selection;
    // 缺清单时明确报错并给关闭按钮，绝不让页面停在旧屏、按钮看似"点不动"。
    if (!inventory?.current) {
        showInitialSelectionError(new Error('资源清单不可用，请关闭深度清理后重试。'));
        return;
    }
    const presetNames = Object.keys(presets);
    const groupChat = inventory.current.groupChat === true;
    const scopeCharacterKey = String(selection.scopeCharacterKey || '');
    const scopeCharacter = inventory.characters.find((character) => character.characterKey === scopeCharacterKey) || null;
    const scopeChats = scopeCharacter
        ? inventory.chats.filter((chat) => chat.characterKey === scopeCharacter.characterKey)
        : [];
    const scopeWorldBooks = scopeCharacter
        ? inventory.worldBooks.filter((worldBook) => worldBook.characterKeys.includes(scopeCharacter.characterKey))
        : [];
    // 角色卡正文是固定处理项、UI 上无可勾选控件，不计入「共选择 N 项」；
    // 这里只数用户真正能勾选的世界书与聊天记录。
    const totalSelected = selection.chatKeys.length + selection.worldBookKeys.length;
    const programModeSelected = selection.processingMode === 'program';
    const scopeBlocked = groupChat || !scopeCharacter;
    const scopeName = scopeCharacter?.displayLabel || '当前没有打开角色卡';

    setDeepCleanWorkspaceHeader('深度清理', '', deepCleanHeaderCloseAction());
    // 勾选复选框会走这里整块重渲染；先记住滚动位置，重建后还原，避免一勾选就被强制拉回顶部。
    const previousScrollTop = $('#blai-deep-clean-content .blai-deep-clean-selection-scroll').get(0)?.scrollTop || 0;
    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-selection">
            <div class="blai-deep-clean-selection-scroll">
                <div class="blai-deep-clean-two-column">
                    <div class="blai-deep-clean-settings">
                        <section class="blai-deep-clean-section blai-deep-clean-options-section" aria-labelledby="blai-deep-clean-options-title">
                            <h3 id="blai-deep-clean-options-title">处理设置</h3>
                            <div class="blai-deep-clean-scope-card ${scopeBlocked ? 'is-blocked' : ''}">
                                <span class="blai-deep-clean-scope-label">当前角色卡：</span>
                                <span class="blai-deep-clean-scope-name" title="${deepCleanSafeHtml(scopeName)}">${deepCleanSafeHtml(scopeName)}</span>
                                ${scopeBlocked ? `<span class="blai-deep-clean-scope-detail">${groupChat ? '当前处于群聊，深度清理不处理群聊。' : '请先在酒馆里打开一张角色卡并进入聊天。'}</span>` : ''}
                            </div>
                            <div class="blai-deep-clean-options">
                                <label class="blai-deep-clean-option"><span>规则预设</span><select class="blai-deep-clean-select" data-deep-clean-option="presetName" aria-label="深度清理规则预设">${presetNames.length
        ? presetNames.map((name) => `<option value="${deepCleanSafeHtml(name)}" ${name === selection.presetName ? 'selected' : ''}>${deepCleanSafeHtml(name)}</option>`).join('')
        : '<option value="">-- 当前规则 (未绑定存档) --</option>'}</select></label>
                                <fieldset class="blai-deep-clean-option">
                                    <legend>处理模式</legend>
                                    <div class="blai-deep-clean-mode-options" aria-label="深度清理处理模式">
                                        <label class="blai-deep-clean-mode-option">
                                            <input type="radio" name="blai-deep-clean-processing-mode" data-deep-clean-option="processingMode" value="program" ${programModeSelected ? 'checked' : ''}>
                                            <span class="blai-deep-clean-mode-copy"><strong>程序改写</strong></span>
                                        </label>
                                        <label class="blai-deep-clean-mode-option">
                                            <input type="radio" name="blai-deep-clean-processing-mode" data-deep-clean-option="processingMode" value="program-ai" ${selection.processingMode === 'program-ai' ? 'checked' : ''}>
                                            <span class="blai-deep-clean-mode-copy"><strong>程序 + AI 改写</strong></span>
                                        </label>
                                    </div>
                                </fieldset>
                                <label class="blai-deep-clean-option blai-deep-clean-hidden-toggle">
                                    <span>清理被 /hide 隐藏的楼层</span>
                                    <input type="checkbox" data-deep-clean-option="includeHidden" ${selection.includeHidden === true ? 'checked' : ''} aria-label="清理被 /hide 隐藏的楼层">
                                </label>
                            </div>
                        </section>
                    </div>
                    <section class="blai-deep-clean-resources" aria-labelledby="blai-deep-clean-final-title">
                        <header class="blai-deep-clean-resource-header">
                            <h3 id="blai-deep-clean-final-title">处理范围</h3>
                            <p>共选择 <strong>${totalSelected}</strong> 项 · 只处理当前角色卡的世界书与聊天记录</p>
                        </header>
                        <div class="blai-deep-clean-resource-workspace">
                        ${renderDeepCleanResourcePanel({
        kind: 'world-book',
        title: '世界书',
        items: scopeWorldBooks,
        selectionKeys: selection.worldBookKeys,
        keyName: 'worldBookKey',
        searchName: 'world-books',
        // 右侧小字只标资源类型：被某个聊天绑定的 world_info 是「知识书」，其余是角色卡「世界书」。
        detailFor: (worldBook) => (Array.isArray(worldBook.chatKeys) && worldBook.chatKeys.length ? '知识书' : '世界书'),
        showSearch: false,
    })}
                        ${renderDeepCleanResourcePanel({
        kind: 'chat',
        title: '聊天记录',
        items: scopeChats,
        selectionKeys: selection.chatKeys,
        keyName: 'key',
        searchName: 'chats',
        // 右侧小字标当前分支：当前打开的聊天 vs 该角色卡的其它历史对话。
        detailFor: (chat) => (chat.key === inventory.current.chatKey ? '当前对话' : '其他对话'),
        showSearch: true,
    })}
                        </div>
                    </section>
                </div>
            </div>
            <footer class="blai-deep-clean-selection-actions">
                <button id="blai-deep-clean-scan" class="blai-deep-clean-primary-action" type="button" ${scopeBlocked || totalSelected === 0 ? 'disabled' : ''}>扫描</button>
            </footer>
        </div>
    `);
    // 恢复勾选前的滚动位置：整块 .html() 重建会把 scrollTop 归零，同步设回原值。
    const scrollEl = $('#blai-deep-clean-content .blai-deep-clean-selection-scroll').get(0);
    if (scrollEl && previousScrollTop > 0) scrollEl.scrollTop = previousScrollTop;
}


