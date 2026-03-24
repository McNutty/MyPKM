# Plectica 2.0 -- M3 Kickoff: Perspective Navigation + Systems Completion

**Author:** Maren (Technical Project Manager), with DSRP theory input from Derek
**Date:** 2026-03-24
**Status:** ACTIVE -- authoritative M3 specification
**Prerequisite:** M2 APPROVED by Derek (2026-03-24). See `docs/m2-derek-review.md`.
**Derek's full M3 input:** `docs/m3-derek-input.md`

---

## M3 Goal

M3 completes the MVP and makes Plectica 2.0 genuinely usable as a thinking tool.

M2 delivered the structural backbone: any card can contain any other card to arbitrary depth, with full persistence and cycle prevention. The user can now build a System. What M3 adds is the ability to work within that System fluidly -- to navigate into a card as its own canvas at its own scale, to delete a System's parts with deliberate intent, and to close the remaining S-behavior gaps that M2 left deferred.

Relationships (R) are explicitly not in M3 scope. Derek confirmed this. The roadmap's Phase 2 sequencing -- Systems before Relationships -- is theoretically correct and is maintained here. Relationships require a genuinely different data structure (edges, not nodes), a different interaction pattern (drawing vs. dragging), and their own DSRP specification. They ship in M4.

By the end of M3:
- A user can double-click any card to enter it as a first-class canvas, seeing only that card's direct parts rendered at the top level of the new context. Depth coloring resets to be context-relative. The user feels oriented inside the System. They can navigate back out through a clickable breadcrumb.
- Creating a new card while navigated inside another card correctly produces a child of the entered card, not a top-level card.
- Deleting a card with parts no longer produces a confusing flash-and-revert. A clear confirmation dialog gives the user meaningful agency over dissolving a System.
- The breadcrumb is fully navigable: clicking any segment returns the user to that ancestor's canvas.
- Code debt from M1-M2 (language, cosmetics) is resolved before M4 adds more IPC commands.

---

## What Carries Forward from M2

These items were logged by Derek in `docs/m2-derek-review.md` as carry-forward inputs to M3. All four are in scope for M3, with priorities adjusted based on Derek's M3 DSRP analysis.

| CF # | Item | Source | Priority in M3 |
|---|---|---|---|
| CF-1 | Zoom-into-card navigation (perspective-taking) | Derek M2 review | Must-have. First-priority deliverable. Derek: "not just a UX convenience -- it is the implementation of perspective-taking." |
| CF-2 | Subtree delete confirmation dialog | Derek M2 review | Must-have. Required before zoom-into-card ships; interaction frequency increases once users are working inside cards. |
| CF-3 | Conditional header border on childless cards | Derek M2 review | Should-have. Minor cosmetic; bundle with cleanup pass. Derek: low priority, CF-4 priority is higher. |
| CF-4 | Language and code cleanup (`[db]` prefixes, `"containers"` in comments) | Derek M2 review | Should-have. Before M4 adds more IPC commands. |

---

## M3 Scope

### Must-Have (M3 closes when all of these are done)

**1. Zoom-into-card navigation (CF-1) -- First Priority**

The user can double-click any card to enter it as its own full-screen canvas. Inside the card's canvas, that card's direct children are rendered as the top-level cards of the new context. Their own children render inside them as nested cards, as normal. The breadcrumb updates to show the navigation path (e.g., `Canvas > Bicycle > Wheels`). Clicking any breadcrumb segment navigates to that ancestor's canvas. Pressing Escape exits to the parent canvas.

This is the implementation of Perspective (P) in DSRP: the user adopts a card as their point of observation and the view is that card's parts. Derek explicitly confirmed in `m3-derek-input.md` (Section 1) that zoom-into-card is simultaneously a Systems move and a Perspectives move -- "the card that was a part (seen from outside) becomes a whole (seen from inside)." It is not a camera convenience; it is the mechanism by which deep Systems remain usable at depth, and it is the prerequisite for full saved-perspective functionality in Phase 3.

