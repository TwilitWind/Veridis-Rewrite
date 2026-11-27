/** 开关控件的唯一状态投影：aria-pressed / 提示 / 文案一次写齐，避免四处漂移。 */
export function syncToggleState(selector, enabled, options = {}) {
    const {
        onTitle,
        offTitle,
        onLabel = onTitle,
        offLabel = offTitle,
        ariaLabel = false,
        stateSelector = '.blai-tools-switch-state',
    } = options;
    const $toggle = $(selector);
    if (!$toggle.length) return;
    $toggle.attr('aria-pressed', String(enabled))
        .attr('title', enabled ? onTitle : offTitle);
    if (ariaLabel) $toggle.attr('aria-label', enabled ? onLabel : offLabel);
    $toggle.find(stateSelector).text(enabled ? '开启' : '关闭');
}
