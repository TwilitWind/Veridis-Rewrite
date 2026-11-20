/**
 * 负责把持久化的 Veridis 主题应用到当前 UI 表面，以及主题下拉选择。
 */
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { showToast } from './notifications.js';
import { openMenuPopover, closeMenuPopover } from './popover.js';

// 主题清单是显示名/图标的唯一来源；settings 层的合法值校验见 migration.js。
export const THEME_MODES = [
    { mode: 'auto', label: '跟随酒馆', icon: 'fa-circle-half-stroke' },
    { mode: 'light', label: '素白', icon: 'fa-sun' },
    { mode: 'warm', label: '暖米', icon: 'fa-seedling' },
    { mode: 'dark', label: '墨夜', icon: 'fa-moon' },
    { mode: 'dim', label: '柔灰', icon: 'fa-cloud' },
];

const SURFACES = '#blai-purifier-popup, .blai-modal-shell, #blai-rule-transfer-modal, #blai-diff-modal, #blai-rule-search-modal, #blai-preset-import-choice-modal, .blai-toast, #blai-loading-overlay, #blai-scope-tag-editor-modal, #blai-tour-layer';
const themeByMode = new Map(THEME_MODES.map((item) => [item.mode, item]));

export function normalizeThemeMode(mode) {
    return themeByMode.has(mode) ? mode : 'auto';
}

export function bindThemeEvents() {
    const { extension_settings, saveSettingsDebounced } = getAppContext();
    const settings = extension_settings[extensionName];

    const applyThemeMode = (mode) => {
        const normalized = normalizeThemeMode(mode);
        const theme = themeByMode.get(normalized);
        settings.themeMode = normalized;
        $(SURFACES).attr('data-theme', normalized);
        $('#blai-theme-toggle, #blai-purifier-popup [data-blai-click-proxy="#blai-theme-toggle"]')
            .attr('title', `当前主题：${theme.label}，点击选择`)
            .attr('aria-label', `当前主题：${theme.label}，点击选择`);
        $('#blai-theme-toggle i, #blai-purifier-popup [data-blai-click-proxy="#blai-theme-toggle"] i')
            .attr('class', `fas ${theme.icon}`);
        $('#blai-theme-menu [data-theme-mode]').each(function () {
            const active = this.dataset.themeMode === normalized;
            $(this).toggleClass('is-active', active).attr('aria-checked', String(active));
        });
    };

    applyThemeMode(settings.themeMode);

    // 点图标只开菜单，不再循环切换；菜单由 popover.js 挂到 body，点击外部/滚动自动关闭。
    $(document).off('click', '#blai-theme-toggle').on('click', '#blai-theme-toggle', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const menu = document.getElementById('blai-theme-menu');
        if (!menu) return;
        if (!menu.hidden) closeMenuPopover(menu);
        else {
            this.setAttribute('aria-expanded', 'true');
            openMenuPopover(this, menu);
        }
    });

    $(document).off('click', '#blai-theme-menu [data-theme-mode]').on('click', '#blai-theme-menu [data-theme-mode]', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const mode = String(this.dataset.themeMode || 'auto');
        applyThemeMode(mode);
        closeMenuPopover(document.getElementById('blai-theme-menu'));
        saveSettingsDebounced();
        showToast(`已切换主题：${themeByMode.get(normalizeThemeMode(mode)).label}`);
    });
}
