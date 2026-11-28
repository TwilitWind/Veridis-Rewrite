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
const ITEM_TEXT_CLASS = 'blai-native-select-item-text';
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

// 选项可用 data-blai-icon 指定 Font Awesome 图标类（如 fa-puzzle-piece），
// 由自绘触发器与菜单项统一渲染，替代在 option 文本里塞 emoji。
function optionIconHtml(option) {
    const icon = String(option?.getAttribute?.('data-blai-icon') || '').trim();
    if (!/^fa[sb]?[ -]/.test(icon) && !/^fa[sb]?-/.test(icon)) return '';
    return `<i class="fas ${icon}" aria-hidden="true"></i>`;
}

function currentLabel(select, placeholder) {
    const option = selectedOption(select);
    if (!option) return placeholder || '';
    // 空值选项（如「请选择」）用占位文案，避免选中后触发器空白。
    if (option.value === '' && placeholder) return placeholder;
    const icon = optionIconHtml(option);
    // 两级文案（预设 / 分组）：optgroup 标签拼在前面，让收起时也能看出属于哪个预设。
    if (select.getAttribute('data-blai-select-two-level') === 'true') {
        const groupLabel = String(option.parentElement?.label || '').trim();
        const text = String(option.textContent || '').trim();
        if (groupLabel) return `${icon}<span>${escapeHtml(groupLabel)} / ${escapeHtml(text)}</span>`;
        return `${icon}<span>${escapeHtml(text)}</span>`;
    }
    return `${icon}<span>${escapeHtml(option.textContent || '')}</span>`;
}

