/** replay 的分块：migration。实现按依赖拓扑拆分，对外接口从同名 barrel 导出。 */
import { parseDdlTableName, isRecord, assertCanonicalState, cloneJson } from './replay-00-sqlText.js';
import { stripSqlLineComments, parseDdlTableConstraints, parseDdlTableSuffix, parseSafeDefaultLiteral } from './replay-01-sqlRebind.js';
import { requireSheetShape, canonicalJson, P1_COLUMN_CONSTRAINT_TOKENS } from './replay-03-cells.js';
import { createSqlRuntime } from './replay-02-runtime.js';

export function sheetSchemaDescriptor(sheet, descriptorVersion) {
    const { headers, columns, ddl } = requireSheetShape(sheet, `schema descriptor V${descriptorVersion}`);
    return {
        descriptorVersion,
        uid: String(sheet.uid || ''),
        tableName: parseDdlTableName(ddl),
        headers: [...headers],
        ddl,
        normalizedSql: stripSqlLineComments(ddl).replace(/\s+/g, ' ').trim(),
        columns: columns.map((column, index) => ({
            index,
            physicalName: column.sqlName,
            displayHeader: headers[index],
            normalizedDefinition: column.normalizedDefinition,
            ...(descriptorVersion === 2 ? { defaultExpression: column.defaultExpression } : {}),
        })),
        tableConstraints: parseDdlTableConstraints(ddl),
        tableSuffix: parseDdlTableSuffix(ddl),
    };
}

export function descriptorSheet(descriptor) {
    return {
        uid: descriptor.uid,
        name: '',
        content: [descriptor.headers.map((value) => value == null ? null : String(value))],
        sourceData: { ddl: descriptor.ddl },
    };
}

export function assertDescriptorMatchesSheet(descriptor, sheet, descriptorVersion, phase) {
    if (!isRecord(descriptor) || descriptor.descriptorVersion !== descriptorVersion) {
        throw new Error(`Deep Clean ${phase} has an unsupported descriptor version`);
    }
    if (canonicalJson(descriptor) !== canonicalJson(sheetSchemaDescriptor(sheet, descriptorVersion))) {
        throw new Error(`Deep Clean ${phase} does not match its DDL/header definition`);
    }
}

export function expectedV1Changes(before, target) {
    if (before.uid !== target.uid) throw new Error('Deep Clean schema migration cannot change sheet uid');
    if (canonicalJson(before.tableConstraints) !== canonicalJson(target.tableConstraints)) {
        throw new Error('Deep Clean V1 schema migration cannot change table constraints');
    }
    if (before.tableSuffix !== target.tableSuffix) throw new Error('Deep Clean V1 schema migration cannot change table suffix');
    const beforeByName = new Map(before.columns.map((column) => [column.physicalName, column]));
    const targetByName = new Map(target.columns.map((column) => [column.physicalName, column]));
    const removed = before.columns.slice(1).filter((column) => !targetByName.has(column.physicalName));
    const added = target.columns.slice(1).filter((column) => !beforeByName.has(column.physicalName));
    if (removed.length > 0 && added.length > 0) throw new Error('Deep Clean V1 schema migration cannot combine physical add and drop');
    const retainedBefore = before.columns.filter((column) => targetByName.has(column.physicalName)).map((column) => column.physicalName);
    const retainedTarget = target.columns.filter((column) => beforeByName.has(column.physicalName)).map((column) => column.physicalName);
    if (canonicalJson(retainedBefore) !== canonicalJson(retainedTarget)) {
        throw new Error('Deep Clean V1 schema migration cannot reorder retained physical columns');
    }
    const changes = [];
    before.columns.forEach((column) => {
        const targetColumn = targetByName.get(column.physicalName);
        if (!targetColumn) {
            if (column.physicalName === 'row_id') throw new Error('Deep Clean schema migration cannot remove row_id');
            changes.push({ kind: 'drop', physicalName: column.physicalName, header: column.displayHeader, index: column.index });
        } else if (column.normalizedDefinition !== targetColumn.normalizedDefinition) {
            throw new Error(`Deep Clean V1 schema migration cannot change a column definition: ${column.physicalName}`);
        } else if (column.displayHeader !== targetColumn.displayHeader) {
            changes.push({
                kind: 'rename_display',
                physicalName: column.physicalName,
                fromHeader: column.displayHeader,
                toHeader: targetColumn.displayHeader,
            });
        }
    });
    added.forEach((column) => {
        if (column.physicalName === 'row_id') throw new Error('Deep Clean schema migration cannot add row_id');
        const targetInfo = requireSheetShape(descriptorSheet(target), 'target schema').columns[column.index];
        const pureDefinition = targetInfo?.declaredType ? `${targetInfo.sqlName} ${targetInfo.declaredType}` : targetInfo?.sqlName;
        if (!targetInfo || targetInfo.isNotNull || targetInfo.hasDefault
            || P1_COLUMN_CONSTRAINT_TOKENS.has(targetInfo.declaredType?.toUpperCase() || '')
            || targetInfo.normalizedDefinition !== pureDefinition) {
            throw new Error(`Deep Clean V1 schema migration cannot add this column definition: ${column.physicalName}`);
        }
        changes.push({ kind: 'add', physicalName: column.physicalName, header: column.displayHeader, index: column.index });
    });
    return changes;
}

