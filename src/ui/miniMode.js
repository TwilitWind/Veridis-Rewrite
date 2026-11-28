/**
 * 悬浮球：开关开着时，× 收起插件页后显示一颗固定的球；点球展开插件，插件页里不显示球。
 * 球必须 body 直属：#blai-purifier-popup 的 backdrop-filter 会生成层叠上下文，
 * 放里面 position:fixed 会相对它定位、被遮罩挡住。
 *
 * 支持拖动换位；靠近左右边缘松手后自动半隐藏，悬停/聚焦时整颗弹出。
 * 保留一条保活口径：开关仍开着时刷新页面，直接进入球态。
 */
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { getFadeDuration } from './motion.js';
import { closeAllMenuPopovers } from './popover.js';

const BALL_ID = 'blai-mini-ball';
const MIRROR_KEY = 'veridis-rewrite:mini-state';
const POS_KEY = 'veridis-rewrite:mini-ball-pos';
const DRAG_THRESHOLD = 4;
// 贴边松手后只留一半在视口内，悬停/聚焦时整颗弹出。
const EDGE_VISIBLE_RATIO = 0.5;
const SNAP_DISTANCE = 56;
let bootApplied = false;
let expandRefreshHandler = () => {};

export function setMiniModeExpandHandler(handler) {
    expandRefreshHandler = typeof handler === 'function' ? handler : () => {};
}

// 只列真正的弹窗。反馈区是反馈页正文、菜单由 popover.js 管理、toast 不是弹窗；
// 统一 .hide() 会把它们写成永久行内 display:none，展开后再也回不来。
const MODAL_SELECTOR = [
    '#blai-binding-history-modal', '#blai-ai-generation-modal', '#blai-ai-additional-modal',
    '#blai-rule-edit-modal', '#blai-risk-confirm-modal', '#blai-risk-info-modal',
    '#blai-deep-clean-backdrop', '#blai-deep-clean-workspace',
    '#blai-rule-transfer-modal', '#blai-preset-import-choice-modal', '#blai-rule-search-modal',
    '#blai-scope-tags-modal', '#blai-scope-tag-editor-modal', '#blai-diff-modal',
    '#blai-subrule-edit-modal', '#blai-ai-prompt-modal', '#blai-ai-model-manage-modal',
    '#blai-loading-overlay',
].join(', ');

const ballMarkup = `
    <button id="${BALL_ID}" type="button" class="blai-mini-ball" aria-label="展开词汇映射界面" title="展开词汇映射界面">
        <i class="fas fa-language" aria-hidden="true"></i>
    </button>`;

function settings() {
    const { extension_settings } = getAppContext();
    return extension_settings?.[extensionName] || {};
}

function readMirror() {
    try {
        const parsed = JSON.parse(localStorage.getItem(MIRROR_KEY) || '{}');
        return { enabled: parsed.enabled === true, active: parsed.active === true };
    } catch {
        return { enabled: false, active: false };
    }
}

function writeMirror(enabled, active) {
    try {
        localStorage.setItem(MIRROR_KEY, JSON.stringify({ enabled, active }));
    } catch { /* 隐私模式禁用存储时静默降级为仅内存态 */ }
}

function readPos() {
    try {
        const parsed = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
        return parsed && Number.isFinite(parsed.x) && Number.isFinite(parsed.y) ? parsed : null;
    } catch {
        return null;
    }
}

function writePos(x, y) {
    try {
        localStorage.setItem(POS_KEY, JSON.stringify({ x, y }));
    } catch { /* 隐私模式禁用存储时静默降级 */ }
}

function isEnabled() {
    return settings().miniModeEnabled === true || readMirror().enabled;
}

function closeOverlays() {
    // 不保留弹窗战况。只清行内 display 和打开态，不写 display:none：
    // 弹窗有的靠 .blai-is-open 显示、有的靠 .show()/css('display') 显示，
    // 一旦写死行内 display:none，下次按各自方式打开就再也显示不出来。
    $(MODAL_SELECTOR).each((_, element) => {
        element.classList.remove('blai-is-open');
        element.setAttribute('aria-hidden', 'true');
        element.style.removeProperty('display');
    });
    closeAllMenuPopovers();
}

