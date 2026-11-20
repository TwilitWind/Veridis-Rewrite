/** replay 的分块：apply。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { cloneJson, isRecord, assertCanonicalState, assertCanonicalSheet, normalizeSqlStructure, parseDdlColumnComments, collectIsolationKeys, collectFrameRefs, latestFullCheckpointIndex, assertCurrentWriterReplaySegment } from './replay-00-sqlText.js';
import { canonicalJson, sha256, runSqlOperation } from './replay-03-cells.js';
import { descriptorSheet, assertDescriptorMatchesSheet, expectedV1Changes, buildMigratedSheetV1, buildMigratedSheetV2, validateSchemaCandidate } from './replay-04-migration.js';
import { materializeRuntime, createSqlRuntime } from './replay-02-runtime.js';
import { createInsertPlan } from './replay-01-sqlRebind.js';

export async function applySchemaMigration(state, operation) {
    const currentSheet = state[operation.sheetKey];
    if (!isRecord(currentSheet)) throw new Error(`Deep Clean schema migration target is missing: ${operation.sheetKey}`);
    if (operation.contractVersion === 1) {
        assertDescriptorMatchesSheet(operation.beforeSchema, currentSheet, 1, 'schema migration beforeSchema');
        assertDescriptorMatchesSheet(operation.targetSchema, descriptorSheet(operation.targetSchema), 1, 'schema migration targetSchema');
        const expectedChanges = expectedV1Changes(operation.beforeSchema, operation.targetSchema);
        if (canonicalJson(operation.columnChanges) !== canonicalJson(expectedChanges)) {
            throw new Error('Deep Clean schema migration columnChanges mismatch');
        }
        const hasDrop = expectedChanges.some((change) => change.kind === 'drop');
        if (hasDrop !== operation.migrationPolicy?.destructiveChangeConfirmed) {
            throw new Error('Deep Clean schema migration destructive confirmation mismatch');
        }
    } else if (operation.contractVersion !== 2) {
        throw new Error(`Deep Clean schema migration contract is unsupported: ${String(operation.contractVersion)}`);
    }
    const beforeDigest = await sha256(canonicalJson(operation.beforeSchema));
    const targetDigest = await sha256(canonicalJson(operation.targetSchema));
    if (operation.beforeSchemaDigest !== beforeDigest || operation.targetSchemaDigest !== targetDigest) {
        throw new Error(`Deep Clean schema migration descriptor digest mismatch: ${operation.sheetKey}`);
    }
    const candidate = cloneJson(state);
    candidate[operation.sheetKey] = operation.contractVersion === 1
        ? buildMigratedSheetV1(currentSheet, operation.targetSchema)
        : buildMigratedSheetV2(currentSheet, operation);
    await validateSchemaCandidate(candidate);
    return candidate;
}

export function applyRowOperation(state, operation) {
    const sheet = state[operation.sheetKey];
    if (!isRecord(sheet) || !Array.isArray(sheet.content)) {
        throw new Error(`Deep Clean Shujuku operation targets a missing sheet: ${operation.sheetKey}`);
    }
    if (operation.kind === 'row_delete') {
        const rowId = String(operation.rowId ?? '').trim();
        sheet.content = sheet.content.filter((row, index) => index === 0 || String(row?.[0] ?? '').trim() !== rowId);
        return;
    }
    if (!Array.isArray(operation.cells)) throw new Error(`Deep Clean Shujuku row_upsert has no cells: ${operation.sheetKey}`);
    const rowId = String(operation.rowId ?? '').trim();
    const cells = cloneJson(operation.cells);
    if (!rowId || String(cells[0] ?? '').trim() !== rowId || cells.length !== sheet.content[0].length) {
        throw new Error(`Deep Clean Shujuku row_upsert identity mismatch: ${operation.sheetKey}`);
    }
    const matches = [];
    sheet.content.forEach((row, index) => {
        if (index > 0 && String(row?.[0] ?? '').trim() === rowId) matches.push(index);
    });
    if (matches.length > 1) throw new Error(`Deep Clean Shujuku row_upsert found duplicate row_id: ${operation.sheetKey}/${rowId}`);
    cells[0] = rowId;
    if (matches.length === 1) sheet.content[matches[0]] = cells;
    else sheet.content.push(cells);
}

export async function applyStructuredOperation(state, operation, runtime) {
    if (operation.kind === 'sql_batch' || operation.kind === 'sql_sheet_batch') {
        const nextRuntime = runtime || await createSqlRuntime(state);
        if (!Array.isArray(operation.statements)) throw new Error(`Deep Clean Shujuku ${operation.kind} has no statements`);
        runSqlOperation(nextRuntime, state, operation);
        return { state, runtime: nextRuntime };
    }
    const nextState = runtime ? materializeRuntime(runtime, state) : cloneJson(state);
    if (operation.kind === 'data_replace') {
        if (!isRecord(operation.data)) throw new Error('Deep Clean Shujuku data_replace has no data');
        const data = cloneJson(operation.data);
        assertCanonicalState(data);
        return { state: data, runtime: null };
    }
    if (operation.kind === 'sheet_replace') {
        if (!operation.sheetKey?.startsWith('sheet_') || !isRecord(operation.sheet)) {
            throw new Error('Deep Clean Shujuku sheet_replace is invalid');
        }
        nextState[operation.sheetKey] = cloneJson(operation.sheet);
    } else if (operation.kind === 'row_upsert' || operation.kind === 'row_delete') {
        applyRowOperation(nextState, operation);
    } else if (operation.kind === 'meta_update') {
        const sheet = nextState[operation.sheetKey];
        if (!isRecord(sheet) || !isRecord(operation.meta)) throw new Error('Deep Clean Shujuku meta_update is invalid');
        if (isRecord(operation.meta.sourceData) && Object.prototype.hasOwnProperty.call(operation.meta.sourceData, 'ddl')) {
            throw new Error('Deep Clean Shujuku meta_update cannot change DDL');
        }
        ['name', 'orderNo', 'updateConfig', 'exportConfig'].forEach((key) => {
            if (operation.meta[key] !== undefined) sheet[key] = cloneJson(operation.meta[key]);
        });
        if (operation.meta.sourceData !== undefined) {
            sheet.sourceData = { ...cloneJson(sheet.sourceData || {}), ...cloneJson(operation.meta.sourceData) };
        }
    } else if (operation.kind === 'sheet_schema_migrate') {
        return { state: await applySchemaMigration(nextState, operation), runtime: null };
    }
    assertCanonicalState(nextState);
    return { state: nextState, runtime: null };
}

export function validatedSheetCheckpoints(frame) {
    if (frame.perSheetCheckpoints === undefined) return [];
    if (!isRecord(frame.perSheetCheckpoints)) throw new Error('Deep Clean Shujuku per-sheet checkpoints are invalid');
    return Object.entries(frame.perSheetCheckpoints).map(([sheetKey, checkpoint]) => {
        if (!sheetKey.startsWith('sheet_') || !isRecord(checkpoint) || checkpoint.kind !== 'sheet_full'
            || checkpoint.sheetKey !== sheetKey || !isRecord(checkpoint.data)) {
            throw new Error(`Deep Clean Shujuku per-sheet checkpoint is invalid: ${sheetKey}`);
        }
        if (checkpoint.timeline !== undefined) {
            const timeline = checkpoint.timeline;
            if (!isRecord(timeline)
                || !['sheet_introduction', 'sheet_rebase', 'sheet_reveal', 'sheet_hide'].includes(timeline.kind)
                || !Number.isInteger(timeline.afterSeq) || timeline.afterSeq < 0) {
                throw new Error(`Deep Clean Shujuku sheet timeline is invalid: ${sheetKey}`);
            }
        }
        assertCanonicalSheet(checkpoint.data, sheetKey);
        return cloneJson(checkpoint);
    }).sort((left, right) => left.sheetKey.localeCompare(right.sheetKey));
}

export function canonicalLogEntries(frame) {
    let previousSeq = -1;
    return frame.logEntries.map((entry) => {
        if (!isRecord(entry) || !Number.isInteger(entry.seq) || entry.seq < 0 || entry.seq <= previousSeq) {
            throw new Error('Deep Clean Shujuku V2 log ordering is invalid');
        }
        previousSeq = entry.seq;
        return entry;
    });
}

export function applySheetCheckpoints(state, checkpoints, lifecycle) {
    const candidate = cloneJson(state);
    checkpoints.forEach((checkpoint) => {
        if (checkpoint.timeline?.kind === 'sheet_hide') {
            delete candidate[checkpoint.sheetKey];
            lifecycle.set(checkpoint.sheetKey, 'hidden');
        } else {
            candidate[checkpoint.sheetKey] = cloneJson(checkpoint.data);
            lifecycle.set(checkpoint.sheetKey, 'active');
        }
    });
    assertCanonicalState(candidate);
    return candidate;
}

export async function replayIsolationSlot(frameRefs, baseIndex) {
    const checkpoint = frameRefs[baseIndex].frame.checkpoint;
    let state = cloneJson(checkpoint.data);
    assertCanonicalState(state);
    const lifecycle = new Map(Object.keys(state).filter((key) => key.startsWith('sheet_')).map((key) => [key, 'active']));
    let runtime = null;

    for (let frameIndex = baseIndex; frameIndex < frameRefs.length; frameIndex += 1) {
        const frame = frameRefs[frameIndex].frame;
        const checkpoints = validatedSheetCheckpoints(frame);
        const untimed = checkpoints.filter((item) => item.timeline === undefined);
        if (untimed.length > 0) {
            if (runtime) {
                state = materializeRuntime(runtime, state);
                runtime = null;
            }
            state = applySheetCheckpoints(state, untimed, lifecycle);
        }
        const pending = checkpoints.filter((item) => item.timeline !== undefined);
        const applyDue = (nextSeq) => {
            const due = pending.filter((item) => item.timeline.afterSeq < nextSeq);
            if (due.length === 0) return;
            if (runtime) {
                state = materializeRuntime(runtime, state);
                runtime = null;
            }
            state = applySheetCheckpoints(state, due, lifecycle);
            due.forEach((item) => pending.splice(pending.indexOf(item), 1));
        };
        for (const entry of canonicalLogEntries(frame)) {
            applyDue(entry.seq);
            for (const operation of entry.operations) {
                const applied = await applyStructuredOperation(state, operation, runtime);
                state = applied.state;
                runtime = applied.runtime;
            }
        }
        applyDue(Number.POSITIVE_INFINITY);
    }
    if (runtime) state = materializeRuntime(runtime, state);
    assertCanonicalState(state);
    return { state, lifecycle };
}

export async function describeStateSchemas(state) {
    const runtime = await createSqlRuntime(state);
    try {
        return new Map([...runtime.sheets.entries()].map(([sheetKey, metadata]) => [sheetKey, metadata.schema.map((column) => column.name)]));
    } finally {
        runtime.db.close();
    }
}

export function projectBusinessColumns(sheet, ddlColumns) {
    const headers = sheet.content[0].map((value) => String(value ?? ''));
    const rawHidden = sheet.sourceData?.hiddenPhysicalColumns;
    if (rawHidden !== undefined && !Array.isArray(rawHidden)) return null;
    const hidden = (rawHidden || []).map((value) => String(value ?? '').trim()).filter(Boolean);
    const hiddenCanonical = hidden.map((value) => value.toLowerCase());
    if (new Set(hiddenCanonical).size !== hiddenCanonical.length || hiddenCanonical.includes('row_id')) return null;
    const canMapByIndex = ddlColumns.length === headers.length;
    const physicalNames = canMapByIndex ? ddlColumns : headers;
    const knownPhysical = new Set([
        ...physicalNames.map((value) => value.toLowerCase()),
        ...(canMapByIndex ? [] : ddlColumns.map((value) => value.toLowerCase())),
    ]);
    if (hidden.some((value) => !knownPhysical.has(value.toLowerCase()))) return null;
    const hiddenSet = new Set(hiddenCanonical);
    const columns = headers.map((header, sourceIndex) => {
        const physicalName = physicalNames[sourceIndex] || header;
        const ddlName = canMapByIndex ? '' : (ddlColumns[sourceIndex] || '');
        const isHidden = hiddenSet.has(physicalName.toLowerCase())
            || (!!ddlName && hiddenSet.has(ddlName.toLowerCase()))
            || (!!header && hiddenSet.has(header.toLowerCase()));
        return { sourceIndex, physicalName, isHidden };
    }).filter((column) => column.sourceIndex > 0 && !column.isHidden && column.physicalName !== 'row_id');
    const keys = columns.map((column) => column.physicalName.trim());
    if (keys.some((key) => !key) || new Set(keys).size !== keys.length) return null;
    return columns;
}

export async function cellsFromReplay(replay, isolationKey, options = {}) {
    const schemas = await describeStateSchemas(replay.state);
    const cells = [];
    for (const [sheetKey, sheet] of Object.entries(replay.state)) {
        if (!sheetKey.startsWith('sheet_') || replay.lifecycle.get(sheetKey) !== 'active') continue;
        try {
            assertCanonicalSheet(sheet, sheetKey);
        } catch (error) {
            if (options.strict === true) throw error;
            continue;
        }
        const columns = projectBusinessColumns(sheet, schemas.get(sheetKey) || []);
        if (!columns) {
            if (options.strict === true) {
                throw new Error(`Deep Clean Shujuku physical column projection is ambiguous: ${sheetKey}`);
            }
            continue;
        }
        sheet.content.slice(1).forEach((row) => {
            const rowId = String(row[0]).trim();
            columns.forEach((column) => {
                const value = row[column.sourceIndex];
                if (typeof value !== 'string') return;
                cells.push({
                    isolationKey,
                    sheetKey,
                    rowId,
                    columnKey: column.physicalName,
                    originalText: value,
                });
            });
        });
    }
    return cells;
}

export async function projectLateV1ShujukuCells(state, isolationKey) {
    assertCanonicalState(state);
    const runtime = await createSqlRuntime(state);
    try {
        for (const [sheetKey, metadata] of runtime.sheets) {
            const sheet = state[sheetKey];
            const seedRows = sheet?.seedRows;
            if (seedRows === undefined) continue;
            if (!Array.isArray(seedRows)) {
                throw new Error(`Deep Clean Shujuku V1 seedRows is invalid: ${sheetKey}`);
            }
            const comments = parseDdlColumnComments(normalizeSqlStructure(String(sheet?.sourceData?.ddl || '')));
            const projectionInput = {
                ...sheet,
                content: [sheet.content[0], ...sheet.content.slice(1), ...seedRows],
            };
            const insertPlan = createInsertPlan(projectionInput, metadata.schema, comments);
            for (const row of seedRows) {
                for (const { column, sourceIndex } of insertPlan) {
                    if ((column.primaryKey || (column.notNull && column.defaultValue === null))
                        && (row[sourceIndex] === null || row[sourceIndex] === undefined)) {
                        throw new Error(`Deep Clean Shujuku V1 seedRows requires a business value: ${sheetKey}/${column.name}`);
                    }
                }
            }
        }
    } finally {
        runtime.db.close();
    }
    const lifecycle = new Map(
        Object.keys(state).filter((key) => key.startsWith('sheet_')).map((key) => [key, 'active']),
    );
    return cellsFromReplay({ state, lifecycle }, isolationKey, { strict: true });
}

export async function readCurrentShujukuV2Cells(chat) {
    if (!Array.isArray(chat)) return [];
    const cells = [];
    for (const isolationKey of collectIsolationKeys(chat)) {
        const frameRefs = collectFrameRefs(chat, isolationKey);
        const baseIndex = latestFullCheckpointIndex(frameRefs);
        if (baseIndex < 0) {
            throw new Error(`Deep Clean Shujuku V2 has no usable full-checkpoint replay root: ${isolationKey}`);
        }
        assertCurrentWriterReplaySegment(frameRefs, baseIndex);
        const replay = await replayIsolationSlot(frameRefs, baseIndex);
        cells.push(...await cellsFromReplay(replay, isolationKey, { strict: true }));
    }
    return cells;
}

export function compareText(left, right) {
    const a = String(left);
    const b = String(right);
    return a < b ? -1 : a > b ? 1 : 0;
}

export function compareCellIdentity(left, right) {
    return compareText(left.sheetKey, right.sheetKey)
        || compareText(left.rowId, right.rowId)
        || compareText(left.columnKey, right.columnKey);
}

export function generateCurrentV2EntryId() {
    return `v2_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

