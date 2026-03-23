export type RuleSeverity = 'warning' | 'error' | 'info';
export type RuleSourceType = 'api-deprecated' | 'api-removed' | 'upgrade-guide' | 'release-note';
export type RuleFixType = 'auto' | 'contextual' | 'manual';
export type SyntaxMode = 'statement' | 'expression' | 'fragment' | 'html' | 'comment' | 'unknown';
export type Confidence = 'high' | 'medium' | 'low';
export type TargetJQueryVersion = '3.0.0' | '3.7.1';

export interface MigrationSuggestion {
  replacementText?: string;
  suggestedLine?: string;
  note?: string;
  syntaxMode: SyntaxMode;
  confidence: Confidence;
  requiresContext?: boolean;
}

export interface MigrationRule {
  id: string;
  name: string;
  description: string;
  severity: RuleSeverity;
  sourceType: RuleSourceType;
  sourceUrl: string;
  sinceVersion: string;
  fixType: RuleFixType;
  pattern: RegExp;
  buildSuggestion: (line: string, match: RegExpMatchArray) => MigrationSuggestion;
}

const UPGRADE_19 = 'https://jquery.com/upgrade-guide/1.9/';
const UPGRADE_30 = 'https://jquery.com/upgrade-guide/3.0/';
const UPGRADE_35 = 'https://jquery.com/upgrade-guide/3.5/';
const RELEASE_370 = 'https://blog.jquery.com/2023/05/11/jquery-3-7-0-released-staying-in-order/';
const RELEASE_371 = 'https://blog.jquery.com/2023/08/28/jquery-3-7-1-released-reliable-table-row-dimensions/';

function replaceRule(config: Omit<MigrationRule, 'buildSuggestion'> & { replacement: string; syntaxMode?: SyntaxMode; confidence?: Confidence; requiresContext?: boolean }): MigrationRule {
  return {
    ...config,
    buildSuggestion: () => ({
      replacementText: config.replacement,
      syntaxMode: config.syntaxMode ?? 'statement',
      confidence: config.confidence ?? 'high',
      requiresContext: config.requiresContext,
    }),
  };
}

function noteRule(config: Omit<MigrationRule, 'buildSuggestion'> & {
  note: string;
  syntaxMode?: SyntaxMode;
  confidence?: Confidence;
  requiresContext?: boolean;
  deriveSuggestedLine?: (line: string, match: RegExpMatchArray) => string | undefined;
}): MigrationRule {
  return {
    ...config,
    buildSuggestion: (line, match) => ({
      suggestedLine: config.deriveSuggestedLine ? config.deriveSuggestedLine(line, match) : undefined,
      note: config.note,
      syntaxMode: config.syntaxMode ?? 'comment',
      confidence: config.confidence ?? 'medium',
      requiresContext: config.requiresContext,
    }),
  };
}

function toNumericIndex(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    return null;
  }

  return Number.parseInt(trimmed, 10);
}

type DeprecatedSelectorPseudo = 'eq' | 'gt' | 'lt' | 'first' | 'last' | 'even' | 'odd';

interface DeprecatedSelectorToken {
  name: DeprecatedSelectorPseudo;
  start: number;
  end: number;
  arg?: string;
}

function isSelectorIdentifierChar(value: string): boolean {
  return /[A-Za-z0-9_-]/.test(value);
}

