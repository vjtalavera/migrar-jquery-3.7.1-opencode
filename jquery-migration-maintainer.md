# Skill: jquery-migration-maintainer

## Propósito
Este skill define un modo de trabajo exhaustivo para este repositorio.
Debe usarse como guía base en cualquier prompt relacionado con el proyecto.

Su objetivo es que cada respuesta, análisis y cambio de código sea consistente con la misión del producto: escanear código jQuery legado y sugerir migraciones seguras hacia jQuery 3.7.1 y jQuery 3.0.0.

## Cuándo usar este skill
Usa este skill para cualquier tarea en este repositorio, especialmente si involucra:
- cambios en `src/`
- creación o modificación de reglas de migración
- ajustes en el analizador
- cambios de UI o estilos
- revisiones de TypeScript
- validación de build
- explicación del comportamiento actual del proyecto
- refactors pequeños o medianos
- documentación técnica del funcionamiento

## Contexto permanente del proyecto
Asume siempre este contexto salvo que el usuario indique explícitamente otra cosa:

- Stack principal:
  - Vite 5
  - React 18
  - TypeScript 5
  - Acorn
  - CSS plano

- Archivos clave:
  - `src/main.tsx`: bootstrap de React
  - `src/App.tsx`: UI principal, estado y handlers (`Pegar codigo`, `Seleccionar carpeta`, `Seleccionar rutas`)
  - `src/analyzer.ts`: lógica de escaneo y tipos exportados
  - `src/dependencyLayout.ts`: análisis recursivo de includes/scripts
  - `vite.config.ts`: endpoint local para leer rutas del sistema en modo rutas
  - `src/rules.ts`: catálogo de reglas, patrones y sugerencias
  - `src/index.css`: resets y layout global
  - `src/App.css`: estilos específicos de la interfaz

- Restricciones importantes:
  - `dist/` es generado; no se edita manualmente
  - TypeScript está en modo estricto
  - no hay lint configurado
  - no hay tests automatizados configurados
  - las verificaciones reales actuales son:
    - `npx tsc --noEmit`
    - `npm run build`

- Convenciones funcionales:
  - la UI debe permanecer en español, salvo instrucción explícita
  - el flujo principal del producto es:
    - entrada de código
    - análisis
    - presentación de resultados
  - la app debe priorizar orientación segura de migración, no transformaciones agresivas
  - la UI debe permitir seleccionar versión objetivo (`3.0.0` o `3.7.1`) y mostrarla en resultados
  - en modo `Seleccionar rutas`, el análisis se dispara con `Analizar rutas` usando rutas locales vía API local
  - en modo carpeta/rutas, mantener análisis on-demand por archivo al seleccionar
  - en incidencias, priorizar layout compacto y sin duplicación visual innecesaria

## Principios obligatorios
Prioriza siempre, en este orden:

1. seguridad de migración
2. exactitud técnica
3. compatibilidad con jQuery 3.7.1
4. compatibilidad con jQuery 3.0.0
5. TypeScript estricto
6. claridad y mantenibilidad
7. consistencia visual y funcional con la app existente

## Procedimiento obligatorio para cualquier prompt

### 1. Interpretar la intención real
Antes de editar o responder:
- identifica si el pedido afecta UI, análisis, reglas, estilos, tipos, estructura o configuración
- revisa el código relevante antes de decidir
- infiere convenciones del repo antes de proponer cambios
- evita preguntar si puedes resolverlo revisando el contexto

### 2. Ajustar la respuesta a la misión del producto
Toda propuesta debe pasar por estas preguntas:
- ¿esto mejora la detección o explicación de migraciones jQuery?
- ¿esto podría sugerir una migración insegura o engañosa?
- ¿esto debe marcarse como cambio manual o contextual?
- ¿esto conserva el propósito pedagógico y práctico de la herramienta?

### 3. Reglas para cambios en `src/rules.ts`
Cuando modifiques o agregues reglas:
- mantén la metadata centralizada
- incluye identificador único
- incluye severidad
- incluye fuente o referencia de versión
- incluye tipo de fix
- incluye patrón o criterio de detección
- incluye generador de sugerencia claro
- usa `requiresContext: true` cuando el cambio no sea seguro automáticamente
- evita regex frágiles
- protege regex globales contra matches vacíos
- no asumas equivalencias de APIs de jQuery sin respaldo técnico
- prioriza referencias oficiales de jQuery cuando aplique
- preserva la estrategia de versionado por `sinceVersion`
- asegura que la selección de versión objetivo filtre reglas en forma centralizada

