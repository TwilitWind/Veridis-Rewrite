/** tour 的分块：targets。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { getAppContext } from '../../host/appContext.js';
import { extensionName } from '../../settings/defaults.js';
import { annotateTauriMobileSurfaces } from '../shell.js';
import { normalizeThemeMode } from '../theme.js';

export function guidedTourSeen(kind) {
    const { extension_settings } = getAppContext();
    const seen = extension_settings[extensionName].guidedTourSeen;
    return kind === 'main' ? seen.main : seen.deepClean;
}

export function markGuidedTourSeen(kind) {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const seen = extension_settings[extensionName].guidedTourSeen;
    if (kind === 'main') seen.main = true;
    else if (kind === 'deep-clean') seen.deepClean = true;
    else throw new TypeError(`Unknown Veridis Rewrite guided tour: ${kind}`);
    saveSettingsDebounced();
}

export function currentMainPage() {
    return document.querySelector('#blai-purifier-popup .page-panel.active')?.getAttribute('data-page') || 'overview';
}

export function isPhone() {
    return window.matchMedia?.('(max-width: 600px)').matches === true;
}

export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

export function activeNavigationTarget() {
    return isPhone()
        ? document.querySelector('#blai-purifier-popup .bottom-nav')
        : document.querySelector('#blai-purifier-popup .rail');
}

export function toolsPageTourTarget() {
    return isPhone()
        ? document.querySelector('#blai-purifier-popup .bottom-nav [data-page-target="tools"]')
        : document.querySelector('#blai-purifier-popup .rail [data-page-target="tools"]');
}

export function aiAdvancedGenerationTourTarget() {
    return isPhone()
        ? document.querySelector('#blai-ai-generation-open')
        : document.querySelector('#blai-ai-generation-section');
}

export function currentRulesetTourTarget() {
    return document.querySelector('#blai-preset-select')?.closest('.blai-home-topbar-row')
        || document.querySelector('.blai-home-topbar');
}

// 手机端五个规则集动作收进了省略号菜单，导览不能继续指向已隐藏的「导入」按钮。
export function presetImportTourTarget() {
    return isPhone()
        ? document.getElementById('blai-preset-actions-toggle')
        : document.querySelector('#blai-purifier-popup [data-blai-click-proxy="#blai-preset-import"]');
}

export function ruleToolsTourTarget() {
    return document.querySelector('#blai-open-new-rule-btn')?.closest('.blai-home-toolbar-actions')
        || document.querySelector('.blai-home-topbar');
}

export function deepCleanLaunchTourTarget() {
    return document.querySelector('#blai-deep-clean-btn')?.closest('.blai-clean-danger-content');
}

// 旧版「快速选择」区已并入「当前角色卡」卡片；手机/电脑共用同一节点，
// 不再依赖只在一端出现的标题 id，避免窄屏下定位失败。
export function deepCleanQuickSelectionTourTarget() {
    return document.querySelector('#blai-deep-clean-workspace .blai-deep-clean-scope-card')
        || document.querySelector('#blai-deep-clean-workspace .blai-deep-clean-options-section');
}

export function deepCleanFinalSelectionTourTarget() {
    return document.querySelector('#blai-deep-clean-final-title')?.closest('.blai-deep-clean-resources');
}

export function deepCleanPresetTourTarget() {
    return document.querySelector('[data-deep-clean-option="presetName"]')?.closest('.blai-deep-clean-option');
}

export function deepCleanOptionsTourTarget() {
    return document.querySelector('#blai-deep-clean-options-title')?.closest('.blai-deep-clean-section');
}

export function createThemedTourLayer() {
    const rawTheme = document.getElementById('blai-purifier-popup')?.getAttribute('data-theme');
    const theme = normalizeThemeMode(rawTheme);
    if (theme !== rawTheme) {
        throw new Error('Veridis Rewrite 主界面未提供有效主题，无法创建导览图层。');
    }
    const layer = document.createElement('div');
    layer.id = 'blai-tour-layer';
    layer.className = 'blai-tour-layer blai-modal-shell blai-is-open';
    layer.setAttribute('data-theme', theme);
    document.body.append(layer);
    annotateTauriMobileSurfaces();
    return layer;
}

export function requiredTarget(step) {
    if (step.previewTarget) return document.querySelector(step.previewTarget);
    const target = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
    if (!target) throw new Error(`无法定位「${step.title}」所需的界面目标。`);
    return target;
}