export function buildMigratedSheetV1(currentSheet, target) {
    const current = sheetSchemaDescriptor(currentSheet, 1);
    const sourceIndexByName = new Map(current.columns.map((column) => [column.physicalName, column.index]));
    const content = [target.headers.map((value) => value == null ? null : String(value))];
    currentSheet.content.slice(1).forEach((row) => {
        if (!Array.isArray(row)) return;
        content.push(target.columns.map((column) => {
            const sourceIndex = sourceIndexByName.get(column.physicalName);
            return sourceIndex === undefined || row[sourceIndex] == null ? null : String(row[sourceIndex]);
        }));
    });
    return {
        ...cloneJson(currentSheet),
        uid: target.uid,
        content,
        sourceData: { ...cloneJson(currentSheet.sourceData || {}), ddl: target.ddl },
    };
}

function requireUniqueNames(values, label) {
    if (values.some((value) => !value || value === 'row_id') || new Set(values).size !== values.length) {
        throw new Error(`Deep Clean ${label} contains an invalid or duplicate physical column`);
    }
}

function literalToCellValue(literal) {
    if (literal.kind === 'null') return null;
    if (literal.kind === 'boolean') return literal.value ? '1' : '0';
    return String(literal.value);
}

function convertCellValue(value, policy) {
    if (value == null) return { value: null, lossy: false };
    const input = String(value);
    if (policy?.kind === 'identity' || policy?.kind === 'stringify') return { value: input, lossy: false };
    if (policy?.kind === 'integer_strict') {
        if (!/^[+-]?\d+$/.test(input)) throw new Error(`Deep Clean integer_strict cannot convert: ${input}`);
        const numeric = Number(input);
        if (!Number.isSafeInteger(numeric)) throw new Error(`Deep Clean integer_strict exceeds safe integer range: ${input}`);
        const output = String(numeric);
        return { value: output, lossy: output !== input };
    }
    if (policy?.kind === 'real_strict') {
        if (!/^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$/.test(input)) {
            throw new Error(`Deep Clean real_strict cannot convert: ${input}`);
        }
        const numeric = Number(input);
        if (!Number.isFinite(numeric)) throw new Error(`Deep Clean real_strict cannot convert: ${input}`);
        const output = String(numeric);
        return { value: output, lossy: output !== input };
    }
    throw new Error(`Deep Clean schema migration conversion policy is unsupported: ${String(policy?.kind)}`);
}

function semanticColumnDefinition(column) {
    return column.normalizedDefinition.slice(column.physicalName.length).trim();
}

