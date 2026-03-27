# Ambit -- M1 Kickoff: Cards on Canvas

**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-23
**Status:** ACTIVE -- M1 is go

---

## M1 Goal

M1 delivers the first user-touchable version of Ambit. By the end of M1, a user can open the app, create cards on the infinite canvas, type text into them, drag them to reposition, resize them manually, and delete them. Every action persists immediately to the local SQLite database. Closing and reopening the app returns the user to exactly the state they left. M1 is not the complete product -- nesting is M2 -- but it is the first moment the application feels real. The canvas has weight, actions have consequences, and work is not lost.

---

## Tech Stack (Resolved in M0)

Both blocking tech decisions are locked. M1 proceeds on the following confirmed stack:

- **Canvas:** Custom React + CSS Transforms. No framework dependency. Pan via CSS `translate()`, zoom via CSS `scale()`. Cards are absolutely positioned nested `<div>` elements. This was Wren's recommendation based on the M0 prototype spike; the custom approach was the only candidate that naturally enforced the truthful boundary requirement.
- **Desktop shell:** Tauri (v2.x). Rust backend owns the SQLite connection. Frontend is 100% TypeScript/React. IPC layer is a thin async TypeScript interface so the canvas code never calls Tauri APIs directly.
- **Database:** SQLite via Tauri's Rust backend (`rusqlite` or `tauri-plugin-sql`), initialized from `data/dsrp_schema.sql`, WAL mode enabled, foreign keys enforced.

No decisions are open for M1. The prototype in `src/prototype/custom-react-canvas/` is the reference implementation.

---

## Deliverables

### Wren -- Card Canvas App

**Output location:** `src/`
**Upstream dependencies:** M0 complete (Tauri shell exists, canvas engine from prototype is in place).
**Downstream:** All M2 nesting work depends on the card CRUD layer being stable.

Wren builds the production card canvas on top of the confirmed Custom React + CSS Transforms stack, integrated into the Tauri desktop shell. The prototype in `src/prototype/custom-react-canvas/` is the starting point -- the core engine (auto-resize, coordinate transforms, nesting logic) is already written and proven. M1 is the hardening and Tauri-wiring pass, not a rewrite.

**What carries forward from the prototype:**
- The canvas engine in `store.ts` (~400 lines): card state model, coordinate transform logic, auto-resize propagation, drag-to-nest hit testing, drag-to-unnest detection. This code is structurally correct and transfers to production with review and cleanup.
- The `Card` component renderer: the div-based card with depth-based styling, resize handle, and selection state.
- The pan/zoom model: CSS `translate()` + `scale()` on a single transform container, mouse wheel for pan, Ctrl+wheel for zoom.
- The interaction model: double-click to create, click to select, drag to move, resize handle bottom-right, Delete key to remove.

**What needs rebuilding or extending for production:**
- Replace the prototype's in-memory state with persistence calls through the Tauri IPC interface. Every create, edit, move, resize, and delete must write to SQLite immediately (or on a tight debounce for continuous operations like drag).
- Replace the prototype's hardcoded Bicycle seed data with loading from the database on app startup.
- Implement the TypeScript IPC interface (`db.createNode()`, `db.updateNodeContent()`, `db.updateNodeLayout()`, `db.deleteNode()`, `db.getMapNodes()`) as a clean abstraction over Tauri's `invoke()`. Wren calls the interface; the interface calls Tauri. This keeps the canvas code portable.
- Add zoom-to-fit and zoom-to-selection (basic navigation quality of life; the prototype only has wheel zoom).
- Add a breadcrumb trail stub (the UI element that will show nesting level in M2; wire it at M1 to show "Canvas" as the current level so the component exists before nesting is added).
- Proper error handling: if a database write fails, the UI must not silently proceed.

**M1 card interactions (the full set):**

| Interaction | Behavior |
|---|---|
| Double-click on empty canvas | Create new card at click position. Auto-focus the text input. |
| Click on card | Select it. Show resize handle. |
| Click on card text | Enter edit mode. `<textarea>` or `contenteditable`. Save on blur or Enter. |
| Drag card | Reposition card on canvas. Persist new x/y on mouse-up. |
| Drag resize handle | Resize card (width and height). Persist new width/height on mouse-up. |
| Delete key (card selected) | Delete the card. Persist immediately. |
| Escape | Deselect / exit edit mode. |
| Scroll | Pan canvas. |
| Ctrl+scroll | Zoom canvas (centered on cursor). |

At M1, nesting is NOT implemented. Dragging a card onto another card does nothing (no parent assignment). That interaction is M2. The drag model should be written with reparenting in mind -- do not implement drag-to-move in a way that makes drag-to-nest hard to add.

---

### Silas -- Persistence Layer

**Output location:** `data/dsrp_schema.sql` (already exists from M0; M1 requires wiring, not a new schema)
**Upstream dependencies:** Schema complete from M0.
**Downstream:** Wren cannot persist card operations until Silas's IPC commands are implemented and tested.

