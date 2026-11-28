/**
 * 插件不使用转场动画：所有切换即时完成。
 * 保留导出名，调用方无需改动；时长统一为 0，退场与 FLIP 直接落到终态。
 */

const leaveTokens = new WeakMap();

export function getFadeDuration() {
    return 0;
}

export function getFadeExitMs() {
    return 0;
}

/** 立即执行 done，供页面 / 弹窗 / 标签页切换共用。 */
export function fadeOutThen(el, done) {
    const node = el && el.jquery ? el[0] : el;
    const previous = node && leaveTokens.get(node);
    if (previous) previous();
    const cancel = () => {
        if (node && leaveTokens.get(node) === cancel) leaveTokens.delete(node);
    };
    if (node) leaveTokens.set(node, cancel);
    if (typeof done === 'function') done();
    return cancel;
}

/** 整块重渲染：直接写入，不做 FLIP 位移。 */
export function renderWithFlip(container, html) {
    if (!container) return;
    container.html(html);
}
