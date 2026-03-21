import { analyzeCode, MigrationResult, MigrationSummary } from './analyzer';
import { TargetJQueryVersion } from './rules';

export type IncludeKind = 'root' | 'jsp-include' | 'script-src' | 'inline-script';

export interface RecursiveAnalysisEntry {
  id: string;
  filePath: string;
  displayPath: string;
  kind: IncludeKind;
  depth: number;
  found: boolean;
  referenceLine?: number;
  parentPath?: string;
  result: MigrationResult | null;
}

export interface RecursiveFileAnalysis {
  entries: RecursiveAnalysisEntry[];
  summary: MigrationSummary;
  totalIssues: number;
}

interface FileRecord {
  filePath: string;
  file: File;
}

function createEmptySummary(): MigrationSummary {
  return {
    errors: 0,
    warnings: 0,
    info: 0,
    autoFixes: 0,
    contextualFixes: 0,
    manualReviews: 0,
  };
}

function normalizePath(rawPath: string): string {
  const slashNormalized = rawPath.replace(/\\/g, '/').replace(/\/+/g, '/').trim();
  const withoutPrefix = slashNormalized.replace(/^\.\//, '');
  const parts = withoutPrefix.split('/');
  const normalizedParts: string[] = [];

  for (const part of parts) {
    if (!part || part === '.') {
      continue;
    }

    if (part === '..') {
      if (normalizedParts.length > 0) {
        normalizedParts.pop();
      }
      continue;
    }

    normalizedParts.push(part);
  }

  return normalizedParts.join('/');
}

function getDirectoryPath(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  if (index < 0) {
    return '';
  }

  return filePath.slice(0, index);
}

function stripQueryAndHash(reference: string): string {
  return reference.split('?')[0].split('#')[0].trim();
}

function isExternalReference(reference: string): boolean {
  return /^(?:[a-z]+:)?\/\//i.test(reference) || reference.startsWith('data:') || reference.startsWith('#');
}

function countLinesUntil(text: string, endIndexExclusive: number): number {
  const slice = text.slice(0, endIndexExclusive);
  let lineCount = 1;

  for (let index = 0; index < slice.length; index += 1) {
    if (slice[index] === '\n') {
      lineCount += 1;
    }
  }

  return lineCount;
}

interface ReferenceMatch {
  value: string;
  line: number;
}

interface OrderedReference {
  value: string;
  line: number;
  kind: 'jsp-include' | 'script-src';
}

function extractReferencesByPattern(content: string, blockPattern: RegExp): ReferenceMatch[] {
  const references: ReferenceMatch[] = [];
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(content)) !== null) {
    const block = blockMatch[0];
    const attrMatch = block.match(/\b(?:file|page|src)\s*=\s*['"]([^'"]+)['"]/i);
    if (!attrMatch) {
      continue;
    }

    const value = stripQueryAndHash(attrMatch[1]);
    if (!value || isExternalReference(value)) {
      continue;
    }

    references.push({
      value,
      line: countLinesUntil(content, blockMatch.index),
    });
  }

  return references;
}

function extractJspIncludeReferences(content: string): ReferenceMatch[] {
  const jspTagRefs = extractReferencesByPattern(content, /<jsp:include\b[^>]*>/gi);
  const directiveRefs = extractReferencesByPattern(content, /<%@\s*:?[\s]*include\b[^%]*%>/gi);
  return [...jspTagRefs, ...directiveRefs];
}

function extractScriptSourceReferences(content: string): ReferenceMatch[] {
  return extractReferencesByPattern(content, /<script\b[^>]*\bsrc\s*=\s*['"][^'"]+['"][^>]*>/gi);
}

function getOrderedFileReferences(content: string): OrderedReference[] {
  const jspRefs = extractJspIncludeReferences(content).map((ref) => ({
    ...ref,
    kind: 'jsp-include' as const,
  }));
  const scriptRefs = extractScriptSourceReferences(content).map((ref) => ({
    ...ref,
    kind: 'script-src' as const,
  }));

  return [...jspRefs, ...scriptRefs].sort((left, right) => {
    if (left.line !== right.line) {
      return left.line - right.line;
    }

    return left.value.localeCompare(right.value);
  });
}

interface InlineScriptBlock {
  code: string;
  startLine: number;
}

function applyLineOffset(result: MigrationResult, lineOffset: number): MigrationResult {
  if (lineOffset === 0) {
    return result;
  }

  return {
    ...result,
    issues: result.issues.map((issue) => ({
      ...issue,
      lineNumber: issue.lineNumber + lineOffset,
    })),
  };
}

function extractInlineScripts(content: string): InlineScriptBlock[] {
  const scripts: InlineScriptBlock[] = [];
  const pattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const scriptBody = match[1] ?? '';
    if (!scriptBody.trim()) {
      continue;
    }

    const bodyStartOffset = match[0].indexOf(scriptBody);
    const bodyStartIndex = match.index + (bodyStartOffset >= 0 ? bodyStartOffset : 0);
    const startLine = countLinesUntil(content, bodyStartIndex);

    scripts.push({
      code: scriptBody,
      startLine,
    });
  }

  return scripts;
}

