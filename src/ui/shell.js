/**
 * 负责 Veridis 外壳创建、外壳级响应式页面投影，以及旧版插件
 * 外壳警告状态；功能专属业务状态属于功能模块。
 */
import { markPresetsUiDirty } from '../presets/state.js';
import { markRulesUiDirty } from '../rules/state.js';
import { logger } from '../log.js';
import { fadeOutThen } from './motion.js';
import { startNativeSelectEnhancer } from './nativeSelectMenu.js';

function applyTauriMobileSurface(selector, surface) {
    $(selector).attr('data-tt-mobile-surface', surface);
}

export function annotateTauriMobileSurfaces() {
    applyTauriMobileSurface('#blai-purifier-popup, #blai-deep-clean-workspace', 'fullscreen-window');
    applyTauriMobileSurface('.blai-modal-shell, #blai-rule-transfer-modal, #blai-diff-modal, #blai-loading-overlay', 'backdrop');
    applyTauriMobileSurface('.blai-modal-card:not(.blai-tour-card), .blai-transfer-content, .blai-diff-modal-card, .blai-loading-panel, .blai-scope-tag-editor-card', 'fullscreen-window');
    applyTauriMobileSurface('.blai-toast', 'free-window');
}

export function isLegacyPurifierDetected() {
    const hasLegacyDom = Boolean(
        document.getElementById('bl-purifier-popup')
        || document.getElementById('bl-wand-btn')
        || document.getElementById('bl-extension-settings-entry')
        || document.getElementById('bl-wand-btn-panel')
    );
    const hasLegacyScript = Array.from(document.scripts || [])
        .some((script) => /\/Veridis-Keyword-filtering-main\//i.test(String(script.src || '')));
    return hasLegacyDom || hasLegacyScript;
}

export function updateLegacyPurifierWarning() {
    const $warning = $('#blai-legacy-purifier-warning');
    if (!$warning.length) return false;
    const detected = isLegacyPurifierDetected();
    $warning.prop('hidden', !detected);
    return detected;
}

const responsivePageMetadata = {
    overview: {
        title: '首页',
        description: '管理规则集、查看统计并编辑规则。',
    },
    ai: {
        title: 'AI',
        description: '配置 AI 改写引擎、连接参数和全局提示词。',
    },
    clean: {
        title: '净化',
        description: '管理需要被改写或保护的 XML 标签范围及深度净化设置。',
    },
    bind: {
        title: '绑定',
        description: '',
    },
    tools: {
        title: '工具',
        description: '管理预设绑定、简繁转换及其他扩展功能。',
    },
    feedback: {
        title: '反馈',
        description: '查看运行日志、AI 上下文与深度清理诊断，并提交匿名反馈。',
    },
};

// 切页是 fade through：旧页先淡出，新页等旧页退干净再淡入。
// 只保留一个待办切换；快速连点时旧任务作废，最终只留下最后一次的目标页。
let pendingPageSwap = null;

export function showResponsivePage(pageId = 'overview') {
    const normalizedPage = responsivePageMetadata[pageId] ? pageId : 'overview';
    const { title, description } = responsivePageMetadata[normalizedPage];
    const $popup = $('#blai-purifier-popup');
    if (!$popup.length) return;

    const $panels = $popup.find('.page-panel');
    const $target = $panels.filter((_, node) => String(node.dataset.page || '') === normalizedPage);
    const previous = $panels.filter('.active').not($target).get(0) || null;

    if (pendingPageSwap) {
        pendingPageSwap.cancel();
        pendingPageSwap = null;
    }
    $panels.removeClass('blai-is-leaving blai-is-entering active');
    $target.addClass('active');
    $popup.find('.rail-btn, .nav-item').each(function() {
        $(this).toggleClass('active', String($(this).attr('data-page-target') || '') === normalizedPage);
    });
    // 当前页写到外壳属性上：样式据此把「全局顶栏 + 页内顶栏」合成一层
    // （首页与反馈页的两条分隔线中间夹着页内顶栏，视觉上是双层顶栏）。
    $popup.attr('data-active-page', normalizedPage);
    $popup.find('[data-title], #blai-responsive-title').text(title);
    $popup.find('#blai-responsive-description').text(description);

    if (!previous || previous === $target.get(0)) return;
    $target.addClass('blai-is-entering');
    let cancel = () => {};
    const swap = { cancel: () => cancel() };
    pendingPageSwap = swap;
    cancel = fadeOutThen(previous, () => {
        if (pendingPageSwap === swap) pendingPageSwap = null;
        // .active 已在点击当帧切走，退场结束只清掉淡出类即可让旧页退出布局。
        previous.classList.remove('blai-is-leaving');
    });
}

export async function setupUI(renderTemplate, templateDirectory) {
    if (typeof renderTemplate !== 'function') {
        throw new TypeError('setupUI requires a SillyTavern template renderer');
    }
    if (typeof templateDirectory !== 'string' || !templateDirectory) {
        throw new TypeError('setupUI requires the current extension template directory');
    }
    logger.debug('[setupUI] 开始初始化 UI');
    $('#blai-purifier-popup, #blai-binding-history-modal, #blai-ai-generation-modal, #blai-ai-additional-modal, #blai-rule-edit-modal, #blai-risk-confirm-modal, #blai-risk-info-modal, #blai-deep-clean-backdrop, #blai-deep-clean-workspace, #blai-feedback-workspace, #blai-rule-transfer-modal, #blai-preset-import-choice-modal, #blai-rule-search-modal, #blai-scope-tags-modal, #blai-scope-tag-editor-modal, #blai-diff-modal, #blai-subrule-edit-modal, #blai-ai-prompt-modal, #blai-ai-model-manage-modal, #blai-loading-overlay, #blai-ai-toast-container, .blai-toast').remove();

    const ensureExtensionPanelEntry = () => {
        if ($('#blai-extension-settings-entry').length || !$('#extensions_settings').length) return;
        $('#extensions_settings').append(`
            <div id="blai-extension-settings-entry" class="inline-drawer blai-extension-settings-entry">
                <div class="inline-drawer-toggle inline-drawer-header">
                    <b>词汇映射</b>
                    <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down interactable"></div>
                </div>
                <div class="inline-drawer-content">
                    <button id="blai-wand-btn-panel" type="button" class="menu_button blai-extension-open-btn">
                        <i class="fa-solid fa-language fa-fw"></i>
                        <span>打开 AI 词汇映射</span>
                    </button>
                </div>
            </div>
        `);
    };

    if (!$('#blai-wand-btn').length) {
        $('#data_bank_wand_container').append(`
            <div id="blai-wand-btn" class="list-group-item flex-container flexGap5" title="词汇映射管理">
                <div class="fa-fw fa-solid fa-language extensionsMenuExtensionButton"></div><span>词汇映射</span>
            </div>`);
    }
    ensureExtensionPanelEntry();
    window.setTimeout(ensureExtensionPanelEntry, 500);

    const templateHtml = await renderTemplate(
        templateDirectory,
        'purifier',
        { logoUrl: new URL('../../images/veridis-logo.png', import.meta.url).href },
        false,
        false,
    );
    $('body').append(templateHtml);
    updateLegacyPurifierWarning();
    window.setTimeout(updateLegacyPurifierWarning, 800);
    markRulesUiDirty(true);
    markPresetsUiDirty(true);
    annotateTauriMobileSurfaces();
    startNativeSelectEnhancer();
}
