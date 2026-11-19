/**
 * 原生 select 自绘化：保留 select 作为数据锚点，旁边生成图1风格的自绘触发器 + 浮层菜单。
 *
 * 设计约束：
 * - 所有业务代码继续读写 select.value、监听原生 change，改造对它们透明。
 * - 自绘菜单只负责「展开 → 点项 → 写回 select.value + 触发 change」。
 * - options 会被业务代码动态 .html()/.empty() 重建，用 MutationObserver 同步菜单。
 * - 浮层走 popover.js 挂到 body，逃出弹窗/滚动容器的 overflow 裁剪。
 */

import { openMenuPopover, closeMenuPopover } from './popover.js';

const WRAPPER_CLASS = 'blai-native-select-wrap';
const TRIGGER_CLASS = 'blai-native-select-trigger';
const MENU_CLASS = 'blai-native-select-menu';
const ITEM_CLASS = 'blai-native-select-item';
const LABEL_CLASS = 'blai-native-select-label';
const GROUP_CLASS = 'blai-native-select-group';

const registry = new Map();

function escapeHtml(value = '') {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function selectedOption(select) {
    return select?.selectedOptions?.[0] || [...(select?.options || [])].find((option) => option.selected) || null;
}

function currentLabel(select, placeholder) {
    const option = selectedOption(select);
    if (!option) return placeholder || '';
    // 空值选项（如「请选择」）用占位文案，避免选中后触发器空白。
    if (option.value === '' && placeholder) return placeholder;
    return option.textContent || '';
}

function buildMenuHtml(select, placeholder) {
    const parts = [];
    for (const node of select.children) {
        if (node.tagName === 'OPTGROUP') {
            parts.push(`<div class="${GROUP_CLASS}" role="group" aria-label="${escapeHtml(node.label || '')}">`);
            parts.push(`<div class="${GROUP_CLASS}-label">${escapeHtml(node.label || '')}</div>`);
            for (const option of node.options) parts.push(optionHtml(option, placeholder));
            parts.push('</div>');
        } else if (node.tagName === 'OPTION') {
            parts.push(optionHtml(node, placeholder));
        }
    }
    return parts.join('');
}

function optionHtml(option, placeholder) {
    const value = String(option.value ?? '');
    const text = value === '' && placeholder ? placeholder : (option.textContent || '');
    const disabled = option.disabled ? ' aria-disabled="true"' : '';
    const selected = option.selected ? ' aria-selected="true"' : '';
    const title = option.title ? ` title="${escapeHtml(option.title)}"` : '';
    return `<button type="button" class="${ITEM_CLASS}" role="option" data-value="${escapeHtml(value)}"${disabled}${selected}${title}>${escapeHtml(text)}</button>`;
}

function syncTrigger(select, state) {
    if (!state.trigger) return;
    state.labelEl.textContent = currentLabel(select, state.placeholder);
    state.trigger.setAttribute('aria-label', state.ariaLabel || select.getAttribute('aria-label') || '下拉选择');
    state.trigger.classList.toggle('is-empty', !selectedOption(select) || selectedOption(select).value === '');
}

function syncMenu(select, state) {
    if (!state.menu) return;
    state.menu.innerHTML = buildMenuHtml(select, state.placeholder);
    syncTrigger(select, state);
}

function closeMenu(state) {
    if (!state.menu || state.menu.hidden) return;
    // 走 popover.js 的关闭，保证 anchor 标记 / 内联样式 / DOM 位置都复原。
    closeMenuPopover(state.menu);
    state.menu.hidden = true;
    state.trigger?.setAttribute('aria-expanded', 'false');
}

function openMenu(select, state) {
    if (!state.menu || !state.trigger) return;
    state.menu.style.width = `${Math.round(state.trigger.getBoundingClientRect().width)}px`;
    openMenuPopover(state.trigger, state.menu);
    state.menu.hidden = false;
    state.trigger.setAttribute('aria-expanded', 'true');
    syncMenu(select, state);
}

/**
 * 包装一个原生 select。重复调用同一个 select 是幂等的。
 * @param {HTMLSelectElement} select
 * @param {{placeholder?:string, ariaLabel?:string, className?:string}} [options]
 */
export function enhanceNativeSelect(select, options = {}) {
    if (!(select instanceof HTMLSelectElement) || registry.has(select)) return;
    if (select.classList.contains('blai-visually-hidden')) return; // 纯数据锚点不包装

    const placeholder = options.placeholder ?? '';
    const ariaLabel = options.ariaLabel ?? select.getAttribute('aria-label') ?? '';
    const state = { select, placeholder, ariaLabel, trigger: null, labelEl: null, menu: null, observer: null };

    const wrapper = document.createElement('div');
    wrapper.className = `${WRAPPER_CLASS}${options.className ? ` ${options.className}` : ''}`;
    select.parentNode.insertBefore(wrapper, select);
    wrapper.appendChild(select);

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = TRIGGER_CLASS;
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.innerHTML = `<span class="${LABEL_CLASS}"></span><i class="fa-solid fa-chevron-down blai-native-select-caret" aria-hidden="true"></i>`;
    wrapper.appendChild(trigger);
    state.trigger = trigger;
    state.labelEl = trigger.querySelector(`.${LABEL_CLASS}`);

    const menu = document.createElement('div');
    menu.className = MENU_CLASS;
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;
    wrapper.appendChild(menu);
    state.menu = menu;

    select.classList.add('blai-native-select-anchor');
    syncTrigger(select, state);

    const open = (e) => {
        e?.preventDefault();
        e?.stopPropagation();
        if (!menu.hidden) closeMenu(state);
        else openMenu(select, state);
    };
    trigger.addEventListener('click', open);

    menu.addEventListener('click', (e) => {
        const item = e.target.closest(`.${ITEM_CLASS}`);
        if (!item || item.getAttribute('aria-disabled') === 'true') return;
        e.preventDefault();
        e.stopPropagation();
        const value = item.getAttribute('data-value') ?? '';
        if (select.value !== value) {
            select.value = value;
            select.dispatchEvent(new Event('change', { bubbles: true }));
        }
        closeMenu(state);
    });

    // 业务代码改 select.value / options 后同步触发器与菜单。
    select.addEventListener('change', () => syncTrigger(select, state));
    state.observer = new MutationObserver(() => syncMenu(select, state));
    state.observer.observe(select, { childList: true, subtree: true, characterData: true });

    registry.set(select, state);
    return state;
}

/** 批量包装：按选择器查找，只对尚未包装的生效。 */
export function enhanceNativeSelects(selector, options = {}) {
    return [...document.querySelectorAll(selector)].map((select) => enhanceNativeSelect(select, options));
}

/** select 被业务整体替换时，释放旧的观察器。 */
export function releaseNativeSelect(select) {
    const state = registry.get(select);
    if (!state) return;
    state.observer?.disconnect();
    closeMenu(state);
    registry.delete(select);
}

// 已经由插件自绘菜单接管的 select（隐藏数据锚点），不要再包装。
const EXCLUDE_SELECTORS = [
    '#blai-preset-select',
    '#blai-tools-preset-select',
    '.blai-visually-hidden',
    '.blai-native-select-anchor',
    '.blai-subrule-mode-select',   // 编辑弹窗的语法模式：原生 select + 专属箭头，保持原样
];

// 插件自己的容器：只包装这些范围内的 select，绝不碰酒馆本体。
const PLUGIN_SCOPE = '#blai-purifier-popup, #blai-feedback-workspace, #blai-rule-edit-modal, #blai-subrule-edit-modal, #blai-scope-tag-editor-modal, #blai-rule-transfer-modal, #blai-preset-import-choice-modal, #blai-deep-clean-workspace';

function isInPluginScope(node) {
    try {
        return !!node.closest?.(PLUGIN_SCOPE);
    } catch {
        return false;
    }
}

function shouldEnhance(select) {
    if (!(select instanceof HTMLSelectElement)) return false;
    if (registry.has(select)) return false;
    if (select.closest('.blai-native-select-wrap')) return false;
    if (!isInPluginScope(select)) return false;
    return !EXCLUDE_SELECTORS.some((sel) => {
        try { return select.matches(sel); } catch { return false; }
    });
}

function enhanceVisibleSelects(root = document) {
    const selects = [...root.querySelectorAll('select')].filter(shouldEnhance);
    selects.forEach((select) => enhanceNativeSelect(select));
    return selects.length;
}

/**
 * 启动自动包装：先包装现有 select，再监听后续动态渲染新增的 select。
 * 只对插件自己的容器生效，不碰酒馆本体的 select。
 */
export function startNativeSelectEnhancer() {
    // 先解包任何不在插件作用域内的 wrapper（防御旧版本遗留或第三方注入）。
    document.querySelectorAll(`.${WRAPPER_CLASS}`).forEach((wrapper) => {
        if (isInPluginScope(wrapper)) return;
        const select = wrapper.querySelector('select');
        if (select) {
            releaseNativeSelect(select);
            wrapper.parentNode?.insertBefore(select, wrapper);
        }
        wrapper.remove();
    });

    const SCOPE = PLUGIN_SCOPE;
    const roots = [...document.querySelectorAll(SCOPE)];
    roots.forEach((root) => enhanceVisibleSelects(root));

    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.tagName === 'SELECT' && shouldEnhance(node)) enhanceNativeSelect(node);
                else if (node.querySelectorAll) enhanceVisibleSelects(node);
            }
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
}
