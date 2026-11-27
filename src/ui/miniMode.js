/**
 * 悬浮球模式：主界面收起成一个 body 直属悬浮球。
 *
 * 保活口径（用户定义）：
 * - 工具页开关开启时，顶栏 × 把界面收成悬浮球；开关关闭时 × 是真正的关闭，不再有单独入口按钮；
 * - 只要开关是开的，页面加载后直接进入悬浮球态，不依赖上次是否点过 ×；
 * - 「界面停留战况」（停在哪个页面、开着哪些弹窗）不保存，刷新后回默认页、无弹窗。
 * 悬浮球必须 body 直属：#blai-purifier-popup 带 backdrop-filter 会生成层叠上下文，
 * 放里面 position:fixed 会相对它定位、被遮罩挡住。
 */
import { extensionName } from '../settings/defaults.js';
import { getAppContext } from '../host/appContext.js';
import { getFadeDuration } from './motion.js';

const BALL_ID = 'blai-mini-ball';
// 迷你态跨刷新保活用 localStorage 镜像：宿主扩展设置由服务端异步落盘，
// 直接改内存对象在快速刷新时可能丢失；球的存在感不该依赖那次写盘时机。
const MIRROR_KEY = 'veridis-rewrite:mini-state';
const POS_KEY = 'veridis-rewrite:mini-ball-pos';
// 首次 applyMiniModeState 代表一次页面加载：此时开关开着就直接进悬浮球态。
let bootApplied = false;
const DRAG_THRESHOLD = 4;
// 成熟悬浮球口径：靠近左右边缘松手时，球只留一小半在屏幕内，其余藏到屏外并半透明；
// 悬停或聚焦时整颗弹出、恢复不透明，方便点击与再次拖动。中间的任意位置都原样保留。
const EDGE_VISIBLE_RATIO = 0.5;
const SNAP_DISTANCE = 56;
// 从悬浮球展开时补跑首屏渲染：刷新后球态启动不会走工具栏的 openPurifier 路径。
let expandRefreshHandler = () => {};

export function setMiniModeExpandHandler(handler) {
    expandRefreshHandler = typeof handler === 'function' ? handler : () => {};
}

const MODAL_SELECTOR = [
    '#blai-binding-history-modal', '#blai-ai-generation-modal', '#blai-ai-additional-modal',
    '#blai-rule-edit-modal', '#blai-risk-confirm-modal', '#blai-risk-info-modal',
    '#blai-deep-clean-backdrop', '#blai-deep-clean-workspace', '#blai-feedback-workspace',
    '#blai-rule-transfer-modal', '#blai-preset-import-choice-modal', '#blai-rule-search-modal',
    '#blai-scope-tags-modal', '#blai-scope-tag-editor-modal', '#blai-diff-modal',
    '#blai-subrule-edit-modal', '#blai-ai-prompt-modal', '#blai-ai-model-manage-modal',
    '#blai-loading-overlay', '#blai-ai-toast-container', '.blai-toast',
    '#blai-theme-menu', '.blai-portal-menu',
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
    // 迷你态不保留任何弹窗战况；隐藏而非删除，保留各自事件绑定。
    $(MODAL_SELECTOR).removeClass('blai-is-open').attr('aria-hidden', 'true').hide();
    $('.blai-portal-menu').attr('hidden', '');
}

function collapse() {
    closeOverlays();
    $('#blai-purifier-popup').stop(true, true).hide();
    $(`#${BALL_ID}`).addClass('is-visible').attr('aria-hidden', 'false');
    refreshEdgeState();
}

function expand() {
    $(`#${BALL_ID}`).removeClass('is-visible').attr('aria-hidden', 'true');
    // 补渲染规则分组等首屏内容，避免「球态刷新 → 点球展开」时列表是空的。
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
    const $ball = $(`#${BALL_ID}`);
    $ball.css({ right: 'auto', bottom: 'auto', left: `${pos.x}px`, top: `${pos.y}px` });
}

