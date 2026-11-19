/**
 * replay.js 拆分产物（sqlText）：29 个顶层声明，15837 字节 / 414 行。
 * 由原文件按依赖拓扑切分；对外接口不变，调用方仍从同名 barrel 导入。
 */
import { hasShujukuV2TableEvidence } from '../../storageEvidence.js';
import { pinyin } from '../../../../vendor/pinyin-pro/index.mjs';

const SUPPORTED_OPERATION_KINDS = new Set([
    'sql_batch',
    'sql_sheet_batch',
    'row_upsert',
    'row_delete',
    'meta_update',
    'sheet_schema_migrate',
    'sheet_replace',
    'data_replace',
]);
export const META_TABLE_NAME = '_acu_sheet_meta';
export const META_TABLE_DDL = `CREATE TABLE IF NOT EXISTS ${META_TABLE_NAME} (
  sheet_key TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL,
  order_no INTEGER DEFAULT 0,
  source_data_json TEXT,
  update_config_json TEXT,
  export_config_json TEXT,
  physical_table_name TEXT
);`;

export function cloneJson(value) {
    return JSON.parse(JSON.stringify(value));
}

export function isRecord(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
}

export function readShujukuIsolatedData(message) {
    const raw = message?.TavernDB_ACU_IsolatedData;
    if (isRecord(raw)) return raw;
    if (typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function readV2Slot(message, isolationKey) {
    if (!isRecord(message) || message.is_user === true) return null;
    return readShujukuIsolatedData(message)?.[isolationKey] ?? null;
}

export function collectIsolationKeys(chat) {
    const keys = new Set();
    chat.forEach((message) => {
        if (!isRecord(message) || message.is_user === true) return;
        const container = readShujukuIsolatedData(message);
        if (!container) return;
        Object.entries(container).forEach(([isolationKey, slot]) => {
            if (hasShujukuV2TableEvidence(slot)) keys.add(isolationKey);
        });
    });
    return [...keys];
}

export function collectFrameRefs(chat, isolationKey) {
    const refs = [];
    chat.forEach((message, messageIndex) => {
        const slot = readV2Slot(message, isolationKey);
        if (hasShujukuV2TableEvidence(slot)) refs.push({ messageIndex, frame: slot.storageFrame });
    });
    return refs;
}

export function latestFullCheckpointIndex(frameRefs) {
    for (let index = frameRefs.length - 1; index >= 0; index -= 1) {
        const checkpoint = frameRefs[index].frame?.checkpoint;
        if (isRecord(checkpoint) && checkpoint.kind === 'full' && isRecord(checkpoint.data)) return index;
    }
    return -1;
}

export function assertCurrentWriterReplaySegment(frameRefs, baseIndex) {
    for (let frameIndex = baseIndex; frameIndex < frameRefs.length; frameIndex += 1) {
        const { frame, messageIndex } = frameRefs[frameIndex];
        if (!isRecord(frame) || frame.version !== 2 || !Array.isArray(frame.logEntries)) {
            throw new Error(`Deep Clean Shujuku V2 replay frame is unsupported: message ${messageIndex}`);
        }
        for (const entry of frame.logEntries) {
            if (!isRecord(entry)) throw new Error('Deep Clean Shujuku V2 log entry is invalid');
            const operations = entry.operations;
            if (!Array.isArray(operations)) {
                if (Array.isArray(entry.patches) && entry.patches.length > 0) {
                    throw new Error('Deep Clean Shujuku V2 patch replay is unsupported');
                }
                throw new Error('Deep Clean Shujuku V2 log entry has no operations array');
            }
            if (operations.length === 0 && Array.isArray(entry.patches) && entry.patches.length > 0) {
                throw new Error('Deep Clean Shujuku V2 patch replay is unsupported');
            }
            for (const operation of operations) {
                if (!isRecord(operation)) throw new Error('Deep Clean Shujuku V2 operation is invalid');
                if (operation.kind === 'table_edit_dsl') {
                    throw new Error('Deep Clean Shujuku V2 table_edit_dsl replay is unsupported');
                }
                if (!SUPPORTED_OPERATION_KINDS.has(operation.kind)) {
                    throw new Error(`Deep Clean Shujuku V2 operation is unsupported: ${String(operation.kind)}`);
                }
                if (operation.kind === 'sheet_schema_migrate'
                    && operation.contractVersion !== 1 && operation.contractVersion !== 2) {
                    throw new Error(`Deep Clean Shujuku schema migration contract is unsupported: ${String(operation.contractVersion)}`);
                }
            }
        }
    }
}

export function assertCanonicalSheet(sheet, sheetKey) {
    if (!sheetKey.startsWith('sheet_') || !isRecord(sheet) || !Array.isArray(sheet.content)) {
        throw new Error(`Deep Clean Shujuku sheet is invalid: ${sheetKey}`);
    }
    const header = sheet.content[0];
    if (!Array.isArray(header) || header.length === 0 || header[0] !== 'row_id') {
        throw new Error(`Deep Clean Shujuku sheet has no canonical row_id header: ${sheetKey}`);
    }
    const rowIds = new Set();
    for (let rowIndex = 1; rowIndex < sheet.content.length; rowIndex += 1) {
        const row = sheet.content[rowIndex];
        if (!Array.isArray(row) || row.length !== header.length) {
            throw new Error(`Deep Clean Shujuku row width is invalid: ${sheetKey}/${rowIndex}`);
        }
        const rowId = String(row[0] ?? '').trim();
        if (!rowId || rowIds.has(rowId)) {
            throw new Error(`Deep Clean Shujuku row_id is invalid: ${sheetKey}/${rowIndex}`);
        }
        rowIds.add(rowId);
    }
}

export function assertCanonicalState(state) {
    if (!isRecord(state)) throw new Error('Deep Clean Shujuku replay state is invalid');
    Object.entries(state).forEach(([sheetKey, sheet]) => {
        if (sheetKey.startsWith('sheet_')) assertCanonicalSheet(sheet, sheetKey);
    });
}

export function canonicalizeDisplayName(value) {
    return String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
}

export function toAsciiSlug(value, maxLength = 48) {
    const canonical = canonicalizeDisplayName(value);
    if (!canonical) return '';
    return pinyin(canonical, {
        toneType: 'none',
        traditional: true,
        v: true,
        separator: '_',
        nonZh: 'consecutive',
    }).normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, Math.max(1, maxLength))
        .replace(/_+$/g, '');
}

export function physicalTableName(sheet, sheetKey) {
    const displaySlug = toAsciiSlug(sheet?.name).replace(/_/g, '');
    const keySlug = toAsciiSlug(String(sheetKey).replace(/^sheet_/, '')).replace(/_/g, '');
    let candidate = (displaySlug || keySlug || 'sheet').slice(0, 48);
    if (/^[0-9]/.test(candidate) || ['sqlite_', '_acu_'].some((prefix) => candidate.startsWith(prefix))) {
        candidate = `table_${candidate}`;
    }
    return candidate.slice(0, 48) || 'table_sheet';
}

export function resolvePhysicalTableNames(state) {
    const result = new Map();
    const owners = new Map();
    Object.keys(state).filter((key) => key.startsWith('sheet_')).sort().forEach((sheetKey) => {
        const name = physicalTableName(state[sheetKey], sheetKey);
        const canonical = name.toLowerCase();
        if (owners.has(canonical)) throw new Error(`Deep Clean Shujuku physical table name collision: ${name}`);
        owners.set(canonical, sheetKey);
        result.set(sheetKey, name);
    });
    return result;
}

export function skipSqlTrivia(value, start) {
    let index = start;
    while (index < value.length) {
        if (/\s/.test(value[index])) {
            index += 1;
            continue;
        }
        if (value[index] === '-' && value[index + 1] === '-') {
            index += 2;
            while (index < value.length && value[index] !== '\n' && value[index] !== '\r') index += 1;
            continue;
        }
        if (value[index] === '/' && value[index + 1] === '*') {
            const end = value.indexOf('*/', index + 2);
            return end < 0 ? value.length : skipSqlTrivia(value, end + 2);
        }
        break;
    }
    return index;
}

function consumeSqlKeyword(value, start, keyword) {
    const end = start + keyword.length;
    return value.slice(start, end).toUpperCase() === keyword
        && !/[A-Z0-9_$]/i.test(value[start - 1] || '')
        && !/[A-Z0-9_$]/i.test(value[end] || '')
        ? end
        : -1;
}

function skipSqlIdentifier(value, start) {
    const quote = value[start];
    if (quote === '"' || quote === '`' || quote === '[') {
        const close = quote === '[' ? ']' : quote;
        let index = start + 1;
        while (index < value.length) {
            if (value[index] === close) {
                if (value[index + 1] === close) {
                    index += 2;
                    continue;
                }
                return index + 1;
            }
            index += 1;
        }
        return value.length;
    }
    let index = start;
    while (index < value.length && !/\s|\(/.test(value[index])) index += 1;
    return index;
}

export function findCreateTableBounds(value) {
    let index = skipSqlTrivia(value, 0);
    index = consumeSqlKeyword(value, index, 'CREATE');
    if (index < 0) return null;
    index = consumeSqlKeyword(value, skipSqlTrivia(value, index), 'TABLE');
    if (index < 0) return null;
    index = skipSqlTrivia(value, index);
    const afterIf = consumeSqlKeyword(value, index, 'IF');
    if (afterIf >= 0) {
        const afterNot = consumeSqlKeyword(value, skipSqlTrivia(value, afterIf), 'NOT');
        const afterExists = afterNot < 0 ? -1 : consumeSqlKeyword(value, skipSqlTrivia(value, afterNot), 'EXISTS');
        if (afterExists < 0) return null;
        index = skipSqlTrivia(value, afterExists);
    }
    const tableNameStart = index;
    const tableNameEnd = skipSqlIdentifier(value, index);
    if (tableNameEnd <= tableNameStart) return null;
    index = skipSqlTrivia(value, tableNameEnd);
    if (value[index] !== '(') return null;
    const openingIndex = index;
    let depth = 0;
    let quote = null;
    for (; index < value.length; index += 1) {
        const char = value[index];
        if (quote) {
            const close = quote === '[' ? ']' : quote;
            if (char === close) {
                if (value[index + 1] === close) index += 1;
                else quote = null;
            }
            continue;
        }
        if ((char === '-' && value[index + 1] === '-') || (char === '/' && value[index + 1] === '*')) {
            index = skipSqlTrivia(value, index) - 1;
            continue;
        }
        if (char === "'" || char === '"' || char === '`' || char === '[') {
            quote = char;
            continue;
        }
        if (char === '(') depth += 1;
        if (char === ')' && --depth === 0) {
            return { tableNameStart, tableNameEnd, openingIndex, closingIndex: index };
        }
    }
    return null;
}

export function normalizeSqlStructure(sql) {
    const replacements = {
        '＝': '=', '＞': '>', '＜': '<', '＋': '+', '－': '-', '＊': '*', '／': '/',
        '（': '(', '）': ')', '，': ',', '；': ';', '\u3000': ' ',
    };
    let result = '';
    let inString = false;
    let inComment = false;
    for (let index = 0; index < String(sql).length; index += 1) {
        const char = String(sql)[index];
        if (inComment) {
            result += char;
            if (char === '\n') inComment = false;
            continue;
        }
        if (inString) {
            result += char;
            if (char === "'") {
                if (String(sql)[index + 1] === "'") result += String(sql)[++index];
                else inString = false;
            }
            continue;
        }
        if (char === "'") inString = true;
        if (char === '-' && String(sql)[index + 1] === '-') inComment = true;
        result += replacements[char] ?? char;
    }
    return result;
}

function splitSqlValueList(value) {
    const values = [];
    let current = '';
    let inString = false;
    for (let index = 0; index < value.length; index += 1) {
        const char = value[index];
        if (inString) {
            current += char;
            if (char === "'") {
                if (value[index + 1] === "'") current += value[++index];
                else inString = false;
            }
        } else if (char === "'") {
            inString = true;
            current += char;
        } else if (char === ',') {
            values.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    if (current.trim()) values.push(current);
    return values;
}

function normalizeCodeIndexLiteral(value) {
    if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) return value;
    const inner = value.slice(1, -1).replace(/''/g, "'");
    const normalized = inner.trim().normalize('NFKC').toUpperCase();
    return normalized === inner ? value : `'${normalized.replace(/'/g, "''")}'`;
}

export function normalizeStatementValues(sql) {
    const insert = sql.match(/^(INSERT\s+INTO\s+\w+\s*)\(([^)]+)\)(\s*VALUES\s*)\((.+)\)\s*;?\s*$/is);
    if (insert) {
        const columns = insert[2].split(',').map((value) => value.trim()).filter(Boolean);
        const values = splitSqlValueList(insert[4]).map((value) => value.trim());
        if (columns.length === values.length) {
            let changed = false;
            const normalized = values.map((value, index) => {
                if (columns[index].toLowerCase() !== 'code_index') return value;
                const next = normalizeCodeIndexLiteral(value);
                changed ||= next !== value;
                return next;
            });
            if (changed) {
                const suffix = sql.trimEnd().endsWith(';') ? ';' : '';
                return `${insert[1]}(${columns.join(', ')})${insert[3]}(${normalized.join(', ')})${suffix}`;
            }
        }
    }
    const update = sql.match(/^(UPDATE\s+\w+\s+SET\s+)(.+?)(\s+WHERE\s+.+)?$/is);
    if (!update) return sql;
    let changed = false;
    const assignments = splitSqlValueList(update[2]).map((assignment) => {
        const match = assignment.match(/^(\s*\w+\s*)=\s*(.+)$/s);
        if (!match || match[1].trim().toLowerCase() !== 'code_index') return assignment;
        const rawValue = match[2].trim();
        const normalized = normalizeCodeIndexLiteral(rawValue);
        if (normalized === rawValue) return assignment;
        changed = true;
        return `${match[1]}= ${normalized}`;
    });
    return changed ? `${update[1]}${assignments.join(', ')}${update[3] || ''}` : sql;
}

export function rebindCreateTableName(ddl, tableName) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new Error(`Invalid Shujuku table name: ${tableName}`);
    const normalized = normalizeSqlStructure(String(ddl || ''));
    const bounds = findCreateTableBounds(normalized);
    if (!bounds) throw new Error('Deep Clean Shujuku DDL is not a supported CREATE TABLE statement');
    return `${normalized.slice(0, bounds.tableNameStart)}${tableName}${normalized.slice(bounds.tableNameEnd)}`;
}

export function parseDdlColumnComments(ddl) {
    const bounds = findCreateTableBounds(ddl);
    const comments = new Map();
    if (!bounds) return comments;
    ddl.slice(bounds.openingIndex + 1, bounds.closingIndex).split('\n').forEach((line) => {
        const match = line.trim().match(/^([^\s,()]+)\s+.*?--\s*(.+?)\s*,?\s*$/);
        if (match) comments.set(match[1], match[2]);
    });
    return comments;
}

export function createTableBody(ddl) {
    const value = String(ddl || '');
    const bounds = findCreateTableBounds(value);
    return bounds ? value.slice(bounds.openingIndex + 1, bounds.closingIndex) : null;
}

export function parseDdlTableName(ddl) {
    const value = String(ddl || '');
    const bounds = findCreateTableBounds(value);
    return bounds ? value.slice(bounds.tableNameStart, bounds.tableNameEnd) : null;
}

