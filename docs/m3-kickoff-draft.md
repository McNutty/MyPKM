# Plectica 2.0 -- M3 Kickoff: Perspective Navigation + Relationships Foundation

**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-24
**Status:** DRAFT -- pending Derek's DSRP theory input (see placeholders marked [DEREK INPUT NEEDED])
**Prerequisite:** M2 APPROVED by Derek (2026-03-24). See `docs/m2-derek-review.md`.

---

## Draft Notice

This document is a DRAFT. Several sections contain placeholders for Derek's DSRP guidance on M3 scope. Derek is working on this input in parallel. When his analysis arrives, the placeholders will be filled and this document promoted to ACTIVE status.

Sections awaiting Derek's input are marked: **[DEREK INPUT NEEDED]**

---

## M3 Goal

M3 completes the MVP and makes Plectica 2.0 genuinely usable as a thinking tool.

M2 delivered the structural backbone: any card can contain any other card to arbitrary depth, with full persistence and cycle prevention. The user can now model a System. What M3 adds is the ability to work within that system fluidly -- to navigate into a card as its own canvas, to delete a system's parts with deliberate intent rather than accidental keystrokes, and to begin laying the groundwork for Relationships (the R in DSRP).

By the end of M3:
- A user can double-click any card to enter it as a first-class canvas, seeing only that card's parts at full scale. They can navigate back out through a clickable breadcrumb. This is perspective-taking made operational.
- Deleting a card with parts no longer produces a confusing flash-and-revert. A clear confirmation dialog gives the user meaningful agency over dissolving a System.
- The codebase is clean enough that adding Relationships in M4 does not require archaeology. Language and structural code debt from M1-M2 is addressed.

**[DEREK INPUT NEEDED]** -- Derek to confirm: Is M3 the right milestone to introduce any Relationships scaffolding (schema, UI groundwork), or should M3 stay entirely within the Systems domain and leave Relationships to M4? His answer affects scope significantly.

---

## What Carries Forward from M2

These items were logged by Derek in `docs/m2-derek-review.md` as carry-forward inputs to M3. All four are in scope for M3.

| CF # | Item | Source | Priority in M3 |
|---|---|---|---|
| CF-1 | Zoom-into-card navigation (perspective-taking) | Derek M2 review | Must-have. Derek called this "not just a UX convenience -- it is the implementation of perspective-taking." Named deliverable, not stretch goal. |
| CF-2 | Subtree delete confirmation dialog | Derek M2 review | Must-have. Replaces the jarring optimistic-then-revert pattern. Clear UX; no data loss risk. |
| CF-3 | Conditional header border on childless cards | Derek M2 review | Should-have. Minor cosmetic refinement; prevent accumulation of container/leaf visual signals. |
| CF-4 | Language and code cleanup (`[db]` prefixes, `"containers"` in comments) | Derek M2 review | Should-have. Code hygiene before M4 adds more IPC commands. |

---

## M3 Scope Proposal

### Must-Have (M3 closes when all of these are done)

**1. Zoom-into-card navigation (CF-1)**

The user can double-click any card to enter it as its own full-screen canvas. Inside the card's canvas, only that card's direct parts are visible at full scale. The breadcrumb updates to show the navigation path (e.g., `Canvas > Bicycle > Wheels`). Clicking a breadcrumb segment navigates back to that ancestor's canvas. Pressing Escape exits to the parent canvas.

This is the implementation of Perspective (P) in DSRP: the user adopts a card as their point of observation and the view is that card's parts. Derek explicitly endorsed this in the M2 review (Item 7, Q8 note) as theoretically significant, not merely cosmetic.

**[DEREK INPUT NEEDED]** -- Derek to specify: When the user navigates into a card's canvas, should that card's parent and siblings be visible (dimmed, greyed out, partially shown) as context, or should the view be a clean break showing only the card's own parts? This is a DSRP Perspective question: does the point of observation always imply a clean frame, or does peripheral context help the thinker? Derek's answer shapes the implementation significantly.