function findByBasename(pathMap: Map<string, File>, referencePath: string): string | null {
  const basename = referencePath.split('/').pop();
  if (!basename) {
    return null;
  }

  const candidates: string[] = [];
  for (const key of pathMap.keys()) {
    if (key === basename || key.endsWith(`/${basename}`)) {
      candidates.push(key);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => left.length - right.length);
  return candidates[0];
}

function resolveReferencePath(currentPath: string, reference: string, pathMap: Map<string, File>): string | null {
  const cleanReference = stripQueryAndHash(reference);
  if (!cleanReference || isExternalReference(cleanReference)) {
    return null;
  }

  const normalizedReference = normalizePath(cleanReference.replace(/^\//, ''));
  const directPath = cleanReference.startsWith('/')
    ? normalizedReference
    : normalizePath(`${getDirectoryPath(currentPath)}/${cleanReference}`);

  if (pathMap.has(directPath)) {
    return directPath;
  }

  if (pathMap.has(normalizedReference)) {
    return normalizedReference;
  }

  return findByBasename(pathMap, normalizedReference);
}

export async function analyzeFileRecursively(
  rootPath: string,
  files: FileRecord[],
  targetVersion: TargetJQueryVersion = '3.7.1',
): Promise<RecursiveFileAnalysis> {
  const pathMap = new Map<string, File>();
  for (const item of files) {
    pathMap.set(normalizePath(item.filePath), item.file);
  }

  const normalizedRootPath = normalizePath(rootPath);
  const entries: RecursiveAnalysisEntry[] = [];
  const visited = new Set<string>();
  const contentCache = new Map<string, string>();
  let sequence = 0;

  const readContent = async (filePath: string): Promise<string> => {
    const cached = contentCache.get(filePath);
    if (cached !== undefined) {
      return cached;
    }

    const file = pathMap.get(filePath);
    if (!file) {
      throw new Error(`Archivo no encontrado: ${filePath}`);
    }

    const content = await file.text();
    contentCache.set(filePath, content);
    return content;
  };

  const pushEntry = (entry: Omit<RecursiveAnalysisEntry, 'id'>): void => {
    sequence += 1;
    entries.push({
      ...entry,
      id: `${entry.kind}-${sequence}`,
    });
  };

  const visitFile = async (
    filePath: string,
    kind: IncludeKind,
    depth: number,
    parentPath?: string,
    referenceLine?: number,
  ): Promise<void> => {
    if (visited.has(filePath)) {
      return;
    }

    visited.add(filePath);
    const content = await readContent(filePath);
    const fileResult = analyzeCode(content, targetVersion);

    pushEntry({
      filePath,
      displayPath: filePath,
      kind,
      depth,
      found: true,
      referenceLine,
      parentPath,
      result: fileResult,
    });

    const inlineScripts = extractInlineScripts(content);
    for (let index = 0; index < inlineScripts.length; index += 1) {
      const inlineScript = inlineScripts[index];
      const inlineResult = applyLineOffset(analyzeCode(inlineScript.code, targetVersion), inlineScript.startLine - 1);
      pushEntry({
        filePath: `${filePath}#inline-${index + 1}`,
        displayPath: `${filePath} (script inline #${index + 1}, linea ${inlineScript.startLine})`,
        kind: 'inline-script',
        depth: depth + 1,
        found: true,
        referenceLine: inlineScript.startLine,
        parentPath: filePath,
        result: inlineResult,
      });
    }

    const orderedReferences = getOrderedFileReferences(content);
    for (const ref of orderedReferences) {
      const resolved = resolveReferencePath(filePath, ref.value, pathMap);
      if (!resolved) {
        pushEntry({
          filePath: ref.value,
          displayPath: `${filePath} -> ${ref.value}`,
          kind: ref.kind,
          depth: depth + 1,
          found: false,
          referenceLine: ref.line,
          parentPath: filePath,
          result: null,
        });
        continue;
      }

      await visitFile(resolved, ref.kind, depth + 1, filePath, ref.line);
    }
  };

  if (!pathMap.has(normalizedRootPath)) {
    throw new Error(`No se encontro el archivo seleccionado: ${rootPath}`);
  }

  await visitFile(normalizedRootPath, 'root', 0);

  const summary = createEmptySummary();
  let totalIssues = 0;

  for (const entry of entries) {
    if (!entry.result) {
      continue;
    }

    totalIssues += entry.result.issues.length;
    summary.errors += entry.result.summary.errors;
    summary.warnings += entry.result.summary.warnings;
    summary.info += entry.result.summary.info;
    summary.autoFixes += entry.result.summary.autoFixes;
    summary.contextualFixes += entry.result.summary.contextualFixes;
    summary.manualReviews += entry.result.summary.manualReviews;
  }

  return {
    entries,
    summary,
    totalIssues,
  };
}
