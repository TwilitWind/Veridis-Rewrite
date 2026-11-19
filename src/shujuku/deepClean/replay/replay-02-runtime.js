/**
 * replay.js 拆分产物（runtime）：15 个顶层声明，14759 字节 / 333 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { META_TABLE_NAME, cloneJson, assertCanonicalState, physicalTableName, resolvePhysicalTableNames, parseDdlColumnComments, parseDdlTableName, normalizeSqlStructure, normalizeStatementValues } from './replay-00-sqlText.js';
import { quoteIdentifier, query, tableInfo, sqlLiteral, sqliteValueToCell, parseMetadataJson, hydrateState } from './replay-01-sqlRebind.js';

export function materializeRuntime(runtime, state) {
    if (!runtime) return state;
    try {
        const metaResult = query(runtime.db, `SELECT * FROM ${META_TABLE_NAME};`);
        const metaColumnIndexes = new Map(metaResult.columns.map((name, index) => [name, index]));
        const metadataRows = metaResult.values.map((row) => {
            const at = (name) => metaColumnIndexes.has(name) ? row[metaColumnIndexes.get(name)] : null;
            return {
                sheetKey: String(at('sheet_key')),
                uid: String(at('uid')),
                name: String(at('name')),
                orderNo: Number(at('order_no')) || 0,
                sourceData: parseMetadataJson(at('source_data_json'), 'source_data_json'),
                updateConfig: parseMetadataJson(at('update_config_json'), 'update_config_json'),
                exportConfig: parseMetadataJson(at('export_config_json'), 'export_config_json'),
                physicalTableName: at('physical_table_name') == null ? '' : String(at('physical_table_name')),
            };
        });
        const metadataState = { mate: {} };
        metadataRows.forEach((metadata) => {
            metadataState[metadata.sheetKey] = {
                uid: metadata.uid,
                name: metadata.name,
                sourceData: metadata.sourceData,
                content: [],
            };
        });
        let currentPhysicalNames = null;
        try {
            currentPhysicalNames = resolvePhysicalTableNames(metadataState);
        } catch {
            // 匹配 Shujuku 的严格导出查找：当前名称解析
            // 失败时仍允许使用持久化的物理标识与 DDL 标识。
        }
        const findMetadata = (tableName) => {
            const stored = metadataRows.find((metadata) => metadata.physicalTableName === tableName);
            if (stored) return stored;
            const current = currentPhysicalNames
                ? metadataRows.find((metadata) => currentPhysicalNames.get(metadata.sheetKey) === tableName)
                : null;
            if (current) return current;
            const ddlMatches = metadataRows.filter((metadata) => parseDdlTableName(String(metadata.sourceData?.ddl || '')) === tableName);
            return ddlMatches.length === 1 ? ddlMatches[0] : null;
        };
        const tableNames = query(runtime.db, `SELECT name FROM sqlite_master
            WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '${META_TABLE_NAME}' ORDER BY rowid;`)
            .values.map((row) => String(row[0]));
        const next = Object.prototype.hasOwnProperty.call(state, 'mate') ? { mate: cloneJson(state.mate) } : {};
        tableNames.forEach((tableName) => {
            const metadata = findMetadata(tableName);
            if (!metadata || !metadata.sheetKey.startsWith('sheet_')) {
                throw new Error(`Deep Clean Shujuku SQL created an unowned table: ${tableName}`);
            }
            const result = query(runtime.db, `SELECT * FROM ${quoteIdentifier(tableName)};`);
            const ddlResult = query(runtime.db, `SELECT sql FROM sqlite_master WHERE type='table' AND name=${sqlLiteral(tableName, 'name')};`);
            const ddl = String(ddlResult.values[0]?.[0] || '');
            const comments = parseDdlColumnComments(ddl);
            const columns = result.columns.length > 0
                ? result.columns
                : tableInfo(runtime.db, tableName).map((column) => column.name);
            const header = columns.map((column) => column === 'row_id' ? 'row_id' : (comments.get(column) || column));
            next[metadata.sheetKey] = {
                uid: metadata.uid,
                name: metadata.name,
                orderNo: metadata.orderNo,
                sourceData: metadata.sourceData,
                updateConfig: metadata.updateConfig,
                exportConfig: metadata.exportConfig,
                content: [header, ...result.values.map((row) => row.map(sqliteValueToCell))],
            };
        });
        assertCanonicalState(next);
        return next;
    } finally {
        runtime.db.close();
    }
}

export async function createSqlRuntime(state) {
    const SQL = await initSqlJs({
        locateFile: () => new URL('../../../vendor/sql.js/sql-wasm.wasm', import.meta.url).href,
    });
    return hydrateState(SQL, state);
}

export function splitSqlStatements(sql) {
    const statements = [];
    let current = '';
    let inString = false;
    let stringChar = '';
    const input = String(sql || '').replace(/<!--|-->/g, '').trim();
    for (let index = 0; index < input.length; index += 1) {
        const char = input[index];
        if (inString) {
            current += char;
            if (char === stringChar) {
                if (input[index + 1] === stringChar) current += input[++index];
                else inString = false;
            }
        } else if (char === "'" || char === '"') {
            inString = true;
            stringChar = char;
            current += char;
        } else if (char === ';') {
            if (current.trim()) statements.push(normalizeStatementValues(normalizeSqlStructure(current.trim())));
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) statements.push(normalizeStatementValues(normalizeSqlStructure(current.trim())));
    return statements;
}

export function decodeSqlIdentifier(value) {
    const text = String(value || '').trim();
    if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === '`' && text.at(-1) === '`'))) {
        return text.slice(1, -1).split(text[0] + text[0]).join(text[0]);
    }
    if (text.length >= 2 && text[0] === '[' && text.at(-1) === ']') return text.slice(1, -1).split(']]').join(']');
    return text;
}

function sqlWordStart(char) {
    return /^[A-Za-z_\u0080-\uFFFF]$/.test(char);
}

function sqlWordPart(char) {
    return /^[A-Za-z0-9_$\u0080-\uFFFF]$/.test(char);
}

export function tokenizeMutationSql(sql) {
    const tokens = [];
    let index = 0;
    let depth = 0;
    const commaDepths = new Set();
    while (index < sql.length) {
        const char = sql[index];
        const next = sql[index + 1];
        if (char === '-' && next === '-') {
            index += 2;
            while (index < sql.length && sql[index] !== '\n' && sql[index] !== '\r') index += 1;
        } else if (char === '/' && next === '*') {
            const end = sql.indexOf('*/', index + 2);
            if (end < 0) throw new Error('Deep Clean SQL has an unterminated comment');
            index = end + 2;
        } else if (char === "'") {
            index += 1;
            while (index < sql.length) {
                if (sql[index] !== "'") index += 1;
                else if (sql[index + 1] === "'") index += 2;
                else {
                    index += 1;
                    break;
                }
            }
            if (sql[index - 1] !== "'") throw new Error('Deep Clean SQL has an unterminated string');
        } else if (char === ',') {
            commaDepths.add(depth);
            index += 1;
        } else if (char === '(') {
            commaDepths.delete(depth);
            depth += 1;
            index += 1;
        } else if (char === ')') {
            depth = Math.max(0, depth - 1);
            index += 1;
        } else if (char === '"' || char === '`' || char === '[') {
            const quote = char;
            const close = quote === '[' ? ']' : quote;
            const start = index;
            let value = '';
            let closed = false;
            index += 1;
            while (index < sql.length) {
                if (sql[index] !== close) value += sql[index++];
                else if (sql[index + 1] === close) {
                    value += close;
                    index += 2;
                } else {
                    index += 1;
                    closed = true;
                    break;
                }
            }
            if (!closed) throw new Error('Deep Clean SQL has an unterminated quoted identifier');
            tokens.push({ start, end: index, value, quote, depth, commaBefore: commaDepths.delete(depth) });
        } else if (sqlWordStart(char)) {
            const start = index;
            index += 1;
            while (index < sql.length && sqlWordPart(sql[index])) index += 1;
            tokens.push({ start, end: index, value: sql.slice(start, index), quote: null, depth, commaBefore: commaDepths.delete(depth) });
        } else {
            index += 1;
        }
    }
    return tokens;
}