**[DEREK INPUT NEEDED]** -- Derek to specify: Does navigating into a card constitute "taking the perspective of that card" in the formal DSRP sense? If so, should the UI reinforce this semantically (e.g., "Viewing from: Wheels") rather than just spatially? Or is spatial navigation sufficient at this stage?

**2. Subtree delete confirmation dialog (CF-2)**

Replace the current optimistic-then-revert delete pattern with a pre-flight check. Before any deletion, the app checks the in-memory card map for children. If the target card has no children, deletion proceeds immediately (current behavior is fine for leaf cards). If the target card has children, a modal confirmation appears:

> "This card contains N parts. Delete the card and all its parts?"
> [Delete all] [Cancel]

"Delete all" triggers a recursive cascade delete from the frontend (delete leaves first, walk up). "Cancel" does nothing.

The `ON DELETE RESTRICT` DB constraint remains as a safety net, but the pre-flight check means users should never encounter the raw restrict error in normal use.

**[DEREK INPUT NEEDED]** -- Derek to confirm: DSRP would say the user's thinking inside a card is meaningful and should not be silently destroyed. The "Delete all" option requires explicit confirmation, which satisfies this principle. Does Derek have any concerns about the cascade direction (delete leaves first vs. delete root and cascade)? Are there DSRP-theoretical reasons to prefer one approach?

**3. Code cleanup (CF-4)**

