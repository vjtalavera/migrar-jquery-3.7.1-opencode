import { useRef, useState } from 'react';
import {
  analyzeCode,
  isAllowedFile,
  MigrationIssue,
  MigrationResult,
} from './analyzer';
import { TargetJQueryVersion } from './rules';
import {
  analyzeFileRecursively,
  RecursiveFileAnalysis,
} from './dependencyLayout';
import './App.css';

const sampleCode = `$(document).ready(function() {
  $('#login').bind('click', submitLogin);
  $('#legacy-link').live('click', legacyHandler);
  $('img').error(function() {
    console.log('error');
  });
  $.trim(userInput);
  $.parseJSON(payload);
  $(panel).find('#');
  $('.list li:first').addClass('active');
  $.ajax('/status').success(renderStatus).error(showError);
  $('#status').on('ajaxStart', function() {
    console.log('wrong target');
  });
});

var html = '<div/><span/>';
var old = $.browser.msie;
`;

function getSeverityClass(severity: string): string {
  if (severity === 'error') {
    return 'error';
  }

  if (severity === 'warning') {
    return 'warning';
  }

  return 'info';
}

function getFixTypeLabel(fixType: string): string {
  if (fixType === 'auto') {
    return 'Auto-fix seguro';
  }

  if (fixType === 'contextual') {
    return 'Auto-fix contextual';
  }

  return 'Revision manual';
}

function getValidationLabel(issue: MigrationIssue): string {
  switch (issue.validation.status) {
    case 'valid':
      return 'Sintaxis validada';
    case 'invalid':
      return 'Sintaxis invalida';
    case 'needs_context':
      return 'Necesita contexto';
    default:
      return 'Sin validacion automatica';
  }
}

function IssueCard({ issue }: { issue: MigrationIssue }) {
  return (
    <article className={`result-item ${getSeverityClass(issue.rule.severity)}`}>
      <div className="result-header">
        <span className="line-number">Linea {issue.lineNumber}</span>
        <span className={`issue-type ${getSeverityClass(issue.rule.severity)}`}>
          {issue.rule.severity.toUpperCase()}: {issue.rule.name}
        </span>
      </div>

      <p className="issue-description">{issue.rule.description}</p>

      <div className="issue-meta-row">
        <span className="meta-pill">jQuery {issue.rule.sinceVersion}</span>
        <span className="meta-pill">{issue.rule.sourceType}</span>
        <span className="meta-pill">{getFixTypeLabel(issue.fixType)}</span>
        <span className={`meta-pill validation ${issue.validation.status}`}>{getValidationLabel(issue)}</span>
      </div>

      <div className="code-block">
        <div className="original-code">
          <strong>Original:</strong>
          <br />
          {issue.line}
        </div>

        {issue.suggestedLine ? (
          <div className={`migrated-code ${issue.validation.status === 'invalid' ? 'syntax-error' : ''}`}>
            <strong>{issue.fixType === 'manual' ? 'Sugerencia:' : 'Linea propuesta:'}</strong>
            <br />
            {issue.suggestedLine}
          </div>
        ) : (
          <div className="migrated-code syntax-note">
            <strong>Sin linea propuesta:</strong>
            <br />
            {issue.note ?? 'No hay correccion automatica segura para este caso.'}
          </div>
        )}
      </div>

      {issue.note && issue.suggestedLine && <p className="extra-note">{issue.note}</p>}
      {issue.validation.message && <p className="validation-detail">{issue.validation.message}</p>}
      <p className="source-link">Fuente oficial: <a href={issue.rule.sourceUrl} target="_blank" rel="noreferrer">{issue.rule.sourceUrl}</a></p>
    </article>
  );
}

interface FolderFileEntry {
  id: string;
  file: File;
  filePath: string;
  isAnalyzing: boolean;
  isAnalyzed: boolean;
  isExpanded: boolean;
  result: MigrationResult | null;
  recursiveAnalysis: RecursiveFileAnalysis | null;
  selectedRecursiveEntryId: string | null;
  error?: string;
}

