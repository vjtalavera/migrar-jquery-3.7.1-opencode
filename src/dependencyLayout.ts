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
  referenceCodeLine?: string;
  referenceSourcePath?: string;
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

function getLineBreakLengthAt(text: string, index: number): number {
  const char = text[index];
  if (char === '\n') {
    return 1;
  }

  if (char === '\r') {
    return text[index + 1] === '\n' ? 2 : 1;
  }

  return 0;
}

function buildLineStartOffsets(text: string): number[] {
  const starts: number[] = [0];

  for (let index = 0; index < text.length; index += 1) {
    const lineBreakLength = getLineBreakLengthAt(text, index);
    if (lineBreakLength > 0) {
      starts.push(index + lineBreakLength);
      index += lineBreakLength - 1;
    }
  }

  return starts;
}

function getLineNumberFromIndex(lineStarts: number[], index: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  let candidate = 0;

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= index) {
      candidate = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return candidate + 1;
}

function getLineTextByLineNumber(content: string, lineStarts: number[], lineNumber: number): string {
  const index = Math.max(1, Math.min(lineNumber, lineStarts.length)) - 1;
  const start = lineStarts[index];
  const nextStart = index + 1 < lineStarts.length ? lineStarts[index + 1] : content.length;
  let end = nextStart;

  while (end > start && (content[end - 1] === '\n' || content[end - 1] === '\r')) {
    end -= 1;
  }

  return content.slice(start, end).trim();
}

interface ReferenceMatch {
  value: string;
  line: number;
  referenceCodeLine: string;
}

interface OrderedReference {
  value: string;
  line: number;
  referenceCodeLine: string;
  kind: 'jsp-include' | 'script-src';
}

interface AttributeValueMatch {
  value: string;
  indexInBlock: number;
}

function extractAttributeValue(block: string, attributeNames: readonly string[]): AttributeValueMatch | null {
  for (const attributeName of attributeNames) {
    const quotedPattern = new RegExp(`\\b${attributeName}\\s*=\\s*(['\"])([^'\"]+)\\1`, 'i');
    const quotedMatch = block.match(quotedPattern);
    if (quotedMatch && typeof quotedMatch.index === 'number') {
      return {
        value: quotedMatch[2],
        indexInBlock: quotedMatch.index,
      };
    }

    const unquotedPattern = new RegExp(`\\b${attributeName}\\s*=\\s*([^\\s>]+)`, 'i');
    const unquotedMatch = block.match(unquotedPattern);
    if (unquotedMatch && typeof unquotedMatch.index === 'number') {
      return {
        value: unquotedMatch[1],
        indexInBlock: unquotedMatch.index,
      };
    }
  }

  return null;
}

function extractReferencesByPattern(
  content: string,
  blockPattern: RegExp,
  attributeNames: readonly string[],
): ReferenceMatch[] {
  const references: ReferenceMatch[] = [];
  const lineStarts = buildLineStartOffsets(content);
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = blockPattern.exec(content)) !== null) {
    const block = blockMatch[0];
    const attributeMatch = extractAttributeValue(block, attributeNames);
    if (!attributeMatch) {
      continue;
    }

    const value = stripQueryAndHash(attributeMatch.value);
    if (!value || isExternalReference(value)) {
      continue;
    }

    const line = getLineNumberFromIndex(lineStarts, blockMatch.index);
    references.push({
      value,
      line,
      referenceCodeLine: getLineTextByLineNumber(content, lineStarts, line),
    });
  }

  return references;
}

function extractJspIncludeReferences(content: string): ReferenceMatch[] {
  const jspTagRefs = extractReferencesByPattern(content, /<jsp:include\b[^>]*>/gi, ['file', 'page']);
  const directiveRefs = extractReferencesByPattern(content, /<%@\s+include\b[^%]*%>/gi, ['file', 'page']);
  const directiveWithColonRefs = extractReferencesByPattern(content, /<%@\s*:\s*include\b[^%]*%>/gi, ['file', 'page']);
  return [...jspTagRefs, ...directiveRefs, ...directiveWithColonRefs];
}

function extractScriptSourceReferences(content: string): ReferenceMatch[] {
  return extractReferencesByPattern(
    content,
    /<script\b[^>]*\bsrc\s*=\s*(?:['"][^'"]+['"]|[^\s>]+)[^>]*>/gi,
    ['src'],
  );
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
  codeStartLine: number;
  referenceLine: number;
  referenceCodeLine: string;
}

function getFirstMeaningfulInlineCodeLine(scriptBody: string, codeStartLine: number): { line: number; text: string } {
  const lines = scriptBody.split('\n');

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (!trimmed) {
      continue;
    }

    return {
      line: codeStartLine + index,
      text: trimmed,
    };
  }

  return {
    line: codeStartLine,
    text: scriptBody.trim(),
  };
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
  const lineStarts = buildLineStartOffsets(content);
  const pattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    const scriptBody = match[1] ?? '';
    if (!scriptBody.trim()) {
      continue;
    }

    const bodyStartOffset = match[0].indexOf(scriptBody);
    const bodyStartIndex = match.index + (bodyStartOffset >= 0 ? bodyStartOffset : 0);
    const codeStartLine = getLineNumberFromIndex(lineStarts, bodyStartIndex);
    const inlineReference = getFirstMeaningfulInlineCodeLine(scriptBody, codeStartLine);

    scripts.push({
      code: scriptBody,
      codeStartLine,
      referenceLine: inlineReference.line,
      referenceCodeLine: inlineReference.text,
    });
  }

  return scripts;
}