A focused cleanup pass before M4 adds more IPC commands:
- Remove `[db]` prefix from user-facing error strings in `commands.rs`
- Replace "containers" with "parent cards" or "cards with parts" in `types.ts` comments and any other developer-facing comments that import a container/leaf distinction
- Update the stale M1-era comment in `types.ts` line 26 (flagged in Derek's M2 review)
- Audit all IPC command error strings for plain-English compliance

This is Silas and Wren split: Silas owns Rust error strings; Wren owns TypeScript comments and types.

### Should-Have (ship in M3 if scope allows; defer to M4 if they threaten the critical path)

**4. Conditional header border cosmetic fix (CF-3)**

The `borderBottom` on `Card.tsx` that conditionally appears when a card has children is cosmetically minor but represents one step toward a visual container/leaf distinction. Address during the code cleanup pass: either make the border unconditional (always present) or remove it entirely. Wren's call on which looks better.

**5. Clickable breadcrumb navigation**

The breadcrumb already renders the correct ancestor chain (M2 delivered this). M2 breadcrumb segments are display-only. In M3, clicking a breadcrumb segment should navigate to that ancestor's canvas view. This is tightly coupled to zoom-into-card navigation (deliverable 1 above) -- once navigate-into is implemented, navigate-out via breadcrumb is a natural extension. Sequenced as a sub-task of deliverable 1, not a separate workstream.

**6. Color scheme selection**

The user expressed interest in choosing a color scheme (matching colors rather than individual card colors). Auto-depth colors stay; the user selects from pre-defined palettes. This is low complexity for Wren and directly supports the "minimum arranging, maximum thinking" design principle.

**[DEREK INPUT NEEDED]** -- Derek to confirm: Does the choice of color scheme carry any DSRP meaning, or is it purely aesthetic? For example, if two different color schemes communicate different things about the structure (warm colors = part, cool colors = system), that would be a DSRP question. If color is purely visual preference with no semantic claim, it is Wren's domain entirely.

### Explicitly Deferred to M4 (not in M3 scope)

The following items are valuable but would expand M3 beyond a focused, closeable milestone. They are tracked, not abandoned.

| Deferred Item | Reason | Target |
|---|---|---|
| Relationships (arrows between cards) | Phase 2 feature. Schema supports it (node_type field). Full R implementation needs its own milestone. | M4 or M5 |
| Multi-select and group move | Useful but not blocking core thinking workflows. | M4 |
| Undo/redo | High value; also high complexity in the Tauri/SQLite architecture. Needs its own scoping. | M4 |
| Map management (create, rename, switch maps) | Needed before v1.0; not needed for MVP validation. | M4 |
| Performance optimization at scale | Test at 100+ cards. Viewport culling. Only urgent if user hits it. | M4 |
| Import/export | Phase 2+ feature. | M5+ |

**[DEREK INPUT NEEDED]** -- Derek to advise: The roadmap places Relationships in Phase 2 (v1.0). Should M3 include any schema or backend scaffolding for Relationships even if the UI is not ready? For example: Silas could add a `node_type = 'relationship'` path to the schema now (the schema already has `node_type DEFAULT 'card'`) so that M4 can wire the UI without a migration. Derek's call on whether this conflicts with any DSRP principle around not pre-encoding structure that the user has not yet expressed.

---

## Milestone Structure

### Deliverables by Team Member

---

### Silas -- Backend: Cascade Delete + Code Cleanup

**Output location:** `src-tauri/src/commands.rs`, `src-tauri/src/main.rs` (or `lib.rs`)
**Upstream dependencies:** None. Silas can start immediately at M3 kickoff.
**Downstream:** Wren's delete dialog depends on a cascade-capable backend command.

**Task 1 -- `delete_node_cascade` IPC command**

A new Rust command that deletes a node and all its descendants recursively. This replaces the current `delete_node` (which relies on `ON DELETE RESTRICT`) for the "Delete all" path.

Implementation approach:
1. Collect the full subtree of the target node using the recursive CTE already documented in `dsrp_schema.sql` (ancestor_chain query, inverted for descendants).
2. Delete all descendant nodes first (leaves before internal nodes), then delete the root node.
3. The `layout` rows clean up automatically via `ON DELETE CASCADE` on `layout.node_id`.
4. Wrap everything in a single transaction. If any delete fails, rollback.
5. Return the count of deleted nodes so the frontend can confirm to the user ("Deleted Wheels and 4 parts").

The existing `delete_node` command should remain for single-node (leaf) deletion, which does not need a dialog.

**Task 2 -- Error string cleanup (CF-4)**

Audit all `commands.rs` error returns. Remove `[db]` prefixes. Replace with clean, plain-English sentences. See Derek's M2 review Item 5 note on the `[db]` prefix.

**Silas validation checklist:**
- `delete_node_cascade` deletes the target node and ALL descendants. Verified by checking node count before and after in the DB.
- Transaction: if any individual delete fails, nothing is deleted.
- `layout` rows for all deleted nodes are gone (cascade should handle this; verify).
- Returns deleted node count to frontend.
- No `[db]` prefixes remain in user-facing error strings.
- Registered in `main.rs`/`lib.rs` alongside existing commands.

---

### Wren -- Frontend: Navigate-Into, Delete Dialog, Cleanup

**Output location:** `src/App.tsx`, `src/components/Card.tsx`, `src/store/canvas-store.ts`, `src/ipc/db.ts`
**Upstream dependencies:**
- Navigate-into: no backend dependency. Pure frontend state management.
- Delete dialog ("Delete all" path): requires Silas's `delete_node_cascade` command.
- Code cleanup: no dependencies.

**Task 1 -- Zoom-into-card navigation (no Silas dependency)**

Implement a "current viewport context" that limits which cards are rendered and at what scale.

Approach:
1. Add a `viewRoot: number | null` state to the canvas store. `null` = top-level canvas (current behavior). A card ID = "we are inside this card's canvas."
2. When `viewRoot` is set to card X, only render X's direct children as top-level cards in the canvas. X's own header is shown as a persistent "you are inside this card" indicator, or simply reflected in the breadcrumb.
3. Double-click on a card's body (not the resize zone, not the text edit zone) triggers `setViewRoot(card.id)`.
4. The breadcrumb becomes clickable: each segment calls `setViewRoot` with that ancestor's ID (or `null` for the top-level canvas).
5. Escape key exits to parent: `setViewRoot(currentViewRoot's parentId)`.
6. Canvas pan/zoom state resets on each navigation (or optionally remembers per-card viewport -- simpler to reset for M3).

**[DEREK INPUT NEEDED]** -- Wren needs Derek's answer on whether the in-card canvas shows only direct children or all descendants (and at what depth). This determines how `viewRoot` filtering works: filter to `parentId === viewRoot` (direct children only) vs. render the full subtree with viewRoot as the new root. Direct children only is simpler and likely more correct from a DSRP standpoint (you are observing this system's immediate parts, not recursively all parts).

