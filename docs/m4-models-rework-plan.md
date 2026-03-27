# M4 Models Rework: Implementation Plan
**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-27
**Status:** DRAFT -- pending Note Panel user input before Phase 1 begins
**Task reference:** T4-23 (Multiple Models Rework + Card Views)

---

## PENDING INPUT -- Do Not Begin Phase 1 Without This

The user has indicated they have thoughts about the **Note Panel** (M4 Feature 2) in relation to this rework that they want to contribute before implementation begins.

This is not a blocking risk in isolation -- the parent_id migration and Model card schema work can be scoped and designed independently. However, Model cards change the navigation model of the app significantly, and the Note Panel is the primary surface for deep-diving into a card's identity. How the Note Panel behaves when you are inside a Model card (are you viewing a "nested" canvas or a full-context switch?) may affect both the Note Panel design and the Model card interaction design.

**Action required:** User provides their Note Panel thoughts before any Phase 1 implementation work begins. Maren will update this plan accordingly before handing off to Silas and Wren.

---

## What This Plan Covers

T4-23 introduces two interlocking features that together constitute a significant architectural rework of Ambit:

- **Models as Cards:** The canvas-switching paradigm (currently: left sidebar) is replaced by a first-class `model` card type. Models nest, organize, and are navigated like any other card -- but entering one switches the active canvas. A `Home` model is the root. Breadcrumbs replace the sidebar.

- **Card Views:** A single card (concept node) can appear in multiple models simultaneously. Each appearance is a View -- an independent visual representation with its own position and parent within that model. Content is shared; layout is per-model. This makes Perspective a first-class experience: the same concept seen from different model contexts.

These two features are separable for implementation purposes. Models as Cards has a hard dependency on a schema change (adding `node_id` to `maps`). Card Views has a harder dependency on a different schema change (`parent_id` moving from `nodes` to `layout`). The `parent_id` migration is the highest-risk item in this entire plan.

---

## Current Schema State (Baseline)

Key facts relevant to this rework:

- `maps (id, name, created_at, updated_at)` -- no `node_id` column yet
- `nodes (id, parent_id, content, node_type, ...)` -- `node_type` CHECK currently allows `'card'` and `'relationship'` only; `'model'` is not yet valid. `parent_id` is global (not per-map).
- `layout (id, node_id, map_id, x, y, width, height)` -- `UNIQUE(node_id, map_id)`. This constraint already supports Card Views structurally -- a node can have one layout row per map. However, `parent_id` living in `nodes` means a card can only have one parent globally, which breaks Card Views.
- `relationships (id, source_id, rel_node_id, target_id, label, map_id, ...)` -- already scoped per map. No changes needed here.

The `UNIQUE(node_id, map_id)` constraint in `layout` is the foundation Card Views needs. The missing piece is moving `parent_id` out of `nodes` and into `layout`.

---

## The Two Schema Changes

### Change A: Add `node_id` to `maps` (Model Cards)

**What it does:** Links each map to a backing card. The Home map has `node_id IS NULL`. Every other map has a `node_id` pointing to a `node_type = 'model'` card that represents it on its parent map.

**Scope:** Additive. One new nullable column on `maps`. One new value in the `node_type` CHECK constraint (requires a table rebuild -- this pattern is already established in `db.rs` for the previous `node_type` migration).

**Risk:** Low. Additive change. The table rebuild pattern is tested and working.

### Change B: Move `parent_id` from `nodes` to `layout` (Card Views)

**What it does:** `parent_id` currently lives in `nodes`, making it global -- a card has one parent everywhere. Moving it to `layout` makes it per-map -- a card can have a different parent (or no parent) in each model it appears in.

**Scope:** Destructive migration. The `nodes` table loses a column. The `layout` table gains a column. Every piece of code that reads or writes `parent_id` must be updated: Rust structs, SQL queries in `commands.rs`, all `update_node_parent` calls, the `delete_node_cascade` logic (which walks the parent chain), and the push-mode/cascade logic in `canvas-store.ts` (which uses `parent_id` to traverse the hierarchy).

