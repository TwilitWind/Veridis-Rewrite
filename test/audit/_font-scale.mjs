// 字号刻度解析的唯一真源：style-audit 与 layout-audit 共用。
// 两处消费口径不同：静态审计以桌面档为准，运行时审计要同时认手机档。
import fs from 'node:fs';
import path from 'node:path';

export const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

export function readFontScale(stylesDir) {
    const text = stripComments(fs.readFileSync(path.join(stylesDir, 'tokens', '03-scale.css'), 'utf8'));
    const tokenMap = new Map();
    const aliasMap = new Map();
    for (const m of text.matchAll(/(--(?:blai-font|blai-fs)-[\w-]+)\s*:\s*([\d.]+)px/g)) {
        // 不覆盖已存在值：03-scale 末尾的手机 @media 会重定义 5 档，
        // 静态审计以桌面档为准（手机档由运行时审计单独量）。
        if (!tokenMap.has(m[1])) tokenMap.set(m[1], Number(m[2]));
    }
    for (const m of text.matchAll(/(--(?:blai-font|blai-fs)-[\w-]+)\s*:\s*var\(\s*(--[\w-]+)\s*\)/g)) {
        aliasMap.set(m[1], m[2]);
    }
    const resolvePx = (name, seen = new Set()) => {
        if (tokenMap.has(name)) return tokenMap.get(name);
        if (aliasMap.has(name) && !seen.has(name)) {
            seen.add(name);
            return resolvePx(aliasMap.get(name), seen);
        }
        return null;
    };
    for (const [name, target] of aliasMap) {
        const px = resolvePx(target);
        if (px != null) tokenMap.set(name, px);
    }
    // 运行时审计用：桌面与手机档所有 px 值都算设计 token。
    const allowedAllPx = new Set(
        [...text.matchAll(/--blai-fs-[\w-]+\s*:\s*([\d.]+)px/g)].map((m) => Number(m[1])),
    );
    return {
        tokenMap,
        aliasMap,
        allowedPx: new Set(tokenMap.values()),
        allowedAllPx,
    };
}