export function isSqlKeyword(token, value) {
    return !!token && token.quote === null && token.value.toUpperCase() === value;
}

function qualifiedSqlTail(sql, tokens, start) {
    let token = tokens[start];
    if (!token) return undefined;
    let index = start;
    while (tokens[index + 1] && tokens[index + 1].depth === token.depth
        && /^\s*\.\s*$/.test(sql.slice(token.end, tokens[index + 1].start))) {
        token = tokens[++index];
    }
    return token;
}

export function mutationTarget(sql, tokens) {
    const first = tokens[0];
    const actionIndex = isSqlKeyword(first, 'WITH')
        ? tokens.findIndex((token, index) => index > 0 && token.depth === 0
            && ['INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(token.value.toUpperCase()))
        : 0;
    const action = tokens[actionIndex];
    if (!action) return undefined;
    if (isSqlKeyword(action, 'INSERT') || isSqlKeyword(action, 'REPLACE')) {
        let index = actionIndex + 1;
        if (isSqlKeyword(action, 'INSERT') && isSqlKeyword(tokens[index], 'OR')) index += 2;
        return isSqlKeyword(tokens[index], 'INTO') ? qualifiedSqlTail(sql, tokens, index + 1) : undefined;
    }
    if (isSqlKeyword(action, 'UPDATE')) {
        let index = actionIndex + 1;
        if (isSqlKeyword(tokens[index], 'OR')) index += 2;
        return qualifiedSqlTail(sql, tokens, index);
    }
    return isSqlKeyword(action, 'DELETE') && isSqlKeyword(tokens[actionIndex + 1], 'FROM')
        ? qualifiedSqlTail(sql, tokens, actionIndex + 2)
        : undefined;
}

function cteScopes(tokens) {
    const result = [];
    for (let withIndex = 0; withIndex < tokens.length; withIndex += 1) {
        const withToken = tokens[withIndex];
        if (!isSqlKeyword(withToken, 'WITH')) continue;
        const depth = withToken.depth;
        let index = withIndex + 1;
        if (isSqlKeyword(tokens[index], 'RECURSIVE')) index += 1;
        const names = [];
        let valid = false;
        while (tokens[index]) {
            const name = tokens[index];
            if (name.depth !== depth) break;
            index += 1;
            if (tokens[index]?.depth === depth + 1) {
                const columnDepth = tokens[index].depth;
                while (tokens[index] && tokens[index].depth >= columnDepth) index += 1;
            }
            if (!isSqlKeyword(tokens[index], 'AS')) break;
            names.push(name.value.toLowerCase());
            index += 1;
            if (!tokens[index] || tokens[index].depth !== depth + 1) break;
            const definitionDepth = tokens[index].depth;
            while (tokens[index] && tokens[index].depth >= definitionDepth) index += 1;
            valid = true;
            if (!tokens[index]?.commaBefore || tokens[index].depth !== depth) break;
        }
        if (!valid) continue;
        const end = tokens.findIndex((token, tokenIndex) => tokenIndex > index && token.depth < depth);
        names.forEach((name) => result.push({ name, depth, start: withIndex, end: end < 0 ? tokens.length : end }));
    }
    return result;
}

function isCteReference(tokens, token, scopes) {
    const index = tokens.indexOf(token);
    return index >= 0 && scopes.some((scope) => (
        scope.name === token.value.toLowerCase()
        && index >= scope.start && index < scope.end && token.depth >= scope.depth
    ));
}

export function mutationTableReferences(sql, tokens, target) {
    const result = new Map([[target.start, target]]);
    const scopes = cteScopes(tokens);
    const terminators = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'LIMIT', 'UNION', 'EXCEPT', 'INTERSECT', 'WINDOW', 'RETURNING', 'VALUES', 'SET']);
    const fromDepths = new Set();
    tokens.forEach((token, index) => {
        const value = token.quote === null ? token.value.toUpperCase() : '';
        if (terminators.has(value)) fromDepths.delete(token.depth);
        if (value === 'FROM') fromDepths.add(token.depth);
        if (value === 'FROM' || value === 'JOIN') {
            const reference = qualifiedSqlTail(sql, tokens, index + 1);
            if (reference && reference.depth === token.depth && !isCteReference(tokens, reference, scopes)) {
                result.set(reference.start, reference);
            }
        } else if (token.commaBefore && fromDepths.has(token.depth) && !isCteReference(tokens, token, scopes)) {
            result.set(token.start, token);
        }
    });
    return [...result.values()];
}

