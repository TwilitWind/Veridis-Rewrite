#!/usr/bin/env node
/**
 * 转场与浮层定位的纯 Node 回归（不需要浏览器）：
 *   ① 导览提示框在手机尺寸下四边都留在视口内，包括贴边目标与空间不足的翻转；
 *   ② portal 菜单按上下可用空间决定展开方向与实际限高；
 *   ③ 转场/导览的源码接线（fade through、弹卡、菜单方向、toast、分段指示块）仍在。
 *
 * 用法：node test/audit/verify-motion-placement.mjs
 * 失败退出码 1。这里只做纯计算与静态接线；真实渲染另由对应 CDP 脚本负责。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { calculateTourPopoverPlacement, calculateCenteredTourPlacement } from '../../src/ui/tour/tour-01-steps.js';
import { computeMenuPlacement } from '../../src/ui/popover.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const results = [];
const check = (name, ok, detail = '') => {
    results.push(ok);
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
};
const inside = (placement, viewport, margin = 12) => placement.left >= margin - 0.5
    && placement.top >= margin - 0.5
    && placement.left + placement.width <= viewport.width - margin + 0.5
    && placement.top + placement.height <= viewport.height - margin + 0.5;

const phone = { width: 390, height: 844 };

// ① 普通情况：下方空间充足，提示框落在目标下方且居中不越界。
const below = calculateTourPopoverPlacement(
    { left: 20, right: 200, top: 100, bottom: 140, width: 180, height: 40 },
    { width: 320, height: 300 },
    phone,
);
check('导览：下方充足时从下方展开', below.side === 'bottom' && inside(below, phone), JSON.stringify(below));

// ② 目标贴屏幕底边：翻转到上方，仍完整留在视口内。
const above = calculateTourPopoverPlacement(
    { left: 20, right: 200, top: 760, bottom: 830, width: 180, height: 70 },
    { width: 320, height: 300 },
    phone,
);
check('导览：下方不足时翻到上方', above.side === 'top' && inside(above, phone), JSON.stringify(above));

// ③ 极端目标几乎占满屏幕高度：只能压到一侧，宽度按剩余空间收缩后左边界不能为负数。
const rightEdge = calculateTourPopoverPlacement(
    { left: 100, right: 380, top: 0, bottom: 844, width: 280, height: 844 },
    { width: 320, height: 300 },
    phone,
);
const legacyLeft = (100 - 12) - 320; // 旧算法：用未收缩的自然宽度算 left，会得到 -232
check('导览：贴边目标按收缩后宽度夹紧', rightEdge.constrained && rightEdge.left >= 12 && inside(rightEdge, phone),
    `left=${rightEdge.left} maxWidth=${rightEdge.maxWidth} 旧算法=${legacyLeft}`);
check('反证：旧算法确实会飞出屏幕', legacyLeft < 0);

// ④ 上下都不够、左右也不够：选能放下最大面积的一侧，坐标与尺寸都夹紧。
const squeezed = calculateTourPopoverPlacement(
    { left: 20, right: 200, top: 100, bottom: 830, width: 180, height: 730 },
    { width: 320, height: 800 },
    phone,
);
check('导览：空间都不足时仍不越界', squeezed.constrained && inside(squeezed, phone), JSON.stringify(squeezed));

// ④b 居中卡（完成页/欢迎页/error）：不能依赖 CSS 的 top:50%，按视口中心夹紧。
const centered = calculateCenteredTourPlacement({ width: 366, height: 260 }, phone);
check('导览：居中卡按视口中心定位且不越界',
    centered.left === 12 && centered.top === 292 && inside(centered, phone), JSON.stringify(centered));
const centeredTall = calculateCenteredTourPlacement({ width: 366, height: 900 }, phone);
check('导览：超高居中卡收缩后四边仍在视口内',
    centeredTall.maxHeight === 820 && centeredTall.top === 12 && inside(centeredTall, phone), JSON.stringify(centeredTall));

// ⑤ portal 菜单：下方充足不翻转；下方不足且上方更宽裕时翻转并限高。
const menuDown = computeMenuPlacement({
    anchorRect: { top: 180, bottom: 212, right: 230 },
    viewportWidth: 390, viewportHeight: 844, naturalWidth: 200, naturalHeight: 180,
});
check('菜单：下方空间充足时完整展开', !menuDown.flipUp && menuDown.top === 218 && menuDown.maxHeight === 180, JSON.stringify(menuDown));
const menuUp = computeMenuPlacement({
    anchorRect: { top: 700, bottom: 730, right: 100 },
    viewportWidth: 390, viewportHeight: 844, naturalWidth: 150, naturalHeight: 250,
});
check('菜单：下方不足时翻到上方', menuUp.flipUp && menuUp.top === 444 && menuUp.maxHeight === 250, JSON.stringify(menuUp));
const menuClamped = computeMenuPlacement({
    anchorRect: { top: 400, bottom: 430, right: 100 },
    viewportWidth: 390, viewportHeight: 844, naturalWidth: 150, naturalHeight: 500,
});
check('菜单：两侧都不够时选较大一侧并留在视口内',
    !menuClamped.flipUp && menuClamped.maxHeight === 400 && menuClamped.top + menuClamped.height <= 844 - 8,
    JSON.stringify(menuClamped));

// ⑥ 接线检查：改动被回退时上面的几何仍可能对，但这些断言会失败。
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const motion = read('styles/components/04-motion.css');
const shellCss = read('styles/layouts/00-shell.css');
const shellJs = read('src/ui/shell.js');
const toastCss = read('styles/components/03-toasts.css');
const segmentCss = read('styles/pages/home/home-rule-edit-modal.css');
const segmentJs = read('src/rules/events/events-01-ui.js');
const popoverJs = read('src/ui/popover.js');
const tourCss = read('styles/pages/tour/00-tour.css');
check('切页 fade through：旧页淡出 + 新页延迟淡入的 CSS/JS 都在',
    /blai-page-enter/.test(motion) && /\.page-panel\.blai-is-leaving[\s\S]*?display: grid/.test(shellCss)
    && /blai-is-entering/.test(shellJs) && /fadeOutThen\(previous/.test(shellJs));
check('弹卡入场走 token 化 scale + 延迟',
    /blai-modal-card-in/.test(motion) && /--blai-modal-card-delay/.test(motion) && /scale\(\.96\)/.test(motion));
check('菜单方向只作用于子元素',
    /data-menu-direction="up"/.test(motion) && /menu\.dataset\.menuDirection/.test(popoverJs)
    && !/menu\.style\.setProperty\('transform'/.test(popoverJs));
check('toast 从顶部边缘滑入并反向退出',
    /translate\(-50%, calc\(-1 \* var\(--blai-space-16\)\)\)/.test(toastCss)
    && /translate\(-50%, 0\)/.test(toastCss));
check('分段控件只有指示块滑动，不改整页',
    /--blai-segment-index/.test(segmentCss) && /--blai-segment-index/.test(segmentJs)
    && /translateX\(calc\(var\(--blai-segment-index/.test(segmentCss));
check('导览提示框有视口上限兜底',
    /max-width: min\(var\(--blai-tour-popover-max-width/.test(tourCss)
    && /max-height: min\(var\(--blai-tour-popover-max-height/.test(tourCss));
const tourRuntime = read('src/ui/tour/tour-02-runtime.js');
check('居中导览步骤（含欢迎/错误页）也走视口夹紧',
    /positionCenteredTour\(/.test(tourRuntime)
    && /if \(!target\) \{[\s\S]*?positionCenteredTour\(card\)/.test(tourRuntime)
    && /positionCenteredTour\(layer\.querySelector\('\.blai-tour-card'\)\)/.test(tourRuntime));

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n失败 ${failed}/${results.length}` : `\n全部通过 ${results.length}/${results.length}`);
process.exit(failed ? 1 : 0);
