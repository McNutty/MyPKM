# M2 DSRP Compliance Review

**Reviewer:** Derek (DSRP & Systems Thinking Expert)
**Date:** 2026-03-24
**Scope:** M2 implementation -- nesting, depth computation, persistence, cycle detection, delete behavior, UX decisions Q6-Q9
**Prerequisite:** M1 APPROVED (2026-03-23). See `docs/m1-derek-review.md`.

---

## Method

I reviewed the following files in full:

- `docs/m2-kickoff.md` -- M2 spec, Derek section (7 review items)
- `src/App.tsx` -- full production app with nesting enabled
- `src/store/canvas-store.ts` -- `computeDepths`, `updateDescendantDepths`, `autoResizeParent`, coordinate utilities
- `src/store/types.ts` -- `CardData` type
- `src/components/Card.tsx` -- card rendering
- `src-tauri/src/commands.rs` -- `update_node_parent` (lines 234-359)
- `src/ipc/db.ts` -- TypeScript IPC interface
- `docs/m2-ux-decisions.md` -- Q6-Q9 decisions
- `docs/m1-derek-review.md` -- carried-forward observations

Each of the 7 review items is addressed in order.

---

## Item 1: No container/leaf distinction introduced

**Result: PASS with one minor language note**

The `Card` component in `Card.tsx` is a single component with no branching on type, role, or capability. Every card -- whether it has zero children or ten -- is rendered by the same `Card` function with the same structural elements: outer div, header div, content area div, children area div, resize handle. There is no `ContainerCard` vs. `LeafCard` split, no conditional rendering of fundamentally different structures, no stored `is_container` flag.

Two conditional behaviors exist. I evaluated each:

**The child count badge:** `({children.length})` appears in the header when `children.length > 0`. This is carried forward from M1 Observation C, which I already evaluated and cleared. It is a navigation aid -- it answers the question "how many parts does this system contain?" That is a legitimate Systems question (how many parts does this whole have?), not a type claim ("this is a different kind of card"). PASS.

**The header border:** `borderBottom: children.length > 0 ? '1px solid rgba(0,0,0,0.1)' : 'none'`. When children are present, the header gets a faint separator line between it and the content area where children are rendered. This is a layout artifact -- the separator visually separates the header from the child cards below it. A card without children has no child area to separate from, so no line. This does not communicate "this card is a different type." It communicates "the header ends here and the parts begin." Acceptable, though I note it below as a cosmetic refinement candidate for M3.

**Language concern (non-blocking):** `types.ts` line 21 has the comment `/** For containers, this may be overridden by auto-resize. */` on the `width`/`height` fields. The word "containers" here is internal developer language, not visible to users, and does not affect behavior. However, the team should prefer "cards with children" or "parent cards" in comments to avoid internalizing a type distinction the data model explicitly rejects. This is a code hygiene note, not a DSRP violation.

---

## Item 2: Depth coloring is positional, not ontological

**Result: PASS**

I traced the full lifecycle of depth coloring through three distinct paths:

**Load time:** `App.tsx` lines 88-95 build the raw card map with `depth=0` as a placeholder, then immediately call `computeDepths(raw)` to correct all depths before `setCards` is called. `computeDepths` in `canvas-store.ts` performs BFS from all root cards (those with `parentId === null`, assigned depth 0), then assigns `depth + 1` to each child. The `color` field is set via `getDepthColor(depth)` at every node. No card renders at the wrong depth after load.

**Nest (card moves deeper):** `App.tsx` lines 443-454 compute `newDepth = target.depth + 1` and update the nested card's color immediately. `updateDescendantDepths` then propagates the new base depth through the entire subtree. When the nest persists successfully, the in-memory state already reflects the correct positional color.

**Unnest (card moves shallower):** `App.tsx` lines 530-544 compute `newDepth` as `grandparentId !== null ? (grandparent.depth ?? 0) + 1 : 0`. A card dragged entirely out of all nesting returns to `depth = 0` and receives `getDepthColor(0)`, which is the depth-0 color (`#e3f2fd`). The old depth color does not persist. Color is never stored in the database -- it is always derived from depth, which is always derived from position in the tree.

The depth coloring system is correctly positional. A card's color changes when its position in the hierarchy changes, and is recomputed on every such change. There is no case where a card retains the color of its former depth after reparenting.

---

## Item 3: Font scaling at depth does not create ontological confusion

**Result: PASS with a monitoring note**