**Risk: HIGH.** This is the largest blast radius item in the entire plan. See the Risk section below.

---

## Phase Sequencing

The phases are ordered by dependency. Each phase produces a working, tested state before the next begins. No phase starts on top of an untested foundation.

### Phase 0: Preparation (no code changes)

**Precondition for all implementation work.**

- User provides Note Panel input (see PENDING INPUT above).
- Maren updates this plan based on that input.
- Silas writes a detailed migration spec for Change B (`parent_id` to `layout`), identifying every query, struct, and frontend call site that touches `parent_id`. This spec becomes the checklist for Phase 2.
- Wren reads the migration spec and flags any canvas-store logic that will be affected beyond what Silas can see from the Rust layer.

Deliverable: A complete, reviewed change list for the `parent_id` migration before a single line of code is written.

---

### Phase 1: Model Card Schema + Model Cards Feature

**Depends on:** Phase 0 complete. Note Panel user input received.

**Owners:** Silas (schema + IPC), Wren (UI)

**What ships:** Models become cards on the canvas. The left sidebar goes away. Home model is the root canvas. Entering a model card switches the active canvas. Breadcrumbs show the navigation path.

**Silas deliverables:**

1. Add `node_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL` column to `maps`. Nullable. Home map has `NULL`.
2. Expand `node_type` CHECK to include `'model'`. Use the table-rebuild pattern already in `db.rs`.
3. New IPC commands:
   - `create_model_card(parent_map_id, name, x, y) -> Result<(MapData, NodeData), String>` -- creates both the backing node (type `model`) and the new map in a single transaction, linking them via `maps.node_id`.
   - `enter_model(node_id) -> Result<MapData, String>` -- given a model card's node_id, returns its associated map.
   - `get_breadcrumb_path(map_id) -> Result<Vec<BreadcrumbItem>, String>` -- walks the map -> node -> parent node -> parent map chain upward to produce the breadcrumb trail.
4. Seed migration: the default map gets `node_id = NULL` (already the case as the column is nullable). No data change needed for existing maps.

**Wren deliverables:**

1. Remove the left sidebar model-picker component.
2. Model cards render distinctly on the canvas -- visually different from concept cards (Derek to advise on the visual treatment, but the mechanism is `node_type === 'model'` on the card component).
3. Entering a model card: clicking a dedicated button on the card (or a confirmed gesture -- see Open Questions) calls `enter_model(node_id)`, sets `mapId` to the returned map's id, and loads that canvas.
4. Breadcrumb bar replaces the model-switching mechanism. Each breadcrumb item is a clickable link that sets `mapId` back to that map's id. "Home" is always the root item.
5. Creating a new model: the user creates a model card on the canvas the same way they create any card, but picks `model` as the type (or there is a dedicated shortcut -- open question). This calls `create_model_card` which creates the backing map in the same transaction.
6. Model cards on the canvas participate in the full push/nest/resize system like any other card. They are not special-cased in canvas-store logic.

**Validation (done criteria for Phase 1):**
- Create a model card on Home canvas. Double-click (or button) enters it -- canvas switches to the model's empty canvas.
- Breadcrumbs show `Home > [Model name]`. Clicking `Home` returns to the Home canvas.
- Create a card inside the model, navigate back to Home -- the model card is still there; entering it again shows the card created inside.
- Create a model card inside a model card. Navigate three levels deep. Breadcrumbs show all three levels correctly.
- Model cards participate in push-mode: resizing a sibling concept card pushes the model card. Nesting works. Shift+double-click fit-to-contents includes model cards.
- All M3 + prior M4 done criteria still hold. Full regression required before Phase 2 begins.
- The left sidebar is gone. Model management happens entirely through the canvas and breadcrumbs.

---

### Phase 2: `parent_id` Migration (the risky one)

**Depends on:** Phase 1 complete and passing full regression.

