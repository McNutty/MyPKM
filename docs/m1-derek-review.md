# M1 DSRP Compliance Review

**Reviewer:** Derek (DSRP & Systems Thinking Expert)
**Date:** 2026-03-23
**Scope:** M1 implementation -- cards on canvas, CRUD persistence, IPC layer
**Verdict:** M1 APPROVED

---

## Method

I reviewed the following files in full:

- `src-tauri/src/commands.rs` -- Silas's IPC handlers (5 commands)
- `src-tauri/src/db.rs` -- DB initialization and schema DDL
- `data/dsrp_schema.sql` -- deployed schema (reference copy with annotations)
- `src/store/types.ts` -- frontend `CardData` interface
- `src/store/canvas-store.ts` -- coordinate utilities and `getDepthColor`
- `src/App.tsx` -- card CRUD logic, interaction model
- `src/components/Card.tsx` -- card rendering
- `docs/m1-kickoff.md` -- M1 spec, lines 102-122

Each of the five compliance checks from the M1 kickoff spec is addressed in order.

---

## Check 1: Cards are Distinctions, not typed objects

**Result: PASS**

The UI presents no typed categories. Every card rendered by `Card.tsx` is structurally identical -- one component, no branching on type. The `CardData` interface in `types.ts` has no `type`, `role`, or `category` field.

The prototype's depth-based background color (`DEPTH_COLORS` in `canvas-store.ts`) did survive into M1. This is not a violation. The color encodes spatial depth in the nesting hierarchy -- a positional property, not an ontological one. A card at depth 2 is not a "different kind of card"; it is a Distinction that happens to be a part inside a part. The comment in `canvas-store.ts` makes this intent explicit: `/** Nesting depth (computed, for coloring). All cards are depth 0 at M1. */` At M1 every card is depth 0 and therefore the same color, so the coloring system is inert. When M2 activates nesting, the color gradient will communicate "how deep in the system are you" -- which is a navigation aid, not a type distinction.

One observation worth carrying to M2: the font-size in `Card.tsx` scales with depth (`Math.max(10, Math.min(14, 14 / Math.max(1, card.depth * 0.3 + 0.7)))`). This is a readability heuristic (nested cards are smaller on screen). It is not an ontological signal, but the M2 team should keep an eye on it. If at deep nesting levels the card reads visually as "a different kind of thing" rather than "the same thing, smaller," that is worth revisiting. Not a blocking issue.

---

## Check 2: Layout is separate from identity

**Result: PASS**

The boundary is cleanly enforced at every layer.

**Schema level:** `nodes` holds `id`, `parent_id`, `content`, `node_type`, timestamps, and `metadata`. No spatial columns. `layout` holds `node_id`, `map_id`, `x`, `y`, `width`, `height`. No structural columns. The tables are architecturally orthogonal.

**IPC layer:** `update_node_content` (`commands.rs` lines 140-159) issues `UPDATE nodes SET content = ?1, updated_at = datetime('now') WHERE id = ?2`. It touches only the `nodes` table. `update_node_layout` (lines 166-193) issues `UPDATE layout SET x = ?1, y = ?2, width = ?3, height = ?4 WHERE node_id = ?5 AND map_id = ?6`. It touches only the `layout` table. The comment on `update_node_layout` explicitly states: "Only touches the layout table -- structural data (parent_id) is unchanged." There is no IPC command that writes to both tables in a single call, and no command that writes spatial data into `nodes` or structural data into `layout`.

**Frontend:** `App.tsx` calls `db.updateNodeLayout(card.id, 1, card.x, card.y, card.width, card.height)` for drag and resize, and `db.updateNodeContent(cardId, newContent)` for text changes. These calls are never conflated.

The separation is complete. No blurring found.

---

## Check 3: No `is_container` flag or equivalent

**Result: PASS**

The `nodes` table, as defined in both `data/dsrp_schema.sql` and the embedded `SCHEMA_DDL` in `db.rs`, contains:

```
id, parent_id, content, node_type, created_at, updated_at, metadata
```

There is no `is_container`, `can_have_children`, `has_children`, `is_leaf`, `is_root`, or any other stored capability flag. The schema comment in `dsrp_schema.sql` explicitly documents the prohibition: `DO NOT add: is_container (every node can be a container)` and `has_children (derived by querying; not a stored property)`.

The `node_type` column is present, defaults to `'card'`, and is constrained to `CHECK(node_type IN ('card'))`. It serves as a DSRP element classifier (Distinction vs. Relationship in future phases) -- not as a structural capability flag. Every M1 row has `node_type = 'card'`. This is correct.

The `metadata TEXT` JSON escape hatch is present and appropriate. The schema and app-layer comments specify it must not hold structural or spatial data. No concern here.

---

