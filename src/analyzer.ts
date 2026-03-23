import * as acorn from 'acorn';
import {
  getMigrationRulesForTarget,
  MigrationRule,
  RuleFixType,
  RuleSeverity,
  SyntaxMode,
  TargetJQueryVersion,
} from './rules';

export interface ValidationResult {
  status: 'valid' | 'invalid' | 'not_applicable' | 'needs_context';
  message?: string;
}

export interface MigrationIssue {
  lineNumber: number;
  line: string;
  match: string;
  rule: MigrationRule;
  fixType: RuleFixType;
  suggestedLine?: string;
  note?: string;
  validation: ValidationResult;
}

export interface MigrationSummary {
  errors: number;
  warnings: number;
  info: number;
  autoFixes: number;
  contextualFixes: number;
  manualReviews: number;
}

export interface MigrationResult {
  issues: MigrationIssue[];
  totalLines: number;
  summary: MigrationSummary;
}

export interface FileAnalysisResult {
  filePath: string;
  fileName: string;
  issues: MigrationIssue[];
  totalLines: number;
  hasIssues: boolean;
  summary: MigrationSummary;
}

export interface FolderAnalysisResult {
  files: FileAnalysisResult[];
  totalFilesScanned: number;
  filesWithIssues: number;
  totalIssues: number;
  summary: MigrationSummary;
}

const ALLOWED_EXTENSIONS = ['.jsp', '.js', '.html', '.htm'];