**Owners:** Silas (schema + Rust), Wren (canvas-store + frontend)

**Why this is its own phase:** This migration touches the structural foundation of every nesting and hierarchy operation in the app. It must be done in isolation -- not bundled with Card Views feature work -- so that any regressions can be attributed cleanly. Phase 2 produces no visible feature change. It is a pure internal refactor. The user will not see a difference. The test suite will.

**What changes:**

1. `layout` table gains `parent_id INTEGER REFERENCES nodes(id) ON DELETE SET NULL`. Nullable. `ON DELETE SET NULL` is appropriate here: if a parent card is deleted, the child becomes a root card on that map (not a cascade delete).
2. `nodes` table loses `parent_id`. This requires a full table rebuild (SQLite cannot DROP COLUMN on tables with FK constraints unless the column is not referenced elsewhere -- Silas to verify).
3. Migration: backfill `layout.parent_id` from `nodes.parent_id` for all existing layout rows. Every existing node that had a parent gets that parent copied into its layout row for its current map.
4. All Rust structs (`NodeWithLayout`) that expose `parent_id` now read from `layout` not `nodes`.
5. All queries that join or filter on `nodes.parent_id` are rewritten to use `layout.parent_id`.
6. `update_node_parent(node_id, new_parent_id)` must become `update_node_parent(node_id, map_id, new_parent_id)` -- the parent change is now per-map.
7. `delete_node_cascade` walks the parent chain via `layout.parent_id` for the relevant `map_id`.
8. Frontend `canvas-store.ts`: every read of `card.parent_id` is now guaranteed to be map-scoped (since it comes from `layout`). The store should not need logic changes if the IPC contract is unchanged. However, Wren must audit every `getChildren`, `autoResizeParent`, `applyPushMode`, and cascade function to confirm they behave correctly with the new source.

**Validation (done criteria for Phase 2):**
- No visible behavior change to the user. All Phase 1 done criteria still hold.
- Full M3 regression suite passes without modification.
- The following specific behaviors are explicitly retested:
  - Nesting a card (drag into parent) -- `layout.parent_id` updates correctly for the active map.
  - Unnesting a card (drag out of parent) -- `layout.parent_id` set to NULL for the active map.
  - `delete_node_cascade` on a parent card removes all descendants. Verified via DB inspection (no orphan layout rows).
  - `autoResizeParent` still correctly identifies children of a card on the active map.
  - `applyPushMode` cascade still propagates correctly up the ancestor chain.
  - Shift+double-click cascading fit-to-contents still works through all ancestor levels.
  - Switching maps after Phase 2: a card that is a child in Map A and (currently) not placed in Map B still shows up correctly in Map A.

**Do not proceed to Phase 3 until all of the above pass.**

---

### Phase 3: Card Views

**Depends on:** Phase 2 complete and stable.

**Owners:** Silas (IPC), Wren (UI), Derek (DSRP review)

**What ships:** A card can be placed on multiple maps simultaneously. Each placement is a View -- independent position, independent parent. Content changes (title, notes) reflect everywhere. Relationships remain per-map (already correct).

**Silas deliverables:**

1. New IPC command: `add_card_view(node_id, target_map_id, x, y) -> Result<LayoutData, String>` -- inserts a new row into `layout` for the given node on the target map. The `UNIQUE(node_id, map_id)` constraint prevents duplicates. Returns the new layout row. No new node is created.
2. New IPC command: `remove_card_view(node_id, map_id) -> Result<RemoveViewResult, String>` -- removes the layout row for this node on this map. If other views exist on other maps, the node persists. If this was the last view, the node itself is deleted (full cascade -- descendants, relationships, layout rows). Returns an enum/flag indicating which case occurred so the UI can react appropriately.
3. `get_map_nodes` response: add a field indicating how many maps a given node appears on (or a simple `has_other_views: bool`). This lets the UI indicate that a card is a View.
4. Content updates (`update_node_content`, `update_node_notes`) are already per-node, not per-map -- no change needed. This is correct: content is shared.