Silas's M1 work is implementing and validating the CRUD operations that Wren calls through the IPC interface. The schema is already built; this is the read/write layer on top of it.

**Specific deliverables:**

1. **Database initialization.** On app startup, Tauri must initialize the SQLite database from `data/dsrp_schema.sql` if it does not already exist. WAL mode must be enabled on every connection (`PRAGMA journal_mode=WAL`). Foreign keys must be enforced on every connection (`PRAGMA foreign_keys=ON`). These pragmas must fire on every connection open, not just on schema creation -- SQLite does not persist pragma state.

2. **CRUD IPC commands.** Implement Tauri IPC commands (Rust `#[tauri::command]` functions) for the following operations:

   | Command | Description |
   |---|---|
   | `get_map_nodes(map_id)` | Return all nodes on the given map with their layout positions. This is the startup query -- load everything on the canvas. |
   | `create_node(map_id, content, x, y, width, height)` | Insert a row into `nodes` (parent_id NULL, node_type 'card') and a row into `layout`. Return the new node's ID. |
   | `update_node_content(node_id, content)` | UPDATE `nodes.content` WHERE `id = ?`. Return success/error. |
   | `update_node_layout(node_id, map_id, x, y, width, height)` | UPDATE `layout` WHERE `node_id = ?` AND `map_id = ?`. Return success/error. |
   | `delete_node(node_id)` | DELETE from `nodes` WHERE `id = ?`. The layout row cascades automatically via FK. Return success/error. |

3. **Default map.** At M1, a single default map must exist. On first run, if no maps exist, create one with a default name ("My Canvas" or similar). Wren's canvas always loads this map. Multi-map support is M3.

4. **WAL and FK validation.** Silas must verify that WAL mode is active and foreign keys are on after initialization. Include a startup check that logs an error if either pragma is not set as expected.

**What Silas does NOT build in M1:**
- Recursive descendant queries (those are M2, needed for nesting subtree retrieval)
- The `update_node_parent` (reparenting) command (M2)
- Any query more complex than the list above

---

### Derek -- DSRP Compliance Review

**Output location:** A written review delivered to Maren (no new doc needed unless Derek finds issues that require a spec amendment)
**Upstream dependencies:** Wren's M1 implementation (Derek reviews the working app, not a design doc).
**Downstream:** M1 is not closed until Derek signs off. M2 cannot begin until M1 is closed.

Derek reviews the M1 deliverable against the DSRP non-negotiables and the data model spec. This is a fidelity gate, not a rubber stamp.

**What Derek checks:**

1. **Cards are Distinctions, not typed objects.** The UI must not present cards as having types, categories, or roles. A card is a card. No "container card" vs. "regular card" distinction in the UI. If the prototype's depth-based styling (color changes at deeper nesting levels) survived into M1, confirm it communicates depth only -- not a difference in card ontology.

2. **Layout is separate from identity.** Confirm the schema and IPC layer as built enforce the `parent_id` (structural) vs. `layout` (visual) separation. The `update_node_layout` command should update only spatial data; structural data should be untouched. Review Silas's implementation for any blurring of this boundary.

3. **No `is_container` flag or equivalent.** Inspect the `nodes` table schema as deployed. Confirm there is no `is_container`, `can_have_children`, `has_children`, or `node_type` value other than `'card'`. If any such column was added during implementation, it must be removed before M1 closes.

4. **`parent_id = NULL` is valid and correct.** At M1 all cards are top-level (no nesting yet), so every card has `parent_id = NULL`. Confirm the schema allows this (not a constraint violation) and the app creates cards this way.

5. **Delete behavior for cards with children.** At M1 cards have no children, so this is not a live risk yet -- but Derek should confirm the delete logic handles the case where a card with children is deleted. This must either cascade-delete children, or refuse the delete with an error. It must NOT silently delete the parent while leaving orphaned children with a dangling `parent_id`. This sets the correct behavior before M2 adds children.

Derek's sign-off is the signal that M1 is done and M2 kickoff can begin.

---

## Parallel vs. Sequential Work

```
M0 COMPLETE (precondition for all M1 work)
  data/dsrp_schema.sql exists
  Tauri app shell exists with custom React canvas
  Both tech decisions locked

PARALLEL (can start immediately once M0 is confirmed complete)
  Silas  --> Implement IPC CRUD layer + default map init
  Wren   --> Harden prototype into production canvas app
               (can stub persistence calls initially, wire when Silas delivers)

SEQUENTIAL
  Silas IPC layer complete
    --> Wren wires persistence (replaces stubs with real IPC calls)
    --> Integration test: create/edit/move/resize/delete all persist correctly

  Wren's wired app working
    --> Derek DSRP review
    --> M1 closed
```

**Critical path:** Wren's canvas work does not need to wait for Silas -- she can build with persistence stubs and wire later. The actual critical path is: Silas IPC layer -> Wren persistence wiring -> Derek review -> M1 closed.

