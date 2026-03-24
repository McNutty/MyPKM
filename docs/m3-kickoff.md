# Plectica 2.0 -- M3 Kickoff: Relationships + Polish

**Author:** Maren (Technical Project Manager), with DSRP theory input from Derek
**Date:** 2026-03-24
**Status:** ACTIVE -- authoritative M3 specification
**Prerequisite:** M2 APPROVED by Derek (2026-03-24). See `docs/m2-derek-review.md`.
**Derek's full M3 analysis:** `docs/m3-relationships-derek.md`

---

## Scope Change Notice

This document supersedes the previous M3 kickoff, which scoped M3 as zoom-into-card navigation (Perspective). Derek revised his sequencing recommendation: Relationships (R) should ship before Perspectives (P). The original M3 doc described Relationships as a Phase 2 feature deferred to M4. That sequencing is now reversed.

**Why Derek changed the recommendation:** Without Relationships, Plectica is a hierarchical note-taker -- Systems without connections across system boundaries. R is what makes it a systems thinking tool. Zoom-into-card (Perspectives) is a navigation affordance that builds on an already-functional DSRP canvas; Relationships are structural. Building P before R would be building a navigation feature on top of an incomplete representation.

**Carry-forward items are rebalanced:** CF-2 (delete dialog) and CF-4 (code cleanup) remain in M3 scope. CF-1 (zoom-into-card) moves to M4. CF-3 (conditional header border) is deferred -- it is cosmetically minor and zoom-into-card is no longer in scope to bundle it with.

---

## M3 Goal

M3 adds Relationships (R) to the canvas and closes two carry-forward items from M2.

M2 delivered Distinctions (cards) and Systems (nesting). The user can build a hierarchy. What M3 adds is the ability to draw connections across that hierarchy -- to say "this part of this system acts on that part of that system." That is the core move of systems thinking, and it is what separates Plectica from a nested outline.

By the end of M3:
- A user can hover near any card edge, see a connection handle appear, and drag from that handle to any other card to create a directed relationship.
- The relationship renders as a directed line with an arrowhead. If the relationship has no label it appears visually flagged as incomplete (dashed/faded). Double-clicking the line lets the user add or edit the label.
- Relationships cross system boundaries freely -- a card inside one subtree can be connected to a card inside a completely different subtree.
- Moving or reparenting a card does not destroy its relationships. Deleting a card silently removes its relationships (no extra confirmation needed).
- Relationships survive app reload. They are first-class persisted entities with their own table and stable IDs.
- The delete confirmation dialog (CF-2) replaces the M2 optimistic-flash-and-revert behavior for cards with parts.
- Code language cleanup (CF-4) is complete before M4 adds more IPC commands.

---

## What Carries Forward from M2

| CF # | Item | Source | Priority in M3 |
|---|---|---|---|
| CF-2 | Subtree delete confirmation dialog | Derek M2 review | Must-have. Deleting a card with Relationships attached now has two cascades (children + relationships). Pre-flight dialog is more important than ever. |
| CF-4 | Language and code cleanup (`[db]` prefixes, `"containers"` in comments) | Derek M2 review | Must-have. Before M4 adds more IPC commands. |
| CF-1 | Zoom-into-card navigation (perspective-taking) | Derek M2 review | **Moved to M4.** Derek revised sequencing: R before P. See Scope Change Notice above. |
| CF-3 | Conditional header border on childless cards | Derek M2 review | **Deferred.** Minor cosmetic; was bundled with zoom-into-card. Revisit at M4. |

---

## DSRP Hard Constraints (from Derek's Analysis)

These constraints are non-negotiable. Any implementation that violates them is not DSRP-compliant and M3 cannot close until Derek confirms all six hold.

**R-1: Every relationship must have a direction (source -> target).**
Relationships in DSRP are not symmetric. "A acts on B" is a different claim than "B acts on A." The data model and UI must enforce directionality -- there is no undirected relationship. Arrowheads on the rendered line are not cosmetic; they are semantic.

**R-2: Labels name the action; unlabeled relationships are flagged as incomplete.**
A relationship without a label is a structurally ambiguous assertion -- the user has said "these two things are connected" but not "how." The system should allow this state (the user may not know the label yet) but must visually flag it as incomplete (dashed line, faded color, or similar). Double-clicking an unlabeled line prompts for a label. The incomplete flag is removed when a label is added.