**Wren deliverables:**

1. UI affordance to place an existing card as a View on the current map. Design TBD (drag from a panel? context menu? keyboard shortcut?). This calls `add_card_view`.
2. Card visual indicator when `has_other_views === true` -- a subtle mark (icon, border treatment, or badge) that signals "this card also exists in other models." Derek to advise on the visual language; the mechanism is the `has_other_views` field from the IPC layer.
3. Removing a View: a context action on a card that removes it from the current map. Calls `remove_card_view`. If other views exist, only this placement is removed. If this is the last view, the card itself is deleted -- with the standard confirmation dialog if it has parts (same UX as the existing delete flow). The user never needs to distinguish between "remove view" and "delete card" -- the system handles it seamlessly.
4. Content edits in one view reflect immediately in other views. This should be automatic if the canvas re-fetches on content changes (which it already does via `updateNodeContent`). Wren verifies this works across maps -- switch to another map containing the same card, confirm the title update is reflected.

**Validation (done criteria for Phase 3):**
- Place card A on Home map. Navigate to Model X. Place card A as a View on Model X. Both maps show card A.
- Edit card A's title on Home map. Navigate to Model X -- card A's title is updated there too.
- Edit card A's notes in Model X -- navigate to Home, select card A -- same notes visible in the Note Panel.
- Card A's position in Home is independent of its position in Model X. Move card A on Home -- position in Model X unchanged.
- Card A in Home is a child of card B. Card A in Model X is a root card. The parent relationships are independent and correct per map.
- The "other views" indicator is visible on card A in both maps.
- Remove card A's View from Model X. Card A is gone from Model X. Card A still exists on Home. No orphaned rows in DB.
- Remove card A's last remaining View (on Home). Card A is fully deleted -- no node row, no layout rows, no orphans.
- Remove last View of a card with parts -- confirmation dialog appears (same as existing delete flow). Cancel preserves everything.
- All Phase 1 and Phase 2 done criteria still hold.

---

## Dependency Map

```
Phase 0: Preparation
  Note Panel user input received
  Silas writes parent_id migration spec (all call sites enumerated)
  Wren reviews spec, flags canvas-store impact
  |
  v
Phase 1: Model Card Schema + Models-as-Cards Feature
  Silas: maps.node_id column, node_type 'model', create_model_card, enter_model, get_breadcrumb_path
  Wren: remove sidebar, model card rendering, enter gesture, breadcrumbs, create model flow
  Full regression before Phase 2 begins
  |
  v
Phase 2: parent_id Migration (internal refactor, no visible feature)
  Silas: layout.parent_id column, nodes table rebuild, backfill, Rust query rewrites
  Wren: audit canvas-store, confirm IPC contract unchanged, targeted regression tests
  Full regression before Phase 3 begins
  |
  v
Phase 3: Card Views
  Silas: add_card_view, remove_card_view, has_other_views on get_map_nodes
  Wren: place-as-view affordance, view indicator, remove-view action, cross-map content sync verification
  Derek: DSRP review of Card Views implementation
```

**What can run in parallel within a phase:** Within Phase 1, Silas's schema/IPC work and Wren's UI work can overlap once Silas has delivered the IPC contracts (even as stubs). Wren should not build UI that calls IPC commands that don't exist yet -- but she can build the rendering and navigation logic against a stub interface and wire up real calls when Silas delivers.

**What cannot be parallelized:** Phases cannot overlap. Phase 2 must not begin until Phase 1 is fully regression-tested. Phase 3 must not begin until Phase 2 is fully regression-tested. The `parent_id` migration is the kind of change that creates subtle, delayed failures -- do not stack feature work on top of an unverified migration.

---

## Relationship to Other M4 Features

### Note Panel (M4 Feature 2)

This is the feature the user has pending input on. Two integration points that this rework introduces:

1. **Which map does the Note Panel show relationships for?** Currently relationships are per-map. In a world with Card Views, a card can have relationships in multiple maps. When the Note Panel lists a card's relationships, does it show relationships for the current map only, or across all maps? The most coherent answer is: current map only (consistent with how the canvas works), with a future affordance to see cross-map relationships. But the user should confirm this before Note Panel implementation.

2. **Note Panel when inside a Model card canvas:** When you navigate into a Model card and select a card there, the Note Panel shows that card. Nothing unusual. But if the selected card is also a View on another map, the "other views" context may be worth surfacing in the Note Panel. This is a Phase 3 detail, but the Note Panel layout should not preclude it.

3. **Per-perspective notes (confirmed).** Notes are stored per-view, not per-card. Each (node_id, map_id) placement carries its own `note TEXT` column on the `layout` table. There is no universal "identity note" on the card itself — all knowledge is perspectival, and a perspective-free note would violate DSRP's core claim that observation is always from a point. The card's only perspective-independent properties are its ID and title (the Distinction boundary). The Note Panel shows one note per perspective the card appears in, with the current model's note visually prominent. See `docs/dsrp-design-log.md` entry 1 for the full reasoning.

The Note Panel's schema work (`layout.note TEXT`, `layout.updated_at TEXT`) is independent of this rework and can proceed in parallel with Phase 1. Silas can add these columns at any point.

### Multi-Select (M4 Feature 3)

No direct conflict with this rework. Multi-select operates on the active map's cards. After Phase 2, those cards still have `parent_id` in their layout rows -- the IPC contract to the frontend is unchanged. Multi-select can be developed in parallel with Phases 1 and 2, provided it does not touch `parent_id` logic directly.

One caveat: if Multi-Select implements group-nest (the stretch goal), that involves changing `parent_id`. This should wait until Phase 2 is complete.

### Undo/Redo (M4 Feature 4)

Undo/Redo should be the last M4 feature to finalize. This rework introduces new undoable operations: entering a model (probably not undoable -- navigation is not typically undoable), creating a model card (undoable), placing a card view (undoable), removing a card view (undoable). Wren should account for these when building the undo stack, and should not finalize Undo/Redo until Phase 3 is stable.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **`parent_id` migration causes silent regressions in push-mode/cascade.** The cascade logic in `canvas-store.ts` calls `getChildren` repeatedly, which filters by `parent_id`. If the migration changes the data shape in any subtle way, cascades could silently traverse fewer or more nodes. | High | High | Phase 2 is a standalone phase with explicit cascade tests. Wren audits every `getChildren`, `autoResizeParent`, `applyPushMode` call during Phase 2. Do not start Phase 3 until these pass. |
| **`delete_node_cascade` breaks after `parent_id` moves to `layout`.** The Rust cascade walks `parent_id` from `nodes`. After the migration, this walk must use `layout.parent_id` scoped to the relevant `map_id`. Incorrectly scoped deletes could leave orphan layout rows or fail to cascade. | High | High | Silas enumerates all cascade paths in the Phase 0 migration spec. Cascade behavior tested explicitly in Phase 2 validation via DB inspection. |
| **`nodes` table rebuild during `parent_id` migration corrupts data.** SQLite table rebuilds (RENAME -> CREATE -> INSERT -> DROP) are safe but must be done within a transaction with FK constraints temporarily disabled. Existing pattern in `db.rs` is established, but this rebuild is more complex (changing column cardinality and FK targets). | Medium | High | Silas tests the migration script against a copy of the live `pkm.db` before running on the real database. Migration is wrapped in a transaction. Rollback path is documented before migration runs. |
| **Model card gesture conflicts with existing card interactions.** The "enter model card" gesture (button click) must not accidentally trigger on normal cards, and must not conflict with double-click (fit-to-contents), drag, or relationship-drawing. | Medium | Medium | Wren defines mode dispatch for the enter gesture explicitly. The button-on-card approach (hover reveal) is the safest -- it requires deliberate interaction and does not conflict with canvas gestures. |
| **Card Views cross-map content sync has latency or inconsistency.** If Map A and Map B both show card X, and the user edits card X in Map A, the title should update in Map B. This relies on React re-rendering from shared state. If Maps A and B are separate component instances (they are -- only one is active at a time), this works automatically on next load. Live sync is not required; the question is whether the canvas correctly re-fetches on mapId switch. | Low | Low | Wren verifies in Phase 3 validation: switch maps, confirm updated content appears. This should work without additional code given the existing `mapId` state pattern. |
| **Home map deletion.** The Home map (`node_id IS NULL`) must not be deletable. If a user could delete it, they would have no root canvas and no way to navigate back. | Low | High | Silas adds a guard in `delete_map`: if the target map has `node_id IS NULL`, return an error. Wren does not render a delete affordance on the Home breadcrumb or on the Home canvas itself. |