function collapse() {
    closeOverlays();
    $('#blai-purifier-popup').stop(true, true).hide();
    $(`#${BALL_ID}`).addClass('is-visible').attr('aria-hidden', 'false');
    refreshEdgeState();
}

function expand() {
    $(`#${BALL_ID}`).removeClass('is-visible').attr('aria-hidden', 'true');
    // 球态下刷新不会走工具栏的 openPurifier，展开时补一次首屏渲染。
    expandRefreshHandler();
    $('#blai-purifier-popup').css('display', 'grid').hide().fadeIn(getFadeDuration('in'));
}

// 球统一用 left/top 定位：隐藏态下 right/bottom 会算出视口外坐标，
// 显示时必须主动给一次位置，不能依赖 CSS 的 right/bottom。
function ballSize() {
    const $ball = $(`#${BALL_ID}`);
    return { w: $ball.outerWidth() || 52, h: $ball.outerHeight() || 52 };
}

function placeBall(pos) {
    $(`#${BALL_ID}`).css({ right: 'auto', bottom: 'auto', left: `${pos.x}px`, top: `${pos.y}px` });
}

function snappedX(side) {
    const { w } = ballSize();
    return side === 'left' ? -w * (1 - EDGE_VISIBLE_RATIO) : window.innerWidth - w * EDGE_VISIBLE_RATIO;
}

function snapSide(x) {
    const { w } = ballSize();
    if (x < -1) return 'left';
    if (x + w > window.innerWidth + 1) return 'right';
    return null;
}

function clampY(y) {
    const { h } = ballSize();
    return Math.max(0, Math.min(y, window.innerHeight - h));
}

function defaultBallPos() {
    const { h } = ballSize();
    return { x: snappedX('right'), y: clampY(window.innerHeight - h - 12) };
}

// 首帧球还没显示，outerWidth 拿不到；先按固定尺寸夹一次。
function clampPosOnce(pos) {
    const side = snapSide(pos.x);
    const x = side ? snappedX(side) : Math.max(0, Math.min(pos.x, window.innerWidth - 52));
    return { x, y: Math.max(0, Math.min(pos.y, window.innerHeight - 52)) };
}

function restoreBallPos() {
    placeBall(clampPosOnce(readPos() || defaultBallPos()));
}

function clampPos(x, y) {
    const { w } = ballSize();
    return {
        x: Math.max(0, Math.min(x, window.innerWidth - w)),
        y: clampY(y),
    };
}

function refreshEdgeState() {
    const ball = document.getElementById(BALL_ID);
    if (!ball || !ball.offsetWidth || !ball.offsetHeight) return;
    // 用内联 left 判定：悬停弹出靠 transform，getBoundingClientRect 会把状态翻转。
    const x = Number.parseFloat(ball.style.left);
    if (!Number.isFinite(x)) return;
    const side = snapSide(x);
    ball.classList.toggle('is-edge-snapped', !!side);
    ball.classList.toggle('is-snap-left', side === 'left');
    ball.classList.toggle('is-snap-right', side === 'right');
}

