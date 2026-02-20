# Funcionalidades del API de DSAgent pendientes en dsagent-vscode

Este documento lista los endpoints y capacidades del **DSAgent server** (`docs/api/http-api.md`) que aún **no están implementados** o están **parcialmente implementados** en la extensión **dsagent-vscode**.

---

## Resumen ejecutivo

| Área | Pendiente (API → extensión) |
|------|------------------------------|
| **Sesiones** | Archivar sesión, exportar sesión como JSON, actualizar `model`/`status` desde la UI |
| **Archivos (session files)** | Listar archivos, descargar archivo, eliminar archivo (solo upload está) |
| **Artifacts** | Eliminar artifact (list + open/download ya existen) |
| **Kernel** | Reset kernel (limpiar variables/imports) |
| **Historial** | Endpoint de mensajes crudos `/messages` (opcional; ya se usa `/turns`) |
| **HITL** | Respond avanzado (modify/retry/skip/feedback) expuesto en UI |
| **Otros** | WebSocket como transporte alternativo a SSE (opcional) |

---

## Tiempos de implementación estimados

Estimación para **una persona** con conocimiento del codebase (client + extensión VS Code). Incluye método en client, comandos/UI y pruebas básicas.

| Área | Tarea | Horas | Notas |
|------|--------|-------|--------|
| **Sesiones** | Archivar sesión (client + menú "Archive" en árbol) | 1–1.5 h | Poco código, seguir patrón delete. |
| **Sesiones** | Exportar sesión como JSON (client + comando "Export as JSON") | 1–1.5 h | Descarga + diálogo "Guardar como". |
| **Sesiones** | Ampliar updateSession (model, status) + UI (cambiar modelo/estado) | 2–3 h | Quick pick / input en sesión activa. |
| **Files** | listFiles + downloadFile + deleteFile en client | 1.5–2 h | Tres métodos REST sencillos. |
| **Files** | Vista "Files" en sidebar (tree + categorías + acciones) | 3–4 h | Nuevo TreeProvider, menú contextual. |
| **Artifacts** | deleteArtifact en client + "Delete" en árbol artifacts | 1–1.5 h | Un método + confirmación en UI. |
| **Kernel** | resetKernel en client + comando "Reset kernel" | 1–1.5 h | Un método + comando/ícono. |
| **HITL** | Ajustar respondAction (modified_plan/code) + UI modify/retry/skip/feedback | 3–4 h | Varios botones/estados en webview. |
| **Opcional** | GET /messages en client (sin UI nueva) | 0.5 h | Solo si se necesita luego. |
| **Opcional** | WebSocket como transporte alternativo al SSE | 4–6 h | Sustituir o complementar flujo actual. |

**Total aproximado (solo lo del checklist, sin opcionales):**

- **Mínimo (solo client + comandos mínimos):** ~10–12 h (**1.5–2 días**).
- **Completo (incl. vista Files y HITL completo):** ~15–18 h (**2–2.5 días**).

Si se hace por fases:

- **Fase 1 (rápida):** Sesiones (archivar, export JSON, update model/status) + Artifacts delete + Kernel reset → **~6–8 h**.
- **Fase 2:** Files (client + vista en sidebar) → **~4–5 h**.
- **Fase 3:** HITL avanzado en UI → **~3–4 h**.

---

## ¿Se pueden hacer las tres fases en paralelo?

**Sí.** Las fases tocan áreas distintas; con un reparto claro se puede trabajar en paralelo (varias personas o varias ramas).

### Reparto recomendado

| Fase | Archivos principales | Dependencias |
|------|----------------------|--------------|
| **Fase 1** | `api/client.ts` (archive, export, update, deleteArtifact, resetKernel), `commands/index.ts`, `providers/sessionsTreeProvider.ts`, `providers/artifactsTreeProvider.ts`, `extension.ts` (comandos) | Ninguna |
| **Fase 2** | `api/client.ts` (listFiles, downloadFile, deleteFile), nuevo `providers/filesTreeProvider.ts`, `package.json` (vista + comandos), `extension.ts` (registro vista) | Ninguna |
| **Fase 3** | `api/client.ts` (ajustes en `respondAction`), `webview-ui/` (componentes HITL), `providers/chatViewProvider.ts` (mensajes al webview) | Ninguna |

