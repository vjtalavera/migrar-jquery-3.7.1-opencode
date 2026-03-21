# Skill: jquery-migration-maintainer

## Proposito
Este skill define un modo operativo exhaustivo para mantener este repositorio.
Debe usarse como guia base para cualquier prompt relacionado con la herramienta
de migracion a jQuery 3.7.1 y jQuery 3.0.0.

## Relacion con AGENTS.md
Este skill no reemplaza `AGENTS.md`; lo extiende.

Reglas de precedencia:
1. `AGENTS.md` define las politicas base del repositorio.
2. Este skill define un modo operativo mas estricto para tareas de migracion.
3. Si existe conflicto, prevalece `AGENTS.md`.

## Contexto permanente
- Stack: Vite 5, React 18, TypeScript 5, Acorn, CSS plano.
- Archivos clave:
  - `src/App.tsx`: UI y estados de analisis.
  - `src/analyzer.ts`: deteccion, normalizacion y resultado.
  - `src/dependencyLayout.ts`: layout recursivo de includes/scripts y analisis por nodo.
  - `src/rules.ts`: catalogo de reglas y sugerencias.
- Versiones objetivo soportadas:
  - `3.0.0`
  - `3.7.1` (default)
- Verificacion disponible:
  - `npx tsc --noEmit`
  - `npm run build`
- No hay lint ni test runner configurados actualmente.

## Premisa obligatoria del analizador
- Solo se consideran instrucciones jQuery que comienzan con: `$jq`, `$`,
  `JQuery` o `jQuery`.
- Debe soportarse mas de una instruccion jQuery en la misma linea.
- La deteccion debe ser agnostica a alias:
  - normalizar la instruccion a una forma canonica para aplicar reglas,
  - restaurar el alias original al reportar `match` y `suggestedLine`.
- Evitar duplicar soporte de alias regla por regla; resolverlo en analyzer.

## Criterios para sugerencias
- No mostrar `suggestedLine` si la reescritura no cambia realmente la
  instruccion detectada.
- Cuando la regla produce reescritura determinista, mostrar linea propuesta.
- Para casos no deterministas, mantener nota contextual/manual clara.
- En pseudos de selector depreciados (`:first`, `:last`, `:eq`, `:gt`, `:lt`,
  `:even`, `:odd`), preferir reescrituras de cadena jQuery (por ejemplo
  `.first()`, `.last()`, `.eq()`, `.slice()`, `.filter()`) en vez de remover
  tokens sin preservar semantica.

## Normas de implementacion
- Priorizar cambios minimos, seguros y trazables.
- Mantener TypeScript estricto, sin `any`.
- Preservar el flujo de UI: entrada -> analisis -> resultados.
- Preservar selector de version objetivo y su reflejo explicito en resultados.
- Centralizar filtrado por version objetivo en analyzer/rules (evitar filtros duplicados en UI).
- No ejecutar reglas cuyo `sinceVersion` sea mayor a la version objetivo seleccionada.
- En modo carpeta, preservar analisis bajo demanda por archivo seleccionado.
- Preservar layout de dos columnas en resultados recursivos:
  - izquierda: incidencias del archivo base,
  - derecha: arbol recursivo y detalle desplegable por nodo.
- Mantener orden del arbol recursivo por `referenceLine` ascendente.
- Mantener offset de lineas en scripts inline para reportar lineas reales.
- Mantener texto de interfaz en espanol salvo instruccion explicita.
- No editar `dist/` manualmente.

## Checklist operativo por prompt
1. Identificar si el cambio afecta analyzer, reglas, UI o tipos.
2. Revisar convenciones existentes en archivos relevantes.
3. Implementar el cambio minimo correcto.
4. Ejecutar verificacion (`npx tsc --noEmit` y/o `npm run build`).
5. Reportar que se cambio, por que, y como se valido.