export function formatSqlIdentifier(value, quote) {
    if (quote === '"') return `"${value.replace(/"/g, '""')}"`;
    if (quote === '`') return `\`${value.replace(/`/g, '``')}\``;
    if (quote === '[') return `[${value.replace(/]/g, ']]')}]`;
    return value;
}

export function rebindMutationTables(statements, aliases, ambiguousAliases) {
    const resolved = new Map([...aliases].map(([alias, physicalName]) => [decodeSqlIdentifier(alias).toLowerCase(), physicalName]));
    const ambiguous = new Set([...ambiguousAliases].map((alias) => decodeSqlIdentifier(alias).toLowerCase()));
    return statements.map((statement) => {
        try {
            const tokens = tokenizeMutationSql(statement);
            const target = mutationTarget(statement, tokens);
            if (!target) return statement;
            const references = mutationTableReferences(statement, tokens, target);
            if (references.some((reference) => ambiguous.has(reference.value.toLowerCase()))) {
                throw new Error(`Deep Clean SQL references an ambiguous table alias: ${target.value}`);
            }
            if (!resolved.has(target.value.toLowerCase())) return statement;
            const replacements = references
                .map((token) => ({ token, name: resolved.get(token.value.toLowerCase()) }))
                .filter((item) => !!item.name)
                .sort((left, right) => right.token.start - left.token.start);
            return replacements.reduce((result, { token, name }) => (
                `${result.slice(0, token.start)}${formatSqlIdentifier(name, token.quote)}${result.slice(token.end)}`
            ), statement);
        } catch {
            return statement;
        }
    });
}

