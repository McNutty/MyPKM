# Plectica 2.0 -- M2 Kickoff: Nesting

**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-24
**Status:** ACTIVE -- M2 is go
**Prerequisite:** M1 APPROVED by Derek (2026-03-23). See `docs/m1-derek-review.md`.

---

## M2 Goal

M2 delivers the core mechanic of Plectica 2.0: cards can contain other cards. By the end of M2, a user can drag any card onto any other card to make it a part of that card's system, drag it back out to unnest it, and watch parent cards automatically expand to contain their children. Nesting works to arbitrary depth -- a card inside a card inside a card inside a card is not a special case; it is the normal case. Every nesting and unnesting operation persists immediately to SQLite. The application loads the full nested tree on startup, computes depth correctly, and renders the visual hierarchy faithfully. M2 is the milestone that makes Plectica 2.0 a DSRP tool rather than a card-management tool. Everything before this was infrastructure. This is the product.

---

## What Carries Forward from M1

M2 is not a rewrite. The foundational work is already in place. The key assets that M2 builds on:

**Frontend -- `src/App.tsx`:**

The drag-to-nest and drag-to-unnest logic is fully written and proven from the prototype. It lives behind the `NESTING_ENABLED = false` flag at lines 43 and 302. The nest target detection loop (lines 307-330) and the mouse-up nest/unnest handlers (lines 421-516) are complete. They update in-memory state correctly -- `parentId`, `depth`, `color`, and all descendant depths propagate correctly in the local `Map<number, CardData>`. What is missing is the persistence call: when a nest or unnest occurs, the code needs to call `db.updateNodeParent()` and `db.updateNodeLayout()` before the flag can be turned on.

**Frontend -- `src/store/canvas-store.ts`:**

`autoResizeParent` (line 110), `getDescendants` (line 72), and `isAncestor` (line 84) are already implemented and correct. Coordinate conversion utilities (`getAbsolutePosition`, `canvasToLocal`, `normalizeChildPositions`) are already in place. The auto-resize algorithm propagates upward through the full ancestor chain. None of this needs to be rebuilt.

**Frontend -- `src/store/canvas-store.ts`, `nodeWithLayoutToCardData`:**

The `depth = 0` hardcode at line 48 is the one known gap, flagged explicitly by Derek in his M1 review (Observation A). This function must compute real depth from the loaded node tree before `NESTING_ENABLED` is turned on. The `get_map_nodes` query already returns `parent_id`; depth can be computed by a post-load tree walk over the in-memory `Map`.

**Backend -- `src-tauri/src/commands.rs`:**

The five M1 IPC commands are complete and correct. `get_map_nodes` already returns `parent_id` on every node (the data is flowing; it just is not used for depth at load time). The schema and the delete behavior (`ON DELETE RESTRICT`) are already correct for nesting. What is missing is the `update_node_parent` command -- the single new Rust function that sets `parent_id` (with cycle detection) and bumps `updated_at`.

**Schema -- `data/dsrp_schema.sql`:**

`nodes.parent_id` exists, is correctly nullable, and is correctly constrained with `ON DELETE RESTRICT`. The cycle detection query is documented in full in the schema file (lines 207-224). `idx_nodes_parent_id` exists for efficient child-lookup queries. No schema migration is needed for M2.

---

## Deliverables

### Silas -- Backend: `update_node_parent` IPC Command

**Output location:** `src-tauri/src/commands.rs`
**Upstream dependencies:** None. Silas can start the moment M2 kicks off.
**Downstream:** Wren cannot wire persistence for nest/unnest until this command exists. This is the M2 critical path item on the backend.

Silas implements one new Rust `#[tauri::command]` function. This is the only schema-layer change in M2.

**`update_node_parent(node_id, new_parent_id: Option<i64>, map_id, x, y, width, height)`**

This command atomically updates the structural parent of a node and its visual position. Both must change together -- an unnested card that keeps its old local coordinates would render in the wrong place. The command runs inside a transaction.

Steps (in order, inside the transaction):

1. **Self-reference check.** If `new_parent_id == Some(node_id)`, return an error immediately. A card cannot be its own parent. This check costs nothing and prevents the recursive CTE from needing to handle this edge case.

