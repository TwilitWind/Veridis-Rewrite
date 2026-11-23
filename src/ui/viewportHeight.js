/**
 * 手机软键盘稳定层。
 *
 * SillyTavern 的 viewport meta 明确写了 interactive-widget=resizes-content，
 * 键盘弹出会把 layout viewport 一起压小，插件的全屏弹窗因此重排、底栏上跳。
 * 这里只在插件自己的输入框获得焦点、且视口明显变矮时冻结打开前的高度；
 * 键盘收起后恢复，避免影响宿主的聊天输入框。
 * 键盘期间只把聚焦输入框滚到可见区上沿，不缩弹窗、不顶底栏。
 */
const PLUGIN_ROOTS = '#blai-purifier-popup, #blai-deep-clean-workspace, .blai-modal-shell, #blai-rule-transfer-modal, #blai-diff-modal';
const LOCK_CLASS = 'blai-keyboard-locked';
const VIEWPORT_VAR = '--blai-viewport-h';
const KEYBOARD_DELTA = 120;
const RESTORE_DELTA = 80;
const REVEAL_MARGIN = 12;

let stableHeight = 0;
let locked = false;
let initialized = false;
let revealState = null;

function currentHeight() {
    const vv = window.visualViewport;
    return Math.round((vv && Number(vv.height) > 0 ? vv.height : window.innerHeight) || 0);
}

function isPluginEditable(el) {
    if (!el || typeof el.matches !== 'function') return false;
    if (!el.matches('input, textarea, select, [contenteditable="true"]')) return false;
    return Boolean(typeof el.closest === 'function' && el.closest(PLUGIN_ROOTS));
}

function getScrollContainer(el) {
    let node = el.parentElement;
    while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        // 不要求当前已经溢出：键盘遮住底部时，正是靠补 padding 才让最后一段可滚上来。
        if (/(auto|scroll)/.test(style.overflowY)) {
            return node;
        }
        node = node.parentElement;
    }
    return null;
}

function restoreReveal() {
    if (!revealState) return;
    revealState.container.style.paddingBottom = revealState.paddingBottom;
    revealState = null;
}

/** 只把聚焦的输入框滚到软键盘上方，不改弹窗/底栏高度。 */
function revealFocusedEditable() {
    const el = document.activeElement;
    if (!locked || !isPluginEditable(el)) return;

    const container = getScrollContainer(el);
    if (!container) return;

    const inset = Math.max(0, stableHeight - currentHeight());
    if (!inset) return;

    if (!revealState || revealState.container !== container) {
        restoreReveal();
        const base = parseFloat(window.getComputedStyle(container).paddingBottom) || 0;
        revealState = { container, paddingBottom: container.style.paddingBottom, base };
    }
    container.style.paddingBottom = `${revealState.base + inset}px`;

    const vv = window.visualViewport;
    const visibleBottom = (vv ? vv.offsetTop : 0) + currentHeight();
    const overflow = el.getBoundingClientRect().bottom - (visibleBottom - REVEAL_MARGIN);
    if (overflow > 0) container.scrollTop += overflow;
}

function lock() {
    if (locked) return;
    locked = true;
    document.documentElement.classList.add(LOCK_CLASS);
    document.documentElement.style.setProperty(VIEWPORT_VAR, `${stableHeight}px`);
    window.requestAnimationFrame(revealFocusedEditable);
}

function unlock() {
    if (!locked) return;
    locked = false;
    document.documentElement.classList.remove(LOCK_CLASS);
    document.documentElement.style.removeProperty(VIEWPORT_VAR);
    restoreReveal();
}

function sync() {
    const height = currentHeight();
    if (!height || !stableHeight) return;

    if (locked) {
        if (height >= stableHeight - RESTORE_DELTA) {
            unlock();
            stableHeight = height;
        }
        return;
    }

    // 视口明显变矮时只可能是软键盘；不要把压缩后的高度记成新的基准。
    if (height < stableHeight - KEYBOARD_DELTA) {
        if (isPluginEditable(document.activeElement)) lock();
        return;
    }

    stableHeight = height;
}

function updateStableHeight() {
    if (locked) return;
    stableHeight = currentHeight();
}

export function initViewportHeightStabilizer() {
    if (initialized) return;
    initialized = true;
    if (!window.visualViewport || !window.matchMedia?.('(pointer: coarse)').matches) return;

    stableHeight = currentHeight();
    window.visualViewport.addEventListener('resize', sync);
    window.visualViewport.addEventListener('scroll', sync);
    // 宿主用 resizes-content 时，键盘弹出会先触发 window.resize。
    // 这里不能直接把压缩后的高度记成基准，否则随后的 visualViewport.resize 就认不出键盘。
    window.addEventListener('resize', sync);
    window.addEventListener('orientationchange', () => {
        unlock();
        window.setTimeout(updateStableHeight, 300);
    });
    document.addEventListener('focusin', (event) => {
        if (!isPluginEditable(event.target)) return;
        window.requestAnimationFrame(() => {
            sync();
            revealFocusedEditable();
        });
    });
    document.addEventListener('focusout', () => {
        // 焦点在两个输入框之间切换时键盘不会收起，保持锁定；视口恢复后才解锁。
        window.setTimeout(sync, 0);
    });
}
