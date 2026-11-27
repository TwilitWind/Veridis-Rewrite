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
 * 整块重渲染列表时的轻量 FLIP：记住旧位置，渲染后把仍在的元素从旧位置滑到新位置，
 * 新元素从上方 6px 淡入。删除项立即移除，不留下参与布局的幽灵节点。
 * 只看 transform/opacity，可在 reduced-motion 下整体跳过。
 */
export function renderWithFlip(container, html, { selector = '[data-flip-key]', getKey = (el) => el.getAttribute('data-flip-key') } = {}) {
    const node = container && container.jquery ? container[0] : container;
    if (!node) return;
    const before = new Map();
    node.querySelectorAll(selector).forEach((el) => {
        const key = getKey(el);
        if (key) before.set(key, el.getBoundingClientRect());
    });
    const scrollTop = node.scrollTop;
    container.html(html);
    node.scrollTop = scrollTop;
    if (prefersReducedMotion() || typeof node.animate !== 'function') return;

    const rootStyle = window.getComputedStyle(document.documentElement);
    const duration = readDurationToken('--blai-duration-slow', 140);
    const easing = rootStyle.getPropertyValue('--blai-ease-out').trim() || 'ease-out';
    node.querySelectorAll(selector).forEach((el) => {
        const key = getKey(el);
        const oldRect = key ? before.get(key) : null;
        const rect = el.getBoundingClientRect();
        if (!oldRect) {
            el.animate(
                [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
                { duration, easing },
            );
            return;
        }
        const dx = oldRect.left - rect.left;
        const dy = oldRect.top - rect.top;
        if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            el.animate(
                [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }],
                { duration, easing },
            );
        }
    });
}