// 吸附态：整颗球只留 EDGE_VISIBLE_RATIO 宽度在视口内，其余藏到屏外。
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

function restoreBallPos() {
    placeBall(clampPosOnce(readPos() || defaultBallPos()));
}

// 首帧球还没显示，outerWidth 拿不到；用固定尺寸夹一次，显示后再由拖拽逻辑接管。
function clampPosOnce(pos) {
    const side = snapSide(pos.x);
    const x = side ? snappedX(side) : Math.max(0, Math.min(pos.x, window.innerWidth - 52));
    return { x, y: Math.max(0, Math.min(pos.y, window.innerHeight - 52)) };
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
    if (!ball) return;
    // 隐藏态 rect 为 0，先不判边缘；等球显示后再由 collapse / applyMiniModeState 重算。
    if (!ball.offsetWidth || !ball.offsetHeight) return;
    // 用内联 left 判定：hover 弹出靠 transform，不能让 getBoundingClientRect 把状态翻转。
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
        // 先切到拖动态（无位置缓动），再把悬浮弹出的位移固化成 left/top，避免回弹。
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
        // 合成事件或部分浏览器没有活动指针，捕获失败不应中断拖动。
        try { ball.setPointerCapture(e.pointerId); } catch { /* 无活动指针时忽略 */ }
    });

    ball.addEventListener('pointermove', (e) => {
        if (!drag || e.pointerId !== drag.id) return;
        const dx = e.clientX - drag.startX;
        const dy = e.clientY - drag.startY;
        if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        drag.moved = true;
        e.preventDefault();
        // 首次拖动时把 right/bottom 换算成 left/top，避免两边同时约束导致跳位。
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
            // 未达阈值视为点击，交给 click 处理展开；仍贴边的话恢复半透明。
            refreshEdgeState();
            return;
        }

        const rect = ball.getBoundingClientRect();
        // 球心距边缘 <= SNAP_DISTANCE 才吸附：松手后只露出一半，另一半藏到屏外并半透明。
        // 中间位置原样保留，垂直方向始终不吸顶/吸底以免挡输入。
        const centerX = rect.left + rect.width / 2;
        const side = centerX <= SNAP_DISTANCE ? 'left'
            : window.innerWidth - centerX <= SNAP_DISTANCE ? 'right' : null;
        const to = side
            ? { x: snappedX(side), y: clampY(rect.top) }
            : clampPos(rect.left, rect.top);
        $(ball).css({ left: `${to.x}px`, top: `${to.y}px` });
        refreshEdgeState();
        writePos(to.x, to.y);
        // pointerup 后浏览器还会派发一次 click，拖动场景要吞掉，避免松手即展开。
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
        // 吸附态按新视口重新算半隐藏位置，而不是夹回全可见。
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
    // 刷新时开关仍开着就直接显示悬浮球，哪怕上次是停在插件界面里刷新的。
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
    // 只有工具页开关开启时才允许进入迷你态；未开启时由调用方走真正的关闭逻辑。
    if (!isEnabled()) return false;
    cfg.miniModeActive = true;
    writeMirror(true, true);
    const { saveSettingsDebounced } = getAppContext();
    saveSettingsDebounced();
    collapse();
    return true;
}

export function exitMiniMode() {
    const cfg = settings();
    cfg.miniModeActive = false;
    writeMirror(isEnabled(), false);
    const { saveSettingsDebounced } = getAppContext();
    saveSettingsDebounced();
    expand();
    return true;
}

export function setMiniModeEnabled(enabled) {
    const cfg = settings();
    const nextEnabled = enabled === true;
    const wasActive = isMiniModeActive();
    cfg.miniModeEnabled = nextEnabled;
    if (!nextEnabled && wasActive) {
        cfg.miniModeActive = false;
        expand();
    }
    writeMirror(nextEnabled, nextEnabled && wasActive);
    const { saveSettingsDebounced } = getAppContext();
    saveSettingsDebounced();
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