2. **Cycle detection.** If `new_parent_id` is `Some(proposed_parent)`, run the cycle detection query from `dsrp_schema.sql` lines 207-224, bound with `:node_id = node_id` and `:proposed_parent_id = proposed_parent`. If `cycle_exists = 1`, abort the transaction and return a descriptive error: `"This move would create a circular containment, which is not allowed."` If `new_parent_id` is `None` (unnesting to top level), skip the cycle check -- setting `parent_id = NULL` cannot create a cycle.

3. **UPDATE `nodes`.** `UPDATE nodes SET parent_id = ?1, updated_at = datetime('now') WHERE id = ?2`. Per Derek's data model spec Decision 4: this is always an UPDATE, never a DELETE + INSERT. The node's ID is its identity and must not change.

4. **UPDATE `layout`.** `UPDATE layout SET x = ?1, y = ?2, width = ?3, height = ?4 WHERE node_id = ?5 AND map_id = ?6`. The new position is local-coordinate-relative to the new parent (the frontend computes this before calling the command).

5. **COMMIT.** If any step fails, ROLLBACK and return a descriptive error.

**What Silas does NOT implement in M2:**
- Recursive descendant queries exposed as IPC commands (the frontend already computes descendant depth updates in-memory; no server-side subtree fetch is needed for the nesting interaction)
- Bulk reparent (moving a card with children is handled by the single `update_node_parent` on the root card; children move with it because their `parent_id` still points to the same node ID)
- Any changes to the `get_map_nodes` query (it already returns `parent_id`; the frontend uses this to reconstruct depth on load)

**Silas validation checklist before handoff to Wren:**
- Command is registered in `main.rs` (or `lib.rs`) alongside the M1 commands
- Self-reference returns an error (not a DB error -- a clean application error)
- Cycle creates an error with a user-readable message
- `UPDATE nodes` and `UPDATE layout` are wrapped in a single transaction (both succeed or both roll back)
- `new_parent_id = None` (unnest to top level) works correctly: sets `parent_id = NULL`, no cycle check, layout updated
- Tested with: nest A into B, unnest A back to top level, nest A into B into C (3 levels), attempt to nest B into A when A is inside B (cycle -- must fail)

---

### Wren -- Frontend: Enable Nesting, Fix Depth, Wire Persistence

**Output location:** `src/App.tsx`, `src/store/canvas-store.ts`, `src/ipc/db.ts` (or equivalent IPC layer file)
**Upstream dependencies:** Silas's `update_node_parent` command must exist and be callable before Wren wires the persistence path. Wren can do all non-persistence work first (depth computation fix, breadcrumb, UX decisions), then wire persistence once Silas delivers.
**Downstream:** Derek's DSRP review gates M2 closure.

Wren has four tasks, ordered by dependency:

**Task 1 -- Fix `nodeWithLayoutToCardData` depth computation (no Silas dependency)**

The `depth = 0` hardcode in `canvas-store.ts` line 48 must be replaced with real depth computation. The approach: after `get_map_nodes` returns all nodes with their `parent_id` values, perform a single tree walk over the in-memory `Map` before rendering to assign each node its correct depth. The walk starts with all nodes where `parentId === null` (depth 0), then recursively assigns depth to their children. This is O(n) and runs once at load time. The recursive `updateDescendantDepths` function already present in the `NESTING_ENABLED` mouse-up path (App.tsx lines 441-450, 499-508) can be extracted into `canvas-store.ts` as a shared utility and called from both places.

**Task 2 -- Resolve open UX questions with Derek (no Silas dependency)**

Before activating nesting, Wren must have answers to the four nesting UX questions from the roadmap. These are answered via a brief alignment with Derek:

| Question (from roadmap) | Decision needed before |
|---|---|
| Q6: What happens when a parent card is too small to show children? | Enabling NESTING_ENABLED |
| Q7: What auto-layout algorithm for children placed inside a parent? | Enabling NESTING_ENABLED |
| Q8: "Zoom into card" vs. "zoom the camera"? Or both? | Enabling zoom-to-expand |
| Q9: What position does a card snap to when unnested? | Enabling NESTING_ENABLED |

Derek is the decision-maker on DSRP fidelity questions (Q6, Q8). Wren is the decision-maker on implementation feasibility (Q7, Q9). These are alignment conversations, not blocking research tasks -- they should resolve quickly. Wren documents the decisions as brief notes in this kickoff doc or in a new `docs/m2-ux-decisions.md` if the answers are substantive.