interface RouteApiFile {
  filePath: string;
  content: string;
}

function normalizeLocalPath(path: string): string {
  return path
    .trim()
    .replace(/^['"]|['"]$/g, '')
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase();
}

function parseRouteLines(value: string): string[] {
  const unique = new Set<string>();

  for (const line of value.split('\n')) {
    const normalized = normalizeLocalPath(line);
    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}

function matchesRoutePath(filePath: string, routePath: string): boolean {
  const normalizedFilePath = normalizeLocalPath(filePath);

  return normalizedFilePath === routePath
    || normalizedFilePath.endsWith(`/${routePath}`)
    || normalizedFilePath.startsWith(`${routePath}/`)
    || normalizedFilePath.includes(`/${routePath}/`)
    || routePath.endsWith(`/${normalizedFilePath}`);
}

function filterEntriesByRoutes(entries: FolderFileEntry[], routePaths: string[]): FolderFileEntry[] {
  if (routePaths.length === 0) {
    return entries;
  }

  return entries.filter((entry) => routePaths.some((routePath) => matchesRoutePath(entry.filePath, routePath)));
}

function getFileNameFromPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || 'archivo';
}

function getDefaultRecursiveEntryId(analysis: RecursiveFileAnalysis): string | null {
  const firstRecursiveWithResult = analysis.entries.find(
    (entry) => (entry.kind === 'jsp-include' || entry.kind === 'script-src') && entry.result,
  );
  if (firstRecursiveWithResult) {
    return firstRecursiveWithResult.id;
  }

  const firstRecursive = analysis.entries.find(
    (entry) => entry.kind === 'jsp-include' || entry.kind === 'script-src',
  );
  return firstRecursive?.id ?? null;
}

function App() {
  const [mode, setMode] = useState<'code' | 'folder' | 'routes'>('code');
  const [targetVersion, setTargetVersion] = useState<TargetJQueryVersion>('3.7.1');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<MigrationResult | null>(null);
  const [folderFiles, setFolderFiles] = useState<FolderFileEntry[]>([]);
  const [skippedFilesCount, setSkippedFilesCount] = useState(0);
  const [routeInput, setRouteInput] = useState('');
  const [routeHint, setRouteHint] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analyzedFiles = folderFiles.filter((file) => file.isAnalyzed);
  const pendingFiles = folderFiles.length - analyzedFiles.length;
  const filesWithIssues = analyzedFiles.filter((file) => (file.recursiveAnalysis?.totalIssues ?? 0) > 0).length;
  const totalIssues = analyzedFiles.reduce((total, file) => total + (file.recursiveAnalysis?.totalIssues ?? 0), 0);
  const analyzedSummary = analyzedFiles.reduce((summary, file) => {
    const currentSummary = file.recursiveAnalysis?.summary;
    if (!currentSummary) {
      return summary;
    }

    return {
      errors: summary.errors + currentSummary.errors,
      warnings: summary.warnings + currentSummary.warnings,
      info: summary.info + currentSummary.info,
      autoFixes: summary.autoFixes + currentSummary.autoFixes,
      contextualFixes: summary.contextualFixes + currentSummary.contextualFixes,
      manualReviews: summary.manualReviews + currentSummary.manualReviews,
    };
  }, {
    errors: 0,
    warnings: 0,
    info: 0,
    autoFixes: 0,
    contextualFixes: 0,
    manualReviews: 0,
  });

  const handleAnalyze = () => {
    setFolderFiles([]);
    setSkippedFilesCount(0);
    setResult(analyzeCode(code, targetVersion));
  };

  const handleLoadSample = () => {
    setCode(sampleCode);
    setResult(null);
    setFolderFiles([]);
    setSkippedFilesCount(0);
    setRouteInput('');
    setRouteHint(null);
    setMode('code');
  };

  const handleSelectFolder = () => {
    fileInputRef.current?.click();
  };

  const handleAnalyzeRoutes = async (): Promise<void> => {
    const routePaths = parseRouteLines(routeInput);
    if (routePaths.length === 0) {
      setRouteHint('Ingresa al menos una ruta por linea.');
      return;
    }

    setRouteHint('Analizando rutas...');

    try {
      const apiUrl = new URL('api/local-routes/files', window.location.href).toString();
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          routes: routePaths,
        }),
      });

      if (!response.ok) {
        throw new Error(`Error ${response.status} al leer rutas locales.`);
      }

      const payload = await response.json() as { files?: RouteApiFile[]; error?: string };
      if (payload.error) {
        throw new Error(payload.error);
      }

      const files = payload.files ?? [];
      const entries: FolderFileEntry[] = files.map((item, index) => ({
        id: `${item.filePath}-${index}`,
        file: new File([item.content], getFileNameFromPath(item.filePath), { type: 'text/plain' }),
        filePath: item.filePath,
        isAnalyzing: false,
        isAnalyzed: false,
        isExpanded: false,
        result: null,
        recursiveAnalysis: null,
        selectedRecursiveEntryId: null,
      }));

      const filteredEntries = filterEntriesByRoutes(entries, routePaths);
      setFolderFiles(filteredEntries);
      setSkippedFilesCount(0);
      setRouteHint(`${filteredEntries.length} archivo(s) cargado(s) por rutas. Selecciona un archivo para analizar.`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudieron analizar las rutas locales.';
      setRouteHint(message);
    }
  };

  const handleTargetVersionChange = (version: TargetJQueryVersion) => {
    setTargetVersion(version);
    setResult(null);
    setFolderFiles((current) => current.map((entry) => ({
      ...entry,
      isAnalyzing: false,
      isAnalyzed: false,
      isExpanded: false,
      result: null,
      recursiveAnalysis: null,
      selectedRecursiveEntryId: null,
      error: undefined,
    })));
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) {
      return;
    }

    setResult(null);
    const selectedFiles = Array.from(files);
    const allowedFiles = selectedFiles.filter((file) => isAllowedFile(file.name));

    const entries = allowedFiles.map((file, index) => ({
        id: `${file.webkitRelativePath || file.name}-${index}`,
        file,
        filePath: file.webkitRelativePath || file.name,
        isAnalyzing: false,
        isAnalyzed: false,
        isExpanded: false,
        result: null,
        recursiveAnalysis: null,
        selectedRecursiveEntryId: null,
      }));

    setFolderFiles(entries);

    setSkippedFilesCount(selectedFiles.length - allowedFiles.length);
    event.target.value = '';
  };

  const handleAnalyzeFile = async (
    entryId: string,
    filePath: string,
    sourceEntries: FolderFileEntry[] = folderFiles,
  ): Promise<void> => {
    const fileRecords = sourceEntries.map((entry) => ({
      filePath: entry.filePath,
      file: entry.file,
    }));

    setFolderFiles((current) => current.map((entry) => (
      entry.id === entryId
        ? { ...entry, isAnalyzing: true, isExpanded: true, error: undefined }
        : entry
    )));

    try {
      const recursiveAnalysis = await analyzeFileRecursively(filePath, fileRecords, targetVersion);
      const rootEntry = recursiveAnalysis.entries.find((entry) => entry.kind === 'root');
      const rootResult = rootEntry?.result ?? null;
      const defaultSelectedRecursiveEntryId = getDefaultRecursiveEntryId(recursiveAnalysis);

      setFolderFiles((current) => current.map((entry) => (
        entry.id === entryId
          ? {
              ...entry,
              isAnalyzing: false,
              isAnalyzed: true,
              isExpanded: true,
              result: rootResult,
              recursiveAnalysis,
              selectedRecursiveEntryId: defaultSelectedRecursiveEntryId,
              error: undefined,
            }
          : entry
      )));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'No se pudo leer el archivo.';

      setFolderFiles((current) => current.map((entry) => (
        entry.id === entryId
          ? {
              ...entry,
              isAnalyzing: false,
              isAnalyzed: false,
              isExpanded: true,
              result: null,
              recursiveAnalysis: null,
              selectedRecursiveEntryId: null,
              error: message,
            }
          : entry
      )));
    }
  };

  const handleToggleFile = (entryId: string) => {
    const selected = folderFiles.find((entry) => entry.id === entryId);
    if (!selected || selected.isAnalyzing) {
      return;
    }

    if (!selected.isAnalyzed) {
      void handleAnalyzeFile(selected.id, selected.filePath);
      return;
    }

    setFolderFiles((current) => current.map((entry) => (
      entry.id === entryId
        ? { ...entry, isExpanded: !entry.isExpanded }
        : entry
    )));
  };

  const handleSelectRecursiveEntry = (folderEntryId: string, recursiveEntryId: string) => {
    setFolderFiles((current) => current.map((entry) => (
      entry.id === folderEntryId
        ? {
            ...entry,
            selectedRecursiveEntryId: entry.selectedRecursiveEntryId === recursiveEntryId ? null : recursiveEntryId,
          }
        : entry
    )));
  };

  return (
    <div className="app">
      <header className="hero">
        <p className="eyebrow">Migracion basada en fuentes oficiales</p>
        <h1>jQuery 3.7.1 Migration Tool</h1>
        <p className="hero-copy">
          Detecta APIs deprecated, removed y breaking changes con trazabilidad a la documentacion oficial de jQuery.
        </p>
      </header>

      <section className="input-section">
        <div className="mode-tabs">
          <button className={`tab ${mode === 'code' ? 'active' : ''}`} onClick={() => setMode('code')}>
            Pegar codigo
          </button>
          <button className={`tab ${mode === 'folder' ? 'active' : ''}`} onClick={() => setMode('folder')}>
            Seleccionar carpeta
          </button>
          <button className={`tab ${mode === 'routes' ? 'active' : ''}`} onClick={() => setMode('routes')}>
            Seleccionar rutas
          </button>
        </div>

        <div className="version-tabs">
          <span className="version-label">Version objetivo</span>
          <button
            className={`tab ${targetVersion === '3.0.0' ? 'active' : ''}`}
            onClick={() => handleTargetVersionChange('3.0.0')}
          >
            jQuery 3.0.0
          </button>
          <button
            className={`tab ${targetVersion === '3.7.1' ? 'active' : ''}`}
            onClick={() => handleTargetVersionChange('3.7.1')}
          >
            jQuery 3.7.1
          </button>
        </div>

        {mode === 'code' && (
          <>
            <label htmlFor="code-input">Codigo legacy a analizar</label>
            <textarea
              id="code-input"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="Pega aqui JavaScript, JSP o fragmentos HTML con jQuery legacy"
            />
            <div className="actions">
              <button onClick={handleAnalyze} disabled={!code.trim()}>
                Analizar codigo
              </button>
              <button className="secondary" onClick={handleLoadSample}>
                Cargar ejemplo
              </button>
            </div>
          </>
        )}

        {(mode === 'folder' || mode === 'routes') && (
          <div className="folder-section">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              webkitdirectory=""
              directory=""
              onChange={handleFileChange}
              style={{ display: 'none' }}
            />
            <div className="folder-select">
              {mode === 'folder' && (
                <button onClick={handleSelectFolder}>
                  Seleccionar carpeta
                </button>
              )}

              {mode === 'routes' && (
                <>
                  <span className="folder-hint">Ingresa rutas manuales (una por linea) y pulsa "Analizar rutas".</span>
                  <textarea
                    className="local-paths-input"
                    value={routeInput}
                    onChange={(event) => setRouteInput(event.target.value)}
                    placeholder={'Una ruta por linea\nEjemplo:\nC:/proyecto-a/webapp/WEB-INF/jsp/home.jsp\nC:/proyecto-b/webapp/js/legacy.js'}
                  />
                  <button type="button" className="secondary" onClick={() => void handleAnalyzeRoutes()}>
                    Analizar rutas
                  </button>
                  {routeHint && <span className="folder-hint">{routeHint}</span>}
                </>
              )}

              <span className="folder-hint">Se analizan recursivamente `jsp`, `js`, `html` y `htm`.</span>
              {skippedFilesCount > 0 && (
                <span className="folder-hint">{skippedFilesCount} archivo(s) ignorado(s) por extension no compatible.</span>
              )}
            </div>
          </div>
        )}
      </section>

      {result && (
        <section className="results">
          <div className="stats">
            <div className="stat">Version objetivo: <strong>{targetVersion}</strong></div>
            <div className="stat">Lineas: <strong>{result.totalLines}</strong></div>
            <div className="stat">Errores: <strong className="error-text">{result.summary.errors}</strong></div>
            <div className="stat">Warnings: <strong className="warning-text">{result.summary.warnings}</strong></div>
            <div className="stat">Info: <strong className="info-text">{result.summary.info}</strong></div>
            <div className="stat">Auto-fix: <strong>{result.summary.autoFixes}</strong></div>
            <div className="stat">Contextual: <strong>{result.summary.contextualFixes}</strong></div>
            <div className="stat">Manual: <strong>{result.summary.manualReviews}</strong></div>
          </div>

          {result.issues.length === 0 ? (
            <div className="no-issues">No se detectaron hallazgos con las reglas actuales.</div>
          ) : (
            result.issues.map((issue, index) => <IssueCard key={`${issue.rule.id}-${index}`} issue={issue} />)
          )}
        </section>
      )}

      {(mode === 'folder' || mode === 'routes') && folderFiles.length > 0 && (
        <section className="results">
          <div className="folder-stats">
            <div className="stat">Version objetivo: <strong>{targetVersion}</strong></div>
            <div className="stat">Archivos detectados: <strong>{folderFiles.length}</strong></div>
            <div className="stat">Pendientes: <strong>{pendingFiles}</strong></div>
            <div className="stat">Analizados: <strong>{analyzedFiles.length}</strong></div>
            <div className="stat">Con hallazgos: <strong>{filesWithIssues}</strong></div>
            <div className="stat">Issues: <strong>{totalIssues}</strong></div>
            <div className="stat">Auto-fix: <strong>{analyzedSummary.autoFixes}</strong></div>
            <div className="stat">Contextual: <strong>{analyzedSummary.contextualFixes}</strong></div>
            <div className="stat">Manual: <strong>{analyzedSummary.manualReviews}</strong></div>
          </div>

          {folderFiles.map((fileEntry) => (
            <section key={fileEntry.id} className={`file-result ${fileEntry.isAnalyzed ? 'analyzed' : 'pending'}`}>
              <button
                type="button"
                className="file-header file-toggle"
                onClick={() => handleToggleFile(fileEntry.id)}
                disabled={fileEntry.isAnalyzing}
              >
                <span className="file-path">{fileEntry.filePath}</span>
                <span className="file-stats">
                  <span className={`status-pill ${fileEntry.isAnalyzed ? 'done' : 'pending'}`}>
                    {fileEntry.isAnalyzing ? 'Analizando...' : fileEntry.isAnalyzed ? 'Analizado' : 'Sin analizar'}
                  </span>
                  {fileEntry.isAnalyzed && (
                    <>
                      <span>{fileEntry.result?.issues.length ?? 0} incidencias</span>
                      <span className="error-text">{fileEntry.result?.summary.errors ?? 0} errores</span>
                      <span className="warning-text">{fileEntry.result?.summary.warnings ?? 0} warnings</span>
                      <span className="info-text">{fileEntry.result?.summary.info ?? 0} info</span>
                    </>
                  )}
                </span>
              </button>

              {fileEntry.error && <p className="validation-detail">{fileEntry.error}</p>}

              {fileEntry.isExpanded && fileEntry.isAnalyzing && (
                <div className="file-issues">
                  <div className="no-issues">Analizando archivo...</div>
                </div>
              )}

              {fileEntry.isExpanded && fileEntry.isAnalyzed && fileEntry.recursiveAnalysis && (
                <div className="file-issues">
                  <div className="recursive-columns">
                    <div className="recursive-left">
                      {fileEntry.result ? (
                        <section className="included-result">
                          <div className="included-header">
                            <span className="file-stats">
                              <span>{fileEntry.result.issues.length} incidencias</span>
                              <span className="error-text">{fileEntry.result.summary.errors} errores</span>
                              <span className="warning-text">{fileEntry.result.summary.warnings} warnings</span>
                              <span className="info-text">{fileEntry.result.summary.info} info</span>
                            </span>
                          </div>

                          {fileEntry.result.issues.length === 0 ? (
                            <div className="no-issues">No se detectaron hallazgos en el archivo base.</div>
                          ) : (
                            fileEntry.result.issues.map((issue, index) => (
                              <IssueCard key={`${fileEntry.id}-root-${issue.rule.id}-${index}`} issue={issue} />
                            ))
                          )}
                        </section>
                      ) : (
                        <div className="no-issues">No se pudo obtener el resultado del archivo base.</div>
                      )}
                    </div>

                    <div className="recursive-right">
                      {(() => {
                        const recursiveEntries = fileEntry.recursiveAnalysis.entries
                          .filter((entry) => entry.kind === 'jsp-include' || entry.kind === 'script-src');

                        if (recursiveEntries.length === 0) {
                          return <div className="no-issues">No se detectaron archivos recursivos.</div>;
                        }

                        return (
                          <>
                            <div className="dependency-layout">
                              <p className="dependency-title">Layout recursivo de includes y scripts</p>
                              {recursiveEntries.map((entry) => {
                                const isSelected = entry.id === fileEntry.selectedRecursiveEntryId;

                                return (
                                  <div key={`${fileEntry.id}-${entry.id}`}>
                                    <button
                                      type="button"
                                      className={`dependency-item ${entry.found ? 'found' : 'missing'} ${isSelected ? 'selected' : ''}`}
                                      style={{ paddingLeft: `${entry.depth * 1.1}rem` }}
                                      onClick={() => handleSelectRecursiveEntry(fileEntry.id, entry.id)}
                                    >
                                      <span className="dependency-path">{entry.displayPath}</span>
                                      {entry.referenceLine && <span className="dependency-count">linea {entry.referenceLine}</span>}
                                      {entry.result && <span className="dependency-count">{entry.result.issues.length} incidencias</span>}
                                      {!entry.found && <span className="dependency-count">no encontrado</span>}
                                    </button>

                                    {isSelected && (
                                      <div className="dependency-details" style={{ marginLeft: `${entry.depth * 1.1}rem` }}>
                                        {!entry.result && (
                                          <div className="no-issues">No se pudo analizar esta referencia.</div>
                                        )}

                                        {entry.result && entry.result.issues.length === 0 && (
                                          <div className="no-issues">No se detectaron hallazgos en este archivo recursivo.</div>
                                        )}

                                        {entry.result && entry.result.issues.length > 0 && (
                                          <>
                                            <div className="included-header">
                                              <span className="file-stats">
                                                {entry.referenceLine && <span>linea {entry.referenceLine}</span>}
                                                <span>{entry.result.issues.length} incidencias</span>
                                                <span className="error-text">{entry.result.summary.errors} errores</span>
                                                <span className="warning-text">{entry.result.summary.warnings} warnings</span>
                                                <span className="info-text">{entry.result.summary.info} info</span>
                                              </span>
                                            </div>
                                            {entry.result.issues.map((issue, index) => (
                                              <IssueCard key={`${entry.id}-${issue.rule.id}-${index}`} issue={issue} />
                                            ))}
                                          </>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </div>
              )}
            </section>
          ))}
        </section>
      )}
    </div>
  );
}

export default App;