---

## Open Questions

These need resolution before or during the phases listed.

| Q# | Question | Owner | Blocking |
|---|---|---|---|
| Q-MR-01 | What gesture enters a model card? Options: (a) dedicated button visible on hover, (b) Shift+double-click (conflicts with cascading fit-to-contents -- probably not), (c) a new keyboard shortcut while the card is selected, (d) Enter key while selected. | User + Wren | Phase 1 UI |
| Q-MR-02 | How does the user create a model card? Same as creating a concept card but with a type selector? Dedicated key (e.g., `m` instead of `c`)? Context menu option? | User + Wren | Phase 1 UI |
| Q-MR-03 | Does the Note Panel show relationships for the current map only, or across all maps the card appears in? | User | Note Panel + Phase 3 |
| Q-MR-04 | How does the user place an existing card as a View on the current map? This is the Phase 3 interaction design question. Options: drag from a card browser panel, context menu on a card, keyboard command with a card picker. | User + Wren | Phase 3 UI |
| Q-MR-05 | What visual treatment distinguishes model cards from concept cards? This should be reviewed with Derek before Phase 1 ships -- the visual language matters for DSRP legibility. | Derek + Wren | Phase 1 visual design |
| Q-MR-06 | What visual treatment indicates a card is a View (appears in multiple models)? | Derek + Wren | Phase 3 visual design |

---

## Explicitly Deferred

These are ideas that arose during analysis but are out of scope for this rework.

| Deferred Item | Reason | Target |
|---|---|---|
| Cross-map relationship visibility in Note Panel | Requires deciding the relationship scoping model first (Q-MR-03). Low risk to defer -- per-map view is coherent on its own. | M5 or after |
| Moving a card View to a different parent within the same map while it has views on other maps | Standard nesting interaction, should just work after Phase 2. Flag if it does not. | Verify in Phase 3 |
| Merging two models (moving all cards from one model into another) | No user story for this yet. Complex to implement correctly with Card Views in play. | Future |
| Model cards within model cards beyond 3-4 levels | No artificial limit -- the breadcrumb handles arbitrary depth. But UX at very deep nesting is untested. | Observe in use |

---

## Summary: What to Build and In What Order

1. ~~**Get user input on Note Panel integration** (Phase 0, blocking).~~ **RESOLVED:** Per-perspective notes only (on `layout` table), no universal identity note. Current model's note prominent in Note Panel.
2. **Silas writes the `parent_id` migration spec** with full call-site enumeration (Phase 0, blocking for Phase 2).
3. **Phase 1:** Add `maps.node_id`, expand `node_type` to include `'model'`, build Model card UI and breadcrumb navigation. Remove left sidebar. Full regression.
4. **Phase 2:** Move `parent_id` from `nodes` to `layout`. Pure internal refactor. No visible feature. Full regression.
5. **Phase 3:** Add `add_card_view` / `remove_card_view` IPC, build Card Views UI and view indicator. Derek review. Full regression.

Note Panel schema work (`layout.note TEXT`, `layout.updated_at TEXT`) is independent and can proceed in parallel with Phase 1.

-- Maren
