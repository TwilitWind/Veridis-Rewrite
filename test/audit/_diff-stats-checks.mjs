// 透视弹窗回归断言：从主脚本拆出，保持 check(failures, condition, message) 历史签名。
export function check(failures, condition, message) {
    if (!condition) failures.push(message);
}

export function checkStats(failures, label, snapshot) {
    // 手改数由 diffStats 单测单独守口径；浏览器里只要求与手改提示的有无一致。
    check(failures, snapshot.stats[0] === snapshot.expectedStats[0] && snapshot.stats[1] === snapshot.expectedStats[1],
        `${label}：程序/AI 计数应为 ${snapshot.expectedStats.slice(0, 2).join('/')}，实际 ${snapshot.stats.slice(0, 2).join('/')}`);
    const hasManualNotice = snapshot.notices.some((notice) => notice.section === 'manual');
    check(failures, (Number(snapshot.stats[2]) > 0) === hasManualNotice,
        `${label}：手改计数 ${snapshot.stats[2]} 与手改提示存在与否（${hasManualNotice}）不一致`);
    check(failures, snapshot.bySection.other === 0,
        `${label}：出现未归类的改写项 ${snapshot.bySection.other} 个`);
}

export function checkNoBorders(failures, label, controls) {
    controls.filter(Boolean).forEach((control) => {
        check(failures, control.border.every((width) => width === '0px'),
            `${label}「${control.label || control.filterSource || control.source}」仍有边框：${control.border.join('/')}`);
    });
}

export function checkSingleLine(failures, label, snapshot, maxHeight) {
    check(failures, snapshot.toolbar.height > 0 && snapshot.toolbar.height <= maxHeight,
        `${label}：工具行高度 ${snapshot.toolbar.height}px，应不超过 ${maxHeight}px`);
    const centers = [
        ...snapshot.sources.map((item) => item.centerY),
        snapshot.navCenterY,
        snapshot.toggle?.centerY || 0,
    ].filter((value) => value > 0);
    check(failures, Math.max(...centers) - Math.min(...centers) <= 8,
        `${label}：来源、定位与筛选不在同一行，中线 ${centers.map(v => v.toFixed(1)).join('/')}`);
    check(failures, snapshot.order.navLeft >= snapshot.order.sourcesRight - 1,
        `${label}：定位应排在来源图例右侧，实际 ${snapshot.order.navLeft} < ${snapshot.order.sourcesRight}`);
    check(failures, snapshot.order.toggleLeft >= snapshot.order.navRight - 1,
        `${label}：筛选开关应排在定位右侧，实际 ${snapshot.order.toggleLeft} < ${snapshot.order.navRight}`);
}

export function checkNotices(failures, label, snapshot) {
    snapshot.notices.forEach((notice) => {
        check(failures, notice.color === snapshot.toolbar.color,
            `${label}「${notice.text}」不是浅字：${notice.color}，应为 ${snapshot.toolbar.color}`);
        check(failures, !!notice.icon, `${label}「${notice.text}」开头没有图标`);
        check(failures, !!notice.iconColor && notice.iconColor !== 'rgba(0, 0, 0, 0)',
            `${label}「${notice.text}」行首图标未着色`);
        check(failures, notice.background !== 'rgba(0, 0, 0, 0)'
            && Math.abs(parseFloat(notice.borderTop) - snapshot.ref1px) < 0.02,
            `${label}「${notice.text}」不是独立提示块：背景 ${notice.background} / 上边框 ${notice.borderTop} / 参考 ${snapshot.ref1px}px`);
        check(failures, notice.fontWeight === '400', `${label}「${notice.text}」字重应为常规，实际 ${notice.fontWeight}`);
    });
}
