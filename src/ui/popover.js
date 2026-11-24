// 负责挂载到 body 的下拉菜单：逃出祖先的溢出裁剪，并在下方空间不足时翻转到锚点上方。
const PORTAL_CLASS = 'blai-portal-menu';
const ANCHOR_MARK = 'data-blai-popover-anchor';
const THEME_VARS = ['--bg-base', '--bg-surface', '--accent-color', '--text-main', '--text-secondary', '--border-color', '--status-danger', '--status-success', '--blai-dropdown-active-bg', '--blai-dropdown-active-ink', '--blai-shadow-color', '--blai-shadow-sm', '--blai-dropdown-shadow'];
const CLEARED_STYLES = ['position', 'top', 'left', 'right', 'bottom', 'margin', 'transform', 'will-change', 'z-index', 'max-height'];
const IMPORTANT_POSITION_PROPS = ['position', 'left', 'top', 'right', 'bottom', 'transform', 'margin', 'max-height'];
const MENU_GAP = 6;
// 菜单统一挂到 body 并压在所有界面之上（仅次于 toast），避免被弹窗、面板、滚动容器裁剪或盖住。
// 层级真源是 --blai-z-menu；这里读一次缓存，字面量只作 CSS 未就绪时的兜底。
const PORTAL_Z_INDEX_FALLBACK = '2147483000';
let portalZIndex = PORTAL_Z_INDEX_FALLBACK;
function resolvePortalZIndex() {
    if (portalZIndex !== PORTAL_Z_INDEX_FALLBACK) return portalZIndex;
    const raw = getComputedStyle(document.documentElement).getPropertyValue('--blai-z-menu').trim();
    if (raw && raw !== PORTAL_Z_INDEX_FALLBACK) portalZIndex = raw;
    return portalZIndex;
}
const VIEWPORT_PADDING = 8;
const openMenus = new Set();
let documentBound = false;

// 手机/触屏打开弹窗时不自动聚焦输入框，避免软键盘意外弹出。
export function focusOnFinePointer(target) {
    if (!target) return;
    if (window.matchMedia?.('(max-width: 600px), (pointer: coarse)').matches) return;
    if (typeof target.trigger === 'function') target.trigger('focus');
    else target.focus?.();
}

function copyThemeVars(anchor, menu) {
    const computed = window.getComputedStyle(anchor);
    THEME_VARS.forEach((name) => {
        const value = String(computed.getPropertyValue(name) || '').trim();
        if (value) menu.style.setProperty(name, value);
    });
}

function positionManually(anchor, menu) {
    const anchorRect = anchor.getBoundingClientRect();
    // 先还原上一次的内联限高，量出菜单的自然高度；CSS 的 --blai-dropdown-max-height
    // 仍是基础上限，这里只按锚点可用空间再收紧一层。
    menu.style.removeProperty('max-height');
    const menuWidth = menu.offsetWidth;
    const naturalHeight = menu.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - anchorRect.bottom - MENU_GAP - VIEWPORT_PADDING;
    const spaceAbove = anchorRect.top - MENU_GAP - VIEWPORT_PADDING;
    const flipUp = spaceBelow < naturalHeight && spaceAbove > spaceBelow;
    const available = Math.max(0, Math.floor(flipUp ? spaceAbove : spaceBelow));
    // 可用空间不足时收紧高度并让菜单自身滚动；空间足够则撤掉内联限高，交回 CSS token。
    if (naturalHeight > available) {
        menu.style.setProperty('max-height', `${available}px`, 'important');
    }
    const menuHeight = Math.min(naturalHeight, available);
    const left = Math.min(
        Math.max(VIEWPORT_PADDING, anchorRect.right - menuWidth),
        Math.max(VIEWPORT_PADDING, viewportWidth - menuWidth - VIEWPORT_PADDING),
    );
    const top = flipUp
        ? Math.max(VIEWPORT_PADDING, anchorRect.top - MENU_GAP - menuHeight)
        : Math.min(anchorRect.bottom + MENU_GAP, Math.max(VIEWPORT_PADDING, viewportHeight - menuHeight - VIEWPORT_PADDING));
    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('left', `${Math.round(left)}px`, 'important');
    menu.style.setProperty('top', `${Math.round(top)}px`, 'important');
    menu.style.setProperty('right', 'auto', 'important');
    menu.style.setProperty('bottom', 'auto', 'important');
}

