// 透视弹窗回归探针：只负责从页面读取来源图例、筛选行、定位态与提示块。
// 从 verify-diff-stats-legend.mjs 拆出，避免主脚本超过提交体积门禁。
export const PROBE = `(() => {
    const modal = document.getElementById('blai-diff-modal');
    const content = document.getElementById('blai-diff-modal-content');
    const toolbar = document.getElementById('blai-diff-toolbar');
    const panel = document.getElementById('blai-diff-filter-panel');
    const seen = new Set();
    const visibleIds = new Set();
    const bySection = { program: 0, ai: 0, other: 0 };
    let groups = 0;
    content?.querySelectorAll('[data-blai-revert-item]').forEach((node) => {
        const id = node.getAttribute('data-blai-revert-item');
        if (!id || seen.has(id)) return;
        seen.add(id);
        groups++;
        const section = node.getAttribute('data-blai-diff-section');
        if (section === 'program' || section === 'ai') bySection[section]++;
        else bySection.other++;
        if (node.offsetParent !== null) visibleIds.add(id);
    });
    const readControl = (node) => {
        if (!node) return null;
        const style = getComputedStyle(node);
        const dot = node.querySelector('i');
        const dotStyle = dot ? getComputedStyle(dot) : null;
        const rect = node.getBoundingClientRect();
        return {
            label: [...node.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(''),
            text: node.textContent.trim(),
            tag: node.tagName.toLowerCase(),
            source: node.getAttribute('data-blai-diff-source'),
            filterSource: node.getAttribute('data-blai-diff-filter-source'),
            count: node.querySelector('.blai-diff-stat')?.textContent ?? null,
            visible: node.offsetParent !== null,
            color: style.color,
            dotColor: dotStyle ? dotStyle.backgroundColor : null,
            border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
            background: style.backgroundColor,
            active: node.classList.contains('is-active'),
            pressed: node.getAttribute('aria-pressed'),
            centerY: rect.top + rect.height / 2,
            left: rect.left,
            right: rect.right,
            width: rect.width,
        };
    };
    const sources = [...document.querySelectorAll('#blai-diff-toolbar .blai-diff-source')].map(readControl);
    const toggleNode = document.getElementById('blai-diff-filter-toggle');
    const toggle = readControl(toggleNode);
    const navNode = document.querySelector('#blai-diff-toolbar .blai-diff-nav');
    const navRect = navNode?.getBoundingClientRect();
    const sourcesRect = document.querySelector('.blai-diff-sources')?.getBoundingClientRect();
    const chips = [...document.querySelectorAll('#blai-diff-filter-panel [data-blai-diff-filter-source]')].map(readControl);
    const panelStyle = panel ? getComputedStyle(panel) : null;
    const toolbarStyle = toolbar ? getComputedStyle(toolbar) : null;
    // 浏览器缩放会把 1px 回读成分数，用同页 1px 参考值比较。
    const refProbe = document.createElement('span');
    refProbe.style.borderTop = '1px solid red';
    content?.appendChild(refProbe);
    const ref1px = parseFloat(getComputedStyle(refProbe).borderTopWidth);
    refProbe.remove();
    const navButtons = [...document.querySelectorAll('#blai-diff-toolbar .blai-diff-nav-btn')].map(readControl);
    const navCenterY = navButtons.length ? (navButtons[0].centerY + navButtons[1].centerY) / 2 : 0;
    const currentNode = content?.querySelector('.blai-diff-nav-current');
    const currentStyle = currentNode ? getComputedStyle(currentNode) : null;
    const notices = [...(content?.querySelectorAll('.blai-diff-empty') || [])].map((node) => {
        const style = getComputedStyle(node);
        const icon = node.querySelector(':scope > i');
        return {
            text: node.textContent.trim().slice(0, 24),
            color: style.color,
            icon: icon?.className || '',
            iconColor: icon ? getComputedStyle(icon).color : '',
            section: node.getAttribute('data-diff-section') || '',
            visible: node.offsetParent !== null,
            background: style.backgroundColor,
            borderTop: style.borderTopWidth,
            marginBottom: style.marginBottom,
            fontWeight: style.fontWeight,
        };
    });
    const revertTextNode = document.getElementById('blai-diff-revert-text');
    const titleTextNode = document.querySelector('.blai-diff-title-text');
    return {
        ref1px,
        modalOpen: !!modal && getComputedStyle(modal).display !== 'none',
        filterEnabled: modal?.getAttribute('data-diff-filter-enabled') || '',
        stats: ['blai-diff-stat-program', 'blai-diff-stat-ai', 'blai-diff-stat-manual']
            .map((id) => document.getElementById(id)?.textContent ?? ''),
        expectedStats: [String(bySection.program), String(bySection.ai), '0'],
        nav: document.getElementById('blai-diff-nav-count')?.textContent ?? '',
        groups,
        visibleGroups: visibleIds.size,
        bySection,
        navCenterY,
        navButtons,
        contentColor: content ? getComputedStyle(content).color : '',
        sources,
        toggle,
        toggleIcon: toggleNode?.querySelector('i')?.className || '',
        toggleExpanded: toggleNode?.getAttribute('aria-expanded') || '',
        order: {
            sourcesRight: sourcesRect?.right || 0,
            navLeft: navRect?.left || 0,
            navRight: navRect?.right || 0,
            toggleLeft: toggle?.left || 0,
        },
        panel: {
            exists: !!panel,
            hidden: panel ? panel.hidden : null,
            visible: !!panel && panel.offsetParent !== null,
            justify: panelStyle?.justifyContent || '',
            border: panelStyle ? [panelStyle.borderTopWidth, panelStyle.borderRightWidth, panelStyle.borderBottomWidth, panelStyle.borderLeftWidth] : [],
            borderBottom: panelStyle?.borderBottomWidth || '',
            right: panel ? panel.getBoundingClientRect().right : 0,
            chips,
        },
        toolbar: {
            height: toolbar ? toolbar.getBoundingClientRect().height : 0,
            color: toolbarStyle?.color || '',
            borderBottom: toolbarStyle?.borderBottomWidth || '',
        },
        highlight: currentStyle ? {
            outlineWidth: currentStyle.outlineWidth,
            outlineOffset: currentStyle.outlineOffset,
            boxShadow: currentStyle.boxShadow,
            background: currentStyle.backgroundColor,
            outlineVar: currentStyle.getPropertyValue('--blai-border-2'),
            zoom: currentStyle.zoom,
        } : null,
        decorationThickness: (() => {
            const delNode = content?.querySelector('del.blai-diff-change');
            return delNode ? getComputedStyle(delNode).textDecorationThickness : '';
        })(),
        // Chrome 会按设备像素量化 outline-width（DPR≠1 时 2px 可能回读成 1.53846px），
        // 因此用同页 2px 参考值作比较，确认高亮确实走 2px 而不是被改成 1px/3px。
        outlineReference: (() => {
            if (!content) return '';
            const probe = document.createElement('span');
            probe.style.cssText = 'outline: 2px solid red; outline-offset: 0';
            content.appendChild(probe);
            const width = getComputedStyle(probe).outlineWidth;
            probe.remove();
            return width;
        })(),
        notices,
        reverted: (content?.textContent || '').includes('已撤回'),
        comparing: (content?.textContent || '').includes('正在比较文本'),
        revert: {
            text: revertTextNode?.textContent ?? '',
            visible: !!revertTextNode && getComputedStyle(revertTextNode).display !== 'none' && revertTextNode.offsetParent !== null,
            buttonWidth: toggleNode && document.getElementById('blai-diff-revert-toggle')
                ? document.getElementById('blai-diff-revert-toggle').getBoundingClientRect().width : 0,
        },
        title: {
            text: titleTextNode?.textContent ?? '',
            clipped: !!titleTextNode && titleTextNode.scrollWidth > titleTextNode.clientWidth + 3,
        },
    };
})()`;