function hasTopLevelComma(selector: string): boolean {
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: 'single' | 'double' | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    const previousChar = selector[index - 1];

    if (quote) {
      if (quote === 'single' && char === '\'' && previousChar !== '\\') {
        quote = null;
      } else if (quote === 'double' && char === '"' && previousChar !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '\'') {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
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

    if (char === '(' && bracketDepth === 0) {
      parenDepth += 1;
      continue;
    }

    if (char === ')' && bracketDepth === 0 && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (char === ',' && bracketDepth === 0 && parenDepth === 0) {
      return true;
    }
  }

  return false;
}

function findDeprecatedSelectorTokens(selector: string): DeprecatedSelectorToken[] {
  const tokens: DeprecatedSelectorToken[] = [];
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: 'single' | 'double' | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    const previousChar = selector[index - 1];

    if (quote) {
      if (quote === 'single' && char === '\'' && previousChar !== '\\') {
        quote = null;
      } else if (quote === 'double' && char === '"' && previousChar !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '\'') {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
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

    if (char === '(' && bracketDepth === 0) {
      parenDepth += 1;
      continue;
    }

    if (char === ')' && bracketDepth === 0 && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (char !== ':' || bracketDepth !== 0 || parenDepth !== 0 || previousChar === ':') {
      continue;
    }

    let cursor = index + 1;
    while (cursor < selector.length && /[A-Za-z-]/.test(selector[cursor])) {
      cursor += 1;
    }

    const pseudoName = selector.slice(index + 1, cursor);
    if (pseudoName === 'first' || pseudoName === 'last' || pseudoName === 'even' || pseudoName === 'odd') {
      if (cursor < selector.length && isSelectorIdentifierChar(selector[cursor])) {
        continue;
      }

      tokens.push({
        name: pseudoName,
        start: index,
        end: cursor,
      });
      index = cursor - 1;
      continue;
    }

    if (pseudoName !== 'eq' && pseudoName !== 'gt' && pseudoName !== 'lt') {
      continue;
    }

    let argumentCursor = cursor;
    while (argumentCursor < selector.length && /\s/.test(selector[argumentCursor])) {
      argumentCursor += 1;
    }

    if (selector[argumentCursor] !== '(') {
      continue;
    }

    const argumentStart = argumentCursor + 1;
    let localDepth = 1;
    argumentCursor += 1;

    while (argumentCursor < selector.length && localDepth > 0) {
      if (selector[argumentCursor] === '(') {
        localDepth += 1;
      } else if (selector[argumentCursor] === ')') {
        localDepth -= 1;
      }

      argumentCursor += 1;
    }

    if (localDepth !== 0) {
      continue;
    }

    const argumentEnd = argumentCursor - 1;
    tokens.push({
      name: pseudoName,
      start: index,
      end: argumentCursor,
      arg: selector.slice(argumentStart, argumentEnd).trim(),
    });
    index = argumentCursor - 1;
  }

  return tokens;
}

function areDeprecatedTokensTrailing(selector: string, tokens: DeprecatedSelectorToken[]): boolean {
  if (tokens.length === 0) {
    return false;
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const nextToken = tokens[index + 1];
    const trailingSlice = nextToken
      ? selector.slice(current.end, nextToken.start)
      : selector.slice(current.end);

    if (trailingSlice.trim() !== '') {
      return false;
    }
  }

  return true;
}

function buildSelectorMigration(
  selector: string,
  options: { allowNonTrailing?: boolean } = {},
): { selector: string; chain: string } | undefined {
  if (hasTopLevelComma(selector)) {
    return undefined;
  }

  const deprecatedTokens = findDeprecatedSelectorTokens(selector);
  if (deprecatedTokens.length === 0) {
    return undefined;
  }

  if (!options.allowNonTrailing && !areDeprecatedTokensTrailing(selector, deprecatedTokens)) {
    return undefined;
  }

  const chainParts: string[] = [];

  for (const token of deprecatedTokens) {
    if (token.name === 'first') {
      chainParts.push('.first()');
      continue;
    }

    if (token.name === 'last') {
      chainParts.push('.last()');
      continue;
    }

    if (token.name === 'even') {
      chainParts.push('.filter((index) => index % 2 === 0)');
      continue;
    }

    if (token.name === 'odd') {
      chainParts.push('.filter((index) => index % 2 === 1)');
      continue;
    }

    const rawArg = (token.arg ?? '').trim();
    if (!rawArg) {
      return undefined;
    }

    const numericArg = toNumericIndex(rawArg);
    if (token.name === 'eq') {
      chainParts.push(`.eq(${rawArg})`);
    } else if (token.name === 'gt') {
      if (numericArg !== null) {
        chainParts.push(`.slice(${numericArg + 1})`);
      } else {
        chainParts.push(`.filter((index) => index > (${rawArg}))`);
      }
    } else if (numericArg !== null) {
      chainParts.push(`.slice(0, ${numericArg})`);
    } else {
      chainParts.push(`.filter((index) => index < (${rawArg}))`);
    }
  }

  const baseBeforeDeprecatedPseudo = selector.slice(0, deprecatedTokens[0].start);
  const shouldAppendUniversalSelector = /(?:\s|[>+~])$/.test(baseBeforeDeprecatedPseudo);

  let cleanedSelector = selector;
  for (let index = deprecatedTokens.length - 1; index >= 0; index -= 1) {
    const token = deprecatedTokens[index];
    cleanedSelector = `${cleanedSelector.slice(0, token.start)}${cleanedSelector.slice(token.end)}`;
  }

  cleanedSelector = cleanedSelector.replace(/\s{2,}/g, ' ').trim();
  if (shouldAppendUniversalSelector && cleanedSelector) {
    cleanedSelector = `${cleanedSelector} *`;
  }

  return {
    selector: cleanedSelector || '*',
    chain: chainParts.join(''),
  };
}

function replaceMatchedText(line: string, match: RegExpMatchArray, replacement: string): string {
  if (typeof match.index !== 'number' || match.index < 0) {
    return line.replace(match[0], replacement);
  }

  const start = match.index;
  const end = start + match[0].length;
  return `${line.slice(0, start)}${replacement}${line.slice(end)}`;
}

type SelectorCallKind = 'root' | 'filter' | 'is' | 'not' | 'selector-method' | 'event-selector';

interface SelectorCallMatch {
  kind: SelectorCallKind;
  start: number;
  end: number;
  selectorStart: number;
  selectorEnd: number;
  selector: string;
  quote: string;
  callPrefix: string;
  callSuffix: string;
}

function getSelectorRangeInCall(
  fullCall: string,
  quote: string,
  selector: string,
  callStart: number,
): { selectorStart: number; selectorEnd: number } | undefined {
  const selectorLiteral = `${quote}${selector}${quote}`;
  const literalStart = fullCall.indexOf(selectorLiteral);
  if (literalStart === -1) {
    return undefined;
  }

  const selectorStart = callStart + literalStart + 1;
  return {
    selectorStart,
    selectorEnd: selectorStart + selector.length,
  };
}

function buildSelectorCallExpression(call: SelectorCallMatch, selector: string): string {
  return `${call.callPrefix}${selector}${call.callSuffix}`;
}

function splitTopLevelSelectorGroups(selector: string): string[] {
  const groups: string[] = [];
  let startIndex = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: 'single' | 'double' | null = null;

  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    const previousChar = selector[index - 1];

    if (quote) {
      if (quote === 'single' && char === '\'' && previousChar !== '\\') {
        quote = null;
      } else if (quote === 'double' && char === '"' && previousChar !== '\\') {
        quote = null;
      }
      continue;
    }

    if (char === '\'') {
      quote = 'single';
      continue;
    }

    if (char === '"') {
      quote = 'double';
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

    if (char === '(' && bracketDepth === 0) {
      parenDepth += 1;
      continue;
    }

    if (char === ')' && bracketDepth === 0 && parenDepth > 0) {
      parenDepth -= 1;
      continue;
    }

    if (char === ',' && bracketDepth === 0 && parenDepth === 0) {
      groups.push(selector.slice(startIndex, index).trim());
      startIndex = index + 1;
    }
  }

  groups.push(selector.slice(startIndex).trim());
  return groups.filter((group) => group.length > 0);
}

function collectSelectorCalls(line: string): SelectorCallMatch[] {
  const calls: SelectorCallMatch[] = [];
  const callPattern = /(?:\$jq|jQuery|JQuery|\$)\s*\(\s*(['"`])([^'"`]*)\1\s*\)|\.(find|filter|is|not|children|parents|closest|siblings|next|nextAll|nextUntil|prev|prevAll|prevUntil|has|add)\s*\(\s*(['"`])([^'"`]*)\4\s*\)|\.(?:on|one|off)\s*\(\s*(['"`])([^'"`]*)\6\s*,\s*(['"`])([^'"`]*)\8\s*(?:,|\))/g;
  let match: RegExpExecArray | null;

  while ((match = callPattern.exec(line)) !== null) {
    const fullCall = match[0];
    const callStart = match.index;
    const callEnd = callStart + fullCall.length;
    const method = match[3];
    const isEventSelector = Boolean(match[6]);
    const quote = isEventSelector ? match[8] : (match[1] ?? match[4]);
    const selector = isEventSelector ? (match[9] ?? '') : (match[2] ?? match[5] ?? '');

    if (!quote) {
      continue;
    }

    const selectorRange = getSelectorRangeInCall(fullCall, quote, selector, callStart);
    if (!selectorRange) {
      continue;
    }

    const selectorLocalStart = selectorRange.selectorStart - callStart;
    const selectorLocalEnd = selectorRange.selectorEnd - callStart;

    calls.push({
      kind: isEventSelector
        ? 'event-selector'
        : (method === 'filter' || method === 'is' || method === 'not'
            ? method
            : (method ? 'selector-method' : 'root')),
      start: callStart,
      end: callEnd,
      selectorStart: selectorRange.selectorStart,
      selectorEnd: selectorRange.selectorEnd,
      selector,
      quote,
      callPrefix: fullCall.slice(0, selectorLocalStart),
      callSuffix: fullCall.slice(selectorLocalEnd),
    });
  }

  return calls;
}

function rewriteSelectorCallWithChain(
  line: string,
  call: SelectorCallMatch,
  migration: { selector: string; chain: string },
): string {
  const updatedCall = buildSelectorCallExpression(call, migration.selector);
  return `${line.slice(0, call.start)}${updatedCall}${migration.chain}${line.slice(call.end)}`;
}

function rewriteRootSelectorGroupsCall(line: string, call: SelectorCallMatch): string | undefined {
  if (call.kind !== 'root' || !hasTopLevelComma(call.selector)) {
    return undefined;
  }

  const selectorGroups = splitTopLevelSelectorGroups(call.selector);
  if (selectorGroups.length < 2) {
    return undefined;
  }

  const groupExpressions = selectorGroups.map((group) => {
    const migration = buildSelectorMigration(group);
    const selectorCall = buildSelectorCallExpression(call, migration ? migration.selector : group);
    return migration ? `${selectorCall}${migration.chain}` : selectorCall;
  });

  if (groupExpressions.length === 0) {
    return undefined;
  }

  const combinedExpression = `${groupExpressions[0]}${groupExpressions.slice(1).map((groupExpression) => `.add(${groupExpression})`).join('')}`;
  return `${line.slice(0, call.start)}${combinedExpression}${line.slice(call.end)}`;
}

function rewriteRootNotPseudoSelectorCall(line: string, call: SelectorCallMatch): string | undefined {
  if (call.kind !== 'root') {
    return undefined;
  }

  const notPseudoMatch = call.selector.match(/^(.*):not\(\s*(:(?:eq|gt|lt)\s*\([^)]*\)|:(?:first|last|even|odd))\s*\)\s*$/);
  if (!notPseudoMatch) {
    return undefined;
  }

  const baseSelector = notPseudoMatch[1].trim() || '*';
  const notMigration = buildNotSelectorMigration(notPseudoMatch[2]);
  if (!notMigration) {
    return undefined;
  }

  const baseCall = buildSelectorCallExpression(call, baseSelector);
  const rewrittenCall = `${baseCall}${notMigration}`;
  return `${line.slice(0, call.start)}${rewrittenCall}${line.slice(call.end)}`;
}

function rewriteFilterSelectorCall(
  line: string,
  call: SelectorCallMatch,
  migration: { selector: string; chain: string },
): string {
  const replacement = migration.selector === '*'
    ? migration.chain
    : `.filter(${call.quote}${migration.selector}${call.quote})${migration.chain}`;

  return `${line.slice(0, call.start)}${replacement}${line.slice(call.end)}`;
}

function rewriteIsSelectorCall(
  line: string,
  call: SelectorCallMatch,
  migration: { selector: string; chain: string },
): string {
  const baseFilter = migration.selector === '*'
    ? ''
    : `.filter(${call.quote}${migration.selector}${call.quote})`;
  const replacement = `${baseFilter}${migration.chain}.length > 0`;

  return `${line.slice(0, call.start)}${replacement}${line.slice(call.end)}`;
}

function buildNotSelectorMigration(selector: string): string | undefined {
  const trimmed = selector.trim();
  const shorthand = trimmed.match(/^:(first|last|even|odd)$/);
  if (shorthand) {
    const token = shorthand[1];
    if (token === 'first') {
      return '.slice(1)';
    }

    if (token === 'last') {
      return '.slice(0, -1)';
    }

    if (token === 'even') {
      return '.filter((index) => index % 2 === 1)';
    }

    return '.filter((index) => index % 2 === 0)';
  }

  const numericPseudo = trimmed.match(/^:(eq|gt|lt)\s*\(([^)]+)\)$/);
  if (!numericPseudo) {
    return undefined;
  }

  const method = numericPseudo[1];
  const rawArg = numericPseudo[2].trim();
  const numericArg = toNumericIndex(rawArg);

  if (method === 'eq') {
    return `.filter((index) => index !== (${rawArg}))`;
  }

  if (method === 'gt') {
    if (numericArg !== null) {
      return `.slice(0, ${numericArg + 1})`;
    }

    return `.filter((index) => index <= (${rawArg}))`;
  }

  if (numericArg !== null) {
    return `.slice(${numericArg})`;
  }

  return `.filter((index) => index >= (${rawArg}))`;
}

function buildNotSelectorPredicate(selector: string, quote: string): string | undefined {
  const trimmed = selector.trim();
  const pseudoMatch = trimmed.match(/^(.*?)(:(eq|gt|lt)\s*\(([^)]+)\)|:(first|last|even|odd))$/);
  if (!pseudoMatch) {
    return undefined;
  }

  const rawSelectorPrefix = pseudoMatch[1].trim();
  const method = pseudoMatch[3] ?? pseudoMatch[5];
  const rawArg = pseudoMatch[4]?.trim();
  let indexPredicate: string | undefined;

  if (method === 'first') {
    indexPredicate = 'index === 0';
  } else if (method === 'last') {
    return undefined;
  } else if (method === 'even') {
    indexPredicate = 'index % 2 === 0';
  } else if (method === 'odd') {
    indexPredicate = 'index % 2 === 1';
  } else if (method === 'eq' && rawArg) {
    indexPredicate = `index === (${rawArg})`;
  } else if (method === 'gt' && rawArg) {
    indexPredicate = `index > (${rawArg})`;
  } else if (method === 'lt' && rawArg) {
    indexPredicate = `index < (${rawArg})`;
  }

  if (!indexPredicate) {
    return undefined;
  }

  if (!rawSelectorPrefix) {
    return indexPredicate;
  }

  return `$(element).is(${quote}${rawSelectorPrefix}${quote}) && ${indexPredicate}`;
}

function rewriteNotSelectorCall(
  line: string,
  call: SelectorCallMatch,
): string | undefined {
  const replacement = buildNotSelectorMigration(call.selector);
  if (replacement) {
    return `${line.slice(0, call.start)}${replacement}${line.slice(call.end)}`;
  }

  const predicate = buildNotSelectorPredicate(call.selector, call.quote);
  if (!predicate) {
    return undefined;
  }

  return `${line.slice(0, call.start)}.not((index, element) => ${predicate})${line.slice(call.end)}`;
}

function buildDeprecatedPseudoCssFallback(token: string): string {
  const trimmedToken = token.trim();

  if (trimmedToken === ':first') {
    return ':first-child';
  }

  if (trimmedToken === ':last') {
    return ':last-child';
  }

  if (trimmedToken === ':even') {
    return ':nth-child(odd)';
  }

  if (trimmedToken === ':odd') {
    return ':nth-child(even)';
  }

  const numericMatch = trimmedToken.match(/^:(eq|gt|lt)\s*\(([^)]*)\)$/);
  if (!numericMatch) {
    return ':nth-child(1)';
  }

  const method = numericMatch[1];
  const rawArg = numericMatch[2].trim();
  const numericArg = toNumericIndex(rawArg);

  if (numericArg === null) {
    return ':nth-child(1)';
  }

  if (method === 'eq') {
    if (numericArg >= 0) {
      return `:nth-child(${numericArg + 1})`;
    }

    return `:nth-last-child(${Math.abs(numericArg)})`;
  }

  if (method === 'gt') {
    if (numericArg < 0) {
      return ':nth-child(n)';
    }

    return `:nth-child(n+${numericArg + 2})`;
  }

  if (numericArg <= 0) {
    return ':not(*)';
  }

  return `:nth-child(-n+${numericArg})`;
}

