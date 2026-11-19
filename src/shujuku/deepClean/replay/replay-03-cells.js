/**
 * replay.js 拆分产物（cells）：14 个顶层声明，15250 字节 / 292 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { query, parseDdlColumnInfos, matchesHeader } from './replay-01-sqlRebind.js';
import { canonicalizeDisplayName, toAsciiSlug, resolvePhysicalTableNames, parseDdlTableName } from './replay-00-sqlText.js';
import { decodeSqlIdentifier, isSqlKeyword, tokenizeMutationSql, mutationTarget, mutationTableReferences, formatSqlIdentifier, splitSqlStatements, rebindMutationTables } from './replay-02-runtime.js';

export const SQL_RESERVED_IDENTIFIERS = new Set([
    'abort', 'action', 'add', 'after', 'all', 'alter', 'analyze', 'and', 'as', 'asc', 'attach',
    'autoincrement', 'before', 'begin', 'between', 'by', 'cascade', 'case', 'cast', 'check',
    'collate', 'column', 'commit', 'conflict', 'constraint', 'create', 'cross', 'current_date',
    'current', 'current_time', 'current_timestamp', 'database', 'default', 'deferrable', 'deferred', 'delete',
    'desc', 'detach', 'distinct', 'drop', 'each', 'else', 'end', 'escape', 'except', 'exclude',
    'exclusive', 'exists', 'explain', 'fail', 'filter', 'first', 'following', 'for', 'foreign',
    'from', 'full', 'generated', 'glob', 'group', 'groups', 'having', 'if', 'ignore', 'immediate', 'in',
    'index', 'indexed', 'initially', 'inner', 'insert', 'instead', 'intersect', 'into', 'is',
    'isnull', 'join', 'key', 'last', 'left', 'like', 'limit', 'match', 'materialized', 'natural', 'no', 'not',
    'nothing', 'notnull', 'null', 'nulls', 'of', 'offset', 'on', 'or', 'order', 'others', 'outer',
    'over', 'partition', 'plan', 'pragma', 'preceding', 'primary', 'query', 'raise', 'range',
    'recursive', 'references', 'regexp', 'reindex', 'release', 'rename', 'replace', 'restrict',
    'returning', 'right', 'rollback', 'row', 'rowid', 'rows', 'savepoint', 'select', 'set', 'table', 'temp',
    'temporary', 'then', 'ties', 'to', 'transaction', 'trigger', 'unbounded', 'union', 'unique',
    'update', 'using', 'vacuum', 'values', 'view', 'virtual', 'when', 'where', 'window', 'with', 'without',
]);

export function mapSqlColumnIdentifiers(headers) {
    const used = new Set();
    return headers.map((header, index) => {
        const canonical = canonicalizeDisplayName(header);
        const isRowId = index === 0 && (canonical === 'row_id' || header == null);
        let base = isRowId ? 'row_id' : toAsciiSlug(String(header ?? '').normalize('NFKC').trim());
        base = base.replace(/^\d+/, (value) => `col_${value}`) || `col_${index + 1}`;
        if (!isRowId && (base === 'row_id' || SQL_RESERVED_IDENTIFIERS.has(base))) base = `col_${base}`;
        let sqlName = base;
        let suffix = 2;
        while (used.has(sqlName.toLowerCase())) sqlName = `${base}_${suffix++}`;
        used.add(sqlName.toLowerCase());
        return { index, sqlName, isRowId };
    });
}

export function buildReplayTableAliases(state, operation) {
    const physicalNames = resolvePhysicalTableNames(state);
    const aliases = new Map();
    const conflicts = new Set();
    const addAlias = (rawAlias, physicalName) => {
        const alias = canonicalizeDisplayName(decodeSqlIdentifier(rawAlias));
        if (!alias || conflicts.has(alias)) return;
        const existing = aliases.get(alias);
        if (existing && existing !== physicalName) {
            aliases.delete(alias);
            conflicts.add(alias);
        } else {
            aliases.set(alias, physicalName);
        }
    };
    physicalNames.forEach((physicalName, sheetKey) => {
        const sheet = state[sheetKey];
        const declaredAliases = Array.isArray(sheet?.sourceData?.tableAliases) ? sheet.sourceData.tableAliases : [];
        [parseDdlTableName(String(sheet?.sourceData?.ddl || '')), physicalName, ...declaredAliases,
            sheetKey, sheet?.uid, sheet?.name].forEach((alias) => addAlias(alias, physicalName));
        const shortKey = sheetKey.slice('sheet_'.length);
        if (/^[A-Za-z_][A-Za-z0-9_$]*$/.test(shortKey)) addAlias(shortKey, physicalName);
    });
    if (operation.kind === 'sql_sheet_batch') {
        let target = null;
        if (state[operation.sheetKey]) {
            target = physicalNames.get(operation.sheetKey);
            const historical = canonicalizeDisplayName(decodeSqlIdentifier(operation.tableName));
            const occupied = aliases.get(historical);
            if (historical && occupied && occupied !== target) {
                throw new Error(`Deep Clean sql_sheet_batch historical table name conflicts with another sheet: ${operation.tableName}`);
            }
        } else {
            target = aliases.get(canonicalizeDisplayName(decodeSqlIdentifier(operation.tableName))) || null;
        }
        if (target) addAlias(operation.tableName, target);
    }
    return { aliases, conflicts, physicalNames };
}

export function buildReplayColumnAliases(state, sheetKey, physicalNames) {
    const sheet = state[sheetKey];
    const physicalName = physicalNames.get(sheetKey);
    const columns = new Map();
    const conflicts = new Set();
    const add = (source, target) => {
        const sourceKey = String(source).toLowerCase();
        const targetKey = String(target).toLowerCase();
        if (!sourceKey || sourceKey === targetKey || conflicts.has(sourceKey)) return;
        const existing = columns.get(sourceKey);
        if (existing && existing.toLowerCase() !== targetKey) {
            if (columns.get(existing.toLowerCase()) === existing) columns.delete(existing.toLowerCase());
            columns.delete(sourceKey);
            conflicts.add(sourceKey);
        } else if (!existing) {
            columns.set(sourceKey, target);
        }
    };
    const headers = sheet.content[0].map((header) => String(header ?? ''));
    const ddlColumns = parseDdlColumnInfos(String(sheet.sourceData?.ddl || ''));
    if (ddlColumns.length !== headers.length) throw new Error(`Deep Clean sql_sheet_batch DDL/header mismatch: ${sheetKey}`);
    ddlColumns.forEach((column, index) => {
        if (!matchesHeader(column.sqlName, column.comment, headers[index].trim())) {
            throw new Error(`Deep Clean sql_sheet_batch column mapping mismatch: ${column.sqlName}`);
        }
        columns.set(column.sqlName.toLowerCase(), column.sqlName);
        add(headers[index], column.sqlName);
    });
    const targetByIndex = new Map(ddlColumns.map((column, index) => [index, column.sqlName]));
    mapSqlColumnIdentifiers(headers).forEach((mapping) => {
        const target = targetByIndex.get(mapping.index);
        if (target) add(mapping.sqlName, target);
    });
    return {
        aliases: new Map([[physicalName, columns]]),
        conflicts: new Map([[physicalName, conflicts]]),
    };
}

const MUTATION_COLUMN_KEYWORDS = new Set([
    'SELECT', 'FROM', 'JOIN', 'AS', 'ON', 'WHERE', 'GROUP', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET',
    'UNION', 'EXCEPT', 'INTERSECT', 'WITH', 'RECURSIVE', 'DISTINCT', 'BY', 'AND', 'OR', 'NOT',
    'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'ASC', 'DESC',
    'COLLATE', 'USING',
]);

function isSqlFunctionCall(sql, token) {
    return /^\s*\(/.test(sql.slice(token.end));
}

export function collectMutationColumnReplacements(sql, tokens, aliases, ambiguous) {
    const replacements = [];
    const handled = new Set();
    const add = (token) => {
        if (!token) return;
        const key = decodeSqlIdentifier(token.value).toLowerCase();
        if (ambiguous.has(key)) throw new Error(`Deep Clean SQL references an ambiguous column alias: ${token.value}`);
        const target = aliases.get(key);
        if (!target || target.toLowerCase() === key || handled.has(token.start)) return;
        handled.add(token.start);
        replacements.push({ token, value: target });
    };
    const first = tokens[0];
    const actionIndex = isSqlKeyword(first, 'WITH')
        ? tokens.findIndex((token, index) => index > 0 && token.depth === 0
            && ['INSERT', 'REPLACE', 'UPDATE', 'DELETE'].includes(token.value.toUpperCase()))
        : 0;
    const action = tokens[actionIndex];
    if (!action) return replacements;
    const actionValue = action.value.toUpperCase();
    const actionDepth = action.depth;
    if (actionValue === 'UPDATE') {
        let setIndex = -1;
        for (let index = actionIndex + 1; index < tokens.length; index += 1) {
            const token = tokens[index];
            if (token.depth !== actionDepth) continue;
            if (isSqlKeyword(token, 'SET')) {
                setIndex = index;
                break;
            }
            if (['WHERE', 'GROUP', 'ORDER', 'LIMIT'].includes(token.value.toUpperCase())) break;
        }
        if (setIndex >= 0) {
            for (let index = setIndex + 1; index < tokens.length; index += 1) {
                const token = tokens[index];
                if (token.depth !== actionDepth) continue;
                if (['WHERE', 'GROUP', 'ORDER', 'LIMIT', 'RETURNING'].includes(token.value.toUpperCase())) break;
                const next = tokens[index + 1];
                if (next && next.depth === token.depth && /=/.test(sql.slice(token.end, next.start))) add(token);
            }
        }
    } else if (actionValue === 'INSERT' || actionValue === 'REPLACE') {
        const openIndex = tokens.findIndex((token) => token.depth === actionDepth + 1 && token.start > action.start);
        if (openIndex >= 0) {
            let cursor = openIndex + 1;
            while (cursor < tokens.length && tokens[cursor].depth >= actionDepth + 1) {
                if (tokens[cursor].depth === actionDepth + 1) add(tokens[cursor]);
                cursor += 1;
            }
        }
    }
    tokens.forEach((token, index) => {
        if (token.quote !== null || MUTATION_COLUMN_KEYWORDS.has(token.value.toUpperCase()) || isSqlFunctionCall(sql, token)) return;
        const previous = tokens[index - 1];
        if (previous && previous.depth === token.depth && isSqlKeyword(previous, 'AS')) return;
        if (previous && previous.depth === token.depth && /^\s*\.\s*$/.test(sql.slice(previous.end, token.start))) return;
        add(token);
    });
    return replacements;
}

export function rebindMutationColumns(statements, columnAliases, targetPhysicalName, ambiguousColumns) {
    const tableKey = decodeSqlIdentifier(targetPhysicalName).toLowerCase();
    const aliases = new Map();
    for (const [alias, physicalName] of columnAliases.get(tableKey) || []) {
        aliases.set(decodeSqlIdentifier(alias).toLowerCase(), physicalName);
    }
    const ambiguous = new Set([...(ambiguousColumns || [])].map((alias) => decodeSqlIdentifier(alias).toLowerCase()));
    return statements.map((statement) => {
        const tokens = tokenizeMutationSql(statement);
        const target = mutationTarget(statement, tokens);
        if (!target || decodeSqlIdentifier(target.value).toLowerCase() !== tableKey) return statement;
        if (tokens.some((token) => isSqlKeyword(token, 'SELECT'))) return statement;
        if (mutationTableReferences(statement, tokens, target).length > 1) {
            throw new Error('Deep Clean sql_sheet_batch column rebinding cannot prove cross-table column ownership');
        }
        const replacements = collectMutationColumnReplacements(statement, tokens, aliases, ambiguous)
            .sort((left, right) => right.token.start - left.token.start);
        return replacements.reduce((result, { token, value }) => (
            `${result.slice(0, token.start)}${formatSqlIdentifier(value, token.quote)}${result.slice(token.end)}`
        ), statement);
    });
}

export function prepareSqlStatements(state, operation) {
    const statements = operation.statements.flatMap(splitSqlStatements);
    if (statements.length === 0) return statements;
    const { aliases, conflicts, physicalNames } = buildReplayTableAliases(state, operation);
    const tableRebound = rebindMutationTables(statements, aliases, conflicts);
    if (operation.kind !== 'sql_sheet_batch' || !state[operation.sheetKey]) return tableRebound;
    const targetPhysicalName = physicalNames.get(operation.sheetKey);
    const columnRegistry = buildReplayColumnAliases(state, operation.sheetKey, physicalNames);
    const normalizedAliases = new Map([...columnRegistry.aliases].map(([tableName, columns]) => [tableName.toLowerCase(), columns]));
    return rebindMutationColumns(
        tableRebound,
        normalizedAliases,
        targetPhysicalName,
        columnRegistry.conflicts.get(targetPhysicalName),
    );
}

export function runSqlOperation(runtime, state, operation) {
    const statements = prepareSqlStatements(state, operation);
    if (statements.length === 0) return;
    const params = Array.isArray(operation.params) ? operation.params : [];
    runtime.db.run('BEGIN TRANSACTION;');
    try {
        statements.forEach((statement, index) => runtime.db.run(statement, params[index]));
        runtime.db.run('COMMIT;');
    } catch (error) {
        try {
            runtime.db.run('ROLLBACK;');
        } catch {
            // 原始 SQL 错误是权威依据。
        }
        throw error;
    }
}

export const P1_COLUMN_CONSTRAINT_TOKENS = new Set([
    'AS', 'CHECK', 'COLLATE', 'CONSTRAINT', 'DEFAULT', 'FOREIGN',
    'GENERATED', 'NOT', 'PRIMARY', 'REFERENCES', 'UNIQUE',
]);

export function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
    if (!value || typeof value !== 'object') return JSON.stringify(value);
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
}

export async function sha256(value) {
    if (!globalThis.crypto?.subtle) throw new Error('Deep Clean schema migration requires Web Crypto SHA-256');
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return `sha256:${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function requireSheetShape(sheet, phase) {
    const rawHeaders = sheet?.content?.[0];
    if (!Array.isArray(rawHeaders) || rawHeaders[0] !== 'row_id') {
        throw new Error(`Deep Clean ${phase} must retain row_id as its first column`);
    }
    const headers = rawHeaders.map((value) => String(value ?? ''));
    const normalizedHeaders = headers.map((value) => value.normalize('NFKC').trim());
    const canonicalHeaders = normalizedHeaders.map((value) => value.toLocaleLowerCase('en-US').replace(/\s+/g, ' '));
    if (normalizedHeaders.some((value) => !value) || new Set(canonicalHeaders).size !== canonicalHeaders.length) {
        throw new Error(`Deep Clean ${phase} has invalid headers`);
    }
    const ddl = String(sheet?.sourceData?.ddl || '');
    const columns = parseDdlColumnInfos(ddl);
    if (!parseDdlTableName(ddl) || columns.length !== headers.length
        || columns[0]?.sqlName !== 'row_id' || columns[0]?.declaredType !== 'INTEGER' || !columns[0]?.isPrimaryKey) {
        throw new Error(`Deep Clean ${phase} must begin with row_id INTEGER PRIMARY KEY`);
    }
    columns.forEach((column, index) => {
        if (!matchesHeader(column.sqlName, column.comment, normalizedHeaders[index])) {
            throw new Error(`Deep Clean ${phase} DDL/header mismatch: ${column.sqlName}`);
        }
        if (!/^[\x00-\x7F]+$/.test(normalizedHeaders[index]) && !/^[\x00-\x7F]+$/.test(column.sqlName)) {
            throw new Error(`Deep Clean ${phase} requires an ASCII physical column: ${column.sqlName}`);
        }
    });
    const physicalNames = columns.map((column) => column.sqlName);
    if (new Set(physicalNames).size !== physicalNames.length) {
        throw new Error(`Deep Clean ${phase} has duplicate physical columns`);
    }
    return { headers, columns, ddl };
}