### Punto de conflicto: `api/client.ts`

Las tres fases añaden o tocan métodos en `DSAgentClient`. Para evitar merges dolorosos:

- **Opción A (recomendada):** Una rama o PR corto que **solo añada en `client.ts`** todos los métodos nuevos (archiveSession, exportSessionJson, ampliar updateSession, listFiles, downloadFile, deleteFile, deleteArtifact, resetKernel, y la firma/body de respondAction). Se mergea primero. Luego **tres ramas en paralelo**, cada una solo con la UI de su fase (comandos, tree providers, webview). Así no se toca dos veces el mismo archivo.
- **Opción B:** Tres ramas en paralelo desde el inicio; cada una añade sus métodos en `client.ts` y su UI. Al mergear, Git suele unir bien porque son **bloques distintos** (métodos nuevos en sitios diferentes). Revisar que no se dupliquen helpers ni imports.

### Otros archivos que pueden tocarse a la vez

- **`extension.ts`:** Fase 1 y 2 registran comandos o vistas; suelen ser bloques distintos. Si hay conflicto, es fácil repartir (uno los comandos de sesión/artifacts/kernel, otro el registro del FilesTreeProvider).
- **`package.json`:** Solo Fase 2 añade vista y comandos de "Files"; Fase 1 y 3 no lo tocan. Sin conflicto.

### Tiempo total en paralelo

- **Con 3 personas (una por fase):** el tiempo total pasa a ser el de la fase más larga (~6–8 h de Fase 1) más un margen pequeño para integración y merge. En **1 día** se puede tener todo integrado.
- **Con 1 persona y 3 ramas:** el tiempo es el mismo que en secuencia (~15–18 h), pero puedes ir mergeando por fases (primero Fase 1, luego Fase 2, luego Fase 3) para tener valor entregado antes.

---

## 1. Sesiones

### 1.1 Archivar sesión
- **API:** `POST /api/sessions/{session_id}/archive`
- **Estado:** No implementado en el client ni en la extensión.
- **Propuesta:** Añadir `archiveSession(sessionId)` en `DSAgentClient` y un comando/acción en el árbol de sesiones (p. ej. "Archive" en el menú contextual).

### 1.2 Exportar sesión como JSON
- **API:** `GET /api/sessions/{session_id}/export` (descarga JSON con datos de la sesión).
- **Estado:** No implementado. La extensión solo tiene "Export notebook" (`.ipynb`).
- **Propuesta:** Añadir `exportSessionJson(sessionId)` en el client y un comando "Export session as JSON" (guardar archivo local).

### 1.3 Actualizar sesión: `model` y `status`
- **API:** `PUT /api/sessions/{session_id}` acepta `name`, `status`, `model`, `hitl_mode`.
- **Estado:** El client solo envía `name` y `hitl_mode` en `updateSession`. No se puede cambiar `model` ni `status` desde la extensión.
- **Propuesta:** Ampliar `updateSession` a `{ name?, status?, model?, hitl_mode? }` y exponer en la UI (p. ej. cambiar modelo en sesión activa, marcar como "completed"/"paused").

---

## 2. Archivos de sesión (Files)

Los archivos de sesión son distintos de los **artifacts**: son inputs (p. ej. datos subidos) en categorías `data`, `artifacts`, `notebooks`.

### 2.1 Listar archivos
- **API:** `GET /api/sessions/{session_id}/files?category=data`
- **Estado:** No implementado. No hay vista "Files" ni método en el client.
- **Propuesta:** Añadir `listFiles(sessionId, category?)` y, opcionalmente, una vista o panel que muestre archivos de la sesión (p. ej. por categoría).

