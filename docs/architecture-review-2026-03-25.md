# Architecture Review -- Plectica 2.0

**Reviewer:** Kael, Software Architect
**Date:** 2026-03-25
**Codebase snapshot:** commit `e5bef0c` (M3: Pushing Mode, Fit-to-contents, size persistence fix)

---

## 1. Current State Assessment

**Overall verdict: Healthy for the stage, with one growing pressure point.**

### What is working well

- **CSS-transforms + DOM rendering.** For a text-heavy, accessibility-friendly canvas tool with card nesting, this is the right call. No need to fight Canvas2D text rendering or WebGL complexity.
- **`canvas-store.ts` as a pure-function spatial engine.** Clean, well-documented, testable. Functions take a `Map<number, CardData>` and return a new one. No side effects. Best-structured module in the codebase.
- **The IPC contract in `src/ipc/db.ts`.** Clean `DbInterface` with 13 methods, Tauri implementation, and a stub for testing.
- **Rust backend.** Schema init, migrations, and PRAGMA validation handled carefully. `Mutex<Connection>` pattern correct for single-user Tauri.
- **Optimistic updates with revert-on-error.** Consistently applied: nest, unnest, delete, content edit, relationship mutations all follow the same pattern.
- **`Card.tsx` and `RelationshipLine.tsx`.** Focused, well-scoped components.

### Pressure point: App.tsx at 2,532 lines

This is the single architectural concern worth discussing. Everything else is load-bearing tech debt that is fine for the current stage.

---

## 2. App.tsx -- Size and Structure

### Is it time to split?

**Not yet, but approaching the threshold.** App.tsx is large but still cohesive -- one component managing one screen.

| Section | ~Lines | Description |
|---------|--------|-------------|
| State declarations + refs | 170 | Lines 70-170 |
| Initialization (loadCards) | 70 | Lines 179-248 |
| Pan/zoom/wheel | 130 | Lines 253-398 |
| Drag start + connection start | 140 | Lines 400-536 |
| handleMouseMove | 470 | Lines 543-1013 |
| Helpers + handleMouseUp | 660 | Lines 1015-1675 |
| Create/edit/reset/delete | 330 | Lines 1677-2007 |
| Keyboard shortcuts | 65 | Lines 2009-2073 |
| Render JSX | 460 | Lines 2107-2532 |

`handleMouseMove` (7 interaction modes) and `handleMouseUp` (609 lines) are the densest sections.

### Natural seams for future extraction

1. **`useCanvasInteractions` hook** -- owns all pointer event routing. Highest-value extraction (~1,100 lines).
2. **`useCanvasKeyboard` hook** -- keyboard shortcut effects. Low-value but easy.
3. **`useCanvasPersistence` hook** -- consolidates the "diff cards and write changes" pattern.

### Split triggers

- Multi-select is added (new interaction mode in handleMouseMove)
- Cross-mode interaction bug takes 30+ min to isolate
- File crosses ~3,000 lines

---

## 3. State Management

### Current approach: React `useState` + `useRef`

Well-considered for current scale. Refs correctly used for high-frequency values (pendingDragRef, shiftHeldDuringDragRef, lastMouseRef). State correctly used for render-affecting data (cards, viewport, dragState).

### Ceiling: ~200-300 cards

- O(N * depth) hover hit-test on every mouse move
- Full Map copy on every `setCards` call (60/sec during drag)

### When it breaks, do this:

- Cache absolute positions in a ref-based lookup
- Consider a simple grid hash for hover hit-testing
- Do NOT move to Zustand/signals until React state + refs is measurably failing

---

## 4. Persistence Pattern

### Correct for single-user local app

- Writes only on mouse-up (no debouncing needed)
- Diffs against snapshots, batches with Promise.all
- Optimistic updates with revert-on-error

### Issues

- `persistRelCardPositions` writes sequentially (should be Promise.all)
- No crash-safe batch transaction (low risk with local SQLite, address before M5)

---

## 5. Vision Ahead -- Architectural Preparation

### Before Note Editor Panel (M4/M5)

- Extract `mapId` from hardcoded `1` (~20 occurrences)
- Extract canvas rendering into `<Canvas />` component (App.tsx becomes layout shell)
- Option A (lift state) before Option B (external store)

### Before Multiple Canvases ("Models")

- Schema already supports it (`layout.map_id`, `get_map_nodes(map_id)`)
- Just need `mapId` as state + model picker UI

### Before MCP Server

- `DbInterface` is a good foundation
- MCP server could open `plectica.db` directly (SQLite WAL mode)
- No frontend architectural changes needed

### Before Text-to-Canvas AI

- Need an auto-layout algorithm (grid, force-directed, or tree)
- This is a canvas-store.ts addition, not architectural change

---

## 6. Performance Horizon

| Card count | Expected behavior | Action needed |
|------------|-------------------|---------------|
| 50 | Smooth | None |
| 200 | Smooth with minor optimizations | Skip hover during gestures, CSS containment |
| 500 | Potential jank on drag | Viewport culling |
| 1,000 | Likely jank | LOD + culling |
| 2,000+ | DOM limit | Hybrid rendering |

**Do not optimize for 1,000 cards until someone has 200.**

---

## 7. Prioritized Recommendations

### Do Now

1. Skip hover hit-test during active gestures (eliminates O(N) per frame)
2. Parallelize `persistRelCardPositions` (Promise.all instead of sequential)

### Do Before M4 (Note Editor Panel)

3. Extract `mapId` from hardcoded `1`
4. Extract canvas into `<Canvas />` component

### Do Before M5 (Multi-select, AI)

5. Batch write IPC command (single Rust transaction)
6. Extract `useCanvasInteractions` hook

### Do Not Do Yet

- External state management
- Spatial indexing
- Canvas2D/WebGL switch
- Viewport culling
- Undo/redo (design as dedicated milestone)
