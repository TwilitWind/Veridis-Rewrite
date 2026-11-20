/**
 * 手机端规则集操作省略号菜单：五个动作在窄屏收进一个浮层。
 * 浮层由 popover.js 挂到 body，点击事件走这里，不再依赖 #blai-purifier-popup 内的代理委托。
 */
import { openMenuPopover, closeMenuPopover } from '../ui/popover.js';

export function bindPresetActionsMenu() {
    const toggle = document.getElementById('blai-preset-actions-toggle');
    const menu = document.getElementById('blai-preset-actions-menu');
    if (!toggle || !menu) return;

    $(document).off('click', '#blai-preset-actions-toggle').on('click', '#blai-preset-actions-toggle', function (e) {
        e.preventDefault();
        e.stopPropagation();
        // 桌面端触发器隐藏：防止脚本或辅助技术误触发时把菜单定位到视口左上角。
        if (getComputedStyle(toggle).display === 'none') return;
        if (!menu.hasAttribute('hidden')) {
            closeMenuPopover(menu);
            menu.setAttribute('hidden', '');
            toggle.setAttribute('aria-expanded', 'false');
            return;
        }
        menu.removeAttribute('hidden');
        toggle.setAttribute('aria-expanded', 'true');
        openMenuPopover(toggle, menu);
    });

    $(document).off('click', '.blai-preset-actions-menu .blai-preset-menu-item').on('click', '.blai-preset-actions-menu .blai-preset-menu-item', function (e) {
        e.preventDefault();
        e.stopPropagation();
        const selector = String($(this).attr('data-blai-preset-action') || '');
        closeMenuPopover(menu);
        menu.setAttribute('hidden', '');
        toggle.setAttribute('aria-expanded', 'false');
        const target = selector ? document.querySelector(selector) : null;
        if (target && !target.disabled) target.click();
    });
}
