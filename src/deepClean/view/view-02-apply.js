/** view 的分块：apply。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { getDeepCleanReviewEntry } from '../review.js';
import { deepCleanRuntimeState } from '../state.js';
import { offerDeepCleanTourFirstUse } from '../../ui/tour.js';
import { deepCleanSafeHtml, setDeepCleanWorkspaceHeader, deepCleanReviewIdentity, deepCleanBatchSummaryHtml, renderDeepCleanResourcePanel } from './view-00-selection.js';
import { deepCleanLookaheadHtml, deepCleanProtectionLabel, renderDeepCleanReviewViewSwitcher, renderDeepCleanReviewView } from './view-01-progress.js';

export function renderDeepCleanReview(session, lookaheadProgress = null) {
    if (!session) return;
    const total = session.reviewItemIndexes.length;
    const stopAction = '<button id="blai-deep-clean-stop" class="blai-deep-clean-header-stop" type="button"><i class="fas fa-xmark" aria-hidden="true"></i><span>停止</span></button>';
    if (total === 0) {
        setDeepCleanWorkspaceHeader('深度净化', '审核 0 / 0', '本批没有需要审核的文本变更。', stopAction);
        $('#blai-deep-clean-content').html(`
            <section class="blai-deep-clean-review-shell" aria-label="深度净化审核">
                <div class="blai-deep-clean-review-main">
                    <section class="blai-deep-clean-review-area"><p class="blai-deep-clean-empty">所有最终候选均与冻结原文相同。</p></section>
                    <aside id="blai-deep-clean-lookahead" class="blai-deep-clean-batch-summary" aria-live="polite">${deepCleanLookaheadHtml(lookaheadProgress)}</aside>
                </div>
                <nav class="blai-deep-clean-review-navigation" aria-label="审核内容项导航"><span></span><strong>当前项 0 / 0</strong><span></span></nav>
                <footer class="blai-deep-clean-review-apply">
                    <p>当前批 · <strong>0 个内容项</strong></p>
                    <button id="blai-deep-clean-apply" type="button">正式应用本批修改</button>
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
    setDeepCleanWorkspaceHeader('深度净化', `审核 ${position + 1} / ${total}`, '', stopAction);
    $('#blai-deep-clean-content').html(`
        <section class="blai-deep-clean-review-shell" aria-label="深度净化审核">
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
                <button type="button" data-deep-clean-review-nav="previous" ${position === 0 ? 'disabled' : ''}><i class="fas fa-arrow-left" aria-hidden="true"></i>上一个</button>
                <strong>当前项 ${position + 1} / ${total}</strong>
                <button type="button" data-deep-clean-review-nav="next" ${position === total - 1 ? 'disabled' : ''}>下一个<i class="fas fa-arrow-right" aria-hidden="true"></i></button>
            </nav>
            <footer class="blai-deep-clean-review-apply">
                <p>当前批 · <strong>${total} 个内容项</strong></p>
                <button id="blai-deep-clean-apply" type="button">正式应用本批修改</button>
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
    setDeepCleanWorkspaceHeader('深度净化 · 正式应用', '正在正式应用', '进度按已完成的真实持久化单元计算。');
    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-processing" aria-label="深度净化正式应用进度">
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
    const totalSelected = selection.characterKeys.length + selection.chatKeys.length + selection.worldBookKeys.length;
    const programModeSelected = selection.processingMode === 'program';
    const scopeBlocked = groupChat || !scopeCharacter;
    const scopeName = scopeCharacter?.displayLabel || '当前没有打开角色卡';

    setDeepCleanWorkspaceHeader('', '深度净化', '初始选择', '', true);
    $('#blai-deep-clean-content').html(`
        <div class="blai-deep-clean-selection">
            <div class="blai-deep-clean-selection-scroll">
                <div class="blai-deep-clean-two-column">
                    <div class="blai-deep-clean-settings">
                        <section class="blai-deep-clean-section blai-deep-clean-options-section" aria-labelledby="blai-deep-clean-options-title">
                            <h3 id="blai-deep-clean-options-title">处理范围与运行设置</h3>
                            <div class="blai-deep-clean-scope-card ${scopeBlocked ? 'is-blocked' : ''}">
                                <span class="blai-deep-clean-scope-label">当前角色卡</span>
                                <strong class="blai-deep-clean-scope-name">${deepCleanSafeHtml(scopeName)}</strong>
                                <span class="blai-deep-clean-scope-detail">${scopeBlocked
        ? (groupChat ? '当前处于群聊，深度净化不处理群聊。' : '请先在酒馆里打开一张角色卡并进入聊天。')
        : `${scopeChats.length} 个聊天 · ${scopeWorldBooks.length} 个世界书`}</span>
                            </div>
                            <div class="blai-deep-clean-options">
                                <label class="blai-deep-clean-option"><span>规则预设</span><select class="blai-deep-clean-select" data-deep-clean-option="presetName" aria-label="深度净化规则预设">${presetNames.length
        ? presetNames.map((name) => `<option value="${deepCleanSafeHtml(name)}" ${name === selection.presetName ? 'selected' : ''}>${deepCleanSafeHtml(name)}</option>`).join('')
        : '<option value="">-- 当前规则 (未绑定存档) --</option>'}</select></label>
                                <fieldset class="blai-deep-clean-option">
                                    <legend>处理模式</legend>
                                    <div class="blai-deep-clean-mode-options" aria-label="深度净化处理模式">
                                        <label class="blai-deep-clean-mode-option">
                                            <input type="radio" name="blai-deep-clean-processing-mode" data-deep-clean-option="processingMode" value="program" ${programModeSelected ? 'checked' : ''}>
                                            <span class="blai-deep-clean-mode-copy"><strong>程序</strong></span>
                                        </label>
                                        <label class="blai-deep-clean-mode-option">
                                            <input type="radio" name="blai-deep-clean-processing-mode" data-deep-clean-option="processingMode" value="program-ai" ${selection.processingMode === 'program-ai' ? 'checked' : ''}>
                                            <span class="blai-deep-clean-mode-copy"><strong>程序 + AI</strong></span>
                                        </label>
                                    </div>
                                </fieldset>
                                <label class="blai-deep-clean-option blai-deep-clean-hidden-toggle">
                                    <span>清理被隐藏的楼层</span>
                                    <input type="checkbox" data-deep-clean-option="includeHidden" ${selection.includeHidden === true ? 'checked' : ''} aria-label="清理被隐藏的楼层">
                                </label>
                            </div>
                        </section>
                    </div>
                    <section class="blai-deep-clean-resources" aria-labelledby="blai-deep-clean-final-title">
                        <header class="blai-deep-clean-resource-header">
                            <h3 id="blai-deep-clean-final-title">处理的文件</h3>
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
        detailFor: (worldBook) => worldBook.worldBookKey,
        showSearch: false,
    })}
                        ${renderDeepCleanResourcePanel({
        kind: 'chat',
        title: '聊天记录',
        items: scopeChats,
        selectionKeys: selection.chatKeys,
        keyName: 'key',
        searchName: 'chats',
        detailFor: (chat) => chat.chatId,
        showSearch: true,
    })}
                        <p class="blai-deep-clean-shujuku-note">角色卡正文、Persona、其它角色与外部世界书、Shujuku 单元格都不在深度净化范围内。</p>
                        </div>
                    </section>
                </div>
            </div>
            <footer class="blai-deep-clean-selection-actions">
                <button id="blai-deep-clean-close" class="blai-deep-clean-secondary-action" type="button">取消并关闭</button>
                <button id="blai-deep-clean-scan" class="blai-deep-clean-primary-action" type="button" ${scopeBlocked || totalSelected === 0 ? 'disabled' : ''}>开始深度净化<i class="fas fa-arrow-right" aria-hidden="true"></i></button>
            </footer>
        </div>
    `);
    offerDeepCleanTourFirstUse();
}