The font-size formula in `Card.tsx` line 170:

```
Math.max(10, Math.min(14, 14 / Math.max(1, card.depth * 0.3 + 0.7)))
```

At the practical depths a user will encounter in M2:

- Depth 0: 14 / 0.7 = 20 -- clamped to 14px
- Depth 1: 14 / 1.0 = 14px
- Depth 2: 14 / 1.3 = ~10.8px
- Depth 3: 14 / 1.6 = ~8.75 -- clamped to 10px
- Depth 4+: clamped to 10px

Depths 3 and beyond all render at 10px -- the floor. This means the gradient has effectively three steps (14px, 14px, ~11px, 10px, 10px...) rather than a smooth descent. The practical consequence is that a card at depth 3 and a card at depth 5 look the same size. This is acceptable -- both are still recognizably "the same kind of thing, smaller." The 10px floor prevents cards from becoming so small that they read as categorically different (icons, labels, badges) rather than cards.

The concern I raised in M1 Observation 1 was specifically about cards becoming "so visually reduced that they appear categorically different." The floor at 10px prevents this. Cards remain readable text containers at all practical depths.

**Monitoring note for M3:** At 5+ levels of nesting, the combination of small font and reduced card area on screen (because the card is inside four nested ancestors, each with its own padding and header) may start to feel cramped. This is a usability issue, not a DSRP one. M3 zoom-into-card navigation will address this by allowing users to enter a card's context as its own canvas -- at which point depth resets visually. No action needed in M2.

---

## Item 4: Identity preservation on reparent

**Result: PASS**

The `update_node_parent` command in `commands.rs` (lines 249-359) performs:

1. A self-reference check (application logic, no DB call)
2. A cycle detection query against the `ancestor_chain` CTE
3. `UPDATE nodes SET parent_id = ?1, updated_at = datetime('now') WHERE id = ?2`
4. `UPDATE layout SET x = ?1, y = ?2, width = ?3, height = ?4 WHERE node_id = ?5 AND map_id = ?6`
5. COMMIT or ROLLBACK

There is no DELETE. There is no INSERT. The node's `id` is used as a stable key across both UPDATE statements. The node row that existed before the reparent is the same row that exists after -- same `id`, same `created_at`, same `node_type`, same `content`. Only `parent_id` and `updated_at` change on the `nodes` row. Only `x`, `y`, `width`, `height` change on the `layout` row.

This is the correct implementation of Decision 4 from the data model spec: identity is the node's ID, and that ID must never change. A Distinction that is moved into a new System remains the same Distinction. The reparent operation changes its relationship to other elements -- it does not reconstitute the Distinction itself.

On the frontend, `App.tsx` updates the in-memory card map by spreading the existing card (`...c`) and overriding only `parentId`, `x`, `y`, `depth`, and `color`. The card's `id`, `content`, `width`, and `height` are preserved across the nest/unnest operation. The `stateBefore` snapshot used for revert is also keyed by the same IDs.

---

## Item 5: Cycle prevention surfaces correctly

**Result: PASS**

The cycle detection operates at two layers:

**Backend (authoritative):** `update_node_parent` in `commands.rs` lines 277-304 runs a recursive CTE that walks the full ancestor chain of the proposed parent. If `node_id` appears anywhere in that chain, the command returns the string `"This move would create a circular containment, which is not allowed."` This is a clean, plain-English sentence. It contains no Rust error types, no stack trace, no `[db]` prefix, no internal error codes.

**Frontend (first defense):** `App.tsx` lines 316-318 skip any candidate nest target for which `isAncestor(cardsRef.current, id, dragState.cardId)` returns true. This means the drag-hover highlight will not appear on a card that would create a cycle -- the user typically cannot even attempt the nest because there is no visual affordance for it. The backend check is a safety net for any edge case where the frontend check is bypassed.

**Error surface in the frontend:** `App.tsx` lines 484-492 parse the error string from the backend:

```
if (msg.includes('circular containment')) {
  setError('Cannot nest: this would create a circular containment.')
} else if (msg.includes('cannot be its own parent')) {
  setError('Cannot nest a card inside itself.')
} else {
  setError(`Failed to save nesting: ${err}`)
}
```

These messages appear in the breadcrumb bar error indicator (`App.tsx` lines 784-788) as red text visible to the user. In-memory state is reverted via `setCards(stateBefore)`.

The messages are user-facing, conceptual, and accurate. A user who sees "circular containment" understands that A cannot be inside B if B is already inside A. No raw Rust error string reaches the UI.