export function buildMigratedSheetV2(currentSheet, operation) {
    const current = sheetSchemaDescriptor(currentSheet, 2);
    assertDescriptorMatchesSheet(operation.beforeSchema, currentSheet, 2, 'schema migration V2 beforeSchema');
    assertDescriptorMatchesSheet(operation.targetSchema, descriptorSheet(operation.targetSchema), 2, 'schema migration V2 targetSchema');
    if (current.uid !== operation.targetSchema.uid) throw new Error('Deep Clean schema migration V2 cannot change sheet uid');
    if (current.columns[0]?.physicalName !== 'row_id' || operation.targetSchema.columns[0]?.physicalName !== 'row_id') {
        throw new Error('Deep Clean schema migration V2 must retain row_id');
    }
    const sourceByName = new Map(current.columns.map((column) => [column.physicalName, column]));
    const targetByName = new Map(operation.targetSchema.columns.map((column) => [column.physicalName, column]));
    const mappings = Array.isArray(operation.physicalColumnMappings) ? operation.physicalColumnMappings : [];
    requireUniqueNames(mappings.map((item) => String(item?.fromPhysicalName || '')), 'physicalColumnMappings source');
    requireUniqueNames(mappings.map((item) => String(item?.toPhysicalName || '')), 'physicalColumnMappings target');
    const mappedSource = new Map();
    mappings.forEach((item) => {
        if (!sourceByName.has(item.fromPhysicalName) || !targetByName.has(item.toPhysicalName)
            || sourceByName.has(item.toPhysicalName) || targetByName.has(item.fromPhysicalName)) {
            throw new Error('Deep Clean physicalColumnMappings has an invalid source or target');
        }
        mappedSource.set(item.toPhysicalName, item.fromPhysicalName);
    });
    const removed = current.columns.slice(1).filter((column) => (
        !targetByName.has(column.physicalName)
        && !mappings.some((item) => item.fromPhysicalName === column.physicalName)
    ));
    const added = operation.targetSchema.columns.slice(1).filter((column) => (
        !sourceByName.has(column.physicalName) && !mappedSource.has(column.physicalName)
    ));
    if (removed.length > 0 && !operation.migrationPolicy?.destructiveChangeConfirmed) {
        throw new Error('Deep Clean schema migration V2 destructive drop is not confirmed');
    }
    const conversionByTarget = new Map();
    for (const conversion of Array.isArray(operation.conversions) ? operation.conversions : []) {
        if (!conversion || conversion.fromPhysicalName === 'row_id' || conversion.toPhysicalName === 'row_id'
            || conversionByTarget.has(conversion.toPhysicalName)) {
            throw new Error('Deep Clean schema migration V2 conversion is invalid');
        }
        conversionByTarget.set(conversion.toPhysicalName, conversion.policy);
    }
    const fills = isRecord(operation.fills) ? operation.fills : {};
    Object.keys(fills).forEach((name) => {
        const fill = fills[name];
        if (!added.some((column) => column.physicalName === name)
            || !fill || (fill.kind !== 'literal' && fill.kind !== 'ddl_literal_default')) {
            throw new Error(`Deep Clean schema migration V2 fill is invalid: ${name}`);
        }
        const parsed = parseSafeDefaultLiteral(fill.literal?.sql);
        if (!parsed || canonicalJson(parsed) !== canonicalJson(fill.literal)) {
            throw new Error(`Deep Clean schema migration V2 fill literal is invalid: ${name}`);
        }
        if (fill.kind === 'ddl_literal_default'
            && canonicalJson(parsed) !== canonicalJson(parseSafeDefaultLiteral(targetByName.get(name)?.defaultExpression))) {
            throw new Error(`Deep Clean schema migration V2 DDL default does not match: ${name}`);
        }
    });
    if (Object.keys(fills).length !== added.length) throw new Error('Deep Clean schema migration V2 requires one fill for every added column');
    const sourceForTarget = (targetName) => sourceByName.has(targetName) ? targetName : mappedSource.get(targetName);
    operation.targetSchema.columns.slice(1).forEach((target) => {
        const sourceName = sourceForTarget(target.physicalName);
        const declared = Array.isArray(operation.conversions)
            ? operation.conversions.find((item) => item?.toPhysicalName === target.physicalName)
            : undefined;
        if (declared && declared.fromPhysicalName !== sourceName) throw new Error(`Deep Clean conversion source mismatch: ${target.physicalName}`);
        if (!sourceName) return;
        const definitionChanged = semanticColumnDefinition(sourceByName.get(sourceName)) !== semanticColumnDefinition(target);
        const conversion = conversionByTarget.get(target.physicalName);
        if (definitionChanged !== !!conversion) throw new Error(`Deep Clean conversion contract mismatch: ${target.physicalName}`);
    });
    const coveredConversions = [...conversionByTarget].filter(([targetName]) => {
        const sourceName = sourceForTarget(targetName);
        return !!sourceName
            && semanticColumnDefinition(sourceByName.get(sourceName)) !== semanticColumnDefinition(targetByName.get(targetName));
    });
    if (conversionByTarget.size !== coveredConversions.length) throw new Error('Deep Clean conversion must cover only changed definitions');
    const content = [operation.targetSchema.headers.map((value) => value == null ? null : String(value))];
    let convertedRowCount = 0;
    let lossyRowCount = 0;
    currentSheet.content.slice(1).forEach((row) => {
        if (!Array.isArray(row)) return;
        let rowLossy = false;
        const targetRow = operation.targetSchema.columns.map((target) => {
            const sourceName = sourceForTarget(target.physicalName);
            if (!sourceName) return literalToCellValue(fills[target.physicalName].literal);
            const sourceIndex = sourceByName.get(sourceName).index;
            const policy = conversionByTarget.get(target.physicalName);
            if (!policy) return row[sourceIndex] == null ? null : String(row[sourceIndex]);
            const converted = convertCellValue(row[sourceIndex], policy);
            convertedRowCount += 1;
            rowLossy ||= converted.lossy;
            return converted.value;
        });
        if (rowLossy) lossyRowCount += 1;
        content.push(targetRow);
    });
    if (lossyRowCount > 0 && !operation.migrationPolicy?.lossyConversionConfirmed) {
        throw new Error('Deep Clean schema migration V2 lossy conversion is not confirmed');
    }
    const dryRun = { convertedRowCount, failedRowCount: 0, lossyRowCount };
    if (canonicalJson(operation.dryRun) !== canonicalJson(dryRun)) throw new Error('Deep Clean schema migration V2 dry-run mismatch');
    return {
        ...cloneJson(currentSheet),
        uid: operation.targetSchema.uid,
        content,
        sourceData: { ...cloneJson(currentSheet.sourceData || {}), ddl: operation.targetSchema.ddl },
    };
}

export async function validateSchemaCandidate(candidate) {
    assertCanonicalState(candidate);
    const runtime = await createSqlRuntime(candidate);
    runtime.db.close();
}

