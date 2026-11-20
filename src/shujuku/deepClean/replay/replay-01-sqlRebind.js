/** replay 的分块：sqlRebind。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { skipSqlTrivia, parseDdlColumnComments, createTableBody, findCreateTableBounds, META_TABLE_NAME, META_TABLE_DDL, assertCanonicalState, resolvePhysicalTableNames, normalizeSqlStructure, rebindCreateTableName, isRecord } from './replay-00-sqlText.js';

function splitColumnDefinitions(body) {
    const definitions = [];
    let current = '';
    let depth = 0;
    let inLineComment = false;
    let inBlockComment = false;
    let quote = null;
    for (let index = 0; index < body.length; index += 1) {
        const char = body[index];
        if (quote) {
            current += char;
            const close = quote === '[' ? ']' : quote;
            if (char === close) {
                if (quote !== '[' && body[index + 1] === close) current += body[++index];
                else quote = null;
            }
            continue;
        }
        if (inBlockComment) {
            current += char;
            if (char === '*' && body[index + 1] === '/') {
                current += body[++index];
                inBlockComment = false;
            }
            continue;
        }
        if (char === '/' && body[index + 1] === '*') {
            inBlockComment = true;
            current += char;
            continue;
        }
        if (!inLineComment && char === '-' && body[index + 1] === '-') {
            inLineComment = true;
            current += char;
            continue;
        }
        if (inLineComment && char === '\n') {
            inLineComment = false;
            current += char;
            continue;
        }
        if (inLineComment) {
            current += char;
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            quote = char;
            current += char;
        } else if (char === '(') {
            depth += 1;
            current += char;
        } else if (char === ')') {
            depth -= 1;
            current += char;
        } else if (char === ',' && depth === 0) {
            definitions.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) definitions.push(current);
    return definitions;
}

export function stripSqlLineComments(value) {
    let result = '';
    let quote = null;
    let inBlockComment = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (inBlockComment) {
            if (char === '*' && value[index + 1] === '/') {
                inBlockComment = false;
                index += 1;
            } else if (char === '\n') {
                result += '\n';
            }
            continue;
        }
        if (quote) {
            result += char;
            const close = quote === '[' ? ']' : quote;
            if (char === close) {
                if (quote !== '[' && value[index + 1] === close) result += value[++index];
                else quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            quote = char;
            result += char;
            continue;
        }
        if (char === '/' && value[index + 1] === '*') {
            inBlockComment = true;
            index += 1;
            continue;
        }
        if (char === '-' && value[index + 1] === '-') {
            while (index < value.length && value[index] !== '\n') index += 1;
            if (index < value.length) result += '\n';
            continue;
        }
        result += char;
    }
    return result;
}

function extractTopLevelSqlTokens(definition) {
    const result = [];
    let current = '';
    let depth = 0;
    let quote = null;
    let inBlockComment = false;
    const flush = () => {
        if (current) result.push(current.toUpperCase());
        current = '';
    };
    for (let index = 0; index < definition.length; index += 1) {
        const char = definition[index];
        if (inBlockComment) {
            if (char === '*' && definition[index + 1] === '/') {
                inBlockComment = false;
                index += 1;
            }
            continue;
        }
        if (quote) {
            const close = quote === '[' ? ']' : quote;
            if (char === close) {
                if (quote !== '[' && definition[index + 1] === close) index += 1;
                else quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            flush();
            quote = char;
        } else if (char === '/' && definition[index + 1] === '*') {
            flush();
            inBlockComment = true;
            index += 1;
        } else if (char === '(') {
            flush();
            depth += 1;
        } else if (char === ')') {
            flush();
            depth = Math.max(0, depth - 1);
        } else if (depth === 0 && /[A-Za-z0-9_]/.test(char)) {
            current += char;
        } else {
            flush();
        }
    }
    flush();
    return result;
}

function consumeDefaultLiteralToken(value, start) {
    if (value[start] === "'") {
        let index = start + 1;
        while (index < value.length) {
            if (value[index] === "'") {
                if (value[index + 1] === "'") {
                    index += 2;
                    continue;
                }
                return value.slice(start, index + 1);
            }
            index += 1;
        }
        return null;
    }
    const blob = value.slice(start).match(/^X'(?:[0-9A-F]{2})*'/i);
    if (blob) return blob[0];
    return value.slice(start).match(/^(?:NULL|TRUE|FALSE|[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?)/i)?.[0] || null;
}

export function extractDdlDefaultExpression(definition) {
    const value = stripSqlLineComments(definition);
    let quote = null;
    let depth = 0;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (quote) {
            const close = quote === '[' ? ']' : quote;
            if (char === close) {
                if (quote !== '[' && value[index + 1] === close) index += 1;
                else quote = null;
            }
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            quote = char;
            continue;
        }
        if (char === '(') {
            depth += 1;
            continue;
        }
        if (char === ')') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0 || value.slice(index, index + 7).toUpperCase() !== 'DEFAULT') continue;
        if (/[A-Z0-9_$]/i.test(value[index - 1] || '') || /[A-Z0-9_$]/i.test(value[index + 7] || '')) continue;
        const start = skipSqlTrivia(value, index + 7);
        return consumeDefaultLiteralToken(value, start) || value.slice(start).trim() || null;
    }
    return null;
}

export function parseDdlColumnInfos(ddl) {
    const body = createTableBody(ddl);
    if (body === null) return [];
    const comments = parseDdlColumnComments(ddl);
    return splitColumnDefinitions(body).flatMap((rawDefinition) => {
        const definition = stripSqlLineComments(rawDefinition).trim();
        if (!definition || /^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(definition)) return [];
        const match = definition.match(/^([^\s,()]+)/);
        if (!match) return [];
        const sqlName = match[1];
        const tokens = extractTopLevelSqlTokens(definition);
        const defaultExpression = extractDdlDefaultExpression(definition);
        return [{
            sqlName,
            declaredType: tokens[1] || null,
            comment: comments.get(sqlName)?.trim() || null,
            normalizedDefinition: definition.replace(/\s+/g, ' ').trim(),
            isPrimaryKey: tokens.some((token, index) => token === 'PRIMARY' && tokens[index + 1] === 'KEY'),
            isNotNull: tokens.some((token, index) => token === 'NOT' && tokens[index + 1] === 'NULL'),
            hasDefault: defaultExpression !== null,
            defaultExpression,
        }];
    }).map((column, index) => ({ ...column, index }));
}

export function parseDdlTableConstraints(ddl) {
    const body = createTableBody(ddl);
    if (body === null) return [];
    return splitColumnDefinitions(body)
        .map((definition) => stripSqlLineComments(definition).replace(/\s+/g, ' ').trim())
        .filter((definition) => /^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT)\b/i.test(definition));
}

export function parseDdlTableSuffix(ddl) {
    const value = String(ddl || '');
    const bounds = findCreateTableBounds(value);
    return bounds
        ? stripSqlLineComments(value.slice(bounds.closingIndex + 1)).replace(/;\s*$/, '').replace(/\s+/g, ' ').trim()
        : '';
}

export function parseSafeDefaultLiteral(expression) {
    const value = String(expression || '').trim();
    if (!value) return null;
    if (/^NULL$/i.test(value)) return { kind: 'null', sql: 'NULL', value: null };
    if (/^TRUE$/i.test(value)) return { kind: 'boolean', sql: 'TRUE', value: true };
    if (/^FALSE$/i.test(value)) return { kind: 'boolean', sql: 'FALSE', value: false };
    if (/^X'(?:[0-9A-F]{2})*'$/i.test(value)) return { kind: 'blob', sql: value.toUpperCase(), value: value.slice(2, -1).toUpperCase() };
    if (/^[+-]?\d+$/.test(value)) {
        const numeric = Number(value);
        return Number.isSafeInteger(numeric) ? { kind: 'integer', sql: value, value: numeric } : null;
    }
    if (/^[+-]?(?:\d+\.\d*|\d*\.\d+)(?:[eE][+-]?\d+)?$|^[+-]?\d+[eE][+-]?\d+$/.test(value)) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? { kind: 'real', sql: value, value: numeric } : null;
    }
    if (value.startsWith("'") && value.endsWith("'")) {
        const inner = value.slice(1, -1);
        if (!/(^|[^'])'(?!')/.test(inner)) return { kind: 'string', sql: value, value: inner.replace(/''/g, "'") };
    }
    return null;
}

export function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

export function query(db, sql) {
    const results = db.exec(sql);
    return results.length > 0 ? results[0] : { columns: [], values: [] };
}

export function tableInfo(db, tableName) {
    const result = query(db, `PRAGMA table_info(${quoteIdentifier(tableName)});`);
    return result.values.map((row) => ({
        name: String(row[1]),
        declaredType: String(row[2]),
        notNull: Number(row[3]) === 1,
        defaultValue: row[4],
        primaryKey: Number(row[5]) > 0,
    }));
}

export function matchesHeader(columnName, comment, header) {
    return !!header && (header === columnName || (columnName === 'row_id' && header === '行号') || (!!comment && header === comment));
}

export function createInsertPlan(sheet, schema, comments) {
    const headers = sheet.content[0].map((header) => String(header ?? '').trim());
    const nonEmptyHeaders = headers.filter(Boolean);
    if (new Set(nonEmptyHeaders).size !== nonEmptyHeaders.length) {
        throw new Error('Deep Clean Shujuku snapshot contains duplicate headers');
    }
    const mappings = [];
    const usedIndexes = new Set();
    schema.forEach((column) => {
        const candidates = headers
            .map((header, index) => ({ header, index }))
            .filter(({ header }) => matchesHeader(column.name, comments.get(column.name), header));
        if (candidates.length > 1) throw new Error(`Deep Clean Shujuku DDL column is ambiguous: ${column.name}`);
        if (candidates.length === 1) {
            const sourceIndex = candidates[0].index;
            if (usedIndexes.has(sourceIndex)) throw new Error(`Deep Clean Shujuku header is reused: ${headers[sourceIndex]}`);
            usedIndexes.add(sourceIndex);
            mappings.push({ column, sourceIndex });
        } else if (column.primaryKey || (column.notNull && column.defaultValue === null)) {
            throw new Error(`Deep Clean Shujuku required DDL column is missing: ${column.name}`);
        }
    });
    headers.forEach((header, sourceIndex) => {
        if (usedIndexes.has(sourceIndex)) return;
        const hasBusinessValue = sheet.content.slice(1).some((row) => row[sourceIndex] !== null && row[sourceIndex] !== undefined && row[sourceIndex] !== '');
        if (hasBusinessValue) throw new Error(`Deep Clean Shujuku header has no DDL column: ${header}`);
    });
    return mappings;
}

export function sqlLiteral(value, columnName) {
    if (value === null || value === undefined) return 'NULL';
    let text = String(value);
    if (columnName.toLowerCase() === 'code_index') text = text.trim().normalize('NFKC').toUpperCase();
    if (/^-?\d+(\.\d+)?$/.test(text)) return text;
    return `'${text.replace(/'/g, "''")}'`;
}

export function hydrateState(SQL, state) {
    assertCanonicalState(state);
    const db = new SQL.Database();
    db.run('PRAGMA foreign_keys = ON;');
    db.run(META_TABLE_DDL);
    const physicalNames = resolvePhysicalTableNames(state);
    const sheets = new Map();
    try {
        Object.keys(state).filter((sheetKey) => sheetKey.startsWith('sheet_')).forEach((sheetKey) => {
            const sheet = state[sheetKey];
            const tableName = physicalNames.get(sheetKey);
            const ddl = rebindCreateTableName(sheet?.sourceData?.ddl, tableName);
            db.run(ddl);
            const schema = tableInfo(db, tableName);
            if (schema.length === 0 || schema[0].name !== 'row_id'
                || schema[0].declaredType.toUpperCase() !== 'INTEGER' || !schema[0].primaryKey) {
                throw new Error(`Deep Clean Shujuku DDL has no row_id primary key: ${sheetKey}`);
            }
            const comments = parseDdlColumnComments(normalizeSqlStructure(String(sheet.sourceData.ddl || '')));
            const insertPlan = createInsertPlan(sheet, schema, comments);
            for (const row of sheet.content.slice(1)) {
                const columns = insertPlan.map(({ column }) => quoteIdentifier(column.name)).join(', ');
                const values = insertPlan.map(({ column, sourceIndex }) => sqlLiteral(row[sourceIndex], column.name)).join(', ');
                db.run(`INSERT INTO ${quoteIdentifier(tableName)} (${columns}) VALUES (${values});`);
            }
            db.run(
                `INSERT OR REPLACE INTO ${META_TABLE_NAME} (
                    sheet_key, uid, name, order_no, source_data_json,
                    update_config_json, export_config_json, physical_table_name
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);`,
                [
                    sheetKey,
                    sheet.uid || sheetKey,
                    sheet.name || sheetKey,
                    sheet.orderNo ?? 0,
                    JSON.stringify(sheet.sourceData || {}),
                    JSON.stringify(sheet.updateConfig || {}),
                    JSON.stringify(sheet.exportConfig || {}),
                    tableName,
                ],
            );
            sheets.set(sheetKey, { tableName, schema });
        });
        return { db, sheets };
    } catch (error) {
        db.close();
        throw error;
    }
}

export function sqliteValueToCell(value) {
    if (value === null || value === undefined) return null;
    if (value instanceof Uint8Array) return '[BLOB]';
    return String(value);
}

export function parseMetadataJson(value, fieldName) {
    try {
        const parsed = JSON.parse(String(value ?? '{}'));
        if (!isRecord(parsed)) throw new Error();
        return parsed;
    } catch {
        throw new Error(`Deep Clean Shujuku SQL metadata is invalid: ${fieldName}`);
    }
}