function rewriteDeprecatedSelectorUsage(line: string, match: RegExpMatchArray): string | undefined {
  const fallbackReplacement = buildDeprecatedPseudoCssFallback(match[0]);

  const matchIndex = typeof match.index === 'number' ? match.index : -1;
  if (matchIndex < 0) {
    return replaceMatchedText(line, match, fallbackReplacement);
  }

  const selectorCall = collectSelectorCalls(line).find(
    (candidate) => matchIndex >= candidate.selectorStart && matchIndex < candidate.selectorEnd,
  );

  if (!selectorCall) {
    return replaceMatchedText(line, match, fallbackReplacement);
  }

  const rootGroupRewrite = rewriteRootSelectorGroupsCall(line, selectorCall);
  if (rootGroupRewrite) {
    return rootGroupRewrite;
  }

  const rootNotRewrite = rewriteRootNotPseudoSelectorCall(line, selectorCall);
  if (rootNotRewrite) {
    return rootNotRewrite;
  }

  const migration = buildSelectorMigration(selectorCall.selector);
  const migrationCandidate = migration
    ?? (selectorCall.kind === 'root' ? buildSelectorMigration(selectorCall.selector, { allowNonTrailing: true }) : undefined);

  if (!migrationCandidate) {
    return replaceMatchedText(line, match, fallbackReplacement);
  }

  if (selectorCall.kind === 'filter') {
    return rewriteFilterSelectorCall(line, selectorCall, migrationCandidate);
  }

  if (selectorCall.kind === 'is') {
    return rewriteIsSelectorCall(line, selectorCall, migrationCandidate);
  }

  if (selectorCall.kind === 'not') {
    return rewriteNotSelectorCall(line, selectorCall) ?? replaceMatchedText(line, match, fallbackReplacement);
  }

  if (selectorCall.kind === 'event-selector') {
    return replaceMatchedText(line, match, fallbackReplacement);
  }

  return rewriteSelectorCallWithChain(line, selectorCall, migrationCandidate);
}

