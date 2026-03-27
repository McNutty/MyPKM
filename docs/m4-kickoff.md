# Plectica 2.0 -- M4 Kickoff: Real Modeling

**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-25
**Status:** DRAFT -- pending user review before execution begins
**Prerequisite:** M3 COMPLETE (all 12 done criteria met, Derek's M3 review signed off)

---

## M4 Goal

Get the app to a state where the user can start using it for real modeling -- real DSRP thinking on real problems.

M3 completed the DSRP feature set: Distinctions, Systems, and Relationships are all first-class entities on the canvas. What M4 adds is the infrastructure for serious use: multiple named canvases (Models) so different problems stay separated, a note panel for deep-diving into a single card without losing the canvas view, multi-select so the user can reorganize at scale, and undo/redo so mistakes are recoverable. These are not polish items -- they are the difference between a tool someone demos and a tool someone thinks in every day.

By the end of M4:
- The user can create, name, switch between, and delete multiple independent Models (canvases).
- Selecting a card opens a side panel showing its content, relationships, and markdown notes -- all editable, with changes reflected on the canvas.
- Multiple cards can be selected via lasso or Shift+click, then moved or deleted as a group.
- Ctrl+Z / Ctrl+Shift+Z undo and redo the most recent operations.

---

## What Carries Forward from M3

| CF # | Item | Source | Priority in M4 |
|---|---|---|---|
| CF-M3-1 | Zoom-into-card navigation (perspective-taking) | Original M2 review, deferred through M3 | Deferred again. Still the right call -- zoom-into-card is a Perspectives feature (Phase 3). M4 is about usability infrastructure, not new DSRP constructs. |
| CF-M3-2 | Conditional header border on childless cards | Derek M2 review | Deferred. Still minor cosmetic. |
| CF-M3-3 | Label slider behavior at high curvature (test 24 note) | M3 user feedback | Should-have. Small refinement -- label should feel like it is attached to the mouse during parallel drag. Wren can include this in M4 if it is low-effort; otherwise defer to M5. |

---

## Architectural Pre-Work (Sequenced First)

Kael's architecture review identified two refactors that must precede M4 feature work. These are not optional cleanup -- they are structural pre-conditions. Starting M4 features without them means building on a foundation that will need to shift underneath the features.

### Pre-1: Extract `mapId` from hardcoded `1`

**Owner:** Wren
**Upstream:** None. Can begin immediately at M4 kickoff.
**Downstream:** Required before Multiple Models feature can be built.

`App.tsx` currently passes `mapId = 1` hardcoded in approximately 20 places (every IPC call that takes a `map_id` argument). To support multiple canvases, `mapId` must become a piece of state -- the currently-active model ID -- that the user can change.

Kael's note: "Schema already supports it (`layout.map_id`, `get_map_nodes(map_id)`) -- just need `mapId` as state + model picker UI." The schema work is already done. This is a pure frontend refactor.

Deliverable: `mapId` is a `useState` value in App.tsx (or lifted to wherever the layout shell will live after Pre-2). All ~20 IPC call sites read from this state. Hardcoded `1` is gone. Passing a different `mapId` loads a different set of cards and relationships.

Validation: Switch `mapId` manually in dev (via console or temp UI) to `2` -- canvas clears and loads a different (empty) set. No hardcoded `1` remains in any IPC call.

### Pre-2: Extract canvas rendering into `<Canvas />` component

**Owner:** Wren
**Upstream:** Pre-1 complete (so `mapId` is clean state before it is threaded through the new component boundary).
**Downstream:** Required before Note Panel can be built. The Note Panel sits alongside the canvas in an app shell layout. That layout requires a `<Canvas />` component that can be placed in a flexbox or grid without App.tsx owning the full viewport.

Currently App.tsx is both the layout shell and the canvas engine. Kael's description: "App.tsx becomes layout shell." The extraction means:

- A new `<Canvas />` component owns all canvas rendering, pan/zoom, drag, and interaction state.
- App.tsx (or a new `<AppShell />`) becomes the top-level layout: `[<Canvas /> | <NotePanel />]` side by side.
- State that both Canvas and NotePanel need (selected card ID, card data) is lifted to the shell level.

This is the highest-effort architectural task in M4. Kael's assessment of App.tsx is 2,532 lines, with `handleMouseMove` (470 lines) and `handleMouseUp` (660 lines) as the dense core. The extraction must be done carefully to avoid regressions across all existing interaction modes.

Kael also recommended considering extracting `useCanvasInteractions` hook during this work, as "multi-select is added" is one of his named split triggers. Wren should evaluate whether the hook extraction belongs in Pre-2 or naturally occurs during the multi-select feature work. The decision is Wren's; flag the choice before beginning.

Deliverable: `src/components/Canvas.tsx` (or equivalent) exists as a focused component. App.tsx (or AppShell) is the layout wrapper. All existing M3 functionality -- cards, nesting, relationships, delete dialog, keyboard shortcuts -- passes a full regression test before any M4 features are built on top.

Validation: Full regression against M3 done criteria (all 12 points). No functional change to the user. App.tsx line count materially reduced.

---

## M4 Features

The four features are sequenced by dependency. Pre-work must complete before features begin.

---

### Feature 1: Multiple Models (Canvases)

**Owner:** Wren (UI), Silas (IPC commands if needed)
**Upstream:** Pre-1 and Pre-2 complete.
**Priority:** Must-have.

The schema already has a `maps` table and `layout.map_id`. The IPC layer already has `get_map_nodes(map_id)` and `get_map_relationships(map_id)`. The backend is largely ready. This feature is primarily frontend work.

**What "Multiple Models" means:**

A model is an independent canvas. Cards and relationships in Model A do not appear in Model B. (Note: this is not Perspectives, which is a different concept -- different views of the same underlying data. Models are genuinely separate thinking spaces.)

**Deliverables:**

1. Model management IPC commands (Silas, if not already present):
   - `create_map(name)` -- creates a new map record, returns `{id, name}`
   - `get_all_maps()` -- returns all maps `[{id, name}]`
   - `rename_map(id, name)` -- updates map name
   - `delete_map(id)` -- deletes a map and all its nodes, layout rows, and relationships (cascade). Returns deleted map ID.

   Check existing schema and commands first. If `create_map` and `get_all_maps` already exist from earlier schema work, Silas confirms and the IPC layer is ready. If not, Silas builds them before Wren builds the UI.

2. Model picker UI (Wren):
   - A model list/switcher visible in the app (sidebar, top bar, or modal -- Wren's call on placement, but it must not eat canvas real estate unnecessarily).
   - Shows all models by name. Clicking a model loads it into the canvas (sets `mapId` state).
   - "New model" action: creates a model with a default name ("Untitled Model" or similar), switches to it immediately. Canvas is empty.
   - Rename model: inline rename on the model name. Persists immediately.
   - Delete model: confirmation dialog ("Delete this model and everything in it?"). Cascade delete. No orphaned nodes.
   - The currently active model is visually distinguished in the picker.

3. Default model on first run: the existing hardcoded Map 1 becomes "Default" (or user renames it). First-run initialization creates a model with a real name, not a magic ID.

**Validation:**
- Create three models. Add distinct cards to each. Switch between them -- each canvas shows only its own cards and relationships.
- Rename a model -- name updates immediately and persists across reload.
- Delete a model -- all its cards, relationships, and layout rows are gone. No orphaned data.
- App opens to the last-active model (or a sensible default if this is the first run).
- All existing M3 functionality (nesting, relationships, deletion) works inside each model.

---

### Feature 2: Note Panel

**Owner:** Wren (UI), Silas (if new IPC queries needed)
**Upstream:** Pre-2 complete (Note Panel is placed in the layout shell alongside `<Canvas />`).
**Priority:** Must-have.

**What the Note Panel shows:**

When a card is selected on the canvas, a side panel opens (or becomes active if already visible) showing:

1. **Card title / label** -- editable. Changes update the card on the canvas immediately.
2. **Relationships** -- a list of all relationships where this card is a source or target. Each entry shows: direction (outgoing / incoming), the action label, and the name of the other card. Clicking an entry selects that relationship on the canvas (or navigates to the other card -- Wren's call on which is more useful).
3. **Markdown notes** -- a text area below the relationships list. The user can type free-form markdown notes about this card. Notes are persisted to the DB (see schema note below).

**Schema note for Silas:** Cards currently have a `content` field (the label text visible on the canvas card). Notes are longer-form text that does not display on the canvas card itself. Silas should determine whether notes live in `nodes.notes` (a new column on the existing nodes table) or in a separate `node_notes` table. Recommendation: a `notes TEXT` column on `nodes` is sufficient for M4 -- no need for a separate table unless versioning or multi-block notes are planned. Silas confirms the approach and provides the migration + IPC command (`update_node_notes(id, notes)` and ensure `get_map_nodes` or a new `get_node(id)` returns the notes field).

**Panel behavior:**
- Panel is visible when a card is selected, empty/hidden or showing a default state when nothing is selected.
- Panel does not close when the user clicks on the canvas (it stays visible while anything is selected). It resets or hides when the user clicks empty canvas to deselect.
- Panel width: fixed or user-resizable. Start with fixed. Wren decides on the default width -- it should not compress the canvas to unusability.
- Editing card title in the panel is equivalent to editing it on the canvas. The canvas card label updates in real time (or on commit -- Wren's call).
- Editing notes is auto-saved (on blur or with a short debounce). No explicit save button needed.
- Markdown notes display as rendered markdown when not being edited. Click to edit (or a toggle). For M4, basic markdown rendering is sufficient (bold, italic, headings, bullets). No need for a full block editor.

**Validation:**
- Select a card -- panel shows its title, a list of its relationships (with correct directions and action labels), and its notes (empty initially).
- Edit the title in the panel -- canvas card updates.
- Edit notes, click away -- notes saved and rendered as markdown on next view.
- Card with 3 outgoing and 2 incoming relationships -- all 5 appear in the relationships list with correct labels and directions.
- Deselect (click empty canvas) -- panel resets or hides.
- All panel data persists across reload.

---

### Feature 3: Multi-Select and Group Operations

**Owner:** Wren
**Upstream:** Pre-2 complete. Feature 1 and Feature 2 can be in progress in parallel -- multi-select does not depend on them. However, Kael flagged that adding multi-select is a split trigger for `useCanvasInteractions` hook extraction; Wren should ensure Pre-2 is fully complete (including any hook extraction decision) before beginning this feature.
**Priority:** Must-have.

**Interactions:**

1. **Lasso select (rubber-band):** Click-drag on empty canvas draws a selection rectangle. On mouse-up, all cards whose bounds intersect the rectangle are selected. Cards gain a "selected" visual state (distinct border, color, or overlay).

2. **Shift+click to extend:** Shift+clicking a card adds it to the current selection (or removes it if already selected). Shift+clicking empty canvas does not clear the selection.

3. **Click to clear:** Clicking empty canvas (without Shift) clears the selection.

**Group operations on selected cards:**

- **Move:** Dragging any selected card moves all selected cards together. Relative positions are preserved. The interaction is: drag starts on one card, all selected cards translate by the same delta.
- **Delete:** Pressing Delete with multiple cards selected shows a confirmation dialog: "Delete [N] selected cards and everything inside them?" On confirm, cascade-delete all selected cards (using `delete_node_cascade` for each, or a new batch backend command if Silas adds one). On cancel, no change.
- **Nest (stretch goal for M4):** Dragging the selection into a parent card nests all selected cards under that parent. This is complex -- only include if Wren determines it is low-risk after the move and delete operations are stable. Do not block M4 closure on nest.

**What is NOT in group operations for M4:**
- Group resize (stretch all selected cards proportionally) -- deferred
- Alignment / distribution -- deferred
- Copy/paste -- deferred

**Kael's architecture note:** Kael recommended a "batch write IPC command" (single Rust transaction) as beneficial for multi-select group moves. Silas should evaluate whether a `batch_update_layouts(updates: [{id, x, y, w, h}])` command is worth adding for M4. If the individual-write approach is fast enough for groups of 10-20 cards, defer the batch command. Silas makes this call.

**Validation:**
- Lasso drag on empty canvas -- selection rectangle appears, cards inside it become selected on mouse-up.
- Shift+click adds a card to an existing selection.
- Shift+click a selected card -- it deselects; others remain selected.
- Click empty canvas -- selection clears.
- Drag any selected card -- all selected cards move together, relative positions preserved.
- Move group positions persist after reload.
- Delete with 3 cards selected -- confirmation dialog shows correct count. Confirm removes all 3 (and their descendants). Cancel leaves all intact.
- Multi-select does not interfere with single-card drag, relationship drawing, or space-pan.
- Lasso on a canvas with existing relationships -- selected cards acquire selection state, relationship lines are not accidentally selected or broken.

---

### Feature 4: Undo / Redo

**Owner:** Wren
**Upstream:** Pre-2 complete. Can be developed in parallel with Features 1-3, but should be the last feature to finalize -- it needs to cover all operations introduced in M4 (including multi-select delete and model switching effects).
**Priority:** Must-have.

**Scope for M4:**

Undo/redo for the most recent operations. This is not a deep unlimited history -- it is recovery from accidental actions. The user makes a mistake, presses Ctrl+Z, and the last thing they did is reversed.

**Operations that must be undoable:**
- Create card
- Delete card (leaf)
- Delete subtree (cascade)
- Delete relationship
- Move card (position change)
- Rename card (label edit)
- Nest card (parent change)
- Unnest card (parent change)
- Create relationship
- Edit relationship label

**Operations in M4 scope that must also be undoable:**
- Move group (multi-select move)
- Multi-select delete

**Operations explicitly out of undo scope for M4:**
- Model create/delete/rename -- excluded for now; model management is high-level and undo here adds significant complexity for low benefit.
- Note panel edits (markdown notes) -- excluded. Notes are free-form text; undo for text editing is handled by the browser natively in the text area.

**Implementation approach:**

Undo/redo is a snapshot or command stack. Wren's call on the implementation pattern. Two reasonable approaches:

- **Command pattern:** Each operation is a `{do, undo}` pair. The undo stack is a list of commands. Ctrl+Z calls the top command's `undo` function; Ctrl+Shift+Z calls the redo stack's top command's `do` function. Clean and explicit but requires wrapping every operation.
- **State snapshots:** Before each operation, snapshot the relevant state (card map, relationships). Ctrl+Z restores the previous snapshot. Simpler to add to existing code but more memory-intensive and requires syncing the snapshot back to the DB.

Given the existing architecture (optimistic updates that write to DB on mouse-up), the command pattern is the better fit -- each operation already has a clear "forward" path; adding an "undo" path is a matter of adding the inverse IPC call. Wren should validate this before committing.

**Stack depth:** A reasonable default is 50 operations. No need for unlimited history in M4.

**Keyboard shortcuts:** Ctrl+Z (undo), Ctrl+Shift+Z (redo). These are already partially reserved in the codebase -- Wren checks for conflicts with M3 shortcuts before implementing.

**Validation:**
- Create a card, Ctrl+Z -- card disappears. Ctrl+Shift+Z -- card reappears.
- Nest a card into a parent, Ctrl+Z -- card unnests. Ctrl+Shift+Z -- re-nests.
- Delete a card, Ctrl+Z -- card reappears with its original content and position.
- Move a card, Ctrl+Z -- card returns to previous position.
- Create a relationship, Ctrl+Z -- relationship removed.
- Multi-select move 3 cards, Ctrl+Z -- all 3 return to previous positions.
- Multi-select delete 3 cards, Ctrl+Z -- all 3 reappear with relationships intact.
- Perform 5 operations, Ctrl+Z five times -- each step reverses correctly.
- Ctrl+Shift+Z after undoing 3 steps -- re-applies all 3 in order.
- Undo while editing card text -- does not interfere with text input (Ctrl+Z inside a text field uses browser native undo, not app undo).
- All undo/redo effects persist correctly to DB (not just in-memory state).

---

## Dependency and Sequencing Map

```
M3 COMPLETE (precondition for all M4 work)

PRE-WORK -- sequenced first, blocks feature work
  Pre-1: Extract mapId from hardcoded 1 (Wren)
    --> No upstream dependencies. Begin at M4 kickoff.
  Pre-2: Extract <Canvas /> component (Wren)
    --> Requires Pre-1 complete.
    --> Wren decides on useCanvasInteractions hook extraction scope before beginning.
    --> Full M3 regression test after Pre-2 before any feature work begins.

SILAS -- schema + IPC pre-work (can run parallel to Wren's Pre-1)
  Schema check: confirm create_map, get_all_maps, rename_map, delete_map exist or build them.
  Schema addition: notes column on nodes table + migration + update_node_notes IPC command.
  Decision: batch_update_layouts command for multi-select -- evaluate and decide.
  --> Silas delivers IPC contracts for Feature 1 and Feature 2 before Wren builds those features.

FEATURE 1: Multiple Models (Wren + Silas)
  --> Requires Pre-1, Pre-2 complete.
  --> Requires Silas model-management IPC commands delivered.

FEATURE 2: Note Panel (Wren + Silas)
  --> Requires Pre-2 complete.
  --> Requires Silas notes column + IPC command delivered.
  --> Can run in parallel with Feature 1 once Pre-2 is done.

FEATURE 3: Multi-Select (Wren)
  --> Requires Pre-2 complete.
  --> Can run in parallel with Features 1 and 2.
  --> Silas evaluates batch_update_layouts and delivers if warranted.

FEATURE 4: Undo/Redo (Wren)
  --> Requires Pre-2 complete.
  --> Should be finalized after Features 1-3 are stable (to cover all M4 operations).
  --> Can be developed in parallel but is validated last.

DEREK -- DSRP compliance review
  --> After Wren's self-verification on all four features.
  --> Focus: Note Panel DSRP consistency, no new conceptual violations.
  --> M4 does not close until Derek signs off.
```

**Critical path:** Pre-1 and Pre-2 are sequential and gate everything. Pre-2 (the `<Canvas />` extraction) is the largest single piece of work in M4. The rest can proceed in parallel once Pre-2 is done.

**Silas is not idle during Pre-work.** Schema check and notes column work can proceed as soon as M4 kicks off, in parallel with Wren's Pre-1 and Pre-2 work.

---

## Done Criteria for M4

M4 is complete -- and M5 planning may begin -- when ALL of the following are true:

**Pre-work:**
1. No hardcoded `mapId = 1` exists anywhere in the frontend code. `mapId` is state.
2. `<Canvas />` is a distinct component. App.tsx (or AppShell) is the layout shell. Full M3 regression passes with no functional regressions.

**Multiple Models:**
3. The user can create, rename, switch between, and delete models.
4. Each model has an independent set of cards and relationships. Switching models loads the correct set.
5. Deleting a model removes all its data. No orphaned rows.
6. App reopens to a sensible model (last-active or default).

**Note Panel:**
7. Selecting a card opens the note panel with the card's title, relationships (correct directions and labels), and notes.
8. Editing the title in the panel updates the canvas card.
9. Editing notes persists and renders as markdown.
10. Deselecting a card resets the panel.
11. All panel data survives reload.

**Multi-Select:**
12. Lasso selects multiple cards. Shift+click extends the selection.
13. Dragging any selected card moves the group. Relative positions preserved. Persists.
14. Delete with multiple cards selected triggers a confirmation and removes all (with their descendants and relationships) on confirm.

**Undo/Redo:**
15. Ctrl+Z undoes the last operation for all in-scope operation types (including multi-select move and delete).
16. Ctrl+Shift+Z redoes the undone operation.
17. Multi-step undo/redo works correctly for at least 10 consecutive operations.
18. Undo/redo effects are reflected in the DB, not just in-memory state.

**Quality:**
19. No regressions from M3. All 12 M3 done criteria still hold.
20. Derek has reviewed and signed off. See `docs/m4-derek-review.md`.

---

## Open Questions

These need resolution before or during M4 execution. Flagged by owner.

| Q# | Question | Owner | Blocking What | Priority |
|---|---|---|---|---|
| Q22 | Where does the model picker live in the UI? | **RESOLVED:** Left sidebar. Three-panel layout: left sidebar (model picker), center (canvas), right sidebar (note panel). | Feature 1 UI design | Resolved |
| Q23 | Does the note panel replace the right side of the screen or appear as an overlay? | **RESOLVED:** Right sidebar, persistent. The right sidebar should be modular — capable of hosting multiple panels (e.g., multiple note panels for different selected cards). Architecture should support this from the start. | Pre-2 layout shell design | Resolved |
| Q24 | Should `notes` live in `nodes.notes` (new column) or a separate table? Recommendation is a column, but Silas confirms. | Silas | Feature 2 schema | Before Feature 2 begins |
| Q25 | What markdown renderer for the note panel? Options: `react-markdown` (lightweight, well-maintained), `marked` + sanitize, or a minimal custom renderer for just the basics (bold, italic, headings, bullets). Given the existing dependency footprint, Wren chooses. | Wren | Feature 2 implementation | Before Feature 2 begins |
| Q26 | Should `useCanvasInteractions` hook extraction be part of Pre-2, or deferred to when multi-select is added (Feature 3)? Kael listed Feature 3 as the natural split trigger. Wren evaluates and decides before starting Pre-2. | Wren | Pre-2 scope | Before Pre-2 begins |
| Q27 | What is the undo implementation pattern -- command stack or state snapshots? Wren's call, but should be decided before Feature 4 begins, and the decision should be documented. | Wren | Feature 4 | Before Feature 4 begins |
| Q28 | Does `delete_map` cascade-delete all nodes, layout, and relationships cleanly with the existing schema FK constraints? Silas verifies. | Silas | Feature 1 delete | Before Feature 1 begins |

Q22 and Q23 resolved by user (2026-03-25). The app uses a three-panel layout: left sidebar (model picker), center (canvas), right sidebar (modular note panels). The right sidebar architecture must support multiple panels from the start.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Pre-2 extraction causes regressions.** App.tsx at 2,532 lines with 7 interaction modes in handleMouseMove. Splitting incorrectly can introduce subtle state-sharing bugs across modes. | Medium | High | Full M3 regression test required after Pre-2, before any feature work. Wren should extract incrementally and test at each step rather than doing a large-bang refactor. |
| **Undo/redo scope creep.** Undo is deceptively large once all operation types are included. Adding multi-select, model switching, and note edits could balloon the implementation. | Medium | Medium | Scope is explicitly limited in this spec. Model management and note panel edits are out of undo scope. Wren flags if any in-scope operation is unexpectedly complex. |
| **Note panel state synchronization.** Canvas state (card labels) and note panel state (title field) need to stay in sync. If they diverge, edits in one place do not reflect in the other. | Medium | Medium | Lift card data to the shell level (a consequence of Pre-2). Both Canvas and NotePanel read from the same state. Wren ensures there is one source of truth, not two. |
| **Multi-select conflicts with existing gestures.** Lasso draw (click-drag on empty canvas) must not conflict with canvas pan (space+drag), card drag (drag on card), or relationship draw (drag from handle). Adding a new mouse mode is where bugs accumulate. | Medium | Medium | Clear mode prioritization: space+held trumps lasso; drag-on-card-body trumps lasso; drag-on-handle trumps lasso. Only a click-drag beginning on empty canvas with no keys triggers lasso. Wren documents the mode dispatch logic before implementing. |
| **Silas schema changes (notes column) require migration.** If users already have a `pkm.db` from M1-M3, the migration must be additive and idempotent. | Low | Medium | Silas follows the established pattern: `ALTER TABLE nodes ADD COLUMN notes TEXT DEFAULT ''` if not exists (or equivalent idempotent migration). Test against existing M3 database. |
| **Model picker UI crowds the canvas.** Adding a model list UI without careful design can fragment the canvas focus. | Low | Medium | Q22 must be answered before Feature 1 begins. Preference is for a compact, collapsible affordance that does not permanently eat canvas real estate. |

---

## Explicitly Deferred to M5+

| Deferred Item | Reason | Target |
|---|---|---|
| Zoom-into-card navigation (Perspectives / CF-1) | Still a Phase 3 feature. M4 does not introduce the perspective-taking concept. | M5 or Phase 3 |
| Packaging and distribution | Scoped to M5 by the user. | M5 |
| MCP Server / AI features | Future. No architectural changes needed in M4. | Future |
| Text-to-canvas AI | Needs auto-layout algorithm first. | Future |
| Multi-select nest (drag group into parent) | Stretch goal within M4 Feature 3; explicitly not a closure requirement. | M4 stretch / M5 |
| Group resize and alignment | Useful but not core to "real modeling." | M5 |
| Copy / paste (cards or groups) | High value but scoped out of M4. | M5 |
| Undo for model management | Disproportionate complexity for the use case. | Future |
| Deep unlimited undo history (50+ operations) | 50-operation stack is sufficient for M4. | Future |
| Block editor for notes | `react-markdown` or equivalent rendering is sufficient. Full block editor (Notion-style) is Phase 3+. | Future |

---

## Reference Documents

- `docs/m3-kickoff.md` -- M3 authoritative spec (Relationships + Polish)
- `docs/architecture-review-2026-03-25.md` -- Kael's architecture review (source of all Pre-work items)
- `docs/roadmap.md` -- Living roadmap; this milestone moves the project from "functional tool" to "usable tool"
- `User input/Vision.md` -- User's forward-looking feature vision (source of all four M4 features)
- `User input/Tasks M3.md` -- M3 task tracker (closed M3 items and carry-forwards into M4)

---

*Pre-1 and Silas's schema work can begin immediately at M4 kickoff. Pre-2 begins after Pre-1 is complete. Q22 and Q23 should be answered by the user before Pre-2 begins, as they shape the layout shell design.*

*Questions to Maren.*

-- Maren