**R-3: Any two nodes can be connected regardless of their position in the hierarchy.**
A relationship is not constrained to cards within the same subtree or at the same depth. A card nested three levels deep inside System A can be connected to a top-level card. This is the whole point: Relationships reveal connections that cross system boundaries. The implementation must not artificially restrict which cards can be endpoints.

**R-4: Moving a node (reparenting) must not destroy its relationships.**
If a user drags a card into a new parent (changing its `parent_id`), its outgoing and incoming relationships must survive. The relationship references the card's stable ID, not its position in the hierarchy. A relationship whose endpoint was reparented is still valid and must continue to render correctly with updated anchor points.

**R-5: Relationships are first-class entities with stable IDs.**
Relationships must live in their own table with their own primary key. They are not JSON attached to nodes, not inferred from node positions, not ephemeral. A relationship created in one session is available in the next. Its ID is stable across updates (editing the label does not change the ID).

**R-6: Deleting a node cascades to its relationships silently.**
When a card is deleted, all relationships where it is the source or target are deleted automatically. No additional confirmation is needed beyond the existing card delete (or subtree delete) confirmation. The user chose to delete the card; its connections go with it. This is implemented via `ON DELETE CASCADE` on the `relationships` table foreign keys.

---

## M3 Scope

### Must-Have (M3 closes when all of these are done)

**1. Relationship drawing**

Hover near a card edge reveals small connection handles (dots on the card perimeter). Dragging from a handle initiates a relationship draw. Releasing the drag over another card creates a directed relationship from the source card to the target card. Releasing over empty canvas cancels the draw.

The draw gesture must be clearly distinct from card drag. Card drag is initiated from the card body (interior). Relationship draw is initiated from the handle dots on the card edge. These should not conflict.

**2. Relationship rendering**

A directed line with an arrowhead renders between the source and target cards. The line:
- Routes to the nearest edges of each card (auto-route to avoid rendering a line that crosses through a card body where possible, though exact routing can be approximate for M3)
- Displays the action label on or near the midpoint of the line
- Shows as dashed/faded when the action label is empty (incomplete state, per R-2)
- Shows as selected (visually highlighted) when clicked
- Recomputes anchor points when either endpoint card is moved or resized

Lines must render correctly when the source and target cards are at different nesting depths, including when one is a top-level card and the other is deeply nested (R-3). This requires computing the absolute canvas position of each card, accounting for any parent card offset.

**3. Relationship editing**