export function isAllowedFile(filename: string): boolean {
  const extIndex = filename.lastIndexOf('.');
  if (extIndex === -1) {
    return false;
  }

  return ALLOWED_EXTENSIONS.includes(filename.slice(extIndex).toLowerCase());
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

function incrementSeverity(summary: MigrationSummary, severity: RuleSeverity): void {
  if (severity === 'error') {
    summary.errors += 1;
    return;
  }

  if (severity === 'warning') {
    summary.warnings += 1;
    return;
  }

  summary.info += 1;
}

function incrementFixType(summary: MigrationSummary, fixType: RuleFixType): void {
  if (fixType === 'auto') {
    summary.autoFixes += 1;
    return;
  }

  if (fixType === 'contextual') {
    summary.contextualFixes += 1;
    return;
  }

  summary.manualReviews += 1;
}

function parseScript(code: string): void {
  acorn.parse(code, {
    ecmaVersion: 2020,
    sourceType: 'script',
    allowHashBang: true,
    allowReturnOutsideFunction: true,
  });
}

function tryParse(code: string): string | undefined {
  try {
    parseScript(code);
    return undefined;
  } catch (error: unknown) {
    return error instanceof Error ? error.message : 'Sintaxis invalida';
  }
}

function expandReplacement(template: string, match: RegExpMatchArray): string {
  return template.replace(/\$(\d+)/g, (_fullMatch, indexText: string) => {
    const index = Number(indexText);
    return match[index] ?? '';
  });
}

function replaceMatchAtIndex(line: string, match: RegExpMatchArray, replacement: string): string {
  if (typeof match.index !== 'number' || match.index < 0) {
    return line.replace(match[0], replacement);
  }

  const matchStart = match.index;
  const matchEnd = matchStart + match[0].length;
  return `${line.slice(0, matchStart)}${replacement}${line.slice(matchEnd)}`;
}

function buildSuggestedLine(line: string, match: RegExpMatchArray, suggestedLine?: string, replacementText?: string): string | undefined {
  if (suggestedLine) {
    return suggestedLine;
  }

  if (!replacementText) {
    return undefined;
  }

  return replaceMatchAtIndex(line, match, expandReplacement(replacementText, match));
}

interface JQueryInstructionSegment {
  text: string;
  start: number;
  end: number;
}

type JQueryAlias = '$jq' | '$' | 'jQuery' | 'JQuery';

const JQUERY_PREFIXES = ['$jq', 'jQuery', 'JQuery', '$'];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectJQueryAlias(segment: string): JQueryAlias {
  if (segment.startsWith('$jq')) {
    return '$jq';
  }

  if (segment.startsWith('jQuery')) {
    return 'jQuery';
  }

  if (segment.startsWith('JQuery')) {
    return 'JQuery';
  }

  return '$';
}

function rewriteSegmentPrefix(segment: string, fromAlias: JQueryAlias): string {
  if (fromAlias === '$') {
    return segment;
  }

  const escapedAlias = escapeRegExp(fromAlias);
  const callPattern = new RegExp(`^${escapedAlias}(\\s*)\\(`);
  const staticPattern = new RegExp(`^${escapedAlias}(\\s*)\\.`);

  if (callPattern.test(segment)) {
    return segment.replace(callPattern, (_fullMatch, spacing: string) => `$${spacing}(`);
  }

  if (staticPattern.test(segment)) {
    return segment.replace(staticPattern, (_fullMatch, spacing: string) => `$${spacing}.`);
  }

  return segment;
}

function normalizeJQuerySegment(segment: string): { normalizedText: string; alias: JQueryAlias } {
  const alias = detectJQueryAlias(segment);

  return {
    normalizedText: rewriteSegmentPrefix(segment, alias),
    alias,
  };
}

function denormalizeJQuerySegment(segment: string, alias: JQueryAlias): string {
  if (alias === '$') {
    return segment;
  }

  return segment
    .replace(/^\$(\s*)\(/, (_fullMatch, spacing: string) => `${alias}${spacing}(`)
    .replace(/^\$(\s*)\./, (_fullMatch, spacing: string) => `${alias}${spacing}.`);
}

function getPrefixLengthAt(line: string, index: number): number | null {
  for (const prefix of JQUERY_PREFIXES) {
    if (line.startsWith(prefix, index)) {
      return prefix.length;
    }
  }

  return null;
}

function findInstructionEnd(line: string, start: number): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateLiteral = false;
  let inLineComment = false;
  let inBlockComment = false;
  let parenthesisDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  for (let index = start; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    const previousChar = line[index - 1];

    if (inLineComment) {
      break;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === '\'' && previousChar !== '\\') {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"' && previousChar !== '\\') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateLiteral) {
      if (char === '`' && previousChar !== '\\') {
        inTemplateLiteral = false;
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === '\'') {
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (char === '`') {
      inTemplateLiteral = true;
      continue;
    }

    if (char === '(') {
      parenthesisDepth += 1;
      continue;
    }

    if (char === ')' && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
      continue;
    }

    if (char === '[') {
      bracketDepth += 1;
      continue;
    }

    if (char === ']' && bracketDepth > 0) {
      bracketDepth -= 1;
      continue;
    }

    if (char === '{') {
      braceDepth += 1;
      continue;
    }

    if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
      continue;
    }

    if (char === ';' && parenthesisDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      return index;
    }
  }

  return line.length;
}

function extractJQueryInstructionSegments(line: string): JQueryInstructionSegment[] {
  const segments: JQueryInstructionSegment[] = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplateLiteral = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const nextChar = line[index + 1];
    const previousChar = line[index - 1];

    if (inLineComment) {
      break;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inSingleQuote) {
      if (char === '\'' && previousChar !== '\\') {
        inSingleQuote = false;
      }
      continue;
    }

    if (inDoubleQuote) {
      if (char === '"' && previousChar !== '\\') {
        inDoubleQuote = false;
      }
      continue;
    }

    if (inTemplateLiteral) {
      if (char === '`' && previousChar !== '\\') {
        inTemplateLiteral = false;
      }
      continue;
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (char === '\'') {
      inSingleQuote = true;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }

    if (char === '`') {
      inTemplateLiteral = true;
      continue;
    }

    const prefixLength = getPrefixLengthAt(line, index);
    if (!prefixLength) {
      continue;
    }

    const segmentEnd = findInstructionEnd(line, index);
    segments.push({
      text: line.slice(index, segmentEnd),
      start: index,
      end: segmentEnd,
    });

    index = segmentEnd;
    if (line[index] === ';') {
      continue;
    }

    if (index >= line.length) {
      break;
    }
  }

  return segments;
}

function replaceSegment(line: string, segment: JQueryInstructionSegment, replacement: string): string {
  return `${line.slice(0, segment.start)}${replacement}${line.slice(segment.end)}`;
}

function shouldExposeSuggestedSegment(originalSegment: string, suggestedSegment?: string): boolean {
  if (!suggestedSegment) {
    return false;
  }

  return suggestedSegment !== originalSegment;
}

function validateSuggestedLine(line: string, syntaxMode: SyntaxMode, requiresContext: boolean): ValidationResult {
  if (requiresContext) {
    return {
      status: 'needs_context',
      message: 'La propuesta necesita contexto adicional; no se valida como linea aislada.',
    };
  }

  if (syntaxMode === 'comment' || syntaxMode === 'html' || syntaxMode === 'unknown') {
    return {
      status: 'not_applicable',
      message: 'La propuesta es orientativa y no aplica validacion sintactica de JavaScript.',
    };
  }

  const candidates: string[] = [];

  if (syntaxMode === 'expression') {
    candidates.push(`(${line})`);
  } else if (syntaxMode === 'fragment') {
    candidates.push(`(function () { ${line} })();`);
  } else {
    candidates.push(line, `(function () { ${line} })();`);
  }

  let lastError = 'Sintaxis invalida';

  for (const candidate of candidates) {
    const error = tryParse(candidate);
    if (!error) {
      return { status: 'valid' };
    }

    lastError = error;
  }

  return {
    status: 'invalid',
    message: lastError,
  };
}

function summarizeIssues(issues: MigrationIssue[]): MigrationSummary {
  const summary = createEmptySummary();

  for (const issue of issues) {
    incrementSeverity(summary, issue.rule.severity);
    incrementFixType(summary, issue.fixType);
  }

  return summary;
}

export function analyzeCode(code: string, targetVersion: TargetJQueryVersion = '3.7.1'): MigrationResult {
  const lines = code.split('\n');
  const issues: MigrationIssue[] = [];
  const activeRules = getMigrationRulesForTarget(targetVersion);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const jquerySegments = extractJQueryInstructionSegments(line);

    if (jquerySegments.length === 0) {
      continue;
    }

    for (const segment of jquerySegments) {
      const normalization = normalizeJQuerySegment(segment.text);

      for (const rule of activeRules) {
        const pattern = new RegExp(rule.pattern.source, rule.pattern.flags);
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(normalization.normalizedText)) !== null) {
          const suggestion = rule.buildSuggestion(normalization.normalizedText, match);
          const normalizedSuggestedSegment = buildSuggestedLine(
            normalization.normalizedText,
            match,
            suggestion.suggestedLine,
            suggestion.replacementText,
          );
          const denormalizedSuggestedSegment = normalizedSuggestedSegment
            ? denormalizeJQuerySegment(normalizedSuggestedSegment, normalization.alias)
            : undefined;
          const suggestedSegment = shouldExposeSuggestedSegment(segment.text, denormalizedSuggestedSegment)
            ? denormalizedSuggestedSegment
            : undefined;
          const suggestedLine = suggestedSegment ? replaceSegment(line, segment, suggestedSegment) : undefined;
          const validation: ValidationResult = suggestedSegment
            ? validateSuggestedLine(suggestedSegment, suggestion.syntaxMode, Boolean(suggestion.requiresContext))
            : {
                status: suggestion.requiresContext ? 'needs_context' : 'not_applicable',
                message: suggestion.note ?? 'No hay autofix directo para esta deteccion.',
              };

          issues.push({
            lineNumber,
            line,
            match: denormalizeJQuerySegment(match[0], normalization.alias),
            rule,
            fixType: rule.fixType,
            suggestedLine,
            note: suggestion.note,
            validation,
          });

          if (match[0].length === 0) {
            pattern.lastIndex += 1;
          }
        }
      }
    }
  }

  return {
    issues,
    totalLines: lines.length,
    summary: summarizeIssues(issues),
  };
}

export async function analyzeFiles(files: FileList, targetVersion: TargetJQueryVersion = '3.7.1'): Promise<FolderAnalysisResult> {
  const fileResults: FileAnalysisResult[] = [];
  let totalFilesScanned = 0;

  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!isAllowedFile(file.name)) {
      continue;
    }

    totalFilesScanned += 1;
    const content = await file.text();
    const result = analyzeCode(content, targetVersion);

    fileResults.push({
      filePath: file.webkitRelativePath || file.name,
      fileName: file.name,
      issues: result.issues,
      totalLines: result.totalLines,
      hasIssues: result.issues.length > 0,
      summary: result.summary,
    });
  }

  const summary = createEmptySummary();
  let totalIssues = 0;

  for (const file of fileResults) {
    totalIssues += file.issues.length;
    summary.errors += file.summary.errors;
    summary.warnings += file.summary.warnings;
    summary.info += file.summary.info;
    summary.autoFixes += file.summary.autoFixes;
    summary.contextualFixes += file.summary.contextualFixes;
    summary.manualReviews += file.summary.manualReviews;
  }

  return {
    files: fileResults,
    totalFilesScanned,
    filesWithIssues: fileResults.filter((file) => file.hasIssues).length,
    totalIssues,
    summary,
  };
}