**Task 2 -- Subtree delete confirmation dialog (requires Silas's `delete_node_cascade`)**

1. In the Delete key handler (`App.tsx` lines 668-713), add a pre-flight check: does the card being deleted have any children in the in-memory map?
2. If no children: proceed with existing single-node delete (no dialog, no change).
3. If children: do NOT optimistically remove from state. Instead, show a modal confirmation:
   - Message: "This card contains [N] part[s]. Delete the card and everything inside it?"
   - Actions: "Delete all" and "Cancel"
4. On "Delete all": call `db.deleteNodeCascade(cardId)`. On success, remove the card and all its descendants from in-memory state (walk the in-memory map using `getDescendants`). On error, show the error -- do not revert since no optimistic change was made.
5. On "Cancel": dismiss the modal. No state change.

The modal can be a simple inline overlay for M3 -- does not need a full modal library. Consistent with the minimal-ceremony approach from M1-M2.

Add `deleteNodeCascade(nodeId: number): Promise<number>` to `src/ipc/db.ts` (returns deleted count).

**Task 3 -- Code cleanup (CF-3, CF-4 frontend side)**

- `Card.tsx`: evaluate the conditional `borderBottom` on cards with children. Make it unconditional or remove it. Document the decision.
- `types.ts`: update the M1-era comment on line 26. Replace "containers" with "parent cards" anywhere in TypeScript comments.
- Audit any other developer-facing language that implies a container/leaf type distinction.

**Wren validation checklist:**
- Navigate into "Bicycle": only Bicycle's direct parts visible on canvas. Breadcrumb shows `Canvas > Bicycle`.
- Navigate into "Wheels" (inside Bicycle): only Wheels' direct parts visible. Breadcrumb shows `Canvas > Bicycle > Wheels`.
- Click "Bicycle" in breadcrumb: returns to Bicycle's canvas. Bicycle's parts visible.
- Click "Canvas" in breadcrumb: returns to top-level canvas. All root cards visible.
- Escape from Wheels: returns to Bicycle's canvas.
- Escape from Bicycle: returns to top-level canvas.
- Delete leaf card (no parts): no dialog, immediate deletion. Same behavior as M2.
- Delete card with 3 parts: dialog appears with correct count. "Cancel" leaves everything intact. "Delete all" removes card and all 3 parts from canvas and DB.
- After "Delete all", DB has no rows for the deleted card or any of its parts.
- No flash-and-revert: the UI does not show the deletion before confirmation.
- No `[db]` prefix visible in any user-facing error message.
- No "containers" in TypeScript type comments.
- Header border decision documented.

---

### Derek -- DSRP Compliance Review

**Output location:** `docs/m3-derek-review.md`
**Upstream dependencies:** Wren's M3 implementation complete and self-verified.
**Downstream:** M3 is not closed until Derek signs off. M4 cannot begin until M3 is closed.

**What Derek checks in M3:**

1. **Zoom-into-card is faithful perspective-taking.** When the user navigates into a card, is the interaction a correct representation of adopting a perspective (point + view) in the DSRP sense? Derek verifies that the point of observation (the card entered) and the view (its parts) are correctly represented, and that the breadcrumb communicates "I am looking from X at Y" in a way that reinforces DSRP rather than just functioning as a navigation convenience.

2. **No container/leaf distinction has accumulated.** With CF-3 and CF-4 addressed, Derek confirms that no new visual or behavioral distinction between "cards that have parts" and "cards that do not" has been introduced in M3.

3. **Delete dialog is DSRP-consistent.** The "Delete all" option dissolves a System and all its parts. Derek confirms that the dialog language and the confirmation requirement adequately communicate the gravity of this operation to the user. A user should not accidentally dissolve a System they built.

4. **[DEREK INPUT NEEDED] -- Additional items Derek identifies from his M3 DSRP theory input.** Derek may add review items based on his parallel DSRP theory analysis, particularly around Relationships scaffolding if any is included in M3.

---

## Dependency and Sequencing Map

```
M2 COMPLETE (precondition for all M3 work)
  zoom-into-card deferred from M2 (Q8 decision)
  delete-with-children UX is acceptable but not ideal (Derek M2 review Item 6)
  code debt logged (CF-3, CF-4)

PARALLEL (can start immediately at M3 kickoff)
  Silas  --> Task 1: Implement delete_node_cascade IPC command
          --> Task 2: Error string cleanup (CF-4 backend)

  Wren   --> Task 1: Implement zoom-into-card navigation (no backend dep)
          --> Task 3: Code cleanup (CF-3, CF-4 frontend)

SEQUENTIAL
  Silas delivers delete_node_cascade
    --> Wren Task 2: Wire delete dialog to cascade command
                     Add deleteNodeCascade to db.ts IPC layer

  Derek provides DSRP input on:
    --> zoom-into-card view scope (direct children only vs. full subtree)
    --> "Delete all" dialog language confirmation
    --> Relationships scaffolding decision (in/out of M3)

  Wren Tasks 1 + 2 + 3 all complete
    --> Wren self-verification against checklist
    --> Derek DSRP review
    --> M3 closed
```

**Critical path:** Zoom-into-card navigation (Wren Task 1) is the most complex item and has no upstream dependency. It should start immediately. Derek's DSRP input on view scope should be collected early -- ideally before Wren reaches the filtering implementation step -- to avoid rework.

**Wren is not blocked at kickoff.** Navigate-into and code cleanup can begin immediately. The delete dialog waits on Silas's cascade command, but that is not the critical path item.

---

## M3 Done Criteria

M3 is complete -- and M4 kickoff may begin -- when ALL of the following are true:

1. **Navigate-into works.** Double-clicking a card enters it as a full-screen canvas. Only that card's parts are visible. The canvas feels like the user has "stepped inside" the System.

2. **Navigate-out works.** Clicking a breadcrumb segment returns the user to that ancestor's canvas. Escape exits to parent. Clicking "Canvas" in the breadcrumb returns to the top-level view.

3. **Breadcrumb is clickable.** Every segment in the breadcrumb is a navigation action, not just a label.

4. **Delete with parts is non-jarring.** A confirmation dialog appears before any multi-card deletion. No optimistic flash-and-revert. The user makes an explicit choice.

5. **"Delete all" cascade works.** The card and all its descendants are removed from the canvas and from the DB in a single operation. No orphaned rows remain.

6. **Leaf delete is unchanged.** Deleting a card with no parts is immediate and requires no dialog. No regression from M2.

7. **No raw error strings reach the user.** All IPC error messages are plain English. No `[db]` prefix visible in the UI under any reachable path.

8. **Code language is clean.** No "containers" in developer-facing type comments. No M1-era stale comments. Header border decision documented.

9. **Derek has signed off.** Derek's M3 DSRP compliance review is complete with no blocking issues.

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Navigate-into scope expands unexpectedly.** Zoom-into-card requires a new canvas rendering mode (filter by viewRoot, reset pan/zoom, manage Escape/breadcrumb state). If per-card viewport memory is added, complexity increases further. | Medium | Medium | Keep M3 simple: viewRoot filter to direct children, pan/zoom resets on navigation, no per-card viewport memory. Per-card memory is M4 scope. Derek's input on view scope must arrive before Wren reaches the filtering step. |
| **Derek's DSRP input on Relationships scaffolding adds M3 scope.** If Derek recommends including schema scaffolding for Relationships in M3, Silas needs time to implement it cleanly. | Low | Medium | If Relationships scaffolding is added, it is scoped to schema-only (no UI). Silas's `node_type` field already exists; a migration may not even be needed. Time-box the scaffolding work before committing it to M3 scope. |
| **Delete cascade has edge cases with deep trees.** Deleting a card with 4 levels of descendants inside it is a larger operation than typical M1-M2 operations. Transaction integrity is critical -- partial deletes would corrupt the map. | Low | High | Silas's validation checklist explicitly covers the "delete cascade and verify no rows remain" test. The recursive CTE approach handles arbitrary depth. SQLite transactions are reliable. |
| **Breadcrumb navigation state and canvas state get out of sync.** If the user navigates into a card and then performs operations (nest, unnest, delete) that affect the ancestor chain, the breadcrumb might show a stale path. | Medium | Low | Breadcrumb reads directly from the in-memory card map on every render. If a card is deleted while navigated into one of its descendants, navigate to the top-level canvas automatically. |
| **Derek's DSRP input is late, blocking Wren's view-scope implementation.** Wren needs Derek's answer on direct-children vs. full-subtree filtering before finalizing the navigate-into rendering. | Medium | Medium | Wren can implement the filtering logic with a feature flag (direct-children mode vs. full-subtree mode) and switch once Derek's input arrives. This is a low-cost way to avoid blocking on a decision. |

---

## Lessons Carried Forward from M2

The M2 iterative workflow worked well. These practices carry directly into M3.

**Keep:**
- **Issue tracker as the source of truth for bugs.** `User input/Thoughts on M2.md` was the single place where new issues were logged, fixed, and verified. The pattern (user writes issue -> Larry delegates fix -> Silas/Wren fix -> commit immediately -> move to Handled) was clean and did not require process overhead.
- **Commit immediately after confirmed fix.** No accumulation of uncommitted working changes. This kept the git log clean and made each fix independently reviewable.
- **Requirements testing checklist at the bottom of the issue tracker.** The numbered list in `Thoughts on M2.md` gave the user a structured way to verify each requirement. The checklist grew organically as features were added. Keep this pattern.
- **Derek's review gates milestone closure.** Derek's sign-off is not a formality -- it consistently caught real issues (Observation A on depth computation, the delete flash, the stale comment) that improved the product. This gate stays.

**Improve:**
- **Derek's DSRP input earlier in the milestone.** In M2, some of Derek's answers to Q6-Q9 were answered during implementation rather than before it. For M3, Derek's input on navigate-into scope (direct children vs. subtree) and the delete dialog language should be collected at kickoff, not mid-implementation. This document contains explicit placeholders to make that dependency visible.
- **Explicit "should-have" vs. "must-have" labeling in scope.** M2's scope was clean, but M3 introduces more candidates. The MoSCoW split in this document (must-have/should-have/deferred) makes scope trade-offs explicit from the start.

**No change needed:**
- Short parallel workstreams. Silas and Wren starting in parallel at kickoff (rather than sequentially) worked well in M2. Same approach in M3.
- Dependency-based sequencing with no timelines. Avoids false precision. The sequencing map above uses "X before Y" language, not "week 1 / week 2."

---

## Open Questions for Derek (Consolidated)

All items marked [DEREK INPUT NEEDED] above, collected here for easy reference:

1. **M3 scope:** Should M3 include any Relationships schema scaffolding, or stay entirely within Systems?

2. **Navigate-into view scope:** When the user enters a card's canvas, do they see only direct children (direct parts of the System), or the full subtree (all descendants)? What is the DSRP-correct answer?

3. **Navigate-into semantics:** Does entering a card constitute formal perspective-taking (P = {point: card, view: card's parts}) in a way that should be reflected in the UI language?

4. **Delete dialog language:** Does the "Delete all" confirmation language adequately communicate the gravity of dissolving a System and its parts? Any suggested wording?

5. **Color scheme selection:** Is color scheme choice purely aesthetic, or does it carry DSRP meaning that the team should be aware of?

---

*This document becomes ACTIVE when Derek's DSRP theory input has been incorporated and the open questions above are resolved. At that point, the team has everything needed to execute M3.*

*Questions to Maren.*

-- Maren