function extractSelectorLiteral(expression: string): string | undefined {
  const trimmed = expression.trim();
  const selectorCall = trimmed.match(/^(?:\$jq|\$|jQuery|JQuery)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1\s*\)$/);
  if (!selectorCall) {
    return undefined;
  }

  return `${selectorCall[1]}${selectorCall[2]}${selectorCall[1]}`;
}

function buildLiveDelegateReplacement(line: string, match: RegExpMatchArray, method: 'on' | 'off'): string {
  const indentation = match[1] ?? '';
  const originalTarget = (match[2] ?? '').trim();
  const selectorLiteral = extractSelectorLiteral(originalTarget) ?? '/* selector */';
  const eventName = match[3] ?? '';
  return replaceMatchedText(line, match, `${indentation}$(document).${method}(${eventName}, ${selectorLiteral}, `);
}

function inferDieNoArgsEvents(selectorLiteral: string): string {
  const unquotedSelector = selectorLiteral.slice(1, -1).trim().toLowerCase();

  if (/(^|\s|[>+~])(?:input|select|textarea)(?:\b|\[)/.test(unquotedSelector)) {
    return 'change click';
  }

  if (/(^|\s|[>+~])form\b/.test(unquotedSelector)) {
    return 'submit';
  }

  return 'click';
}

function buildDieWithoutArgsReplacement(line: string, match: RegExpMatchArray): string {
  const indentation = match[1] ?? '';
  const originalTarget = (match[2] ?? '').trim();
  const selectorLiteral = extractSelectorLiteral(originalTarget) ?? '/* selector */';
  const quote = selectorLiteral[0] === '"' || selectorLiteral[0] === '\'' || selectorLiteral[0] === '`'
    ? selectorLiteral[0]
    : '\'';
  const inferredEvents = inferDieNoArgsEvents(selectorLiteral);
  return replaceMatchedText(line, match, `${indentation}$(document).off(${quote}${inferredEvents}${quote}, ${selectorLiteral})`);
}

function buildDieOneArgReplacement(line: string, match: RegExpMatchArray): string {
  const indentation = match[1] ?? '';
  const originalTarget = (match[2] ?? '').trim();
  const eventName = match[3] ?? '/* event */';
  const selectorLiteral = extractSelectorLiteral(originalTarget) ?? '/* selector */';
  return replaceMatchedText(line, match, `${indentation}$(document).off(${eventName}, ${selectorLiteral})`);
}

function rewriteHoverCall(line: string): string | undefined {
  const dualHandler = line.match(/\.hover\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/);
  if (dualHandler) {
    return line.replace(dualHandler[0], `.on("mouseenter", ${dualHandler[1].trim()}).on("mouseleave", ${dualHandler[2].trim()})`);
  }

  const singleHandler = line.match(/\.hover\s*\(\s*([^)]+?)\s*\)/);
  if (singleHandler) {
    return line.replace(singleHandler[0], `.on("mouseenter", ${singleHandler[1].trim()}).on("mouseleave", ${singleHandler[1].trim()})`);
  }

  return undefined;
}

function rewriteBrowserDetectionUsage(line: string, match: RegExpMatchArray): string {
  const browserToken = match[0].slice('$.browser'.length).replace(/^\./, '');

  if (browserToken === 'msie') {
    return replaceMatchedText(line, match, 'document.documentMode !== undefined');
  }

  if (browserToken === 'mozilla') {
    return replaceMatchedText(line, match, `'InstallTrigger' in window`);
  }

  if (browserToken === 'webkit') {
    return replaceMatchedText(line, match, `'WebkitAppearance' in document.documentElement.style`);
  }

  if (browserToken === 'opera') {
    return replaceMatchedText(line, match, `('opr' in window || 'opera' in window)`);
  }

  if (browserToken === 'safari') {
    return replaceMatchedText(line, match, '/^((?!chrome|android).)*safari/i.test(navigator.userAgent)');
  }

  return replaceMatchedText(line, match, 'navigator.userAgent');
}

function rewriteSupportDetectionUsage(line: string, match: RegExpMatchArray): string {
  const token = match[0].slice('$.support'.length).replace(/^\./, '');

  if (token === 'boxModel') {
    return replaceMatchedText(line, match, `document.compatMode === 'CSS1Compat'`);
  }

  if (token === 'opacity') {
    return replaceMatchedText(line, match, `window.CSS?.supports?.('opacity', '0.5') ?? true`);
  }

  return replaceMatchedText(line, match, `window.CSS?.supports?.('display', 'block') ?? true`);
}