## Check 4: `parent_id = NULL` is valid and correct

**Result: PASS**

The `nodes` table defines `parent_id` as:

```sql
parent_id   INTEGER REFERENCES nodes(id) ON DELETE RESTRICT
```

No `NOT NULL` constraint. `NULL` is the valid, correct, and intended state for a top-level Distinction -- a card that belongs to no containing System.

`create_node` in `commands.rs` inserts `parent_id = NULL` explicitly:

```sql
INSERT INTO nodes (parent_id, content, node_type, created_at, updated_at)
VALUES (NULL, ?1, 'card', datetime('now'), datetime('now'))
```

`App.tsx` confirms this on the frontend: all new cards are created with `parentId: null` in the `CardData` record, and the IPC call passes no parent argument. At M1, every card in the database has `parent_id = NULL`. This is the correct state.

---

## Check 5: Delete behavior

**Result: PASS**

The schema uses `ON DELETE RESTRICT` on `nodes.parent_id`:

```sql
parent_id   INTEGER REFERENCES nodes(id) ON DELETE RESTRICT
```

This means the database will refuse a `DELETE FROM nodes WHERE id = ?` if any row in `nodes` references that id via `parent_id`. No silent cascade. No orphaned children.

Silas's `delete_node` command in `commands.rs` handles this constraint explicitly (lines 202-232). The FK violation is caught by `map_err`, and a clear error message is returned to the frontend:

```rust
"[db] delete_node: node {} has children and cannot be deleted until \
 they are removed first"
```

This error propagates as a `Result::Err(String)` to the TypeScript IPC layer. `App.tsx` catches it in the `try/catch` block around `db.deleteNode(id)`, reverts the optimistic UI removal, and restores `selectedId`. The user is not left with a silent partial state.

One note on the App.tsx optimistic delete: the frontend first removes the card and all its local descendants from the in-memory `cards` map (the `collectDescendants` loop), then calls `db.deleteNode(id)`. If the DB returns RESTRICT on a child that exists in the DB but not in the local map (an edge case not possible at M1 but worth noting), the revert restores `cardsBefore` which was captured before the optimistic removal. The revert logic is sound.

The `layout` table uses `ON DELETE CASCADE` on `node_id` -- when a node is deleted, its layout rows are cleaned up automatically. This is correct and does not conflict with the RESTRICT on `parent_id`. The cascade applies to `layout`, not to `nodes`. The RESTRICT applies to `nodes` self-referential FK. Both constraints serve their purpose.

At M1, no card has children, so RESTRICT will never fire in practice. The mechanism is correctly in place for M2.

---

## Additional Observations (Non-Blocking)

These are not blocking issues. They are inputs for the M2 kickoff.

**A. `nodeWithLayoutToCardData` hardcodes `depth = 0`**

In `canvas-store.ts` line 48: `const depth = 0 // M1: all cards at root level`. This is intentional for M1 since all cards are top-level. When M2 introduces nesting, this function must compute depth by either receiving it from the DB query (e.g., from a recursive CTE that returns a `depth` column) or by walking the in-memory parent chain after all nodes are loaded. The DB schema's Query 2 and Query 6 in `dsrp_schema.sql` already return a `depth` column from the recursive CTE -- the application layer just needs to use it. This is a clean M2 task.

**B. `get_map_nodes` returns `parent_id` but the M1 load ignores it for depth**

`commands.rs` correctly returns `parent_id` in `NodeWithLayout`, and `types.ts` maps it to `parentId: node.parent_id`. The data is flowing correctly. The depth hardcode in point A above is the only gap. No data is lost; depth is just not computed at load time. Clean path to M2.

**C. Child count indicator in `Card.tsx`**

`Card.tsx` line 178-182 renders `({children.length})` in the card header when `children.length > 0`. At M1 this never fires (no nesting). In M2, this badge tells the user "this card contains N things." It is a navigation aid, not a type label. Consistent with DSRP: it describes the System aspect of this Distinction, not a different category of card. No concern.

**D. M2 will need `update_node_parent` IPC command**

The kickoff spec already notes this. When nesting is activated, a new Rust command will set `parent_id`. At that point, the application layer must run cycle detection before the UPDATE (the algorithm is documented in `dsrp_schema.sql` lines 207-224). Ensure the M2 kickoff explicitly assigns this to Silas.

---

## Summary

All five DSRP compliance checks pass. The data model is clean. The identity/layout separation is enforced at schema, IPC, and frontend layers. No container flags exist. `parent_id = NULL` is correct and implemented. Delete behavior is correct with RESTRICT surfacing as an explicit error rather than a silent cascade or orphan.

The M1 implementation is a faithful representation of DSRP Distinctions and Systems thinking as a data model foundation.

**M1 APPROVED. M2 kickoff may proceed.**

-- Derek
