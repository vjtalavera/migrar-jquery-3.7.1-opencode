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

function buildSelectorMigration(selector: string): { selector: string; chain: string } | undefined {
  const pseudoPattern = /:(eq|gt|lt)\s*\(([^)]+)\)|:(first|last|even|odd)\b/g;
  const chainParts: string[] = [];
  let hasDeprecatedPseudo = false;
  let match: RegExpExecArray | null;

  while ((match = pseudoPattern.exec(selector)) !== null) {
    hasDeprecatedPseudo = true;

    if (match[1]) {
      const method = match[1];
      const rawArg = (match[2] ?? '').trim();
      const numericArg = toNumericIndex(rawArg);

      if (method === 'eq') {
        chainParts.push(`.eq(${rawArg})`);
      } else if (method === 'gt') {
        if (numericArg !== null) {
          chainParts.push(`.slice(${numericArg + 1})`);
        } else {
          chainParts.push(`.filter((index) => index > (${rawArg}))`);
        }
      } else if (method === 'lt') {
        if (numericArg !== null) {
          chainParts.push(`.slice(0, ${numericArg})`);
        } else {
          chainParts.push(`.filter((index) => index < (${rawArg}))`);
        }
      }

      continue;
    }

    const shorthand = match[3];
    if (shorthand === 'first') {
      chainParts.push('.first()');
    } else if (shorthand === 'last') {
      chainParts.push('.last()');
    } else if (shorthand === 'even') {
      chainParts.push('.filter((index) => index % 2 === 0)');
    } else if (shorthand === 'odd') {
      chainParts.push('.filter((index) => index % 2 === 1)');
    }
  }

  if (!hasDeprecatedPseudo) {
    return undefined;
  }

  const cleanedSelector = selector
    .replace(/:(eq|gt|lt)\s*\(([^)]+)\)|:(first|last|even|odd)\b/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    selector: cleanedSelector,
    chain: chainParts.join(''),
  };
}

function rewriteDeprecatedSelectorUsage(line: string): string | undefined {
  const callPattern = /(\$\s*\(\s*(['"`])([^'"`]*)\2\s*\)|\.find\s*\(\s*(['"`])([^'"`]*)\4\s*\))/;
  const callMatch = line.match(callPattern);
  if (!callMatch) {
    return undefined;
  }

  const fullCall = callMatch[1];
  const selector = callMatch[3] ?? callMatch[5] ?? '';
  const migration = buildSelectorMigration(selector);
  if (!migration) {
    return undefined;
  }

  const updatedCall = fullCall.replace(selector, migration.selector);
  return line.replace(fullCall, `${updatedCall}${migration.chain}`);
}

function extractSelectorLiteral(expression: string): string | undefined {
  const trimmed = expression.trim();
  const selectorCall = trimmed.match(/^(?:\$|jQuery)\s*\(\s*(['"`][^'"`]+['"`])\s*\)$/);
  return selectorCall?.[1];
}

function buildLiveDelegateReplacement(line: string, match: RegExpMatchArray, method: 'on' | 'off'): string {
  const indentation = match[1] ?? '';
  const originalTarget = (match[2] ?? '').trim();
  const selectorLiteral = extractSelectorLiteral(originalTarget) ?? '/* selector */';
  const eventName = match[3] ?? '';
  return line.replace(match[0], `${indentation}$(document).${method}(${eventName}, ${selectorLiteral}, `);
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
    deriveSuggestedLine: (line) => line.replace(/\.toggle\s*\(/g, '.on("click", '),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `.state() === "${match[1] === 'isRejected' ? 'rejected' : 'resolved'}"`),
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
      suggestedLine: line.replace(match[0], `${match[1]}$(`),
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
    deriveSuggestedLine: (line) => line.replace(/\.unload\s*\(/g, '.on("unload", '),
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
        return line.replace(match[0], '.addClass(/* className */)');
      }

      if (/\.toggleClass\s*\(\s*false\s*\)/.test(match[0])) {
        return line.replace(match[0], '.removeClass(/* className */)');
      }

      return line.replace(match[0], '.toggleClass(/* className */)');
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], 'document.addEventListener("DOMContentLoaded", '),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `Number.isFinite(Number(${match[1]}))`),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `${match[1]} != null && ${match[1]} === ${match[1]}.window`),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `typeof ${match[1]}`),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `${match[1].trim()}.bind(${match[2].trim()})`),
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
    deriveSuggestedLine: (line) => rewriteHoverCall(line) ?? line.replace(/\.hover\s*\(/g, '.on("mouseenter", '),
    requiresContext: true,
  }),
  ...shorthandHandlerRules,
  noteRule({
    id: 'jquery-selector-extensions-deprecated',
    name: 'jQuery extension selectors deprecated',
    description: 'Los selectores :eq/:gt/:lt/:first/:last/:even/:odd fueron depreciados.',
    severity: 'warning',
    sourceType: 'api-deprecated',
    sourceUrl: 'https://api.jquery.com/category/deprecated/deprecated-3.4/',
    sinceVersion: '3.4',
    fixType: 'manual',
    pattern: /:(eq|gt|lt)\s*\([^)]*\)|:(first|last|even|odd)\b/g,
    note: 'Mueva el filtrado fuera del selector: use .eq(), .slice(), .first(), .last() o .filter().',
    deriveSuggestedLine: (line) => rewriteDeprecatedSelectorUsage(line),
    syntaxMode: 'expression',
  }),
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
      suggestedLine: line.replace(match[0], `$(document).on("ajax${match[2]}", `),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `$(document).on("ajax${match[1]}"`),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `.prop("${match[1]}", false)`),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], `new URLSearchParams(${match[1]}).toString()`),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], '/* selector corregido */'),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], '"mouseenter mouseleave"'),
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
    deriveSuggestedLine: (line, match) => line.replace(match[0], '.data()'),
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
    deriveSuggestedLine: (line) => line.replace(/<([a-z][^\s/>]*)([^>]*)\/>/gi, '<$1$2></$1>'),
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
    pattern: /\.prev(All|Until|Until)|\.next(All|Until|Until)/g,
    note: 'Si despues encadena wrapAll/manipulacion y necesita orden DOM, revise si conviene .uniqueSort().',
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