function normalizeComparablePath(rawPath: string): string {
  return normalizePath(rawPath).toLowerCase();
}

function findCaseInsensitiveExactMatch(pathMap: Map<string, File>, candidatePath: string): string | null {
  const normalizedCandidate = normalizeComparablePath(candidatePath);

  for (const key of pathMap.keys()) {
    if (normalizeComparablePath(key) === normalizedCandidate) {
      return key;
    }
  }

  return null;
}

function findBestSuffixMatch(pathMap: Map<string, File>, referencePath: string): string | null {
  const normalizedReference = normalizeComparablePath(referencePath);
  const suffix = `/${normalizedReference}`;
  const candidates: string[] = [];

  for (const key of pathMap.keys()) {
    const normalizedKey = normalizeComparablePath(key);
    if (normalizedKey === normalizedReference || normalizedKey.endsWith(suffix)) {
      candidates.push(key);
    }
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => {
    const leftScore = normalizeComparablePath(left).length - normalizedReference.length;
    const rightScore = normalizeComparablePath(right).length - normalizedReference.length;

    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }

    return left.length - right.length;
  });

  return candidates[0];
}

function sanitizeReferencePath(reference: string): string {
  return reference
    .replace(/<%=?[\s\S]*?%>/g, '')
    .replace(/\$\{[^}]+\}/g, '')
    .replace(/^['"]|['"]$/g, '')
    .replace(/^\/+/, '')
    .trim();
}

function findByBasename(pathMap: Map<string, File>, referencePath: string): string | null {
  const basename = referencePath.split('/').pop();
  if (!basename) {
    return null;
  }

  const candidates: string[] = [];
  for (const key of pathMap.keys()) {
    const normalizedKey = normalizeComparablePath(key);
    const normalizedBasename = basename.toLowerCase();
    if (normalizedKey === normalizedBasename || normalizedKey.endsWith(`/${normalizedBasename}`)) {
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

  const sanitizedReference = sanitizeReferencePath(cleanReference);
  if (!sanitizedReference) {
    return null;
  }

  const normalizedReference = normalizePath(sanitizedReference);
  const directPath = cleanReference.startsWith('/')
    ? normalizedReference
    : normalizePath(`${getDirectoryPath(currentPath)}/${sanitizedReference}`);

  const directCandidates = [directPath, normalizedReference].filter((value, index, values) => values.indexOf(value) === index);

  for (const candidate of directCandidates) {
    if (pathMap.has(candidate)) {
      return candidate;
    }

    const caseInsensitiveMatch = findCaseInsensitiveExactMatch(pathMap, candidate);
    if (caseInsensitiveMatch) {
      return caseInsensitiveMatch;
    }
  }

  for (const candidate of directCandidates) {
    const suffixMatch = findBestSuffixMatch(pathMap, candidate);
    if (suffixMatch) {
      return suffixMatch;
    }
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
  const analysisCache = new Map<string, MigrationResult>();
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

  const analyzeFile = async (filePath: string): Promise<MigrationResult> => {
    const cached = analysisCache.get(filePath);
    if (cached) {
      return cached;
    }

    const content = await readContent(filePath);
    const result = analyzeCode(content, targetVersion);
    analysisCache.set(filePath, result);
    return result;
  };

  const visitFile = async (
    filePath: string,
    depth: number,
  ): Promise<void> => {
    const content = await readContent(filePath);
    const fileResult = await analyzeFile(filePath);

    if (depth === 0) {
      pushEntry({
        filePath,
        displayPath: filePath,
        kind: 'root',
        depth,
        found: true,
        result: fileResult,
      });
    }

    if (visited.has(filePath)) {
      return;
    }

    visited.add(filePath);

    const inlineScripts = extractInlineScripts(content);
    for (let index = 0; index < inlineScripts.length; index += 1) {
      const inlineScript = inlineScripts[index];
      const inlineResult = applyLineOffset(analyzeCode(inlineScript.code, targetVersion), inlineScript.codeStartLine - 1);
      pushEntry({
        filePath: `${filePath}#inline-${index + 1}`,
        displayPath: `${filePath} -> script inline #${index + 1}`,
        kind: 'inline-script',
        depth: depth + 1,
        found: true,
        referenceLine: inlineScript.referenceLine,
        referenceCodeLine: inlineScript.referenceCodeLine,
        referenceSourcePath: filePath,
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
          referenceCodeLine: ref.referenceCodeLine,
          referenceSourcePath: filePath,
          parentPath: filePath,
          result: null,
        });
        continue;
      }

      const resolvedResult = await analyzeFile(resolved);
      pushEntry({
        filePath: resolved,
        displayPath: `${filePath} -> ${resolved}`,
        kind: ref.kind,
        depth: depth + 1,
        found: true,
        referenceLine: ref.line,
        referenceCodeLine: ref.referenceCodeLine,
        referenceSourcePath: filePath,
        parentPath: filePath,
        result: resolvedResult,
      });

      await visitFile(resolved, depth + 1);
    }
  };

  if (!pathMap.has(normalizedRootPath)) {
    throw new Error(`No se encontro el archivo seleccionado: ${rootPath}`);
  }

  await visitFile(normalizedRootPath, 0);

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