function rewriteFindTokenizeUsage(line: string, match: RegExpMatchArray): string {
  return replaceMatchedText(line, match, 'jQuery.find.tokenize.bind(jQuery.find)');
}

function appendUniqueSortAfterTraversalCall(line: string, match: RegExpMatchArray): string | undefined {
  if (match[0].includes('.uniqueSort(')) {
    return undefined;
  }

  return replaceMatchedText(line, match, `${match[0]}.uniqueSort()`);
}

const shorthandEvents = [
  'blur',
  'change',
  'click',
  'contextmenu',
  'dblclick',
  'focus',
  'focusin',
  'focusout',
  'keydown',
  'keypress',
  'keyup',
  'mousedown',
  'mouseenter',
  'mouseleave',
  'mousemove',
  'mouseout',
  'mouseover',
  'mouseup',
  'resize',
  'scroll',
  'select',
  'submit',
];

const shorthandHandlerRules: MigrationRule[] = shorthandEvents.flatMap((eventName) => [
  {
    id: `jquery-${eventName}-handler-deprecated`,
    name: `.${eventName}() deprecated`,
    description: `.${eventName}(fn) fue depreciado en jQuery 3.3. Use .on("${eventName}", fn).`,
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'auto',
    pattern: new RegExp(`\\.${eventName}\\s*\\(\\s*(?!\\))`, 'g'),
    buildSuggestion: () => ({
      replacementText: `.on("${eventName}", `,
      syntaxMode: 'statement' as SyntaxMode,
      confidence: 'high' as Confidence,
    }),
  },
  {
    id: `jquery-${eventName}-trigger-deprecated`,
    name: `.${eventName}() trigger shorthand deprecated`,
    description: `.${eventName}() sin argumentos fue depreciado en jQuery 3.3. Use .trigger("${eventName}").`,
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'auto',
    pattern: new RegExp(`\\.${eventName}\\s*\\(\\s*\\)`, 'g'),
    buildSuggestion: () => ({
      replacementText: `.trigger("${eventName}")`,
      syntaxMode: 'statement' as SyntaxMode,
      confidence: 'high' as Confidence,
    }),
  },
]);

