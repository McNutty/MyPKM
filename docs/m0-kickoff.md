# Plectica 2.0 -- M0 Kickoff

**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-23
**Status:** ACTIVE -- M0 is go

---

## M0 Goal

Establish the technical foundation that all subsequent milestones depend on.

M0 is complete when: an app window opens with a pannable, zoomable infinite canvas, and the database exists and can store and retrieve nodes using a DSRP-native schema.

No user-facing card interactions are built in M0. M0 is scaffolding and architecture. M1 is where users first touch the product.

---

## Deliverables

### Derek -- DSRP Data Model Spec

**Output file:** `docs/dsrp-data-model-spec.md`
**Upstream dependencies:** None. Derek starts immediately.
**Downstream:** Silas cannot begin schema work until this is delivered.

Derek's spec will contain:

1. Formal mapping of DSRP Distinction and System concepts to tables and columns
2. Full annotated DDL for the `nodes`, `maps`, and `layout` tables (see Data Model section below for the agreed outline)
3. Constraint inventory -- what is enforced at the database layer vs. application layer, and why
4. Six key annotated SQL queries: direct children, full subtree (recursive CTE), ancestor chain, top-level nodes on a map, node with layout position, full subtree with layout positions (the render-sub-canvas query)
5. Formal answers to Q2 and Q3 (already answered in Derek's review; this formalizes them as design decisions in the spec)
6. A "what this defers and why" section covering Phase 2 Relationships and Phase 3 Perspectives schema evolution

Derek's review has already answered Q2, Q3, Q6, and Q8. Those answers are incorporated into the Non-Negotiables and Decisions sections below so the team is not waiting on the full spec document to understand the direction.

---

### Silas -- DSRP-Native Schema

**Output file:** `data/dsrp_schema.sql`
**Upstream dependencies:** Derek's spec (`docs/dsrp-data-model-spec.md`) must be complete.
**Downstream:** Wren wires persistence in M1 once this schema is in place.

Silas builds the three-table schema outlined in the Data Model section below. This is a clean break from the existing PKM schema -- not an evolution of it. The PKM schema stays intact for the PKM product. The Plectica schema is designed fresh with DSRP as the organizing principle.

Silas must also prototype the most complex read query -- "get all descendants of a node with their layout positions on a given map" -- before finalizing the schema. This is the query that powers the "navigate into a card" feature and is the most complex read in the whole MVP. It must be verified to work correctly under the adjacency list approach before the schema is locked.

**Specific instructions from Derek (non-negotiable):**

- Do not add a `node_type`, `is_container`, `can_have_children`, or `has_children` column to the nodes table. Whether a node has children is determined by querying for rows whose `parent_id` references this node -- not by any flag on the node itself.
- Do add `node_type TEXT NOT NULL DEFAULT 'card' CHECK(node_type IN ('card'))`. This costs nothing now. In Phase 2 it gains the value `'relationship'` without a schema migration.
- Do not add a `links` table in Phase 1. The existing PKM `links` table is not a template here.
- Implement "move card" (reparenting) as an UPDATE to `parent_id` on an otherwise unchanged row. Do not implement move as delete + re-insert. This breaks referential integrity for future relationship edges.
- `parent_id` stays on the `nodes` table (structural relationship). `x, y, width, height` go in the `layout` table (visual position). Do not put structural relationships on the layout table and do not put visual coordinates on the nodes table. They are different things.
- Preserve the `metadata TEXT` (JSON) column convention from the PKM schema. It belongs on core tables.

---

### Wren -- Canvas Framework Prototype Spike

**Output location:** `src/`
**Upstream dependencies:** None. Wren starts immediately, in parallel with Derek.
**Downstream:** The canvas framework decision must be locked before Wren proceeds to the full app shell build. The Electron vs. Tauri decision must also be locked before the app shell build.

The spike is not the app shell. It is a prototype that answers the blocking framework question. Wren prototypes recursive nested boxes in tldraw and one alternative framework (her call on the alternative). The prototype must test the hardest thing -- five levels of nesting, auto-resize of parent on child addition/removal, and drag-to-nest -- not the easy thing (flat card rendering).

The single most important thing the framework must prove it can do: **enforce that a child card is never visually renderable outside its parent's boundary, and that the parent auto-expands when a child grows.** This truthful boundary requirement is the core visual property of the MVP. If a framework makes this hard to enforce, it is the wrong framework regardless of its other virtues.

Wren reports results and a recommendation. The team makes the framework decision. Wren then proceeds to the app shell build.

---

## Parallel vs. Sequential Work

```
PARALLEL (start immediately, no upstream dependencies)
  Derek  --> DSRP data model spec  -->  docs/dsrp-data-model-spec.md
  Wren   --> Canvas framework spike -->  src/

SEQUENTIAL (each waits for its input)
  Derek's spec complete
    --> Silas builds DSRP schema  -->  data/dsrp_schema.sql

  Canvas spike results + Electron/Tauri decision
    --> Wren builds app shell + infinite canvas (pan/zoom, no interactivity)

SILAS AND WREN RUN IN PARALLEL once their respective inputs are ready.
Neither Silas nor Wren depends on the other during M0.

M0 IS DONE when all three outputs exist and the testable output criterion is met.
M1 begins only after M0 is done.
```

The critical path through M0 is: **Derek's spec -> Silas's schema.** The canvas spike is on a parallel track and should not be the bottleneck.

---

## Data Model: Agreed Outline

Derek has posted the spec outline in his review. The team has validated scope. The three-table structure is:

**`nodes` table** -- one row per Distinction (card). Columns: `id`, `parent_id` (FK to nodes, NULL for top-level), `content`, `node_type` (DEFAULT 'card'), `created_at`, `updated_at`, `metadata` (JSON).

**`maps` table** -- one row per canvas/workspace. Columns: `id`, `name`, `created_at`, `updated_at`.

**`layout` table** -- one row per (node, map) pair. Columns: `id`, `node_id` (FK to nodes), `map_id` (FK to maps), `x`, `y`, `width`, `height`. UNIQUE constraint on `(node_id, map_id)`. At MVP, a node appears at most once per map.

**Schema approach:** Adjacency list with recursive CTEs for descendant queries. This is the agreed approach. Silas validates it against query patterns before finalizing.

**Constraints and where they live:**

| Constraint | Enforced at |
|---|---|
| No cycles (no node is its own ancestor) | Application logic (SQLite CHECK cannot express recursive conditions) |
| Parent and child must appear on the same map | Application logic |
| Child visual bounds within parent visual bounds | Application layer (Wren) |
| `node_type = 'card'` in Phase 1 | Database CHECK constraint + DEFAULT |
| A node appears at most once per map | Database UNIQUE constraint on layout(node_id, map_id) |

---

## Non-Negotiables (9 total)

These are requirements that flow directly from DSRP theory and cannot be compromised. The original roadmap listed six. Derek's review adds three more. All nine are in force.

**1. Arbitrary depth nesting.**
No artificial limit on nesting depth. DSRP systems are fractal -- every part can be a whole at another scale. Any depth limit is a DSRP violation.

**2. Any card can contain any other card.**
There is no distinction between container cards and leaf cards. Every node is equally capable of being a parent. The schema must not encode this distinction (no `is_container`, `node_type = 'container'`, or `can_have_children` column). Whether a node has children is a runtime query fact, not a property of the node.

**3. Auto-adjusting containers.**
When a card gains children, the parent expands to contain them. When children are removed or resized smaller, the parent contracts. This is a correctness requirement, not a UX nicety. The visual boundary of a card IS the system boundary. A card whose visual boundary does not contain its children is misrepresenting the DSRP structure.

**4. Drag-to-nest, drag-to-unnest.**
The primary interaction for creating and breaking part-whole relationships is dragging a card into or out of another card.

**5. Identity preservation on restructure.**
Moving a card from one parent to another does not destroy the card or its contents. The card's ID, content, and any future relationship edges are fully preserved. Implemented as an UPDATE to `parent_id`, never as delete + re-insert.

**6. Persistence.**
The map survives app close and reopen. Local SQLite storage.

**7. A node must be able to exist without a parent (top-level Distinction).**
A Distinction does not require a containing System to exist. `parent_id = NULL` is a valid and correct state. The schema must allow it; the canvas must render top-level cards correctly. Do not impose a constraint that forces all cards to be children of a map node or a root node.

**8. At MVP, a card has exactly one parent (or none).**
A node cannot appear in two places simultaneously in Phase 1. This makes the visual representation unambiguous. This constraint must be explicitly enforced; the roadmap implied it but did not state it. Note: this constraint is intentionally revisited in Phase 3. The separate layout table (Decision 4 in the roadmap) is designed specifically to support the Phase 3 case where a node appears in multiple Perspectives with different positions.

**9. The canvas (map) is a first-class entity.**
A map is not an implicit file, a session state, or a special node with a flag. It is a separate entity with its own ID, represented in the `maps` table. This is what enables multiple maps, map switching, and the Phase 3 Perspectives model where a node can appear in multiple maps with different spatial positions.

---

## Decisions M0 Must Resolve

M1 cannot begin until both of these are locked.

### Decision 1: Canvas Rendering Framework

**Status:** Open. Blocked on Wren's prototype spike.
**Decision maker:** Wren recommends; team confirms.
**Options under evaluation:** tldraw (primary candidate) and one alternative of Wren's choosing.
**What the prototype must answer:** Does the framework make it natural to enforce the truthful boundary requirement (child always visually inside parent; parent auto-expands)? Does it handle arbitrary-depth recursive nesting, drag-to-nest, and drag-to-unnest without requiring us to build those primitives from scratch?
**Consequence of getting this wrong:** A bad framework choice discovered deep in M1-M2 forces a full rewrite of Wren's canvas work. This is the highest-impact technical risk in the project.

### Decision 2: Application Shell -- Electron vs. Tauri

**Status:** Open. Larry's call, with input from Wren.
**Decision maker:** Larry (with Wren input on Rust comfort level).
**Options:** Electron (mature, JS-only, larger bundle) vs. Tauri (Rust backend, smaller bundle, better performance for local-first SQLite architecture).
**Derek's note:** For a local-first, SQLite-as-data-layer app, Tauri's Rust backend owning the database connection is architecturally cleaner than SQLite through Node.js in Electron. If the team has any Rust comfort at all, Tauri is the right choice for this application profile.
**What is needed to unblock Wren:** A decision, not more analysis.

---

## M0 Done Criteria

M0 is complete -- and M1 may begin -- when ALL of the following are true:

1. `docs/dsrp-data-model-spec.md` exists and has been reviewed by Silas (the person who will implement it). Silas has confirmed there are no blocking ambiguities.
2. `data/dsrp_schema.sql` exists. The schema implements the three-table model (`nodes`, `maps`, `layout`) per Derek's spec. Silas has verified the complex subtree-with-layout query works correctly under the adjacency list approach.
3. The canvas framework decision is locked and documented. Wren has prototyped the hardest case (5-level nesting, auto-resize, drag-to-nest) and the winning framework has demonstrated it can enforce the truthful boundary requirement.
4. The Electron vs. Tauri decision is locked.
5. An app window opens. The canvas is pannable and zoomable. There is no card interactivity yet -- that is M1.
6. The database can store and retrieve a node record. A round-trip (insert node, close app, reopen, query node) succeeds.

M0 does not require cards to be visible on the canvas. It does not require drag interactions. It does not require any user-facing CRUD. Those are M1.

---

## Open Questions Answered by Derek (on record)

These were flagged in the roadmap as blocking. Derek has answered them. The answers are binding for schema design.

**Q2: Should Relationships be first-class entities (their own nodes) at MVP?**
No, but the schema must not foreclose it. At MVP every node is a card. Do not port the PKM `links` table. Do add `node_type DEFAULT 'card'` from day one so that Phase 2 can add `'relationship'` as a valid type without a migration. All nodes (including future relationship nodes) share the same `nodes` table and ID space.

**Q3: Should a map be a special node or a separate entity?**
A separate entity. A map is not a DSRP System -- it is the viewing context within which Systems are built. Making maps separate entities (the `maps` table) is what enables multiple maps, map switching, and the Phase 3 model where a node appears in multiple Perspectives. Do not use a root node with an `is_map` flag. Do not require top-level cards to be structural children of a map node. Top-level cards are placed on a map (tracked in the `layout` table via `map_id`) but are not structurally contained by it (`parent_id = NULL` is correct for top-level cards).

**Q6: How should cards behave when too small to show their children?**
Show a visual indicator of contained depth (child count, subtle fill, nested bounding-box echoes) -- not the children themselves at unreadable scale. The parent's boundary must always be visible and must always visually enclose its children. Do not collapse a parent card to hide its children. Collapsing is acceptable only as an explicit visibility toggle, never as a structural change, and even then it risks teaching users the wrong mental model (that parts only exist when expanded). The DSRP structure exists regardless of whether the user is looking at it.

**Q8: "Zoom into" a card vs. "zoom the camera" -- which?**
Both. They are conceptually distinct and must be visually differentiated.
- Camera zoom: Pan and zoom the infinite canvas. Everything stays in its structural place; the user sees more or less of the map.
- Navigate into: Enter a card as if it were its own canvas. The card's children become the new top-level view. This is the key pedagogical move -- it teaches users that any System, examined closely, is itself a new world of complexity.
A breadcrumb trail (e.g., `Map > Bicycle > Wheels > Front Wheel`) is required so users always know which level they are at. Losing track of nesting level is a known failure mode of systems thinking; the UI must prevent it.

---

## Warnings for Silas (from Derek)

These are the specific implementation traps that Derek has flagged. They are listed here so they are visible at kickoff, not buried in the spec document.

1. **Do not add a `node_type`, `is_container`, or `can_have_children` column.** Exception: the `node_type TEXT DEFAULT 'card'` column described above, which is for future-proofing Relationship nodes, not for distinguishing containers from leaves. Those are different things.

2. **Implement move as UPDATE, never as delete + re-insert.** Moving a card changes its `parent_id`. Everything else stays the same. Future relationship edges reference node IDs; a re-insert breaks those references.

3. **`parent_id` on `nodes` is structural. `x, y, width, height` on `layout` is visual. Do not mix them.** Structural parent-child relationships and visual spatial positions are separate concerns that happen to be correlated in Phase 1. Phase 3 Perspectives will decouple them. The schema must reflect this separation from day one.

4. **Prototype the subtree-with-layout query before finalizing the schema.** "Get all descendants of node X with their layout positions on map M" is the most complex read in the MVP. Verify it works correctly under the adjacency list + recursive CTE approach before the schema is locked.

5. **Do not port the PKM `links` table.** It is a reasonable piece of work for the PKM product. Its semantics do not match DSRP Relationships (which have action/reaction structure). Leave it out entirely in Phase 1.

6. **Preserve the `metadata TEXT` (JSON) column on core tables.** This is an established pattern from the PKM schema that has proven its worth. It buys flexibility against future schema migrations.

---

## Risks Carried Into M0

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Framework cannot enforce the truthful boundary requirement | Medium | High | The prototype spike tests this exact property first. If neither candidate passes, Wren escalates before any app shell work begins. |
| Canvas framework choice is wrong and discovered late | Medium | High | The spike tests the hardest mechanic (5-level nesting, auto-resize, drag-to-nest), not the easy mechanic (flat card rendering). The decision is locked before M1 begins. |
| Subtree-with-layout query is slower than expected | Low | Medium | Silas prototypes this query before finalizing the schema. If the adjacency list approach has a performance problem at expected depth, escalate before the schema is locked. |
| Electron/Tauri decision delays Wren's app shell work | Low | Medium | This is Larry's call. It unblocks Wren. Make the call quickly. |

---

## What M0 Does Not Decide

These are deferred to M1 or later and are explicitly out of scope for M0:

- Auto-layout algorithm for children inside a parent (Q7) -- resolves before M2
- What happens to a card's spatial position when unnested (Q9) -- resolves before M2
- PKM-to-Plectica data migration vs. clean break (Q10) -- does not block MVP
- UX design for nesting affordances (drop targets, visual cues) -- Derek has raised the priority of a UX engagement before M2; this is a recommendation, not a blocker for M0

---

*M0 is go. Derek and Wren start immediately. Silas starts on receipt of Derek's spec. Framework and shell decisions unblock Wren's build phase. Questions to Maren.*

-- Maren