### 2.2 Descargar archivo
- **API:** `GET /api/sessions/{session_id}/files/{filename}?category=data`
- **Estado:** No implementado.
- **Propuesta:** Añadir `downloadFile(sessionId, filename, category?)` y uso desde la UI (p. ej. "Save to workspace" desde la lista de archivos).

### 2.3 Eliminar archivo
- **API:** `DELETE /api/sessions/{session_id}/files/{filename}?category=data`
- **Estado:** No implementado.
- **Propuesta:** Añadir `deleteFile(sessionId, filename, category?)` y acción "Delete" en la lista de archivos.

**Nota:** La **subida** de archivos sí está implementada (`uploadFile` en el client y uso desde el chat / attach file).

---

## 3. Artifacts

### 3.1 Eliminar artifact
- **API:** `DELETE /api/sessions/{session_id}/artifacts/{filename}`
- **Estado:** Listar y “abrir” (descargar vía URL) están; **eliminar** no existe en el client ni en la UI.
- **Propuesta:** Añadir `deleteArtifact(sessionId, filename)` en el client y opción "Delete" en el menú contextual del árbol de artifacts.

---

## 4. Kernel

### 4.1 Reset kernel
- **API:** `POST /api/sessions/{session_id}/kernel/reset`
- **Estado:** No implementado. Existe `getKernelState` y `executeCode`, pero no reset.
- **Propuesta:** Añadir `resetKernel()` en el client y un comando "Reset kernel" (p. ej. en la barra de estado o en el panel de variables) para limpiar variables e imports.

---

## 5. Historial de mensajes

### 5.1 GET mensajes (crudos)
- **API:** `GET /api/sessions/{session_id}/messages?limit=50&offset=0&role=assistant`
- **Estado:** La extensión usa `/turns` para cargar historial; no usa `/messages`.
- **Prioridad:** Baja. Solo necesario si se quiere una vista "raw messages" o filtros por rol distintos a lo que dan los turns.

---

## 6. HITL (Human-in-the-Loop)

### 6.1 Respond avanzado
- **API:** `POST /api/sessions/{session_id}/hitl/respond` con body `{ action, message?, modified_plan?, modified_code? }`. Acciones: `approve`, `reject`, `modify`, `retry`, `skip`, `feedback`.
- **Estado:** El client tiene `respondAction(action, message?, modification?)` y la UI expone principalmente Approve/Reject. Las acciones `modify`, `retry`, `skip`, `feedback` no están bien expuestas (o no lo están) en la UI.
- **Propuesta:** Revisar que `respondAction` envíe correctamente `modified_plan`/`modified_code` según la API y añadir en la UI opciones para "Modify plan", "Retry", "Skip", "Send feedback" cuando el HITL esté esperando.

---

## 7. WebSocket (opcional)

- **API:** `WS /ws/chat/{session_id}` para chat en tiempo real.
- **Estado:** La extensión usa **SSE** (`POST .../chat/stream`) para el chat. No usa WebSocket.
- **Prioridad:** Baja. Solo tiene sentido si se quiere un segundo transporte o menos reconexiones en escenarios concretos.

---

## 8. Health / Ready

- **API:** `GET /health`, `GET /health/ready`
- **Estado:** El client usa `/health` para `connect()`. No se usa `/health/ready`.
- **Prioridad:** Muy baja; solo si se quiere un "readiness" explícito en la UI.

---

## Checklist de implementación sugerida

- [ ] **Sesiones:** `archiveSession`, `exportSessionJson`, ampliar `updateSession` (model, status) y exponer en UI.
- [ ] **Files:** `listFiles`, `downloadFile`, `deleteFile` + vista/acción "Files" en la sesión.
- [ ] **Artifacts:** `deleteArtifact` + "Delete" en contexto del árbol de artifacts.
- [ ] **Kernel:** `resetKernel` + comando "Reset kernel" en la extensión.
- [ ] **HITL:** Completar UI de `hitl/respond` (modify, retry, skip, feedback) y asegurar body según API.

Referencia de API: en el repo **dsagent**, archivo `docs/api/http-api.md`.