**Task 3 -- Wire persistence for nest/unnest (requires Silas's `update_node_parent`)**

Replace the stub in the `NESTING_ENABLED` mouse-up path with real persistence calls:

1. Add `updateNodeParent(nodeId, newParentId, mapId, x, y, width, height)` to the TypeScript IPC interface (`db.*`), matching Silas's command signature.

2. In the nest path (App.tsx around line 421): after the in-memory state update, call `db.updateNodeParent(cardId, nestTargetId, 1, finalCard.x, finalCard.y, finalCard.width, finalCard.height)`. On error, revert the in-memory state and surface the error (same pattern as existing M1 error handling).

3. In the unnest path (App.tsx around line 459): after the in-memory state update, call `db.updateNodeParent(cardId, null, 1, finalCard.x, finalCard.y, finalCard.width, finalCard.height)`.

4. The `updateNodeLayout` call that currently fires at the end of every drag (line 522) continues to fire for layout-only drags (moving within the same parent). The nest/unnest paths replace it with `updateNodeParent` for that drag.

**Task 4 -- Enable `NESTING_ENABLED = true` and breadcrumb wiring**

Once Tasks 1, 2, and 3 are complete and tested:

- Set `NESTING_ENABLED = true` (App.tsx line 43). The nest target detection and the full nest/unnest mouse-up paths become live.
- Wire the breadcrumb bar (currently hardcoded to `"Canvas"` at App.tsx line 679) to show the actual ancestor chain of the selected card. This uses Query 3 from `dsrp_schema.sql` (ancestor chain) or, at minimum, walks the in-memory parent chain from the selected card up to the root. The breadcrumb is a navigation element that tells the user where in the system hierarchy they are.

**Wren validation checklist before handing to Derek:**
- Nest A into B: A's `parentId` updates in-memory AND in DB. `parent_id` in `nodes` is correct on reload.
- Unnest A from B: A's `parentId` is null in-memory AND in DB.
- Nest A into B into C: three levels render correctly. Depth colors are correct. Reload preserves structure.
- Attempt to nest B into A when A is already inside B: the error from Silas's cycle detection surfaces cleanly. The UI reverts. No corrupted state.
- Delete a card with children: the existing RESTRICT behavior from M1 applies. The user gets an error; nothing is deleted silently. (Wren may need to surface a clearer UX message here -- at M1 this was acceptable because no card had children; at M2 it will happen regularly.)
- Depth colors are correct at reload (no longer all depth 0).
- Breadcrumb shows the correct ancestor trail for the selected card.
- Auto-resize fires: nesting a card into a small parent expands the parent. Unnesting contracts it (if no other children).
- `normalizeChildPositions` runs on nest: a dragged card that arrives at a negative local coordinate is shifted to be inside the parent's content area.

---

### Derek -- DSRP Compliance Review

**Output location:** A written review delivered as `docs/m2-derek-review.md`
**Upstream dependencies:** Wren's M2 implementation complete and self-verified.
**Downstream:** M2 is not closed until Derek signs off. M3 cannot begin until M2 is closed.

Derek reviews the M2 deliverable against DSRP non-negotiables and carries forward the specific items flagged in the M1 review.

**What Derek checks:**

1. **No container/leaf distinction introduced.** M2 is where the temptation to add `is_container` becomes highest -- a card that contains things might be styled or behave differently than one that does not. Confirm the UI treats cards uniformly regardless of whether they have children. The child count badge (`({children.length})` in `Card.tsx`) is acceptable as a navigation aid. Any visual treatment that implies "this card type is different" is a DSRP violation.

2. **Depth coloring remains a positional signal, not an ontological one.** Derek flagged this in the M1 review (Observation 1). Now that depth is live, confirm that depth colors communicate "how deep in this system are you" and not "this is a different kind of card." In particular: a card at depth 3 that is unnested to depth 0 must visually revert to a depth-0 color. If the color is sticky (stays at the old depth color after unnesting), that is a violation because the color would no longer reflect position.

3. **Font scaling at depth does not create ontological confusion.** Derek flagged this in M1 (Observation 1, second paragraph). Now live: confirm that at practical nesting depths (3-5 levels), cards at deeper nesting levels still read as "the same kind of thing, smaller" and not "a different kind of element." If deep cards are so visually reduced that they appear categorically different, the scaling factor needs adjustment.

4. **Identity preservation on reparent.** Nest a card into a new parent, then unnest it. Confirm the card's `id` is identical before and after. No DELETE + INSERT should have occurred. This is verifiable by checking the DB directly.

5. **Cycle prevention surfaces correctly.** Attempt to create a cycle from the UI. Confirm the error message is clear and user-facing (not a raw Rust error string). The user should understand what happened without reading a stack trace.

6. **Delete of a card with children.** With nesting live, deleting a parent card with children will now trigger the `ON DELETE RESTRICT` path. Confirm the UI surfaces a clear, non-confusing message. Derek should weigh in on the right UX: should the user be asked to delete or move children first? Or should the app offer to delete the whole subtree? This is both a UX and a DSRP question (DSRP would say: the user's thinking inside the card is meaningful and should not be silently destroyed).

7. **Open UX questions Q6-Q9 resolved consistently with DSRP.** Derek should confirm that the answers Wren arrived at during Task 2 are consistent with DSRP systems thinking. In particular: Q8 (zoom-into-card vs. zoom camera) has DSRP implications. Zooming into a card as if it were its own canvas reinforces the fractal nature of Systems; pure camera zoom does not enforce any conceptual boundary. Derek's view on which interaction better serves the user's thinking matters here.

Derek's sign-off is the signal that M2 is done and M3 kickoff can begin.

---

## Parallel vs. Sequential Work

```
M1 COMPLETE (precondition for all M2 work)
  nodes.parent_id exists in schema
  NESTING_ENABLED code is dormant but present in App.tsx
  autoResizeParent, getDescendants, isAncestor implemented in canvas-store.ts
  get_map_nodes returns parent_id on every node

PARALLEL (can start immediately at M2 kickoff)
  Silas  --> Implement update_node_parent IPC command
               (cycle detection, transaction, both table updates)

  Wren   --> Task 1: Fix nodeWithLayoutToCardData depth computation
          --> Task 2: Resolve UX questions Q6-Q9 with Derek

SEQUENTIAL
  Silas delivers update_node_parent
    --> Wren Task 3: Add db.updateNodeParent() to IPC layer
    --> Wren Task 3: Wire nest/unnest mouse-up paths to persistence

  Wren Tasks 1 + 2 + 3 all complete
    --> Wren Task 4: Set NESTING_ENABLED = true, wire breadcrumb
    --> Wren self-verification against checklist

  Wren self-verified
    --> Derek DSRP review
    --> M2 closed
```

**Critical path:** Silas's `update_node_parent` -> Wren's persistence wiring -> Wren's full activation -> Derek's review -> M2 closed.

**Wren is not blocked at the start.** Depth computation fix and UX alignment with Derek can begin immediately. Silas's command is only needed for Task 3.

---

## M2 Done Criteria

M2 is complete -- and M3 kickoff may begin -- when ALL of the following are true:

1. **Drag-to-nest works.** Dragging card A onto card B (with a visual drop-target indicator on B) nests A inside B. A becomes a visual child of B. B expands to contain A.

2. **Drag-to-unnest works.** Dragging a child card outside its parent's boundary unnests it. It becomes a top-level card at the position where it was dropped.

3. **Nesting persists.** Close the app and reopen it. The nested structure is exactly as the user left it. `parent_id` in the `nodes` table is correct for every card.

4. **Depth is correct at load.** After a restart, all cards render at their correct depth. No card that is 3 levels deep renders as depth 0. Depth colors are accurate.

5. **Auto-resize fires.** Nesting a card into a parent expands the parent to contain it. Removing the last child contracts the parent toward its minimum size.

6. **Arbitrary depth works.** Five levels of nesting renders and behaves correctly. A card at depth 5 can be dragged, edited, and deleted. Its ancestors resize correctly.

7. **Cycles are prevented.** Attempting to nest card B into card A when A is already inside B (directly or transitively) results in a clear error. No cycle is created. The UI reverts cleanly.

8. **The bicycle example works end to end.** The user story from `docs/roadmap.md` Section 3 is executable:
   - Create "Bicycle"
   - Create "Wheels", "Frame", "Drivetrain", "Brakes" and drag them inside "Bicycle"
   - Create "Front Wheel", "Rear Wheel" inside "Wheels"
   - Create "Tire", "Rim", "Spokes", "Hub" inside "Front Wheel"
   - Close the app, reopen it, find everything intact

9. **Delete behavior is clear.** Deleting a card with children surfaces a non-confusing message. No silent data loss. (Exact UX to be determined in Q6/Q9 alignment -- the key criterion is that it is non-confusing.)

10. **Identity preserved on reparent.** A card's `id` is the same before and after being nested or unnested. No DELETE + INSERT occurred.

11. **Derek has signed off.** Derek's M2 DSRP compliance review is complete with no blocking issues. Non-blocking findings are logged as inputs to M3.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Coordinate system bugs on deep nesting.** The `canvasToLocal` / `getAbsolutePosition` chain has not been exercised with real multi-level nesting in the production app (only in the prototype). A subtle off-by-one in header offset accumulation could cause cards to render slightly wrong at 3+ levels deep. | Medium | Medium | Wren tests specifically at 3, 4, and 5 levels. The existing utilities are from the proven prototype, but the production wiring is new. Any coordinate glitch becomes visually obvious immediately -- this is a catchable bug, not a silent one. |
| **Depth computation post-load is more complex than expected.** Computing depth from a flat list of `{id, parent_id}` pairs requires building the tree in topological order. If the `get_map_nodes` query returns nodes in arbitrary order (not parent-before-child), the depth walk needs to handle unresolved parents gracefully (e.g., iterate until stable). | Low | Low | The in-memory `Map` already has all nodes. A two-pass or recursive approach handles arbitrary ordering. This is a straightforward algorithm problem. If needed, Silas can modify `get_map_nodes` to return nodes ordered by `parent_id NULLS FIRST` to simplify the walk -- but this is a micro-optimization, not a blocker. |
| **Cycle detection has a gap.** If the Rust cycle detection query has a bug (wrong anchor, wrong traversal direction), a cycle could be created and silently persist. Cycles in the `nodes` table would cause infinite loops in the frontend's parent-chain walking functions. | Low | High | Silas tests cycle detection explicitly (see validation checklist). The cycle detection query in `dsrp_schema.sql` is well-documented and correct -- the risk is in wiring it correctly in Rust, not in the query itself. Wren's `isAncestor` function in `canvas-store.ts` provides a second layer of prevention on the frontend (it already runs before the nest path fires). |
| **Delete UX is confusing with children.** At M1, the Delete key optimistically removed a card with no children and was clean. At M2, pressing Delete on a parent card with children returns a `RESTRICT` error from the DB and reverts. The user may not understand why their card did not delete. | Medium | Medium | Derek and Wren align on the right UX during M2. Options: (a) surface a clear dialog "This card has N children. Delete everything inside it too?" (b) block Delete when a card has children and show a tooltip. Either way, the done criterion is "non-confusing" -- Derek signs off on this. |
| **`NESTING_ENABLED` flag turned on before persistence is wired.** If Wren enables the flag before `update_node_parent` is wired, nest/unnest operations will update in-memory state but not the DB. On reload, all structural changes are lost. | Low | Medium | Task ordering in Wren's checklist explicitly gates flag activation on persistence being wired. This is a process risk, not a technical one. |
| **Open questions Q6-Q9 have harder answers than expected.** In particular, Q8 (zoom-into-card as its own canvas vs. camera zoom) could expand M2 scope significantly if "zoom-into-card" is chosen, as it implies a navigation model (breadcrumbs, enter/exit, current viewport context) that adds complexity. | Medium | Medium | If Q8 resolves to "zoom-into-card," that feature becomes a named M2 sub-deliverable with its own scope. If it resolves to "camera zoom only," it is already implemented. Wren and Derek should answer Q8 first, as it has the largest scope impact. If Q8 is too large for M2, it can be explicitly deferred to M3 with a note that M2 ships with camera zoom only. |

---

## Open Questions Resolved in M2

The following questions from the roadmap are answered as part of M2 kickoff work (before Wren activates nesting). Answers to be filled in by Wren and Derek during Task 2 alignment:

| Q# | Question | Answer | Decided By |
|---|---|---|---|
| Q6 | What happens when a parent card is too small to show children? | TBD | Derek + Wren |
| Q7 | What auto-layout algorithm for children inside a parent? | TBD | Wren |
| Q8 | Zoom-into-card (navigate) vs. zoom camera (magnify)? | TBD | Derek + Wren |
| Q9 | Where does a card snap when unnested? | TBD | Wren |

These must be answered before `NESTING_ENABLED` is set to `true`.

---

*M2 is go. The nesting logic exists. The schema supports it. The missing piece is one Rust command and a depth fix. The product is three tasks away from the core mechanic working end to end.*

*Questions to Maren.*

-- Maren
