// collectDiffStats 的手改计数口径单测；从浏览器回归脚本里拆出来，纯 Node 运行。
import { collectDiffStats } from '../../src/diff/diffStats.js';

export function checkManualCount(failures) {
    const emptyEl = { querySelectorAll: () => [] };
    const makeMsg = (mes, programMes, reverted = false) => ({
        mes,
        __blai_diff_branch_meta: {
            main: { originalMes: programMes, aiMes: null, programMes, reverted },
        },
    });
    const cases = [
        ['无手改', makeMsg('ABCDEFGH', 'ABCDEFGH'), 0],
        ['一处连续手改', makeMsg('AXCDEFGH', 'ABCDEFGH'), 1],
        ['两处分离手改', makeMsg('AXCDEYGH', 'ABCDEFGH'), 2],
        ['撤回态不计手改', makeMsg('AXCDEYGH', 'ABCDEFGH', true), 0],
    ];
    for (const [name, msg, expected] of cases) {
        const actual = collectDiffStats(msg, emptyEl).manual;
        if (actual !== expected) failures.push(`手改计数单测「${name}」应为 ${expected}，实际 ${actual}`);
    }
}
