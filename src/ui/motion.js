/**
 * 通用的「退场后切换」helper：给元素加 .blai-is-leaving 播放淡出，动画结束后执行 done。
 * 三类视图切换（页面 / 弹窗 / 反馈标签页）共用，避免各自重写定时器与竞态保护。
 *
 * 约束：
 * - 只做透明度，不叠 transform（portal 菜单由 popover.js 精确定位，位移会导致跳动）。
 * - prefers-reduced-motion 下跳过动画、立即 done。
 * - 同一元素连续调用时，旧任务作废，只让最后一次的 done 生效（防止快速连点导致内容错乱）。
 */

const LEAVE_CLASS = 'blai-is-leaving';
const ANIMATION_END_BUFFER_MS = 20;
const FALLBACK_FAST_MS = 80;
const FALLBACK_BASE_MS = 120;

const leaveTokens = new WeakMap();

function readDurationToken(name, fallback) {
    if (typeof window === 'undefined' || !window.getComputedStyle || !window.document?.documentElement) return fallback;
    const raw = String(window.getComputedStyle(window.document.documentElement).getPropertyValue(name) || '').trim();
    const value = Number.parseFloat(raw);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return raw.endsWith('ms') ? value : value * 1000;
}

/** 退场/进场时长统一取 tokens/03-scale.css，避免 JS 与 CSS 各写一份后漂移。 */
export function getFadeDuration(phase = 'in') {
    return phase === 'out'
        ? readDurationToken('--blai-duration-fast', FALLBACK_FAST_MS)
        : readDurationToken('--blai-duration-base', FALLBACK_BASE_MS);
}

/** 动画结束兜底定时器：多留一点缓冲，避免 animationend 漏触发时提前切换。 */
export function getFadeExitMs() {
    return getFadeDuration('out') + ANIMATION_END_BUFFER_MS;
}

function prefersReducedMotion() {
    return !!(typeof window !== 'undefined'
        && window.matchMedia
        && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
}

/**
 * 让元素淡出后执行 done。
 * @param {HTMLElement|jQuery} el   要淡出的元素（DOM 节点或只含一个元素的 jQuery 对象）
 * @param {Function} done           淡出结束后调用（真正隐藏 / 重渲染 / 移除）
 * @returns {Function} cancel       取消本次淡出（若已结束则为 no-op）
 */
export function fadeOutThen(el, done) {
    const node = el && el.jquery ? el[0] : el;
    if (!node) { if (typeof done === 'function') done(); return () => {}; }

    const previous = leaveTokens.get(node);
    if (previous) previous(); // 作废上一次：清除其定时器与监听，且不再触发它的 done。

    if (prefersReducedMotion()) {
        if (typeof done === 'function') done();
        return () => {};
    }

    let cancelled = false;
    const finish = () => {
        if (cancelled) return;
        cancelled = true;
        node.removeEventListener('animationend', onEnd);
        node.classList.remove(LEAVE_CLASS);
        if (leaveTokens.get(node) === cancel) leaveTokens.delete(node);
        if (typeof done === 'function') done();
    };
    const onEnd = (event) => { if (event.target === node) finish(); };
    const cancel = () => {
        if (cancelled) return;
        cancelled = true;
        node.removeEventListener('animationend', onEnd);
        clearTimeout(timer);
        node.classList.remove(LEAVE_CLASS);
        if (leaveTokens.get(node) === cancel) leaveTokens.delete(node);
    };
    const timer = setTimeout(finish, getFadeExitMs());

    leaveTokens.set(node, cancel);
    node.addEventListener('animationend', onEnd);
    node.classList.add(LEAVE_CLASS);
    return cancel;
}

/**
 * 取消进行中的淡出：作废旧任务（其 done 不再执行）、移除退场类。
 * 用于「元素淡出到一半又被重新显示」的场景（如快速来回切页）：
 * 不取消的话，旧定时器到点仍会执行 done，把刚重新激活的元素又隐藏掉。
 */
export function cancelFadeOut(el) {
    const node = el && el.jquery ? el[0] : el;
    if (!node) return;
    const cancel = leaveTokens.get(node);
    if (cancel) cancel();
}

/**
 * 让元素重新淡入：移除退场类并强制重排后，浏览器会重放入场动画。
 * 用于 innerHTML 重渲染的内容区（新节点天然带入场动画则无需调用）。
 */
export function restartFadeIn(el) {
    const node = el && el.jquery ? el[0] : el;
    if (!node || prefersReducedMotion()) return;
    node.classList.remove(LEAVE_CLASS);
    // 触发一次重排，确保入场动画从 opacity:0 重新开始。
    void node.offsetWidth;
}