One note: the self-reference error from Rust (`"[db] update_node_parent: node {} cannot be its own parent"`) does include the `[db]` prefix that I flagged as internal language. However, this case is extremely unlikely to reach the UI in practice, because the frontend's nest target detection already skips the card being dragged (`if (id === dragState.cardId) continue` at `App.tsx` line 317). A card cannot hover over itself as a drop target. The `[db]` prefix is a cosmetic issue on a nearly unreachable code path. Non-blocking.

---

## Item 6: Delete of a card with children

**Result: PASS with a UX recommendation for M3**

**What the implementation does:**

`App.tsx` lines 668-713 handle the Delete key. The handler:

1. Optimistically removes the target card AND all its descendants from in-memory state via the `collectDescendants` loop (lines 678-685).
2. Calls `db.deleteNode(id)`.
3. If the DB returns a RESTRICT error, catches it, displays the error message, and restores `cardsBefore` via `setCards(cardsBefore)`.

The `delete_node` command in `commands.rs` (lines 214-219) catches the FK violation and returns: `"[db] delete_node: node {id} has children and cannot be deleted until they are removed first"`.

`App.tsx` checks `msg.includes('has children')` and displays: `'Cannot delete: this card contains other cards. Remove or move its children first.'`

**DSRP assessment:**

The DSRP principle at stake is that the user's thinking inside a card -- the parts of a System that the user has deliberately organized -- must not be silently destroyed. The `ON DELETE RESTRICT` constraint enforces this at the database level. No child is ever deleted without an explicit user action on that child. This is correct.

**The optimistic removal:** The handler removes the card and all its descendants from the in-memory map before the DB call, then reverts on failure. This means the user sees a flash where their entire card subtree disappears and then reappears. This is jarring and potentially alarming. From a DSRP standpoint, it briefly presents a false state of the system (the parts appear to have been deleted). The revert corrects this, but the experience communicates "your thinking was deleted" before correcting itself. No data is actually lost -- the revert is clean -- but the perception is poor.

**The error message:** `'Cannot delete: this card contains other cards. Remove or move its children first.'` is clear, non-technical, and accurate. It tells the user what to do next. This passes the "non-confusing" criterion from the M2 done criteria.

**Recommendation for M3:** The delete interaction should be upgraded from the current optimistic-then-revert pattern to a pre-flight check. Before performing any deletion, check whether the card has children in the in-memory map. If it does, present a modal or inline confirmation: "This card contains N other cards. Delete everything inside it, or cancel?" Options: "Delete all" (cascade the full subtree), "Cancel." This avoids the flash and gives the user a meaningful choice. DSRP would favor "Delete all" requiring explicit confirmation over a silent cascade -- the user should know they are dissolving a System and all its parts. This is M3 scope. For M2, the current behavior is acceptable because it is non-confusing and causes no data loss.

---

## Item 7: Q6-Q9 decisions are DSRP-consistent

**Result: PASS**

I reviewed `docs/m2-ux-decisions.md` against DSRP theory for each question.

**Q6 -- Parent too small to show children:**

Decision: `autoResizeParent` enforces that the parent always contains all children. Count badge `(N)` in header. No collapse. Children never hidden.