function buildMenuHtml(select, placeholder) {
    const parts = [];
    for (const node of select.children) {
        if (node.tagName === 'OPTGROUP') {
            parts.push(`<div class="${GROUP_CLASS}" role="group" aria-label="${escapeHtml(node.label || '')}">`);
            parts.push(`<div class="${GROUP_CLASS}-label">${escapeHtml(node.label || '')}</div>`);
            // HTMLOptGroupElement 没有 .options 属性，必须遍历子 OPTION 节点；
            // 用 node.options 会在含分组的下拉（如移动规则弹窗）抛错，导致菜单 0 项、触发器空白。
            for (const option of node.children) {
                if (option.tagName === 'OPTION') parts.push(optionHtml(option, placeholder));
            }
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
    const icon = optionIconHtml(option);
    // 文字单独包一层：菜单项禁止换行后，超长选项靠 span 省略，不会把图标挤歪。
    return `<button type="button" class="${ITEM_CLASS}" role="option" data-value="${escapeHtml(value)}"${disabled}${selected}${title}>${icon}<span class="${ITEM_TEXT_CLASS}">${escapeHtml(text)}</span></button>`;
}

function syncTrigger(select, state) {
    if (!state.trigger) return;
    // 图标来自硬编码 data 属性、文案经 escapeHtml，innerHTML 安全。
    state.labelEl.innerHTML = currentLabel(select, state.placeholder);
    state.trigger.setAttribute('aria-label', state.ariaLabel || select.getAttribute('aria-label') || '下拉选择');
    state.trigger.classList.toggle('is-empty', !selectedOption(select) || selectedOption(select).value === '');
}

function menuSignature(select, placeholder) {
    // innerHTML 覆盖选项文本 / 分组 / 禁用状态，value 覆盖 select.value 切换造成的 selected 变化。
    return `${placeholder}\u0000${select.value}\u0000${select.innerHTML}`;
}

function syncMenu(select, state) {
    if (!state.menu) return;
    const signature = menuSignature(select, state.placeholder);
    if (state.menuSignature !== signature) {
        state.menu.innerHTML = buildMenuHtml(select, state.placeholder);
        state.menuSignature = signature;
    }
    syncTrigger(select, state);
}

// 菜单是 grid + minmax(0,1fr)，普通宽度下长文案不会撑开容器。
// 旧实现逐项读 scrollWidth，每项都会强制一次同步布局，选项一多展开就卡。
// 这里用 canvas 按菜单实际字体量文本，再加图标列 / 间距 / 内边距：
// 只读一次样式、不触发布局，长选项也不会被提前截断。
function naturalMenuWidth(menu) {
    const px = (value) => parseFloat(value) || 0;
    const item = menu.querySelector(`.${ITEM_CLASS}`);
    const itemStyle = item ? getComputedStyle(item) : getComputedStyle(menu);
    const menuStyle = getComputedStyle(menu);
    const context = document.createElement('canvas').getContext('2d');
    context.font = `${itemStyle.fontStyle} ${itemStyle.fontWeight} ${itemStyle.fontSize} ${itemStyle.fontFamily}`;
    const nodes = [...menu.querySelectorAll(`.${ITEM_TEXT_CLASS}, .${GROUP_CLASS}-label`)];
    const text = nodes.reduce((max, node) => Math.max(max, context.measureText(node.textContent || '').width), 0);
    const icon = px(menuStyle.getPropertyValue('--blai-dropdown-icon-slot'));
    const gap = px(itemStyle.columnGap);
    const itemPad = px(itemStyle.paddingLeft) + px(itemStyle.paddingRight);
    const shell = px(menuStyle.paddingLeft) + px(menuStyle.paddingRight)
        + px(menuStyle.borderLeftWidth) + px(menuStyle.borderRightWidth);
    return Math.ceil(shell + itemPad + icon + gap + text);
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
    // 先填内容再量宽：菜单要撑到「不换行的最长选项」，而不是被触发器宽度卡住。
    // 宽度取 max(触发器, 内容自然宽)，再受视口减去两侧留白约束；
    // popover.js 仍负责右对齐与翻转，宽菜单不会越出屏幕。
    syncMenu(select, state);
    // 先撤掉上一次的窄化标记，否则 overflow:hidden 会让这次量到的自然宽度偏小。
    state.menu.classList.remove('is-width-capped');
    state.menu.style.removeProperty('width');
    state.menu.hidden = false;
    const triggerWidth = state.trigger.getBoundingClientRect().width;
    const naturalWidth = naturalMenuWidth(state.menu);
    const cap = Math.max(120, window.innerWidth - 16);
    const wanted = Math.max(triggerWidth, naturalWidth);
    // 只有超出视口才退化成省略号；常规选项保持完整文案。
    state.menu.classList.toggle('is-width-capped', wanted > cap);
    state.menu.style.width = `${Math.round(Math.min(wanted, cap))}px`;
    openMenuPopover(state.trigger, state.menu);
    state.trigger.setAttribute('aria-expanded', 'true');
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
    const state = { select, placeholder, ariaLabel, trigger: null, labelEl: null, menu: null, observer: null, menuSignature: '' };

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

/**
 * 业务代码动态重建 options / value 后显式同步一次触发器与菜单。
 * 迁移弹窗实测 MutationObserver 未能及时刷新（label 空、菜单 0 项），
 * 所以在填完选项后主动调用，保证收起显示与展开列表都正确。
 */
export function syncNativeSelect(select) {
    if (!(select instanceof HTMLSelectElement)) return false;
    if (!registry.has(select)) {
        enhanceNativeSelect(select);
        return registry.has(select);
    }
    const state = registry.get(select);
    syncMenu(select, state);
    return true;
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
];

// 插件自己的容器：只包装这些范围内的 select，绝不碰酒馆本体。
const PLUGIN_SCOPE = '#blai-purifier-popup, #blai-feedback-workspace, #blai-rule-edit-modal, #blai-subrule-edit-modal, #blai-scope-tag-editor-modal, #blai-rule-transfer-modal, #blai-subrule-transfer-modal, #blai-preset-import-choice-modal, #blai-deep-clean-workspace';

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
