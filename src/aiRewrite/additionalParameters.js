/** 附加参数的 YAML 文本解析与请求组装。
 *  酒馆助手（JS-Slash-Runner）会把 custom_api 的这三个字段各自 YAML.stringify 后
 *  传给酒馆后端，因此这里必须把用户填写的 YAML「文本」解析成对象/数组，而不是原样传字符串。
 *  只覆盖原生「附加参数」示例所用的 YAML 子集（扁平键值 / 字符串数组 / 一层缩进），
 *  非法行静默跳过，与酒馆原生 mergeObjectWithYaml / excludeKeysByYaml 的容错行为一致。 */

// 把单个 YAML 标量转成 JS 值：数字 / 布尔 / null / 引号字符串 / 行内 JSON / 普通字符串。
function parseScalar(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return '';
    const lower = text.toLowerCase();
    if (lower === 'null' || text === '~') return null;
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    if (/^-?\d+$/u.test(text) || /^-?\d*\.\d+$/u.test(text)) {
        const num = Number(text);
        if (Number.isFinite(num)) return num;
    }
    if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
        return text.slice(1, -1);
    }
    if ((text.startsWith('{') && text.endsWith('}')) || (text.startsWith('[') && text.endsWith(']'))) {
        try {
            return JSON.parse(text);
        } catch {
            // 行内 JSON 解析失败时按普通字符串处理。
        }
    }
    return text;
}

// 去掉行尾注释（# 前需有空白，避免误伤值里的 #，如颜色值）；整行注释直接清空。
function stripInlineComment(line) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('#')) return '';
    const match = line.match(/\s+#/u);
    return match ? line.slice(0, match.index) : line;
}

// 解析「YAML 对象」文本（包括主体参数、请求标头）。
// 支持 key: value 与一层缩进的对象；忽略注释、空行、数组项等非键值行。
export function parseYamlObject(text) {
    const result = {};
    const lines = String(text || '').split(/\r?\n/u);
    let currentParent = null;
    for (const original of lines) {
        const line = stripInlineComment(original).replace(/\t/gu, '  ').trimEnd();
        if (!line.trim()) continue;
        const indent = line.length - line.trimStart().length;
        const content = line.trim();
        if (content.startsWith('- ')) continue;
        const colon = content.indexOf(':');
        if (colon <= 0) continue;
        const key = content.slice(0, colon).trim();
        const valueText = content.slice(colon + 1).trim();
        if (!key) continue;
        if (indent >= 2 && currentParent) {
            // 一层缩进的子对象：parent:\n  child: value
            if (!result[currentParent] || typeof result[currentParent] !== 'object' || Array.isArray(result[currentParent])) {
                result[currentParent] = {};
            }
            result[currentParent][key] = parseScalar(valueText);
            continue;
        }
        if (valueText === '') {
            result[key] = {};
            currentParent = key;
            continue;
        }
        currentParent = null;
        result[key] = parseScalar(valueText);
    }
    return result;
}

// 解析「YAML 数组」文本（排除主体参数）。支持 - item 与裸键名两种写法。
export function parseYamlList(text) {
    const result = [];
    const lines = String(text || '').split(/\r?\n/u);
    for (const original of lines) {
        const line = stripInlineComment(original).trim();
        if (!line) continue;
        const item = line.startsWith('- ') ? line.slice(2).trim() : line;
        if (!item) continue;
        result.push(String(parseScalar(item)));
    }
    return result;
}

// 判断附加参数是否有任意一项填写（给按钮状态用）。
export function hasAdditionalParameters(aiSettings = {}) {
    return Boolean(
        String(aiSettings.customIncludeBody || '').trim()
        || String(aiSettings.customExcludeBody || '').trim()
        || String(aiSettings.customIncludeHeaders || '').trim()
    );
}

// 组装要并入 custom_api 的三个附加参数字段。
// 只返回解析后非空的字段，避免传空对象/空数组给后端。
// 返回结构：{ custom_include_body?: object, custom_exclude_body?: string[], custom_include_headers?: object }
export function buildAdditionalApiParams(aiSettings = {}) {
    const params = {};
    const includeBody = parseYamlObject(aiSettings.customIncludeBody);
    if (Object.keys(includeBody).length > 0) params.custom_include_body = includeBody;
    const excludeBody = parseYamlList(aiSettings.customExcludeBody);
    if (excludeBody.length > 0) params.custom_exclude_body = excludeBody;
    const includeHeaders = parseYamlObject(aiSettings.customIncludeHeaders);
    if (Object.keys(includeHeaders).length > 0) params.custom_include_headers = includeHeaders;
    return params;
}