Clicking a relationship line selects it. When selected:
- Double-clicking the line (or its label area) opens an inline label editor
- Pressing Delete removes the relationship (no confirmation needed -- a relationship is a single entity, not a subtree)
- A "flip direction" action swaps source and target (UI treatment Wren's call -- a button in a small toolbar near the selected line, or a right-click option)

**4. Unlabeled relationship state**

An unlabeled relationship (empty action string) renders as visually distinct from a labeled one -- dashed line, reduced opacity, or similar. The intent is to communicate "this connection exists but is not yet described." The incomplete state is cleared when the user adds a label.

**5. Cross-boundary relationships**

The implementation must support and correctly render relationships between any two cards regardless of nesting depth or parent. No artificial restriction on which cards can be connected (R-3). The anchor point computation must use absolute canvas coordinates for both endpoints.

**6. Persistence**

Relationships are loaded on app startup alongside cards. Creating, editing, or deleting a relationship is immediately persisted to the DB. Reload produces the same set of relationships that existed before reload.

**7. Delete cascade (R-6)**

Deleting a card (leaf or subtree) silently removes all relationships where that card is the source or target. This is handled at the DB level via `ON DELETE CASCADE` on the `relationships` table foreign keys. No additional UI is needed -- the relationship lines simply disappear when their endpoint is removed.

**8. Subtree delete confirmation dialog (CF-2)**

Replace the current optimistic-then-revert delete behavior for cards with children. Before any multi-card deletion, a pre-flight check determines whether the target card has children in the in-memory map.

- If no children: deletion proceeds immediately (leaf delete, no dialog -- unchanged from M2).
- If children: a modal confirmation appears before any state change:

  > "This card contains [N] part[s]. Delete the card and everything inside it?"
  > [Delete all] [Cancel]

"Delete all" calls the cascade delete backend command, then removes the card and all descendants from in-memory state on success. Relationship lines for all deleted cards disappear automatically (R-6 handles the DB side; the frontend removes them from state on success). "Cancel" dismisses the modal with no state change.

No optimistic removal before confirmation. No flash-and-revert.

**9. Code cleanup (CF-4)**

A focused cleanup pass:
- Remove `[db]` prefix from user-facing error strings in `commands.rs`
- Replace "containers" with "parent cards" or "cards with parts" in `types.ts` comments and any developer-facing comments
- Update the stale M1-era comment in `types.ts` line 26
- Audit all IPC command error strings for plain-English compliance

Silas owns Rust error strings. Wren owns TypeScript comments and types.

### Explicitly Deferred to M4

| Deferred Item | Reason | Target |
|---|---|---|
| Zoom-into-card navigation (CF-1) | Sequencing change: R before P. Perspectives build on a complete DSRP canvas; Relationships complete the canvas. | M4 |
| Conditional header border cosmetic (CF-3) | Was bundled with zoom-into-card. Now deferred with it. | M4 |
| Relationship-as-system (R node that contains parts) | Advanced DSRP construct -- a relationship that is itself a system. Not needed for M3 validation. | M4+ |
| Bidirectional / reaction labels | One relationship per direction. Two relationships cover bidirectional. Explicit bidirectional type is an elaboration. | M4+ |
| Self-loops | A card related to itself. Valid in DSRP but edge case. Deferred. | M4+ |
| Relationship type classification (`rel_type` field) | Naming the type of relationship (causal, structural, etc.). Rich but not needed for basic R. | M4+ |
| Multi-select and group move | Needs to work with relationship lines. Build after R rendering is stable. | M4+ |
| Undo/redo | High complexity; needs its own scoping. More valuable after R is stable. | M4+ |
| Map management | Needed before v1.0; not needed for M3 validation. | M4+ |
| Saved perspectives / named views | Full Register 2 Perspectives. Phase 3 feature. | Phase 3 |
| Import/export | Phase 2+ feature. | M5+ |

---

## Milestone Structure

### Deliverables by Team Member

---

### Silas -- Backend: Relationships Schema + Commands + Cascade Delete + Cleanup

**Output locations:** `data/dsrp_schema.sql`, `src-tauri/src/db.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/lib.rs`
**Upstream dependencies:** None. Silas can start immediately at M3 kickoff.
**Downstream:** Wren needs the IPC contract (command signatures and return types) before implementing the frontend. Silas delivers before Wren begins relationship work.

**Task 1 -- `relationships` table**

Add to `data/dsrp_schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS relationships (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    action      TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    metadata    TEXT    -- JSON for rendering hints (reserved for future use)
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
```

`ON DELETE CASCADE` on both foreign keys implements R-6 silently and correctly.

The schema migration in `db.rs` must be idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`) so it runs safely against an existing database from M1/M2.

**Task 2 -- IPC commands**

New Rust commands in `commands.rs`:

- `create_relationship(source_id, target_id, action, map_id)` -- creates a relationship, returns the full relationship record including its new ID
- `get_map_relationships(map_id)` -- returns all relationships for a map (JOIN on source/target node IDs to verify both belong to the map)
- `update_relationship(id, action)` -- updates the action label; returns updated record
- `flip_relationship(id)` -- swaps `source_id` and `target_id`; returns updated record
- `delete_relationship(id)` -- deletes a single relationship by ID; returns deleted count

Add a `RelationshipData` struct (or equivalent) for the return type:

```rust
pub struct RelationshipData {
    pub id: i64,
    pub source_id: i64,
    pub target_id: i64,
    pub action: String,
}
```

**Task 3 -- `delete_node_cascade` IPC command (CF-2 backend)**

A Rust command that deletes a node and all its descendants in a single transaction:

1. Collect the full subtree of the target node using a recursive CTE (descendants query).
2. Delete descendant nodes first (leaves before internal nodes), then the root node.
3. `layout` rows clean up via existing `ON DELETE CASCADE` on `layout.node_id`.
4. `relationships` rows for all deleted nodes clean up via the new `ON DELETE CASCADE` on `relationships.source_id` / `relationships.target_id`.
5. Wrap in a single transaction. Rollback on any failure.
6. Return the count of deleted nodes.

The existing `delete_node` command remains for leaf deletion (no dialog, no cascade needed).

**Task 4 -- Error string cleanup (CF-4 backend)**

Audit all `commands.rs` error returns. Remove `[db]` prefixes. Rewrite as plain-English sentences.

Register all new commands in `lib.rs` alongside existing commands.

**Silas validation checklist:**
- `relationships` table exists after migration. Migration is idempotent (running twice produces no error and no duplicate table/index).
- `create_relationship` returns a record with a stable ID. Source and target IDs reference existing nodes.
- `get_map_relationships` returns all relationships for the map. Returns empty array (not error) when no relationships exist.
- `update_relationship` changes only the `action` field. Returns updated record.
- `flip_relationship` swaps `source_id` and `target_id`. Source and target are reversed in the DB after the call.
- `delete_relationship` removes exactly one relationship by ID.
- Deleting a node via `delete_node` or `delete_node_cascade`: all relationships where that node is source or target are also gone. Verified by querying `relationships` after deletion.
- `delete_node_cascade` deletes the target node and ALL descendants in a single transaction. Verified by node count before and after. Layout rows and relationship rows for all deleted nodes are gone.
- Transaction: if any individual delete in the cascade fails, nothing is deleted.
- No `[db]` prefixes remain in any user-facing error strings.
- All new commands registered in `lib.rs`.

---

### Wren -- Frontend: Relationship UI + Delete Dialog + Cleanup

**Output locations:** `src/App.tsx`, `src/components/Card.tsx`, `src/components/RelationshipLine.tsx` (new), `src/store/canvas-store.ts`, `src/store/types.ts`, `src/ipc/db.ts`, `src/ipc/db-tauri.ts`, `src/ipc/db-stub.ts`
**Upstream dependencies:**
- Relationship IPC calls: require Silas's commands and confirmed `RelationshipData` type. Wren can build the UI components and state structure before Silas is done, but cannot wire live IPC until commands exist.
- Delete dialog ("Delete all" path): requires Silas's `delete_node_cascade` command.
- Code cleanup: no dependencies. Can begin at kickoff.

**Task 1 -- Types and IPC layer**

Add to `src/store/types.ts`:

```typescript
interface RelationshipData {
  id: number
  sourceId: number
  targetId: number
  action: string
}
```

Add to `src/ipc/db.ts` (`DbInterface`):
- `createRelationship(sourceId, targetId, action, mapId): Promise<RelationshipData>`
- `getMapRelationships(mapId): Promise<RelationshipData[]>`
- `updateRelationship(id, action): Promise<RelationshipData>`
- `flipRelationship(id): Promise<RelationshipData>`
- `deleteRelationship(id): Promise<number>`

Implement in `db-tauri.ts` (live Tauri IPC) and `db-stub.ts` (in-memory stub for dev/testing).

Also add `deleteNodeCascade(nodeId: number): Promise<number>` to the interface and both implementations.

**Task 2 -- Canvas store utilities**

Add to `src/store/canvas-store.ts`:
- `getAbsoluteCenter(cards, cardId)` -- computes the absolute canvas coordinate of the center of a card, accounting for all ancestor offsets. Used to determine relationship line anchor points regardless of nesting depth.
- `getCardEdgePoint(cards, cardId, direction)` -- returns the absolute canvas coordinate of a specific edge midpoint (top, bottom, left, right) of a card. Used for anchor point routing.

These utilities must correctly traverse the card hierarchy to accumulate offsets. A deeply nested card's absolute position is its own x/y plus the sum of all ancestor x/y offsets.

**Task 3 -- Connection handles on Card.tsx**

On hover (when the user is not currently dragging a card), small handle dots appear on the card's four edge midpoints (or corners -- Wren's call on placement). The handles are visible only on hover and only when no drag is in progress.

Dragging from a handle initiates a relationship draw (distinct from the card drag gesture). The interaction is: `mousedown` on handle -> record `connectingFrom: cardId` in App state -> on `mousemove`, render a "ghost" line from the source card's handle to the cursor -> on `mouseup` over a card, create the relationship; on `mouseup` over empty canvas, cancel.

The handle drag must not trigger the card's normal drag behavior.

**Task 4 -- RelationshipLine component (new)**

`src/components/RelationshipLine.tsx` renders a single relationship as an SVG element:

- Directed line (straight for M3; curved routing is M4+) with an arrowhead at the target end
- Anchor points computed via `getCardEdgePoint` for source and target cards (nearest-edge heuristic for M3 is acceptable)
- Action label displayed near the midpoint of the line
- Visual states:
  - Normal: solid line, full opacity
  - Incomplete (empty action): dashed line, reduced opacity (per R-2)
  - Selected: highlighted (thicker stroke, distinct color)
- Click selects the relationship
- Double-click on line or label opens inline label editor
- Delete key (when selected) calls `deleteRelationship`
- "Flip" action accessible when selected (button near line or keyboard shortcut -- Wren's call)

The SVG layer for relationship lines must render above the card layer so lines are not obscured by cards. Alternatively, render lines in a separate SVG overlay positioned absolutely over the canvas.

Relationship lines must update anchor points when cards are moved or resized. This means `RelationshipLine` reads card positions from the canvas store on every render (reactive to card position changes).

**Task 5 -- App.tsx orchestration**

New state in `App.tsx`:
- `relationships: RelationshipData[]` -- loaded on mount alongside cards
- `selectedRelId: number | null` -- currently selected relationship
- `connectingFrom: number | null` -- card ID being used as draw source (null when not drawing)
- Ghost line state: source position + cursor position, used while drawing

On mount: call `getMapRelationships` and store results alongside card load.

On relationship create: call `createRelationship`, add result to `relationships` state.
On relationship update/flip: call respective IPC, update in `relationships` state.
On relationship delete: call `deleteRelationship`, remove from `relationships` state.
On card delete (cascade): after `deleteNodeCascade` succeeds, remove the card and all descendants from state AND remove any relationship where `sourceId` or `targetId` is among the deleted card IDs. DB cascade handles the persistence; frontend state must be updated to match.

**Task 6 -- Subtree delete confirmation dialog (CF-2)**

In the Delete key handler in `App.tsx`:

1. Pre-flight check: does the selected card have children in the in-memory card map?
2. If no children: proceed with existing single-node delete. No dialog. Unchanged from M2.
3. If children: do NOT optimistically remove from state. Show a modal confirmation:
   - "This card contains [N] part[s]. Delete the card and everything inside it?"
   - Actions: "Delete all" and "Cancel"
4. On "Delete all": call `deleteNodeCascade(cardId)`. On success, remove the card and all descendants from in-memory card state (walk the in-memory map for all descendants). Also remove any relationship in `relationships` state where source or target is among the deleted IDs. On error, show the error -- no state was changed optimistically, so no revert needed.
5. On "Cancel": dismiss modal. No state change.

The modal can be a simple inline overlay. No modal library needed for M3.

**Task 7 -- Code cleanup (CF-4 frontend)**

- `types.ts`: update M1-era comment on line 26. Replace "containers" with "parent cards" anywhere in TypeScript comments.
- Audit all developer-facing language in TypeScript files for container/leaf distinction language.
- No `[db]` prefix should appear in any user-facing string on the frontend side either.

**Wren validation checklist:**

_Relationship drawing:_
- Hover over a card: connection handles appear on card edges. Handles disappear when not hovering.
- Drag from a handle to another card: a directed line with arrowhead renders between the two cards.
- Drag from a handle to empty canvas: no relationship created; draw gesture cancels cleanly.
- Drag does not conflict with card body drag. Initiating from the card interior still moves the card.

_Relationship rendering:_
- Source card at depth 0, target card at depth 3 inside a different subtree: line renders correctly between them, crossing the system boundary. No clipping, no incorrect anchor points.
- Moving a card updates the relationship line anchor points in real time.
- Resizing a card (via nested cards auto-resize) updates anchor points.
- Unlabeled relationship renders as dashed/faded. Labeled relationship renders as solid.
- Selected relationship renders as visually distinct (highlighted).

_Relationship editing:_
- Click a line: it becomes selected. Click empty canvas: deselects.
- Double-click a line or its label: inline label editor opens.
- Edit label and confirm: label updates on line and in DB. Incomplete visual state clears.
- Delete key on selected relationship: relationship removed from canvas and DB.
- Flip action: source and target are swapped. Arrowhead flips direction.

_Persistence:_
- Create several relationships, reload app: all relationships are present with correct labels and directions.

_Reparenting:_
- Drag a card with an incoming relationship into a new parent: relationship survives, line re-anchors to new position.

_Delete cascade:_
- Delete a card with an incoming and outgoing relationship: both relationships disappear from canvas. DB has no relationship rows for the deleted card.
- Delete a card with children and relationships on those children: subtree delete dialog appears. "Delete all" removes cards and all relationships on any of the deleted cards. No orphaned relationship lines remain.

_Delete dialog (CF-2):_
- Delete leaf card (no parts): no dialog, immediate deletion. Unchanged from M2.
- Delete card with 3 parts: dialog appears with correct count. "Cancel" leaves everything intact. "Delete all" removes card and all 3 parts from canvas and DB.
- No optimistic flash-and-revert at any point.

_Code cleanup:_
- No "containers" in TypeScript type comments.
- No M1-era stale comments in `types.ts`.
- No `[db]` prefix visible in any user-facing string reachable from the frontend.

---

### Derek -- DSRP Compliance Review

**Output location:** `docs/m3-derek-review.md`
**Upstream dependencies:** Wren's M3 implementation complete and self-verified against checklist above.
**Downstream:** M3 is not closed until Derek signs off. M4 cannot begin until M3 is closed.

**What Derek checks in M3:**

1. **R-1 holds: every relationship has a direction.** No undirected relationships are creatable or renderable. Arrowheads are present and semantically accurate.

2. **R-2 holds: unlabeled relationships are flagged as incomplete.** The incomplete visual state is clearly distinct from a labeled relationship. A user cannot mistake an unlabeled line for a fully specified relationship.

3. **R-3 holds: cross-boundary relationships work.** Derek verifies that a relationship between a deeply nested card and a top-level card in a different subtree renders correctly and is indistinguishable in capability from a relationship between two top-level cards.

4. **R-4 holds: reparenting does not destroy relationships.** Derek verifies that moving a card to a new parent preserves all its relationships and they re-render correctly.

5. **R-5 holds: relationships are first-class persisted entities.** Derek confirms the implementation does not use any shortcut that would make relationships ephemeral or positionally-encoded rather than ID-based.

6. **R-6 holds: delete cascade is silent and complete.** Derek verifies that deleting a card (leaf or subtree) removes all associated relationships with no additional confirmation and no orphaned lines.

7. **Delete dialog is DSRP-consistent.** The "Delete all" dialog adequately communicates that the user is dissolving a System and its parts. No accidental System dissolution.

8. **No container/leaf distinction has accumulated.** CF-4 cleanup confirmed; no new language reintroduces the distinction.

9. **No Perspectives scaffolding crept in.** M3 is a Relationships milestone. Derek confirms no premature zoom-into-card or perspective state was introduced.

---

## UX Decisions (Resolved)

These decisions were made by the user and are binding for M3 implementation. They are recorded here so Silas and Wren do not need to re-raise them.

| Decision | Resolution |
|---|---|
| How to draw relationships? | Hover-to-reveal handles on card edges. Drag from handle to target card. |
| Allow unlabeled relationships? | Yes. Unlabeled relationships are allowed but visually flagged as incomplete (dashed/faded). User can double-click to add label later. |
| Delete behavior when a card with relationships is deleted? | Cascade silently. No additional confirmation beyond the card delete (or subtree delete) dialog. Relationships go with the card. |

## Open UX Questions

These questions are raised by the new scope and must be answered before Wren begins Tasks 3-5. Tasks 1, 2, and 7 can begin without these answers.

| Q# | Question | Who Decides | Blocking What |
|---|---|---|---|
| Q17 | When drawing a relationship, how is the "ghost" line visualized while dragging from a handle? Dashed line from source to cursor? Solid with arrowhead tracking cursor? | Wren (implementation) | Task 3 draw gesture |
| Q18 | Where exactly do handles appear on a card? Edge midpoints (top/bottom/left/right)? Corners? All of the above? | Wren (UX), Derek (DSRP check) | Task 3 handle placement |
| Q19 | How is "flip direction" exposed when a relationship is selected? Small inline toolbar near the line? Keyboard shortcut only? Right-click context menu? | Wren (implementation) | Task 4 editing UI |
| Q20 | How does the SVG relationship layer interact with card z-ordering? Lines should appear above card backgrounds but potentially below card text. What z-order is correct? | Wren (implementation) | Task 4 rendering layer |
| Q21 | Should the anchor point auto-route to the nearest edge of each card (nearest-edge heuristic) or use a fixed edge per relationship (e.g., always right-to-left)? For M3, nearest-edge is recommended; confirm. | Wren (implementation) | Task 4 anchor computation |

Q17-Q21 are implementation decisions Wren can resolve unilaterally or quickly with Derek. They should be answered before Wren begins Task 3. Larry should collect answers and record them in the issue tracker.

---

## Dependency and Sequencing Map

```
M2 COMPLETE (precondition for all M3 work)
  zoom-into-card deferred from M2, now moved to M4
  delete-with-children UX still needs improvement (CF-2)
  code debt logged (CF-4)

SILAS -- starts immediately at M3 kickoff
  Task 1: relationships table + migration
  Task 2: IPC commands (create/get/update/flip/delete relationship)
  Task 3: delete_node_cascade IPC command
  Task 4: error string cleanup (CF-4 backend)
  --> Silas delivers IPC contract to Wren before Wren begins Tasks 3-5

WREN -- can start immediately on some tasks
  Task 1: types.ts + IPC interface (no Silas dependency -- define interface first)
  Task 2: canvas-store utilities (no Silas dependency)
  Task 7: code cleanup (no Silas dependency)
  [Q17-Q21 must be answered before beginning Tasks 3-5]

WREN -- waits on Silas IPC contract
  Task 3: connection handles + draw gesture
  Task 4: RelationshipLine component
  Task 5: App.tsx orchestration
  Task 6: delete dialog (also waits on Silas delete_node_cascade)

SEQUENTIAL
  Silas delivers IPC contract (command signatures + RelationshipData struct)
    --> Wren Tasks 3, 4, 5 unblocked
  Silas delivers delete_node_cascade
    --> Wren Task 6 unblocked

  Q17-Q21 answered
    --> Wren Tasks 3, 4 unblocked

  Wren Tasks 1-7 all complete
    --> Wren self-verification against checklist
    --> Derek DSRP compliance review (docs/m3-derek-review.md)
    --> M3 closed
```

**Critical path:** Silas's IPC commands are the upstream dependency for the most complex frontend work. Silas should prioritize delivering the command signatures and `RelationshipData` struct (even before full implementation) so Wren can start building against the interface. The `db-stub.ts` implementation lets Wren develop and test the frontend without a live Rust backend.

**Wren is not fully blocked at kickoff.** Tasks 1, 2, and 7 have no upstream dependencies. Q17-Q21 are resolvable quickly. The window between kickoff and Silas's delivery is time for Wren to build the IPC interface and store utilities.

---

## M3 Done Criteria

M3 is complete -- and M4 kickoff may begin -- when ALL of the following are true:

1. **Relationship drawing works.** Hover reveals handles on card edges. Dragging from a handle to another card creates a directed relationship. Dragging to empty canvas cancels.

2. **Relationship rendering is correct.** Directed lines with arrowheads render between source and target. Labels display on the line. Incomplete (unlabeled) relationships are visually distinct (dashed/faded).

3. **Cross-boundary relationships work.** A card nested inside one subtree can be connected to a card in a different subtree. Line renders correctly across the boundary.

4. **Relationship editing works.** Click selects. Double-click edits label. Delete key removes. Flip reverses direction. All changes persist to DB immediately.

5. **Reparenting preserves relationships.** Moving a card to a new parent does not destroy or orphan its relationships. Lines re-anchor to new position.

6. **Persistence is complete.** All relationships survive app reload with correct data and visual state.

7. **Delete cascade is silent and complete.** Deleting a card (by any path) removes all its relationships from canvas and DB. No orphaned lines, no extra confirmation required.

8. **Delete dialog is non-jarring.** For cards with children, a confirmation dialog appears before any state change. No optimistic flash-and-revert. "Delete all" removes card, all descendants, and all their relationships. "Cancel" leaves everything intact.

9. **Leaf delete is unchanged.** Deleting a card with no children is immediate, no dialog. No regression from M2.

10. **No raw error strings reach the user.** All IPC errors are plain English. No `[db]` prefix in any reachable UI path.

11. **Code language is clean.** No "containers" in developer-facing TypeScript comments. No M1-era stale comments.

12. **Derek has signed off.** Derek's M3 DSRP compliance review (`docs/m3-derek-review.md`) is complete with no blocking issues. All six R constraints confirmed.

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Absolute position computation for cross-boundary lines is harder than expected.** Relationship lines between deeply nested cards require summing all ancestor offsets. If the canvas store does not have a clean utility for this, building it may take longer than estimated. | Medium | Medium | Wren builds and tests `getAbsoluteCenter` / `getCardEdgePoint` as the first deliverable in Task 2. If the utility is complex, Wren flags before beginning Task 4. |
| **SVG layer z-ordering conflicts with card interaction.** Rendering lines above cards may intercept mouse events intended for cards (hover, drag). Rendering below cards may obscure lines under card bodies. | Medium | Medium | Use pointer-events management on the SVG overlay. Relationship lines should have pointer events enabled (for click-to-select); card bodies should sit above relationship lines in z-order. Wren resolves via Q20 before starting Task 4. |
| **Draw gesture conflicts with card drag.** Mousedown on a handle dot that is close to the card body edge may ambiguously trigger both card drag and relationship draw. | Medium | Medium | Handle dots are distinct interactive targets with their own event handlers. `stopPropagation` on the handle's mousedown prevents the card drag handler from firing. Wren tests this boundary carefully. |
| **Q17-Q21 delay Wren Tasks 3-5.** If UX questions are not answered quickly, Wren cannot begin the visual components. | Low | Medium | Questions are Wren-resolvable. Larry collects answers before signaling Wren to begin Task 3. Wren works on Tasks 1, 2, 7 in the interim. |
| **Delete cascade with relationships has edge cases.** If a subtree delete removes 10 cards, all their relationships must be removed from both DB and frontend state. A partial update would leave orphaned lines. | Low | High | Wren's Task 6 explicitly walks all deleted card IDs and filters them out of `relationships` state after a successful cascade delete. DB side is handled by `ON DELETE CASCADE` -- verify explicitly in Silas's checklist. |
| **Relationship line anchor points drift when cards resize.** Auto-resize (from adding parts) changes a card's dimensions. Lines anchored to card edges must recompute. If `RelationshipLine` only reads initial positions, lines will drift. | Medium | Medium | `RelationshipLine` must be reactive to card position and size changes in the store. Wren ensures the component re-renders whenever the relevant cards change in `canvas-store`. |

---

## Lessons Carried Forward from M2

**Keep:**
- Issue tracker as source of truth for bugs and polish items.
- Commit immediately after confirmed fix.
- Requirements testing checklist at the bottom of the issue tracker.
- Derek's review gates milestone closure.
- Parallel workstreams at kickoff (Silas and Wren start concurrently on non-overlapping tasks).

**Improve:**
- **IPC contract first.** In M2, Silas and Wren sometimes worked in sequence unnecessarily. In M3, Silas should deliver the command signatures and `RelationshipData` struct as early as possible -- even before full Rust implementation -- so Wren can build the frontend against the interface using `db-stub.ts`.
- **UX questions answered before visual tasks begin.** Q17-Q21 are flagged explicitly. Larry collects answers before signaling Wren to begin Tasks 3-5.

---

## Reference Documents

- `docs/m3-relationships-derek.md` -- Derek's full DSRP Relationships analysis (source for R-1 through R-6 and all Derek inputs in this document)
- `docs/m2-derek-review.md` -- Derek's M2 compliance review (source of CF-1 through CF-4)
- `docs/roadmap.md` -- Living roadmap; M4 scope (Perspectives / zoom-into-card) will be defined at M3 close
- `C:\Users\marti\.claude\plans\bubbly-frolicking-plum.md` -- M3 Relationships planning document (scope, files, delegation)

---

*M3 execution begins when Q17-Q21 are answered. Silas starts immediately. Wren starts Tasks 1, 2, and 7 immediately.*

*Questions to Maren.*

-- Maren