DSRP assessment: PASS, strongly. This is the correct decision. A System is defined by the relationship between its whole and its parts. If the visual representation hides parts, it misrepresents the System. A "Bicycle" card that contains "Wheels" but does not show "Wheels" is not a faithful representation of the part-whole structure. The auto-resize guarantee means the boundary of the System (the card's visual boundary) always encompasses all the parts (the child cards). This is DSRP-correct by construction.

The count badge is acceptable. It adds information ("this card has N parts") without hiding any of those parts. Consistent with the M1 assessment.

**Q7 -- Auto-layout algorithm for children:**

Decision: Manual positioning. `normalizeChildPositions` prevents negative-coordinate clipping on drop. No grid or flow layout.

DSRP assessment: PASS. DSRP does not prescribe the spatial arrangement of parts within a system. The user's choice of where to place "Front Wheel" relative to "Rear Wheel" inside "Wheels" is part of their mental model. Forcing a grid layout would override that spatial intent with algorithmic arrangement. Free positioning is correct. The `normalizeChildPositions` nudge handles the one case where user intent is not meaningful (landing at a negative coordinate, which is outside the visible content area).

**Q8 -- Zoom-into-card vs. zoom camera:**

Decision: Camera zoom only for M2. Breadcrumb wired. Zoom-into-card deferred to M3.

DSRP assessment: PASS for M2, with strong endorsement of the M3 motivation.

Camera zoom (the current implementation) is DSRP-compatible -- it does not misrepresent the structure, it simply makes it larger or smaller on screen. The breadcrumb correctly communicates position in the hierarchy, satisfying the Perspective question ("where am I looking from, and at what?"). The user knows they are inside "Bicycle > Wheels > Front Wheel" even without navigating into each card as a separate canvas.

The M2 UX decision document correctly identifies zoom-into-card as the stronger DSRP interaction: "each card IS its own system and can be navigated into as a canvas." This is the fractal property of Systems -- every part is itself a whole at the appropriate scale of analysis. Zoom-into-card would make this operationally concrete: the user can shift their perspective (P) to take any card as the entry point, seeing only that System and its parts. This is the Perspective structure of DSRP made interactive.

I want to be explicit about why this matters for M3: zoom-into-card is not just a UX convenience. It is the implementation of perspective-taking. When a user navigates into "Wheels" as its own canvas, they have adopted "Wheels" as their point of observation, and the view is the system of wheels-parts (Front Wheel, Rear Wheel). This is P = {point: Wheels, view: Wheels-parts}. Camera zoom does not accomplish this shift -- it just magnifies. The deferred feature is theoretically significant, not just visually nice. M3 should prioritize it.

**Q9 -- Unnest position:**

Decision: Card drops at its absolute canvas position at moment of release, converted to new parent's local space (or root). No snapping.

DSRP assessment: PASS. The user dragged the card to a specific location and released it there. Overriding that position would impose the tool's spatial intent over the user's. The conversion logic (`getAbsolutePosition` to `canvasToLocal`) correctly preserves the card's visual position while updating its coordinate reference frame. The card appears to stay where the user put it, which is what the user intends. Correct.

---

## Stale Comment (Non-blocking)

`src/store/types.ts` line 26 still reads: `/** Nesting depth (computed, for coloring). All cards are depth 0 at M1. */`

This is an M1-era comment. With M2 live, the comment should be updated to something like: `/** Nesting depth (computed from parent chain, for coloring). 0 for top-level cards. */`

Not a DSRP issue. Cosmetic maintenance item.

---

## Carry-Forward Items to M3

These are not blocking issues in M2. They are logged here as inputs for M3 planning.

**CF-1: Zoom-into-card navigation.** The most significant deferred feature. Implements perspective-taking (P) in the DSRP sense -- the user can adopt any card as their observational point and see its system as a first-class canvas. M3 should plan this as a named deliverable, not a stretch goal.

**CF-2: Subtree delete dialog.** Replace the current optimistic-revert delete pattern with a pre-flight check and confirmation dialog. Offer "Delete all (N cards)" as an explicit option. Eliminates the flash of incorrect state and gives the user meaningful agency over dissolving a System.

**CF-3: Header border on childless cards.** The conditional `borderBottom` in `Card.tsx` line 173 is a very minor visual distinction between cards with and without children. It does not create an ontological confusion at present, but as the UI matures, the team should ensure no additional conditional styling accumulates that adds up to a container/leaf visual split.

**CF-4: Language cleanup.** The `[db]` prefix on error strings from the self-reference check, and the word "containers" in the `types.ts` comment, are internal code-level language concerns. Not user-facing. Worth a cleanup pass before M3 adds more IPC commands.

---

## Summary

| Item | Result |
|---|---|
| 1. No container/leaf distinction | PASS |
| 2. Depth coloring is positional | PASS |
| 3. Font scaling -- no ontological confusion | PASS |
| 4. Identity preservation on reparent | PASS |
| 5. Cycle prevention surfaces correctly | PASS |
| 6. Delete of card with children | PASS |
| 7. Q6-Q9 DSRP consistency | PASS |

All seven items pass. There are no blocking findings. Four carry-forward items are logged for M3 input.

The nesting implementation is a faithful representation of the Systems structure of DSRP. Cards can be parts of other cards to arbitrary depth. The boundary of a card (its visual extent) always encompasses its parts. Reparenting preserves identity. Cycles are prevented. The user's spatial intent is respected on both nest and unnest. The DSRP non-negotiables from the M1 review are all preserved and extended correctly into the nesting domain.

**M2 APPROVED. M3 kickoff may proceed.**

-- Derek