### 4. Reglas para cambios en `src/analyzer.ts`
Cuando modifiques lógica de análisis:
- prefiere helpers puros
- evita acoplar análisis con UI
- conserva tipos exportados claros
- usa guard clauses
- maneja errores sin ocultarlos
- si usas `catch`, estrecha con `instanceof Error`
- no inventes un parser paralelo si ya existe flujo con Acorn
- conserva resultados legibles para la UI
- mantiene `3.7.1` como versión objetivo por defecto
- no ejecutes reglas con `sinceVersion` superior a la versión seleccionada

### 5. Reglas para cambios en UI
Cuando modifiques `src/App.tsx`, `src/App.css` o `src/index.css`:
- conserva el flujo actual del producto
- mantén textos en español
- preserva la estética actual salvo pedido explícito de rediseño
- respeta responsive móvil
- no introduzcas dependencias de UI innecesarias
- no abstraigas componentes si no hay ganancia clara
- mantén claridad en estados, handlers y render condicional
- en tarjetas de incidencia, prioriza densidad visual (menos altura, una línea cuando sea viable)
- evita duplicar etiquetas/textos que ya estén visibles en la misma tarjeta
- conserva preview de archivo base (solo lectura) con foco por línea al seleccionar incidencia

### 6. Reglas de TypeScript
Siempre:
- evita `any`
- usa `unknown` con narrowing cuando haga falta
- prefiere `interface` para objetos exportados
- prefiere `type` para uniones y alias pequeños
- modela nulabilidad explícitamente
- evita variables no usadas
- evita parámetros no usados
- añade tipos explícitos cuando mejoren claridad
- no dejes deuda de tipos “temporal” sin decirlo

### 7. Reglas de estilo y edición
Siempre:
- edita sólo lo necesario
- no cambies archivos generados sin necesidad
- no toques `dist/`
- no toques `node_modules/`
- no modifiques `package-lock.json` salvo cambio intencional de dependencias
- conserva estilo local del archivo
- usa comentarios sólo si aclaran algo no evidente
- favorece código legible sobre abstracciones ingeniosas

### 8. Reglas de validación
Después de cambios relevantes:
- ejecuta `npx tsc --noEmit` si cambias lógica o tipos
- ejecuta `npm run build` si cambias comportamiento de la app o UI
- no afirmes lint si no existe
- no afirmes tests si no existen
- si no puedes validar, explica exactamente qué faltó

### 9. Regla de seguridad para migraciones
Si una sugerencia de migración:
- depende del contexto de ejecución
- puede cambiar semántica
- puede afectar eventos, timing, compatibilidad o plugins
- no tiene reemplazo 1:1 claro

entonces:
- marca la sugerencia como contextual o manual
- explica el riesgo
- evita presentarla como fix automático seguro

### 10. Formato esperado de las respuestas
En la respuesta final:
- empieza diciendo qué cambiaste y por qué
- menciona los archivos afectados
- resume decisiones importantes
- indica riesgos o límites si existen
- indica qué comandos de verificación ejecutaste
- menciona si lint o tests no existen cuando sea relevante
- propone siguientes pasos breves sólo si son naturales

## Política de preguntas
No hagas preguntas por defecto.

Sólo pregunta si:
- falta un dato que cambia materialmente la implementación
- la acción es destructiva o irreversible
- se necesita una credencial o valor externo no inferible
- hay dos direcciones válidas con impacto funcional distinto y no se puede inferir una por el código

Si necesitas preguntar:
- primero completa todo lo no bloqueado
- haz una sola pregunta
- que sea precisa
- incluye una recomendación concreta
- explica qué cambiaría según la respuesta

## Política de comunicación
Al responder:
- sé claro, técnico y directo
- evita relleno
- no prometas validaciones que no ejecutaste
- no ocultes incertidumbre real
- no presentes heurísticas débiles como certezas
- distingue claramente entre:
  - hecho actual del código
  - inferencia razonable
  - recomendación

## Criterio de calidad
Una tarea se considera bien resuelta sólo si:
- respeta la misión del producto
- no rompe TypeScript estricto
- mantiene coherencia con la arquitectura actual
- no introduce complejidad innecesaria
- no sugiere migraciones inseguras como si fueran automáticas
- deja claro qué se hizo, por qué y cómo verificarlo

## Modo de actuación resumido
Para cualquier prompt de este repo, actúa así:
1. entender el objetivo real
2. leer contexto relevante
3. inferir convención existente
4. aplicar el cambio mínimo correcto
5. verificar con TypeScript y/o build cuando corresponda
6. reportar con claridad, límites y siguientes pasos si aplica
