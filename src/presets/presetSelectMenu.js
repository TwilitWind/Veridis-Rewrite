/**
 * 首页规则集自绘下拉：触发器展开浮层、选项点击切换。
 * 从 events.js 拆出，避免该文件触发体积闸门。切换逻辑由调用方以回调注入。
 */
import { openMenuPopover, closeMenuPopover } from '../ui/popover.js';
import { updateToolbarUI } from './view.js';

export function bindPresetSelectMenu(switchPreset) {
    // 点触发器展开浮层，菜单宽度铺满触发器；已是展开态则收起。
    $(document).off('click', '#blai-preset-select-trigger').on('click', '#blai-preset-select-trigger', function(e) {
        e.preventDefault();
        e.stopPropagation();
        const trigger = this;
        const menu = document.getElementById('blai-preset-menu');
        if (!menu) return;
        // 用 hidden 判断展开态：popover 外部点击关闭时会设 hidden，这里可正常再次打开。
        if (!menu.hasAttribute('hidden')) {
            closeMenuPopover(menu);
            menu.setAttribute('hidden', '');
            $('#blai-preset-select-trigger').attr('aria-expanded', 'false');
            return;
        }
        // 宽度交给 CSS 按最长选项自适应；写死触发器宽度会把长预设名折成多行。
        menu.style.removeProperty('width');
        // hidden 交由 openMenuPopover 在挂到 body 之后解除，避免展开瞬间撑高网格顶栏。
        $('#blai-preset-select-trigger').attr('aria-expanded', 'true');
        openMenuPopover(trigger, menu);
    });

    // 点选项：先关菜单再切换规则集（切换含未保存确认弹窗）。
    $(document).off('click', '.blai-preset-menu-item').on('click', '.blai-preset-menu-item', async function(e) {
        e.preventDefault();
        e.stopPropagation();
        const newPreset = String($(this).attr('data-preset') || '');
        const menu = document.getElementById('blai-preset-menu');
        if (menu) {
            closeMenuPopover(menu);
            menu.setAttribute('hidden', '');
        }
        $('#blai-preset-select-trigger').attr('aria-expanded', 'false');
        // switchPreset 走 skipRender，切完需主动刷新工具栏以同步自绘触发器的当前值文案。
        await switchPreset(newPreset);
        updateToolbarUI();
    });
}
