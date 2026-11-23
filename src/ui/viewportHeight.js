/**
 * 手机软键盘稳定层。
 *
 * SillyTavern 的 viewport meta 明确写了 interactive-widget=resizes-content，
 * 键盘弹出会把 layout viewport 一起压小，插件的全屏弹窗因此重排、底栏上跳。
 * 这里只在插件自己的输入框获得焦点、且视口明显变矮时冻结打开前的高度；
 * 键盘收起后恢复，避免影响宿主的聊天输入框。
 */
const PLUGIN_ROOTS = '#blai-purifier-popup, #blai-deep-clean-workspace, .blai-modal-shell, #blai-rule-transfer-modal, #blai-diff-modal';
const LOCK_CLASS = 'blai-keyboard-locked';
const VIEWPORT_VAR = '--blai-viewport-h';
const KEYBOARD_DELTA = 120;
const RESTORE_DELTA = 80;

let stableHeight = 0;
let locked = false;
let initialized = false;

function currentHeight() {
    const vv = window.visualViewport;
    return Math.round((vv && Number(vv.height) > 0 ? vv.height : window.innerHeight) || 0);
}

function isPluginEditable(el) {
    if (!el || typeof el.matches !== 'function') return false;
    if (!el.matches('input, textarea, select, [contenteditable="true"]')) return false;
    return Boolean(typeof el.closest === 'function' && el.closest(PLUGIN_ROOTS));
}

function lock() {
    if (locked) return;
    locked = true;
    document.documentElement.classList.add(LOCK_CLASS);
    document.documentElement.style.setProperty(VIEWPORT_VAR, `${stableHeight}px`);
}

function unlock() {
    if (!locked) return;
    locked = false;
    document.documentElement.classList.remove(LOCK_CLASS);
    document.documentElement.style.removeProperty(VIEWPORT_VAR);
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
        window.requestAnimationFrame(sync);
    });
    document.addEventListener('focusout', () => {
        // 焦点在两个输入框之间切换时键盘不会收起，保持锁定；视口恢复后才解锁。
        window.setTimeout(sync, 0);
    });
}