**DSRP constraints governing this feature (from Derek's input, Section 3):**

**Constraint 1 -- Only the entered card's subtree is visible.**
When navigating into a card, the visible canvas contains exactly and only that card's direct children as the top-level elements (with their descendants rendered inside them as nested cards). No cards outside the entered card's subtree appear. Siblings of the entered card are not visible. Children of sibling cards are not visible. This is not a filter -- it is a genuine change of perspective point.

**Constraint 2 -- Depth coloring is context-relative, not absolute.**
When a user navigates into a card at logical depth 3, its children are at logical depth 4 in the global tree. But visually, those children must appear as depth-0 cards -- the "top level" of this context. Depth coloring communicates "how many layers of system boundary separate you from the current whole," relative to the current navigation context, not absolute depth in the global tree. Inside "Wheels," Front Wheel and Rear Wheel display as depth-0. Inside "Front Wheel," Tire and Rim display as depth-0. The logical depth is preserved in the data and available to the breadcrumb; only the visual rendering is context-relative.

**Constraint 3 -- The breadcrumb is the Perspective indicator and must be navigable before zoom-into-card ships.**
The breadcrumb answers the DSRP Perspective question: "What is my current point of observation, and what does it contain?" `Canvas > Bicycle > Wheels` tells the user their point is "Wheels" and they are looking at Wheels' parts. Clicking "Bicycle" shifts the point to Bicycle. Clicking "Canvas" returns to the global view. A display-only breadcrumb with navigate-into functionality but no navigate-out functionality would be a trap. Clickable breadcrumb is not a "should-have" in M3 -- it is required for zoom-into-card to be safe to ship.

**Constraint 4 -- Creating a card while inside a card creates a part of that card.**
If a user navigates into "Wheels" and double-clicks the canvas to create a new card, that new card's `parent_id` must be the ID of "Wheels," not null. The user is making a Distinction inside a System; the result is a part of that System. The canvas store's card creation logic must be context-aware.

**Constraint 5 -- Cards cannot be accidentally moved out of the entered card via drag.**
While inside a card, the parent System is not visible. Dragging a child card to the edge of the viewport must not unnest it into the parent System. Unnesting requires either (a) navigating up first, or (b) an explicit "move to parent" action. Accidental unnesting through drag is a DSRP violation: it moves a part out of its System without the user intending a structural change.

**2. Subtree delete confirmation dialog (CF-2) -- Required before zoom-into-card ships**

Replace the current optimistic-then-revert delete pattern with a pre-flight check. Before any deletion, the app checks the in-memory card map for children. If the target card has no children, deletion proceeds immediately (current leaf-delete behavior unchanged). If the target card has children, a modal confirmation appears before any state change:

> "This card contains [N] part[s]. Delete the card and everything inside it?"
> [Delete all] [Cancel]

"Delete all" calls the new cascade delete backend command, then removes the card and all descendants from in-memory state on success. "Cancel" dismisses the modal with no state change.

Derek's M3 input (Section 4, S-Deferred-4) notes this is higher priority in M3 than it was in M2 because zoom-into-card navigation increases the frequency with which users work inside cards and therefore the frequency with which they may attempt to delete a card they have been actively building. The pre-flight dialog replaces the optimistic-revert flash entirely: the UI does not show any deletion until the user confirms.

**3. Context-sensitive card creation (S-Deferred-3)**

Currently, double-clicking the canvas always creates a top-level card (null `parent_id`). With zoom-into-card navigation, this behavior must become context-aware: when the user is navigated inside a card (i.e., `viewRoot` is set), a new card created by double-clicking must receive the entered card's ID as its `parent_id`. This is Constraint 4 above and is tightly coupled to the zoom-into-card implementation -- it cannot ship without this behavior.

**4. Code cleanup (CF-4)**

A focused cleanup pass before M4 adds more IPC commands:
- Remove `[db]` prefix from user-facing error strings in `commands.rs`
- Replace "containers" with "parent cards" or "cards with parts" in `types.ts` comments and any other developer-facing comments that carry a container/leaf distinction
- Update the stale M1-era comment in `types.ts` line 26
- Audit all IPC command error strings for plain-English compliance

This is Silas and Wren split: Silas owns Rust error strings; Wren owns TypeScript comments and types.

### Should-Have (ship in M3 if scope allows; defer to M4 if they threaten the critical path)

**5. Conditional header border cosmetic fix (CF-3)**

The `borderBottom` on `Card.tsx` that conditionally appears when a card has children is cosmetically minor. Address during the cleanup pass: either make it unconditional or remove it entirely. Wren's call on which looks better. Derek rated this low priority; it can be bundled with any PR touching `Card.tsx`.

**6. Color scheme selection**

The user expressed interest in choosing a color scheme (matching colors rather than individual card colors). Auto-depth-relative colors stay; the user selects from pre-defined palettes. This is aesthetic, not DSRP-semantic -- Derek's input does not raise any DSRP concern about color scheme choice, so this is entirely Wren's domain. Low complexity; directly supports the "minimum arranging, maximum thinking" design principle.

**7. Subtree move verification (S-Deferred-2)**

When a user drags a card with deep descendants into a new parent, the entire subtree moves together. The data model handles this correctly (only the moved card's `parent_id` updates; children retain their existing `parent_id`). But there has been no explicit specification or testing of the visual behavior when dragging a card with a multi-level subtree into a new parent: auto-resize must propagate correctly for the new parent, and coordinate recalculation must handle the case. This belongs in M3 as an explicit test rather than a new implementation -- it is verification of existing behavior at depth.

### Explicitly Deferred to M4 (not in M3 scope)

| Deferred Item | Reason | Target |
|---|---|---|
| Relationships (R) -- arrows between cards | Phase 2 feature. Requires its own data model (edges), interaction pattern (drawing), and DSRP specification. Confirmed by Derek: "Compressing Relationships into M3 alongside zoom-into-card navigation would produce a half-built implementation of both." | M4 |
| Relationships schema scaffolding | Derek explicitly does not recommend pre-encoding structure the user has not yet expressed. No schema scaffolding for R in M3. | M4 |
| Multi-select and group move | Useful; also needs to work correctly within the zoom-into-card navigation context. Derek notes multi-select nesting has a DSRP question (Q15) that requires its own answer. Build after navigation model is settled. | M4 |
| Undo/redo | High value; high complexity in Tauri/SQLite architecture. Derek notes undo scope has a DSRP question (Q16 -- within-context vs. global). Needs its own scoping; more valuable after navigation model is settled. | M4 |
| Map management (create, rename, switch maps) | Needed before v1.0; not needed for MVP validation. | M4 |
| Performance optimization at scale | Test at 100+ cards; viewport culling. Only urgent if user hits it. | M4 |
| Saved perspectives (named views, point/view semantics) | Full Register 2 Perspectives implementation. Phase 3 feature. Zoom-into-card (Register 1) is the prerequisite. | Phase 3 |
| Import/export | Phase 2+ feature. | M5+ |

**Note on undo/redo and multi-select sequencing:** Derek's M3 input (Section 2, M3-B/C) is explicit that undo/redo and multi-select should be worked after the zoom-into-card navigation model is settled, because those interactions need to work correctly within the navigation context. Building undo/redo before the navigation model exists risks rebuilding parts of it when navigation is added. This is the correct sequencing reason for deferring them.

---

## Milestone Structure

### Deliverables by Team Member

---

### Silas -- Backend: Cascade Delete + Code Cleanup

**Output location:** `src-tauri/src/commands.rs`, `src-tauri/src/main.rs` (or `lib.rs`)
**Upstream dependencies:** None. Silas can start immediately at M3 kickoff.
**Downstream:** Wren's delete dialog depends on Silas's cascade command. Wren's zoom-into-card has no Silas dependency.

**Task 1 -- `delete_node_cascade` IPC command**

A new Rust command that deletes a node and all its descendants recursively. This replaces the current `delete_node` (which relies on `ON DELETE RESTRICT`) for the "Delete all" path.

Implementation approach:
1. Collect the full subtree of the target node using the recursive CTE already documented in `dsrp_schema.sql` (ancestor_chain query, inverted for descendants).
2. Delete all descendant nodes first (leaves before internal nodes), then delete the root node.
3. The `layout` rows clean up automatically via `ON DELETE CASCADE` on `layout.node_id`.
4. Wrap everything in a single transaction. If any delete fails, rollback.
5. Return the count of deleted nodes so the frontend can confirm to the user ("Deleted Wheels and 4 parts").

The existing `delete_node` command should remain for single-node (leaf) deletion, which requires no dialog and no cascade.

**Task 2 -- Error string cleanup (CF-4)**

Audit all `commands.rs` error returns. Remove `[db]` prefixes. Replace with plain-English sentences. See Derek's M2 review Item 5 on the `[db]` prefix.

**Silas validation checklist:**
- `delete_node_cascade` deletes the target node and ALL descendants. Verified by checking node count before and after in the DB.
- Transaction: if any individual delete fails, nothing is deleted.
- `layout` rows for all deleted nodes are gone (cascade should handle this; verify explicitly).
- Returns deleted node count to frontend.
- No `[db]` prefixes remain in user-facing error strings.
- Registered in `main.rs`/`lib.rs` alongside existing commands.

---

### Wren -- Frontend: Navigate-Into, Delete Dialog, Cleanup

**Output location:** `src/App.tsx`, `src/components/Card.tsx`, `src/store/canvas-store.ts`, `src/ipc/db.ts`
**Upstream dependencies:**
- Navigate-into: no backend dependency. Pure frontend state management.
- Context-sensitive card creation: no backend dependency. State management extension of navigate-into.
- Delete dialog ("Delete all" path): requires Silas's `delete_node_cascade` command.
- Code cleanup: no dependencies.

**Task 1 -- Zoom-into-card navigation (no Silas dependency) -- Start Immediately**

Implement a "current viewport context" that limits which cards are rendered and at what depth coloring.

Approach:
1. Add a `viewRoot: number | null` state to the canvas store. `null` = top-level canvas (current behavior). A card ID = "we are inside this card's canvas."
2. When `viewRoot` is set to card X, render only cards whose `parentId === X` as the top-level elements of the canvas. Those cards' own children render inside them as nested cards, exactly as the current nesting renders -- no change to the children's rendering logic. Derek confirmed (Constraint 1): direct children of the entered card are the top-level elements; the subtree below them renders normally within them.
3. Depth coloring resets to be context-relative (Constraint 2): when inside a navigated context, a card whose `parentId === viewRoot` renders as depth 0, its children as depth 1, and so on. The absolute depth in the global tree is irrelevant to visual rendering. The canvas store should compute display depth relative to `viewRoot`, not relative to the global root.
4. Double-clicking a card's body (not the resize zone, not the text edit zone) triggers `setViewRoot(card.id)`. The breadcrumb updates.
5. The breadcrumb is fully clickable (not display-only): each segment calls `setViewRoot` with that ancestor's ID, or `setViewRoot(null)` for "Canvas."
6. Escape key exits to parent: `setViewRoot(currentViewRoot's parentId)`. If the current `viewRoot` is a top-level card (its `parentId` is null), Escape returns to `viewRoot = null`.
7. Canvas pan/zoom state resets on each navigation for M3. Per-card viewport memory is M4 scope.
8. The entered card itself is not rendered as a visible container -- the user is inside it. Only its children are visible.

**Constraint 5 enforcement:** While navigated inside a card, dragging a child card to the edge of the viewport must not trigger any unnesting behavior. The parent System is not in view. Unnesting via drag while navigated inside requires explicit navigation up first.

**Task 2 -- Context-sensitive card creation (no backend dependency, tightly coupled to Task 1)**

When `viewRoot` is set, double-clicking the canvas to create a new card must use `viewRoot` as the `parent_id` for the new card, not null. The existing card creation logic in App.tsx must read `viewRoot` from the canvas store and pass it as the parent. This ensures DSRP Constraint 4: a Distinction made inside a System is a part of that System.

Default position for a new card in a navigated context: same approach as top-level card creation (at cursor or default offset from center). Auto-placement to avoid overlap uses the same existing logic.

**Task 3 -- Subtree delete confirmation dialog (requires Silas's `delete_node_cascade`)**

1. In the Delete key handler (`App.tsx` lines 668-713), add a pre-flight check: does the card being deleted have any children in the in-memory map?
2. If no children: proceed with existing single-node delete. No dialog. No change from M2 behavior.
3. If children: do NOT optimistically remove from state. Show a modal confirmation:
   - Message: "This card contains [N] part[s]. Delete the card and everything inside it?"
   - Actions: "Delete all" and "Cancel"
4. On "Delete all": call `db.deleteNodeCascade(cardId)`. On success, remove the card and all its descendants from in-memory state (walk the in-memory map using `getDescendants`). On error, show the error -- no optimistic change was made, so no revert is needed.
5. On "Cancel": dismiss the modal. No state change.

The modal can be a simple inline overlay for M3. No full modal library needed.

Add `deleteNodeCascade(nodeId: number): Promise<number>` to `src/ipc/db.ts` (returns deleted count).

**Edge case:** If the user is navigated inside a card and deletes that card's ancestor from another context (not currently possible, but worth noting), the navigation state must be reset to the top-level canvas. Guard: if `viewRoot` is no longer in the card map after any delete, reset to `null`.

**Task 4 -- Code cleanup (CF-3, CF-4 frontend side)**

- `Card.tsx`: evaluate the conditional `borderBottom` on cards with children. Make it unconditional or remove it. Document the decision in a comment.
- `types.ts`: update the M1-era comment on line 26. Replace "containers" with "parent cards" anywhere in TypeScript comments.
- Audit any other developer-facing language that implies a container/leaf type distinction.

**Wren validation checklist:**
- Navigate into "Bicycle": only Bicycle's direct parts visible as top-level on the canvas. Breadcrumb shows `Canvas > Bicycle`. Depth coloring: Bicycle's children render as depth 0.
- Navigate into "Wheels" (from inside Bicycle): only Wheels' direct parts visible. Breadcrumb shows `Canvas > Bicycle > Wheels`. Depth coloring: Wheels' children render as depth 0.
- Children of children are still visible as nested cards inside their parent cards (e.g., Front Wheel's children are still visible inside Front Wheel when navigated into Wheels).
- Click "Bicycle" in breadcrumb: returns to Bicycle's canvas. Bicycle's parts visible.
- Click "Canvas" in breadcrumb: returns to top-level canvas. All root cards visible.
- Escape from Wheels: returns to Bicycle's canvas.
- Escape from Bicycle: returns to top-level canvas.
- Double-click canvas while inside "Wheels": new card is created with `parent_id = Wheels.id`. Verify in DB. New card appears as a part of Wheels.
- Drag a card inside "Wheels" to the canvas edge: card does not escape into the parent System. Drag is constrained to the current context.
- Delete leaf card (no parts): no dialog, immediate deletion. Same behavior as M2.
- Delete card with 3 parts: dialog appears with correct count ("3 parts"). "Cancel" leaves everything intact. "Delete all" removes card and all 3 parts from canvas and DB.
- After "Delete all," DB has no rows for the deleted card or any of its parts. Layout rows are also gone.
- No optimistic flash-and-revert: UI does not show any deletion before user confirms.
- No `[db]` prefix visible in any user-facing error message.
- No "containers" in TypeScript type comments.
- Header border decision documented.
- Subtree move test: drag a card with 2+ levels of descendants into a new parent. Verify the entire subtree moves, auto-resize propagates correctly on the new parent, and no coordinates are corrupted.

---

### Derek -- DSRP Compliance Review

**Output location:** `docs/m3-derek-review.md`
**Upstream dependencies:** Wren's M3 implementation complete and self-verified.
**Downstream:** M3 is not closed until Derek signs off. M4 cannot begin until M3 is closed.

**What Derek checks in M3:**

1. **Zoom-into-card is faithful perspective-taking.** When the user navigates into a card, is the interaction a correct representation of adopting a perspective (point + view) in the DSRP sense? Derek verifies that the breadcrumb communicates "I am looking from X at Y" in a way that reinforces DSRP rather than just functioning as a navigation convenience.

2. **Depth coloring is genuinely context-relative.** The depth colors reset when navigating into a card. A card at logical depth 4 renders as depth 0 when it is the top-level element of its current navigation context. Derek confirms this is visually correct and does not mislead the user about their position in the global hierarchy (breadcrumb handles that).

3. **Context-sensitive card creation is correct.** Creating a card while navigated inside another card produces a part of the entered card. Derek confirms this matches the DSRP principle: a Distinction made inside a System is a part of that System.

4. **No container/leaf distinction has accumulated.** With CF-3 and CF-4 addressed, Derek confirms that no new visual or behavioral distinction between "cards that have parts" and "cards that do not" has been introduced in M3.

5. **Delete dialog is DSRP-consistent.** The "Delete all" option dissolves a System and all its parts. Derek confirms the dialog language adequately communicates the gravity of this operation. A user should not accidentally dissolve a System they built.

6. **Constraint 5 holds.** Cards cannot be accidentally moved out of the entered card via drag. Derek confirms no accidental system boundary violations are reachable through normal interaction.

7. **No Relationships scaffolding crept in.** Derek confirms no pre-encoding of relationship structure was introduced in M3. The schema and data model remain Systems-only.

---

## UX Questions for M3

These questions must be answered before implementation begins on the relevant features. Q1-Q9 were answered in M2. Q10-Q16 are new for M3, contributed by Derek in `m3-derek-input.md` (Section 5).

| Q# | Question | Who Decides | Blocking What | Status |
|---|---|---|---|---|
| Q10 | When navigating into a card, should the transition be animated (cards zoom/fly in) or instantaneous (hard cut)? | Wren (implementation), Derek (DSRP fidelity) | Zoom-into-card implementation | Open -- must resolve before Wren begins Task 1 |
| Q11 | How should depth coloring work when navigated into a card? Context-relative (children of entered card show as depth-0) or absolute depth colors retained? | Derek (DSRP), Wren (implementation) | Zoom-into-card visual design | **Answered by Derek:** Context-relative. Children of the entered card display as depth-0. See Constraint 2 above. |
| Q12 | Can a user navigate into a card that has no children? What do they see -- an empty canvas inviting them to add parts, or is navigation blocked on empty cards? | Derek (DSRP), Wren (UX) | Zoom-into-card empty state | Open -- must resolve before Wren begins Task 1 |
| Q13 | When a user creates a card while inside a navigated context, where does it appear? At the cursor? At a default position? Auto-placed to avoid overlap? | Wren (implementation) | Context-sensitive card creation | Open -- Wren decides; should be consistent with existing card creation behavior |
| Q14 | The delete dialog (CF-2): should options be "Delete all" / "Cancel" only, or also offer "Move children to parent before deleting"? The latter is more DSRP-respectful but significantly more complex. | Derek (DSRP), Wren (implementation) | Delete dialog design | Open -- recommend "Delete all" / "Cancel" for M3; "Move children to parent" deferred to M4 as it requires its own implementation spec |
| Q15 | Multi-select nesting: when the user selects multiple cards and drags them into a new parent, do they nest as a group or individually? | Derek (DSRP), Wren (implementation) | Multi-select implementation | Deferred to M4 (multi-select is out of M3 scope) |
| Q16 | Undo/redo scope: does undo apply only within the current navigation context or globally across the hierarchy? | Wren (implementation), Derek (DSRP) | Undo/redo architecture | Deferred to M4 (undo/redo is out of M3 scope) |

**Q10 and Q12 must be answered before Wren begins zoom-into-card implementation.** Both are blocking the start of Wren Task 1. Larry should collect these answers from Derek and Wren before signaling implementation kickoff.

---

## Dependency and Sequencing Map

```
M2 COMPLETE (precondition for all M3 work)
  zoom-into-card deferred from M2 (Q8 decision)
  delete-with-children UX acceptable but not ideal (Derek M2 review Item 6)
  code debt logged (CF-3, CF-4)
  S-Deferred behaviors logged (Sections 2 and 4 of m3-derek-input.md)

PARALLEL (can start immediately at M3 kickoff)
  Silas  --> Task 1: Implement delete_node_cascade IPC command
          --> Task 2: Error string cleanup (CF-4 backend)

  Wren   --> Task 1: Zoom-into-card navigation (no backend dep)
               [BLOCKED on Q10 and Q12 answers before beginning]
          --> Task 2: Context-sensitive card creation (coupled to Task 1)
          --> Task 4: Code cleanup (CF-3, CF-4 frontend)

SEQUENTIAL
  Silas delivers delete_node_cascade
    --> Wren Task 3: Wire delete dialog to cascade command
                     Add deleteNodeCascade to db.ts IPC layer

  Q10 and Q12 answered (Derek + Wren)
    --> Wren Task 1 unblocked

  Wren Tasks 1 + 2 + 3 + 4 all complete
    --> Wren self-verification against checklist
    --> Derek DSRP compliance review (docs/m3-derek-review.md)
    --> M3 closed
```

**Critical path:** Zoom-into-card navigation (Wren Task 1) is the most complex item and has no Silas dependency. It should start immediately after Q10 and Q12 are answered. Context-sensitive card creation (Wren Task 2) is tightly coupled to Task 1 and should be implemented as part of the same workstream, not a separate hand-off.

**Wren is not fully blocked at kickoff.** Code cleanup (Task 4) can begin immediately. Task 1 and Task 2 wait on Q10 and Q12 answers. The delete dialog (Task 3) waits on Silas's cascade command, but that is not the critical path item.

**Why breadcrumb navigation is not a separate task:** The breadcrumb was wired in M2 to display the ancestor chain. Making it navigable (clickable) is integral to zoom-into-card -- it cannot ship as display-only once navigate-into exists (Derek Constraint 3). It is a sub-task of Wren Task 1, not a separate workstream.

---

## M3 Done Criteria

M3 is complete -- and M4 kickoff may begin -- when ALL of the following are true:

1. **Navigate-into works.** Double-clicking a card enters it as a full-screen canvas. Only that card's direct parts are visible as top-level elements. Their children are visible inside them as nested cards. Depth coloring is context-relative (entered card's children render at depth 0).

2. **Navigate-out works.** Clicking a breadcrumb segment returns the user to that ancestor's canvas. Escape exits to parent. Clicking "Canvas" in the breadcrumb returns to the top-level view.

3. **Breadcrumb is clickable.** Every segment in the breadcrumb is a navigation action, not just a label.

4. **Context-sensitive card creation works.** Double-clicking the canvas while inside a navigated card creates a card with the entered card as its parent. Verified in DB.

5. **Accidental unnesting via drag is blocked.** A child card cannot be dragged outside its System boundary while the user is navigated inside the System.

6. **Delete with parts is non-jarring.** A confirmation dialog appears before any multi-card deletion. No optimistic flash-and-revert. The user makes an explicit choice.

7. **"Delete all" cascade works.** The card and all its descendants are removed from the canvas and from the DB in a single transaction. No orphaned rows remain.

8. **Leaf delete is unchanged.** Deleting a card with no parts is immediate and requires no dialog. No regression from M2.

9. **No raw error strings reach the user.** All IPC error messages are plain English. No `[db]` prefix visible in the UI under any reachable path.

10. **Code language is clean.** No "containers" in developer-facing type comments. No M1-era stale comments. Header border decision documented.

11. **Subtree move works at depth.** Dragging a card with 2+ levels of descendants into a new parent moves the entire subtree correctly. Auto-resize propagates on the new parent. No coordinate corruption.

12. **Derek has signed off.** Derek's M3 DSRP compliance review (`docs/m3-derek-review.md`) is complete with no blocking issues.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Q10 or Q12 delays Wren Task 1 start.** If animation decision (Q10) or empty-card navigation decision (Q12) is not answered quickly, Wren cannot begin the most complex task. | Medium | Medium | Larry collects Q10 and Q12 answers from Derek and Wren before signaling kickoff. Wren begins Task 4 (code cleanup) in the interim. |
| **Context-relative depth coloring is harder than expected.** The canvas store currently computes depth from a global root. Switching to context-relative depth requires reading `viewRoot` during rendering. If the depth computation is tightly coupled to the global tree, a refactor may be needed. | Medium | Medium | Wren investigates the current depth computation path before committing to the approach. If the refactor is large, context-relative coloring can be approximated by resetting depth to 0 for all top-level-in-context cards and incrementing normally from there. |
| **Navigate-into scope expands unexpectedly.** Zoom-into-card requires a new canvas rendering mode (filter by viewRoot, reset pan/zoom, manage Escape/breadcrumb state). Per-card viewport memory adds complexity. | Medium | Medium | Keep M3 simple: viewRoot filter to direct children, pan/zoom resets on navigation, no per-card viewport memory. Per-card memory is M4 scope. |
| **Constraint 5 (no accidental unnesting) conflicts with existing drag behavior.** The current drag implementation may not have a natural hook for "canvas boundary = System boundary." Enforcing this may require changes to the drag event handler. | Low | Medium | Wren investigates during Task 1. If drag boundary enforcement is complex, the M3 implementation can simply clip drag positions to a safe zone within the canvas rather than enforcing the boundary at the System level. Full boundary enforcement can be tightened in M4. |
| **Delete cascade has edge cases with deep trees.** Deleting a card with 4+ levels of descendants is a larger operation than typical M1-M2 operations. Partial deletes would corrupt the map. | Low | High | Silas's validation checklist explicitly covers the "delete cascade and verify no rows remain" test. The recursive CTE approach handles arbitrary depth. SQLite transactions are reliable. |
| **Breadcrumb navigation state and canvas state get out of sync.** If a card is deleted while the user is navigated into one of its descendants, the breadcrumb may show a stale path. | Medium | Low | Breadcrumb reads directly from the in-memory card map on every render. If `viewRoot` is no longer in the card map after any deletion, auto-reset to `viewRoot = null` (top-level canvas). |

---

## Lessons Carried Forward from M2

**Keep:**
- **Issue tracker as source of truth for bugs.** The pattern (user writes issue -> Larry delegates fix -> Silas/Wren fix -> commit immediately -> move to Handled) was clean and low-overhead. Carry into M3.
- **Commit immediately after confirmed fix.** No accumulation of uncommitted working changes.
- **Requirements testing checklist at the bottom of the issue tracker.** Grows organically as features are added. Keep this pattern for M3.
- **Derek's review gates milestone closure.** Derek's sign-off consistently caught real issues. This gate stays.

**Improve:**
- **Derek's DSRP input at kickoff, not mid-implementation.** In M2, some DSRP answers arrived during implementation. For M3, Q10 and Q12 are explicitly flagged as blocking before Wren begins Task 1. The dependency is visible in the sequencing map.
- **Explicit "must-have" vs. "should-have" labeling.** M3 has more candidates than M2. The MoSCoW split in this document makes scope trade-offs explicit from kickoff.

**No change:**
- Short parallel workstreams. Silas and Wren starting in parallel at kickoff worked well in M2. Same in M3.
- Dependency-based sequencing with no timelines. "X before Y," not "week 1 / week 2."

---

## Reference Documents

- `docs/m3-derek-input.md` -- Derek's full DSRP analysis for M3 (source for all Derek inputs in this document)
- `docs/m3-kickoff-draft.md` -- Maren's draft with original placeholders (retained for reference)
- `docs/m2-derek-review.md` -- Derek's M2 compliance review (source of CF-1 through CF-4)
- `docs/roadmap.md` -- Living roadmap; M4 scope will be defined at M3 close

---

*M3 execution begins when Q10 and Q12 are answered. All other tasks are unblocked at kickoff.*

*Questions to Maren.*

-- Maren