**Wren should not be blocked.** The prototype is already functional. Production hardening (TypeScript cleanup, error handling, zoom-to-fit, breadcrumb stub) can proceed the moment M0 is confirmed complete.

---

## What Carries Forward from `src/prototype/custom-react-canvas/`

The prototype is not throwaway code. The following components transfer to production with review:

| Prototype component | Production fate |
|---|---|
| `store.ts` -- card state, coordinate transforms, auto-resize | **Transfer.** Review for TypeScript strictness, extract pure functions, add error handling. The core logic is correct. |
| `Card.tsx` -- div-based card renderer | **Transfer with extension.** Add `<textarea>` for text editing, connect to persistence on blur. |
| Pan/zoom model (CSS transforms on viewport div) | **Transfer.** Add zoom-to-fit. |
| Drag-to-move | **Transfer.** Ensure mouse-up handler calls `update_node_layout`. |
| Drag-to-nest hit testing | **Transfer to M2.** The code exists in the prototype; it is disabled at M1 and enabled properly in M2 when reparenting is wired. Do not delete it. |
| Bicycle seed data | **Remove.** Replace with database load on startup. |
| In-memory state (`useState` map of cards) | **Replace.** Load from DB on startup; write to DB on every mutation. Keep in-memory state as the render cache, but treat the database as the source of truth. |

Nothing from the tldraw prototype transfers. That prototype served its evaluation purpose.

---

## M1 Done Criteria

M1 is complete -- and M2 kickoff may begin -- when ALL of the following are true:

1. **The app opens.** The Tauri desktop app launches on Windows without errors. The canvas loads with the user's existing cards (or an empty canvas on first run).

2. **Cards can be created.** Double-clicking on empty canvas space creates a new card at that position. The card appears immediately. The card persists: close and reopen the app, the card is there.

3. **Cards can be edited.** Clicking a card's text enters edit mode. The user can type. Saving on blur or Enter updates the card's content. The updated content persists across app restart.

4. **Cards can be moved.** Dragging a card repositions it. The new position persists across app restart. Dragging feels smooth (no visual lag on the card following the cursor).

5. **Cards can be resized.** Dragging the resize handle (bottom-right corner) changes the card's width and height. The new size persists across app restart.

6. **Cards can be deleted.** Selecting a card and pressing Delete removes it from the canvas. It is gone after app restart.

7. **Canvas is navigable.** Scroll pans the canvas. Ctrl+scroll zooms. The canvas handles at least 20 cards without noticeable slowdown.

8. **Persistence is reliable.** A complete round-trip -- create card, edit it, move it, resize it, close app, reopen app -- returns the card in the correct state. No silent data loss.

9. **The schema is clean.** The deployed `nodes` table has no `is_container`, `can_have_children`, or `has_children` column. `node_type` is present, defaults to `'card'`, and all rows have the value `'card'`. WAL mode is on. Foreign keys are on.

10. **Derek has signed off.** Derek's DSRP compliance review is complete and has found no blocking issues. Any non-blocking findings are logged as inputs to M2 kickoff.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Prototype-to-production gap is larger than expected.** The prototype is ~950 lines; production code will be larger. Hardening for error handling, edge cases, and TypeScript strictness takes time. | Medium | Medium | The prototype is the starting point, not the spec. Budget for a genuine production pass, not a simple copy. |
| **Tauri IPC friction.** Rust IPC commands, serialization/deserialization, and error propagation between Rust and TypeScript can be fiddly, especially on Windows. First-time Tauri wiring is always slower than expected. | Medium | Medium | Silas should get the IPC layer building and returning test data before Wren depends on it. Wren uses stubs until the real layer is ready. |
| **Persistence stubs diverge from real IPC interface.** If Wren's stubs don't match Silas's actual IPC command signatures, the wiring step causes rework. | Low | Low | Silas and Wren agree on the TypeScript IPC interface signatures (the `db.*` function shapes) before Wren writes stubs. One short alignment conversation prevents this entirely. |
| **Drag-to-nest code in prototype causes confusion.** The prototype has partial drag-to-nest logic. If it is left active in M1, users may accidentally trigger nesting behavior that is not backed by persistence. | Low | Medium | Wren explicitly disables drag-to-nest detection in M1. The code stays in place (commented or behind a feature flag) but does not fire. |
| **Derek's review finds a schema violation.** If Silas added a column or constraint that violates a DSRP non-negotiable, the schema must be corrected before M2. | Low | Medium | Silas re-reads the "Warnings for Silas" section of `docs/m0-kickoff.md` before writing any Rust. The schema is already built from M0; the risk is whether the IPC layer introduced any new modeling decisions that need review. |

---

*M1 is go. The stack is confirmed. The prototype is proven. The work is execution, not exploration.*

*Questions to Maren.*

-- Maren