// 定位只走手动计算，不再交给 Popper。
// 原因：Popper 用非 important 的内联 left/top 排版，而这里为了压过主题注入必须用 important，
// 两套优先级混在一起时会出现「菜单停在视口右上角」的错位（弹窗内必现，
// 因为 .blai-modal-shell 自带 backdrop-filter，会形成包含块）。手动计算没有这层依赖，
// 只有一处写 left/top，行为可预测。
function applyPosition(anchor, menu) {
    positionManually(anchor, menu);
    return null;
}

function bindDocumentClose() {
    if (documentBound) return;
    documentBound = true;
    document.addEventListener('mousedown', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest(`.${PORTAL_CLASS}`)) return;
        if (target.closest(`[${ANCHOR_MARK}]`)) return;
        closeAllMenuPopovers();
    }, true);
    window.addEventListener('resize', () => closeAllMenuPopovers());
    // 菜单自身也在滚动容器里（长列表）。滚动菜单内部不能把自己关掉，
    // 否则「想滑到下面的分组 → 菜单消失」。只有外部滚动才关闭。
    document.addEventListener('scroll', (event) => {
        const target = event.target;
        if (target instanceof Element && target.closest(`.${PORTAL_CLASS}`)) return;
        closeAllMenuPopovers();
    }, true);
}

export function openMenuPopover(anchor, menu) {
    if (!anchor || !menu) return;
    bindDocumentClose();
    closeAllMenuPopovers();
    const placeholder = document.createComment('blai-menu-anchor');
    if (menu.parentNode) menu.parentNode.insertBefore(placeholder, menu);
    menu.__blaiPlaceholder = placeholder;
    menu.hidden = false;
    menu.classList.add(PORTAL_CLASS);
    anchor.setAttribute(ANCHOR_MARK, 'true');
    copyThemeVars(anchor, menu);
    menu.style.setProperty('position', 'fixed', 'important');
    menu.style.setProperty('right', 'auto', 'important');
    menu.style.setProperty('bottom', 'auto', 'important');
    menu.style.setProperty('margin', '0', 'important');
    menu.style.setProperty('z-index', resolvePortalZIndex(), 'important');
    document.body.appendChild(menu);
    const instance = applyPosition(anchor, menu);
    // 只定位一次：弹窗/切页入场动画已改为纯淡入，锚点不再位移，
    // 无需二次重定位。原先 animationend + 200ms 的补偿会在锚点归位后重算，
    // 导致菜单「弹出后又往上跳」，与用户期望的稳定位置冲突。
    const entry = { anchor, menu, instance };
    openMenus.add(entry);
}

export function closeMenuPopover(menu) {
    if (!menu) return;
    const entry = Array.from(openMenus).find((item) => item.menu === menu);
    if (!entry) {
        menu.classList.remove(PORTAL_CLASS);
        menu.hidden = true;
        return;
    }
    openMenus.delete(entry);
    try {
        entry.instance?.destroy?.();
    } catch (error) {
        // Popper 的销毁尽力而为。
    }
    entry.anchor?.removeAttribute(ANCHOR_MARK);
    if (entry.anchor instanceof Element && entry.anchor.hasAttribute('aria-expanded')) {
        entry.anchor.setAttribute('aria-expanded', 'false');
    }
    menu.classList.remove(PORTAL_CLASS);
    menu.hidden = true;
    const placeholder = menu.__blaiPlaceholder;
    if (placeholder && placeholder.parentNode) placeholder.parentNode.replaceChild(menu, placeholder);
    else if (menu.parentNode) menu.parentNode.removeChild(menu);
    menu.__blaiPlaceholder = null;
    CLEARED_STYLES.forEach((name) => menu.style.removeProperty(name));
    THEME_VARS.forEach((name) => menu.style.removeProperty(name));
}

export function closeAllMenuPopovers() {
    Array.from(openMenus).forEach((entry) => closeMenuPopover(entry.menu));
}