export const migrationRules: MigrationRule[] = [
  {
    id: 'jquery-live-removed',
    name: '.live() removed',
    description: '.live() fue eliminado y debe migrarse a delegacion con $(document).on(event, selector, handler).',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'contextual',
    pattern: /^(\s*)(.+?)\.live\s*\(\s*(['"`][^'"`]+['"`])\s*,\s*/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: buildLiveDelegateReplacement(line, match, 'on'),
      syntaxMode: 'fragment',
      confidence: 'high',
      requiresContext: true,
    }),
  },
  {
    id: 'jquery-die-removed',
    name: '.die() removed',
    description: '.die() fue eliminado y debe migrarse a $(document).off(event, selector).',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'contextual',
    pattern: /^(\s*)(.+?)\.die\s*\(\s*(['"`][^'"`]+['"`])\s*,\s*/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: buildLiveDelegateReplacement(line, match, 'off'),
      syntaxMode: 'fragment',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  {
    id: 'jquery-die-single-event-removed',
    name: '.die(event) removed',
    description: '.die(event) fue eliminado y debe migrarse a $(document).off(event, selector).',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'contextual',
    pattern: /^(\s*)(.+?)\.die\s*\(\s*(['"`][^'"`]+['"`])\s*\)/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: buildDieOneArgReplacement(line, match),
      syntaxMode: 'statement',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  {
    id: 'jquery-die-noargs-removed',
    name: '.die() no-args removed',
    description: '.die() fue eliminado y debe migrarse a $(document).off(event, selector).',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'contextual',
    pattern: /^(\s*)(.+?)\.die\s*\(\s*\)/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: buildDieWithoutArgsReplacement(line, match),
      syntaxMode: 'statement',
      confidence: 'low',
      requiresContext: true,
    }),
  },
  noteRule({
    id: 'jquery-attr-boolean-property',
    name: '.attr(boolean, value) should use .prop',
    description: 'Para propiedades booleanas use .prop(name, value) en lugar de .attr(name, value).',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'contextual',
    pattern: /\.attr\s*\(\s*['"`](checked|selected|readonly|disabled|multiple)['"`]\s*,\s*(true|false)\s*\)/g,
    note: 'Use .prop(name, value) para reflejar estado booleano real del elemento.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `.prop('${match[1]}', ${match[2]})`),
    syntaxMode: 'statement',
    confidence: 'high',
  }),
  replaceRule({
    id: 'jquery-andself-removed',
    name: '.andSelf() removed',
    description: '.andSelf() fue eliminado. Use .addBack().',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_30,
    sinceVersion: '1.8',
    fixType: 'auto',
    pattern: /\.andSelf\s*\(\s*\)/g,
    replacement: '.addBack()',
  }),
  replaceRule({
    id: 'jquery-size-removed',
    name: '.size() removed',
    description: '.size() fue eliminado. Use .length.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_30,
    sinceVersion: '1.8',
    fixType: 'auto',
    pattern: /\.size\s*\(\s*\)/g,
    replacement: '.length',
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-toggle-function-removed',
    name: '.toggle(fn, fn) removed',
    description: '.toggle(fn, fn) fue eliminado. Requiere reescritura a eventos click.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.8',
    fixType: 'manual',
    pattern: /\.toggle\s*\(\s*function/g,
    note: 'Reescriba con estado explicito y .on("click", handler). No existe reemplazo 1:1 seguro.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '.on("click", function'),
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-sub-removed',
    name: 'jQuery.sub() removed',
    description: 'jQuery.sub() fue eliminado y no tiene reemplazo directo en core.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.7/',
    sinceVersion: '1.7',
    fixType: 'manual',
    pattern: /\$\.sub\s*\(\s*\)/g,
    note: 'Revisar el patron de extension de jQuery. No hay autofix seguro.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, 'jQuery'),
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-selector-property-removed',
    name: '.selector removed',
    description: '.selector fue eliminado.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.7/',
    sinceVersion: '1.7',
    fixType: 'manual',
    pattern: /\.selector\b/g,
    note: 'Elimine la dependencia de .selector; ya no representa de forma fiable la consulta original.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '.get(0)'),
  }),
  noteRule({
    id: 'jquery-context-property-removed',
    name: '.context removed',
    description: '.context fue eliminado.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.10-and-2.0/',
    sinceVersion: '1.10/2.0',
    fixType: 'manual',
    pattern: /\.context\b/g,
    note: 'Reemplace el acceso a .context por una referencia explicita al nodo o documento.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '.get(0)?.ownerDocument ?? document'),
  }),
  noteRule({
    id: 'jquery-deferred-state-removed',
    name: 'deferred.isRejected()/isResolved() removed',
    description: 'Los metodos deferred.isRejected()/isResolved() fueron eliminados.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.7/',
    sinceVersion: '1.7',
    fixType: 'manual',
    pattern: /\.(isRejected|isResolved)\s*\(\s*\)/g,
    note: 'Reestructure el flujo asyncrono con promesas/handlers explicitos.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `.state() === "${match[1] === 'isRejected' ? 'rejected' : 'resolved'}"`),
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-browser-removed',
    name: 'jQuery.browser removed',
    description: 'jQuery.browser fue eliminado; use feature detection.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'manual',
    pattern: /\$\.browser\b(?:\.[A-Za-z_$][\w$]*)?/g,
    note: 'Reemplace la deteccion por capacidades del navegador o APIs nativas.',
    deriveSuggestedLine: (line, match) => rewriteBrowserDetectionUsage(line, match),
  }),
  noteRule({
    id: 'jquery-boxmodel-removed',
    name: 'jQuery.boxModel removed',
    description: 'jQuery.boxModel fue eliminado.',
    severity: 'error',
    sourceType: 'api-removed',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.3/',
    sinceVersion: '1.3',
    fixType: 'manual',
    pattern: /\$\.boxModel\b/g,
    note: 'Elimine esa dependencia; el soporte historico de box model ya no aplica.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `document.compatMode === 'CSS1Compat'`),
  }),
  noteRule({
    id: 'jquery-support-removed',
    name: 'jQuery.support deprecated/removed',
    description: 'jQuery.support ya no debe usarse desde codigo de aplicacion.',
    severity: 'error',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.9/',
    sinceVersion: '1.9',
    fixType: 'manual',
    pattern: /\$\.support\b(?:\.[A-Za-z_$][\w$]*)?/g,
    note: 'Use feature detection moderna o una comprobacion explicita del API requerido.',
    deriveSuggestedLine: (line, match) => rewriteSupportDetectionUsage(line, match),
  }),
  {
    id: 'jquery-ready-deprecated',
    name: '.ready() deprecated',
    description: 'La forma recomendada desde jQuery 3 es $(fn).',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'contextual',
    pattern: /^(\s*)(?:\$\s*\(\s*document\s*\)|\$\s*\(\s*[^)]*\s*\)|\$\s*\(\s*\s*\))\.ready\s*\(\s*/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: replaceMatchedText(line, match, `${match[1]}$(`),
      syntaxMode: 'fragment',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  replaceRule({
    id: 'jquery-bind-deprecated',
    name: '.bind() deprecated',
    description: '.bind() fue depreciado. Use .on().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.bind\s*\(/g,
    replacement: '.on(',
  }),
  replaceRule({
    id: 'jquery-unbind-deprecated',
    name: '.unbind() deprecated',
    description: '.unbind() fue depreciado. Use .off().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.unbind\s*\(/g,
    replacement: '.off(',
  }),
  {
    id: 'jquery-delegate-deprecated',
    name: '.delegate() deprecated',
    description: '.delegate() fue depreciado. Use .on(event, selector, handler).',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'contextual',
    pattern: /\.delegate\s*\(\s*(['"`][^'"`]+['"`])\s*,\s*(['"`][^'"`]+['"`])\s*,\s*/g,
    buildSuggestion: (_line, match) => ({
      replacementText: `.on(${match[2]}, ${match[1]}, `,
      syntaxMode: 'fragment',
      confidence: 'high',
      requiresContext: true,
    }),
  },
  {
    id: 'jquery-undelegate-deprecated',
    name: '.undelegate() deprecated',
    description: '.undelegate() fue depreciado. Use .off(event, selector).',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'contextual',
    pattern: /\.undelegate\s*\(\s*(['"`][^'"`]+['"`])\s*,\s*(['"`][^'"`]+['"`])\s*,?\s*/g,
    buildSuggestion: (_line, match) => ({
      replacementText: `.off(${match[2]}, ${match[1]}${match[0].trim().endsWith(',') ? ', ' : ''}`,
      syntaxMode: 'fragment',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  {
    id: 'jquery-load-event-removed',
    name: '.load() event removed',
    description: '.load() como shortcut de evento fue removido; use .on("load", fn).',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.load\s*\(/g,
    buildSuggestion: () => ({
      replacementText: '.on("load", ',
      syntaxMode: 'statement',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  {
    id: 'jquery-error-event-removed',
    name: '.error() event removed',
    description: '.error() como shortcut de evento fue removido; use .on("error", fn).',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.error\s*\(/g,
    buildSuggestion: () => ({
      replacementText: '.on("error", ',
      syntaxMode: 'statement',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  noteRule({
    id: 'jquery-unload-event-removed',
    name: '.unload() event removed',
    description: '.unload() fue removido; requiere reescritura explicita.',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'manual',
    pattern: /\.unload\s*\(/g,
    note: 'Reemplace por window.onunload o addEventListener segun el caso.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '.on("unload", '),
    requiresContext: true,
  }),
  replaceRule({
    id: 'jquery-parsejson-deprecated',
    name: 'jQuery.parseJSON deprecated',
    description: 'jQuery.parseJSON fue depreciado. Use JSON.parse().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\$\.parseJSON\s*\(/g,
    replacement: 'JSON.parse(',
    syntaxMode: 'expression',
  }),
  replaceRule({
    id: 'jquery-unique-deprecated',
    name: 'jQuery.unique() deprecated',
    description: 'jQuery.unique() fue renombrado a jQuery.uniqueSort().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\$\.unique\s*\(/g,
    replacement: '$.uniqueSort(',
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-fx-interval-deprecated',
    name: 'jQuery.fx.interval deprecated',
    description: 'jQuery.fx.interval fue depreciado y luego removido.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.0/',
    sinceVersion: '3.0',
    fixType: 'manual',
    pattern: /\$\.fx\.interval\b/g,
    note: 'Elimine la dependencia; requestAnimationFrame cambia este comportamiento.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '16'),
  }),
  noteRule({
    id: 'jquery-toggleclass-deprecated',
    name: '.toggleClass() special signatures deprecated',
    description: '.toggleClass() sin argumentos o con boolean fue depreciado.',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'manual',
    pattern: /\.toggleClass\s*\(\s*(?:|true|false)\s*\)/g,
    note: 'Use addClass/removeClass con una condicion explicita.',
    deriveSuggestedLine: (line, match) => {
      if (/\.toggleClass\s*\(\s*true\s*\)/.test(match[0])) {
        return replaceMatchedText(line, match, '.addClass(/* className */)');
      }

      if (/\.toggleClass\s*\(\s*false\s*\)/.test(match[0])) {
        return replaceMatchedText(line, match, '.removeClass(/* className */)');
      }

      return replaceMatchedText(line, match, '.toggleClass(/* className */)');
    },
  }),
  replaceRule({
    id: 'jquery-isarray-deprecated',
    name: 'jQuery.isArray deprecated',
    description: 'jQuery.isArray fue depreciado. Use Array.isArray().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.2/',
    sinceVersion: '3.2',
    fixType: 'auto',
    pattern: /\$\.isArray\s*\(/g,
    replacement: 'Array.isArray(',
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-holdready-deprecated',
    name: 'jQuery.holdReady deprecated',
    description: 'jQuery.holdReady() fue depreciado por su impacto global.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.2/',
    sinceVersion: '3.2',
    fixType: 'manual',
    pattern: /\$\.holdReady\s*\(/g,
    note: 'Reestructure el orden de carga en vez de bloquear el ready global.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, 'document.addEventListener("DOMContentLoaded", '),
    requiresContext: true,
  }),
  replaceRule({
    id: 'jquery-isfunction-deprecated',
    name: 'jQuery.isFunction deprecated',
    description: 'jQuery.isFunction fue depreciado. Use typeof x === "function".',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'contextual',
    pattern: /\$\.isFunction\s*\(\s*([^)]+)\s*\)/g,
    replacement: 'typeof $1 === "function"',
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-isnumeric-deprecated',
    name: 'jQuery.isNumeric deprecated',
    description: 'jQuery.isNumeric fue depreciado; la comprobacion correcta depende del caso.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'manual',
    pattern: /\$\.isNumeric\s*\(\s*([^)]+)\s*\)/g,
    note: 'Sustituya por una validacion especifica para su dominio; no existe reemplazo universal seguro.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `Number.isFinite(Number(${match[1]}))`),
    syntaxMode: 'expression',
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-iswindow-deprecated',
    name: 'jQuery.isWindow deprecated',
    description: 'jQuery.isWindow fue depreciado.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'manual',
    pattern: /\$\.isWindow\s*\(\s*([^)]+)\s*\)/g,
    note: 'Si realmente hace falta, use obj != null && obj === obj.window.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `${match[1]} != null && ${match[1]} === ${match[1]}.window`),
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-type-deprecated',
    name: 'jQuery.type deprecated',
    description: 'jQuery.type fue depreciado.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'manual',
    pattern: /\$\.type\s*\(\s*([^)]+)\s*\)/g,
    note: 'Sustituya por typeof, Array.isArray, instanceof u otra comprobacion especifica.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `typeof ${match[1]}`),
    syntaxMode: 'expression',
  }),
  replaceRule({
    id: 'jquery-now-deprecated',
    name: 'jQuery.now deprecated',
    description: 'jQuery.now fue depreciado. Use Date.now().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'auto',
    pattern: /\$\.now\s*\(\s*\)/g,
    replacement: 'Date.now()',
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-proxy-deprecated',
    name: 'jQuery.proxy deprecated',
    description: 'jQuery.proxy fue depreciado en favor de bind/closures.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'manual',
    pattern: /\$\.proxy\s*\(\s*([^,]+)\s*,\s*([^,)]+)([^)]*)\)/g,
    note: 'Revise si puede reemplazarse por fn.bind(context). En handlers puede cambiar la identidad de la funcion.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `${match[1].trim()}.bind(${match[2].trim()})`),
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-hover-deprecated',
    name: '.hover() deprecated',
    description: '.hover() fue depreciado. Use mouseenter/mouseleave explicitos.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.3/',
    sinceVersion: '3.3',
    fixType: 'manual',
    pattern: /\.hover\s*\(/g,
    note: 'Reemplace por .on("mouseenter", enterHandler).on("mouseleave", leaveHandler).',
    deriveSuggestedLine: (line, match) => rewriteHoverCall(line) ?? replaceMatchedText(line, match, '.on("mouseenter", '),
    requiresContext: true,
  }),
  ...shorthandHandlerRules,
  {
    id: 'jquery-selector-extensions-deprecated',
    name: 'jQuery extension selectors deprecated',
    description: 'Los selectores :eq/:gt/:lt/:first/:last/:even/:odd fueron depreciados.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.4/',
    sinceVersion: '3.4',
    fixType: 'contextual',
    pattern: /:(eq|gt|lt)\s*\([^)]*\)|:(first|last|even|odd)(?![-\w])/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: rewriteDeprecatedSelectorUsage(line, match),
      syntaxMode: 'expression',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  replaceRule({
    id: 'jquery-trim-deprecated',
    name: 'jQuery.trim deprecated',
    description: 'jQuery.trim fue depreciado. Use String.prototype.trim.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.5/',
    sinceVersion: '3.5',
    fixType: 'contextual',
    pattern: /\$\.trim\s*\(\s*([^)]+)\s*\)/g,
    replacement: 'String($1).trim()',
    syntaxMode: 'expression',
  }),
  {
    id: 'jquery-ajax-global-methods-deprecated',
    name: 'AJAX global event aliases deprecated',
    description: 'Los aliases .ajaxStart/.ajaxStop/etc. fueron depreciados. Use $(document).on(...).',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.5/',
    sinceVersion: '3.5',
    fixType: 'contextual',
    pattern: /(.*?)\.ajax(Start|Stop|Send|Complete|Error|Success)\s*\(\s*/g,
    buildSuggestion: (line, match) => ({
      suggestedLine: replaceMatchedText(line, match, `$(document).on("ajax${match[2]}", `),
      syntaxMode: 'fragment',
      confidence: 'medium',
      requiresContext: true,
    }),
  },
  replaceRule({
    id: 'jquery-getstackhook-deprecated',
    name: 'jQuery.Deferred.getStackHook() deprecated',
    description: 'jQuery.Deferred.getStackHook() fue depreciado. Use getErrorHook.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.7/',
    sinceVersion: '3.7',
    fixType: 'auto',
    pattern: /\$\.Deferred\.getStackHook\b/g,
    replacement: '$.Deferred.getErrorHook',
    syntaxMode: 'expression',
  }),
  replaceRule({
    id: 'jquery-deferred-pipe-deprecated',
    name: 'deferred.pipe() deprecated',
    description: 'deferred.pipe() fue depreciado. Use .then().',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-1.8/',
    sinceVersion: '1.8',
    fixType: 'auto',
    pattern: /\.pipe\s*\(/g,
    replacement: '.then(',
  }),
  replaceRule({
    id: 'jquery-jqxhr-success-removed',
    name: 'jqXHR.success() removed',
    description: 'Los metodos especiales success/error/complete del jqXHR fueron removidos en jQuery 3.0.',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.success\s*\(/g,
    replacement: '.done(',
  }),
  replaceRule({
    id: 'jquery-jqxhr-error-removed',
    name: 'jqXHR.error() removed',
    description: 'Los metodos especiales success/error/complete del jqXHR fueron removidos en jQuery 3.0.',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.error\s*\(/g,
    replacement: '.fail(',
    confidence: 'medium',
    requiresContext: true,
  }),
  replaceRule({
    id: 'jquery-jqxhr-complete-removed',
    name: 'jqXHR.complete() removed',
    description: 'Los metodos especiales success/error/complete del jqXHR fueron removidos en jQuery 3.0.',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\.complete\s*\(/g,
    replacement: '.always(',
  }),
  noteRule({
    id: 'jquery-ajax-global-on-nondocument',
    name: 'AJAX global events must be attached to document',
    description: 'Desde jQuery 1.9 los eventos ajax globales deben adjuntarse a document.',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'manual',
    pattern: /\$\s*\((?!\s*document\s*\))[^)]*\)\.on\s*\(\s*['"`]ajax(Start|Stop|Send|Complete|Error|Success)['"`]/g,
    note: 'Cambie el origen del handler a $(document).on("ajax...", handler).',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `$(document).on("ajax${match[1]}"`),
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-removeattr-boolean-breaking',
    name: '.removeAttr() on boolean attributes changed',
    description: 'En jQuery 3.0 .removeAttr() ya no pone la propiedad booleana a false.',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'manual',
    pattern: /\.removeAttr\s*\(\s*['"`](checked|selected|readonly|disabled|multiple)['"`]\s*\)/g,
    note: 'Revise si debe usar .prop(name, false) en vez de .removeAttr(name).',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `.prop("${match[1]}", false)`),
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-param-breaking',
    name: 'jQuery.param() serialization changed',
    description: 'jQuery.param() cambia el tratamiento de espacios desde jQuery 3.0.',
    severity: 'info',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'manual',
    pattern: /\$\.param\s*\(\s*([^)]+)\s*\)/g,
    note: 'Revise si el backend depende de + en lugar de %20. Considere URLSearchParams segun el caso.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, `new URLSearchParams(${match[1]}).toString()`),
    requiresContext: true,
  }),
  replaceRule({
    id: 'jquery-expr-filters-deprecated',
    name: 'jQuery.expr aliases deprecated',
    description: 'jQuery.expr[":"] y jQuery.expr.filters fueron depreciados. Use jQuery.expr.pseudos.',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'auto',
    pattern: /\$\.expr\.filters|\$\.expr\[['"`]:['"`]\]/g,
    replacement: '$.expr.pseudos',
    syntaxMode: 'expression',
  }),
  noteRule({
    id: 'jquery-empty-hash-selector-breaking',
    name: '$("#") and .find("#") invalid syntax',
    description: 'Los selectores "#" y find("#") son invalidos desde jQuery 3.0.',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_30,
    sinceVersion: '3.0',
    fixType: 'manual',
    pattern: /\$\s*\(\s*['"`]#['"`]\s*\)|\.find\s*\(\s*['"`]#['"`]\s*\)/g,
    note: 'Corrija el selector antes de migrar; jQuery 3+ lanza error de sintaxis.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '/* selector corregido */'),
  }),
  noteRule({
    id: 'jquery-hover-pseudo-event-breaking',
    name: '"hover" pseudo-event removed',
    description: 'El pseudo-evento "hover" dejo de ser sinonimo de mouseenter/mouseleave.',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'manual',
    pattern: /['"`]hover['"`]/g,
    note: 'Verifique si es un custom event legitimo o un uso historico del pseudo-evento hover.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '"mouseenter mouseleave"'),
    confidence: 'low',
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-data-events-breaking',
    name: '.data("events") removed',
    description: 'El acceso a .data("events") dejo de exponer la estructura interna de eventos.',
    severity: 'error',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_19,
    sinceVersion: '1.9',
    fixType: 'manual',
    pattern: /\.data\s*\(\s*['"`]events['"`]\s*\)/g,
    note: 'No existe API publica equivalente; reescriba la logica.',
    deriveSuggestedLine: (line, match) => replaceMatchedText(line, match, '.data()'),
  }),
  noteRule({
    id: 'jquery-htmlprefilter-breaking',
    name: 'jQuery.htmlPrefilter/self-closing tags changed',
    description: 'jQuery 3.5 cambio el tratamiento de self-closing tags en HTML.',
    severity: 'warning',
    sourceType: 'upgrade-guide',
    sourceUrl: UPGRADE_35,
    sinceVersion: '3.5',
    fixType: 'manual',
    pattern: /jQuery\.htmlPrefilter|\$\.htmlPrefilter|['"`][^'"`]*<(div|span|p|li|td|tr|script|section|article)(\s[^'"`]*)?\/>([^'"`]*)['"`]/g,
    note: 'Reemplace tags autocerrados no vacios por apertura+cierre explicitos.',
    deriveSuggestedLine: (line, match) => {
      if (/jQuery\.htmlPrefilter|\$\.htmlPrefilter/.test(match[0])) {
        return replaceMatchedText(line, match, '(html) => html');
      }

      return line.replace(/<([a-z][^\s/>]*)([^>]*)\/>/gi, '<$1$2></$1>');
    },
    syntaxMode: 'html',
    requiresContext: true,
  }),
  noteRule({
    id: 'jquery-find-tokenize-restored',
    name: 'jQuery.find.tokenize was accidentally hidden in 3.7.0',
    description: 'jQuery 3.7.1 restauro jQuery.find.tokenize; si el proyecto dependio de 3.7.0, conviene revisar compatibilidad.',
    severity: 'info',
    sourceType: 'release-note',
    sourceUrl: RELEASE_371,
    sinceVersion: '3.7.1',
    fixType: 'manual',
    pattern: /\$\.find\.tokenize|jQuery\.find\.tokenize/g,
    note: 'Si el codigo se probo con 3.7.0, valide el comportamiento con 3.7.1.',
    deriveSuggestedLine: (line, match) => rewriteFindTokenizeUsage(line, match),
  }),
  noteRule({
    id: 'jquery-uniqueSort-chainable-release',
    name: '.uniqueSort() chainable available in 3.7.0',
    description: 'jQuery 3.7.0 agrego .uniqueSort() chainable para colecciones.',
    severity: 'info',
    sourceType: 'release-note',
    sourceUrl: RELEASE_370,
    sinceVersion: '3.7.0',
    fixType: 'manual',
    pattern: /\.(?:prev(?:All|Until)?|next(?:All|Until)?)\s*\([^)]*\)/g,
    note: 'Si despues encadena wrapAll/manipulacion y necesita orden DOM, revise si conviene .uniqueSort().',
    deriveSuggestedLine: (line, match) => appendUniqueSortAfterTraversalCall(line, match),
    confidence: 'low',
    requiresContext: true,
  }),
];

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
}

function parseVersion(version: string): ParsedVersion | null {
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3] ?? '0', 10),
  };
}

function compareVersions(left: ParsedVersion, right: ParsedVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

export function getMigrationRulesForTarget(targetVersion: TargetJQueryVersion): MigrationRule[] {
  const parsedTarget = parseVersion(targetVersion);
  if (!parsedTarget) {
    return migrationRules;
  }

  return migrationRules.filter((rule) => {
    const parsedRuleVersion = parseVersion(rule.sinceVersion);
    if (!parsedRuleVersion) {
      return true;
    }

    return compareVersions(parsedRuleVersion, parsedTarget) <= 0;
  });
}