function bindBallDrag() {
    const ball = document.getElementById(BALL_ID);
    if (!ball || ball.dataset.dragBound === '1') return () => 0;
    ball.dataset.dragBound = '1';

    let drag = null;
    let suppressClickUntil = 0;
    ball.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        const rect = ball.getBoundingClientRect();
        // 先切到拖动态（无位置缓动），再把悬停弹出的位移固化成 left/top。
        ball.classList.add('is-dragging');
        if (ball.classList.contains('is-edge-snapped')) {
            $(ball).css({ left: `${rect.left}px`, top: `${rect.top}px`, right: 'auto', bottom: 'auto' });
            ball.classList.remove('is-edge-snapped', 'is-snap-left', 'is-snap-right');
        }
        drag = {
            id: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: rect.left,
            originY: rect.top,
            moved: false,
        };
        try { ball.setPointerCapture(e.pointerId); } catch { /* 合成事件可能没有活动指针 */ }
    });

    ball.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        e.preventDefault();
        const to = clampPos(drag.originX + dx, drag.originY + dy);
        $(ball).css({ right: 'auto', bottom: 'auto', left: `${to.x}px`, top: `${to.y}px` });
    });

    const finish = (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const moved = drag.moved;
        drag = null;
        ball.classList.remove('is-dragging');
        if (ball.hasPointerCapture(e.pointerId)) ball.releasePointerCapture(e.pointerId);
        if (!moved) {
            refreshEdgeState();
            return;
        }
        const rect = ball.getBoundingClientRect();
        const centerX = rect.left + rect.width / 2;
        const side = centerX <= SNAP_DISTANCE ? 'left'
            : window.innerWidth - centerX <= SNAP_DISTANCE ? 'right' : null;
        const to = side
            ? { x: snappedX(side), y: clampY(rect.top) }
            : clampPos(rect.left, rect.top);
        $(ball).css({ left: `${to.x}px`, top: `${to.y}px` });
        refreshEdgeState();
        writePos(to.x, to.y);
        // pointerup 后还会派发一次 click，拖动场景要吞掉，避免松手即展开。
        suppressClickUntil = Date.now() + 250;
    };
    ball.addEventListener('pointerup', finish);
    ball.addEventListener('pointercancel', finish);

    window.addEventListener('resize', () => {
        if (!ball.offsetWidth || !ball.offsetHeight) return;
        const x = Number.parseFloat(ball.style.left);
        const y = Number.parseFloat(ball.style.top);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const side = snapSide(x);
        const to = side ? { x: snappedX(side), y: clampY(y) } : clampPos(x, y);
        $(ball).css({ left: `${to.x}px`, top: `${to.y}px` });
        writePos(to.x, to.y);
        refreshEdgeState();
    });
    return () => suppressClickUntil;
}

export function isMiniModeEnabled() {
    return isEnabled();
}

export function isMiniModeActive() {
    const cfg = settings();
    const mirror = readMirror();
    return (cfg.miniModeActive === true || mirror.active) && isEnabled();
}

export function applyMiniModeState() {
    const cfg = settings();
    const mirror = readMirror();
    const enabled = isEnabled();
    const boot = !bootApplied;
    bootApplied = true;
    const active = enabled && (boot || cfg.miniModeActive === true || mirror.active === true);
    if (active !== cfg.miniModeActive) cfg.miniModeActive = active;
    if (boot && active) {
        writeMirror(true, true);
        getAppContext().saveSettingsDebounced?.();
    }
    if (active) {
        $('#blai-purifier-popup').hide();
        $(`#${BALL_ID}`).addClass('is-visible').attr('aria-hidden', 'false');
        refreshEdgeState();
    } else {
        $(`#${BALL_ID}`).removeClass('is-visible').attr('aria-hidden', 'true');
    }
}

export function enterMiniMode() {
    const cfg = settings();
    if (!isEnabled()) return false;
    cfg.miniModeActive = true;
    writeMirror(true, true);
    getAppContext().saveSettingsDebounced?.();
    collapse();
    return true;
}

export function exitMiniMode() {
    const cfg = settings();
    cfg.miniModeActive = false;
    writeMirror(isEnabled(), false);
    getAppContext().saveSettingsDebounced?.();
    expand();
    return true;
}

export function setMiniModeEnabled(enabled) {
    const cfg = settings();
    const nextEnabled = enabled === true;
    const wasActive = isMiniModeActive();
    cfg.miniModeEnabled = nextEnabled;
    if (!nextEnabled) {
        cfg.miniModeActive = false;
        // 关开关只是把球撤掉，不强行把插件页弹开。
        if (wasActive) $('#blai-purifier-popup').hide();
    }
    writeMirror(nextEnabled, nextEnabled && wasActive);
    getAppContext().saveSettingsDebounced?.();
    applyMiniModeState();
}

export function bindMiniModeEvents() {
    if (!$(`#${BALL_ID}`).length) $('body').append(ballMarkup);
    restoreBallPos();
    const suppressClick = bindBallDrag();
    $(document)
        .off('click', `#${BALL_ID}`)
        .on('click', `#${BALL_ID}`, (e) => {
            e.preventDefault();
            if (Date.now() < suppressClick()) return;
            exitMiniMode();
        });
    applyMiniModeState();
}
