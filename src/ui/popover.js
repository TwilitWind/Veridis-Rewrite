// 负责挂载到 body 的下拉菜单：逃出祖先的溢出裁剪，并在下方空间不足时翻转到锚点上方。
const PORTAL_CLASS = 'blai-portal-menu';
const ANCHOR_MARK = 'data-blai-popover-anchor';
const THEME_VARS = ['--bg-base', '--bg-surface', '--accent-color', '--text-main', '--text-secondary', '--border-color', '--status-danger', '--status-success', '--blai-dropdown-active-bg', '--blai-dropdown-active-ink', '--blai-shadow-color', '--blai-shadow-sm', '--blai-dropdown-shadow'];
const CLEARED_STYLES = ['position', 'top', 'left', 'right', 'bottom', 'margin', 'transform', 'will-change', 'z-index'];
const IMPORTANT_POSITION_PROPS = ['position', 'left', 'top', 'right', 'bottom', 'transform', 'margin', 'max-height'];
const MENU_GAP = 6;
// 菜单统一挂到 body 并压在所有界面之上（仅次于 toast 的 2147483647），避免被弹窗、面板、滚动容器裁剪或盖住。
const PORTAL_Z_INDEX = '2147483000';
const VIEWPORT_PADDING = 8;
const openMenus = new Set();
let documentBound = false;

function copyThemeVars(anchor, menu) {
    const computed = window.getComputedStyle(anchor);
    THEME_VARS.forEach((name) => {
        const value = String(computed.getPropertyValue(name) || '').trim();
        if (value) menu.style.setProperty(name, value);
    });
}

function positionManually(anchor, menu) {
    const anchorRect = anchor.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const spaceBelow = viewportHeight - anchorRect.bottom - MENU_GAP - VIEWPORT_PADDING;
    const spaceAbove = anchorRect.top - MENU_GAP - VIEWPORT_PADDING;
    const flipUp = spaceBelow < menuHeight && spaceAbove > spaceBelow;
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
    menu.style.setProperty('z-index', PORTAL_Z_INDEX, 'important');
    document.body.appendChild(menu);
    const instance = applyPosition(anchor, menu);
    // 存同一个 entry 引用，供下方重定位与关闭逻辑共用。
    // 之前 add() 存匿名对象、这里另建对象，has(entry) 恒 false，重定位从未执行。
    const entry = { anchor, menu, instance };
    openMenus.add(entry);
    // 弹窗/切页的入场动画带 6px 位移：动画期间量到的锚点位置与稳定后差 6px，
    // 菜单就会停在偏移处，看起来像"第一次点没弹出、要点第二次"。
    // 逐帧比对锚点位置，连续两帧稳定（动画落定）后再定位一次；超时兜底防止异常时漏定位。
    let lastRect = '';
    let stableFrames = 0;
    let elapsed = 0;
    const settle = () => {
        if (!openMenus.has(entry)) return;
        const rect = anchor.getBoundingClientRect();
        const signature = `${rect.top}|${rect.left}|${rect.bottom}|${rect.right}`;
        stableFrames = signature === lastRect ? stableFrames + 1 : 0;
        lastRect = signature;
        if (stableFrames >= 2 || elapsed >= 400) {
            applyPosition(anchor, menu);
            return;
        }
        elapsed += 16;
        requestAnimationFrame(settle);
    };
    requestAnimationFrame(settle);
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
