# Plectica 2.0 -- Project Roadmap

**Author:** Maren (Technical Project Manager)
**Date:** 2026-03-23
**Status:** ACTIVE -- M0 complete, M1 in progress

---

## 1. Project Vision

Plectica 2.0 is a local-first visual systems thinking application built on the DSRP framework (Distinctions, Systems, Relationships, Perspectives). The primary interface is an infinite canvas/whiteboard where users think visually using "auto-adjusting boxes within boxes" -- nested cards representing DSRP structures.

This is not a note-taking app with a canvas bolted on. The whiteboard IS the application. DSRP IS the product.

---

## 2. Phased Plan

### Phase 1: MVP -- "Think in Boxes"
**Goal:** A user can create cards and nest them to arbitrary depth on an infinite canvas.
**DSRP coverage:** Distinctions + Systems (the foundational pair)

### Phase 2: v1.0 -- "Think in Connections"
**Goal:** A user can draw labeled, directed relationships between any cards -- including across nesting boundaries.
**Depends on:** Phase 1 complete.
**DSRP coverage:** Adds Relationships

### Phase 3: v1.5 -- "Think in Views"
**Goal:** A user can save, name, and switch between perspectives (views) of the same map.
**Depends on:** Phase 2 complete.
**DSRP coverage:** Adds basic Perspectives

### Phase 4: v2.0 -- "Think Deeply"
**Goal:** Rich perspectives with point/view semantics. Thinkquiry (DSRP-guided questioning). Import/export. Collaboration hooks.
**Depends on:** Phase 3 complete.
**DSRP coverage:** Full DSRP + extensions

Each phase delivers a usable, testable product. No phase depends on a future phase to be valuable.

---

## 3. MVP Definition

### The User Story

> **A user can open Plectica 2.0, create cards on an infinite canvas, type text into them, and nest cards inside other cards to arbitrary depth. Cards auto-adjust their size to contain their children. The user can drag cards in and out of other cards to restructure their thinking. The map persists locally between sessions.**

### What "Done" Looks Like

A user sits down and models a system -- say, "the parts of a bicycle" -- by:
1. Creating a card labeled "Bicycle"
2. Creating cards for "Frame", "Wheels", "Drivetrain", "Brakes" and dragging them inside "Bicycle"
3. Creating cards for "Front Wheel" and "Rear Wheel" inside "Wheels"
4. Creating cards for "Tire", "Rim", "Spokes", "Hub" inside "Front Wheel"
5. Zooming in to work at the sub-component level, zooming out to see the whole
6. Closing the app, reopening it, and finding their work intact

### MVP Non-Negotiables (per Derek / DSRP Theory)

These are requirements that flow directly from DSRP and cannot be compromised:

1. **Arbitrary depth nesting.** No artificial limit on how deep cards can nest. A card inside a card inside a card inside a card must work. This is the fractal nature of Systems in DSRP.

2. **Any card can contain any other card.** There is no distinction between "container cards" and "leaf cards." Every card is both a potential whole (system) and a potential part. Creating a card is making a Distinction; nesting it is making a System.

3. **Auto-adjusting containers.** When a card gains children, the parent card must visually expand to contain them. When children are removed, it should contract. The visual containment IS the system relationship -- it must be unambiguous.

4. **Drag-to-nest, drag-to-unnest.** The primary interaction for creating part-whole relationships is dragging a card into or out of another card. This must feel direct and physical.

5. **Identity preservation on restructure.** Moving a card from one parent to another does not destroy the card or its contents. The card's identity (its Distinction) is preserved regardless of which System it belongs to.

6. **Persistence.** The map must survive app close/reopen. Local SQLite storage.

### MVP Explicitly Out of Scope

- Relationships (lines/arrows between cards) -- Phase 2
- Perspectives (saved views) -- Phase 3
- Multi-user / collaboration -- future
- Cloud sync -- future
- Import/export -- future
- Rich text editing inside cards -- future (plain text + basic formatting is sufficient)
- Images or media inside cards -- future

---

## 4. MVP Milestone Breakdown

### M0: Foundation -- COMPLETE
**Goal:** Technical scaffolding -- app shell, canvas rendering, database connection.

| Deliverable | Owner | Status | Details |
|---|---|---|---|
| DSRP data model specification | Derek | DONE | `docs/dsrp-data-model-spec.md` |
| Database schema v2 (DSRP-native) | Silas | DONE | `data/dsrp_schema.sql` -- three-table model: `nodes`, `maps`, `layout` |
| Canvas framework prototype spike | Wren | DONE | `src/prototype/custom-react-canvas/` and `src/prototype/tldraw-nested/` evaluated |
| Tech stack decision: Canvas | Team | RESOLVED | **Custom React + CSS Transforms.** Wren's recommendation; only approach that naturally enforces the truthful boundary requirement. tldraw rejected. |
| Tech stack decision: App shell | Team | RESOLVED | **Tauri (v2.x).** Rust backend owns SQLite. Smaller footprint, cleaner local-first architecture. |

**Testable output:** An app window opens with a pannable, zoomable canvas. The database exists and can store/retrieve nodes.

---

### M1: Cards on Canvas -- IN PROGRESS
**Goal:** Users can create, edit, move, resize, and delete cards on the canvas. Every operation persists immediately to SQLite via Tauri IPC.

**Stack:** Custom React + CSS Transforms (canvas), Tauri v2 (shell), SQLite via Rust backend.

| Deliverable | Owner | Details |
|---|---|---|
| Production canvas app (hardened from prototype) | Wren | Transfer `src/prototype/custom-react-canvas/` engine to `src/`. Wire to Tauri IPC. Add zoom-to-fit, breadcrumb stub, error handling. |
| Tauri IPC CRUD layer | Silas | Rust `#[tauri::command]` functions: `get_map_nodes`, `create_node`, `update_node_content`, `update_node_layout`, `delete_node`. Default map init on first run. WAL + FK pragmas on every connection. |
| DSRP compliance review | Derek | Verify: no `is_container` flag, `parent_id` vs. layout separation enforced, cards are typeless Distinctions. Sign off before M1 closes. |

**Dependencies:** Requires M0 complete. Silas and Wren run in parallel; Wren stubs persistence until Silas delivers IPC layer.

**Testable output:** A user can create several cards, type in them, drag them around, resize them, and close/reopen the app to find them where they left them.

---

### M2: Nesting -- The Core Mechanic
**Goal:** Cards can be nested inside other cards. This is the hardest and most important milestone.

| Deliverable | Owner | Details |
|---|---|---|
| Drag-to-nest interaction | Wren | Dragging card A onto card B (with a visual "drop target" indicator) nests A inside B. |
| Drag-to-unnest interaction | Wren | Dragging a child card outside its parent's boundary unnests it. |
| Auto-resize parent | Wren | Parent card automatically expands to contain children. Contracts when children are removed. |
| Recursive nesting | Wren | Nesting works to arbitrary depth. A card nested 5 levels deep renders and behaves correctly. |
| Nesting in database | Silas | parent_id updates on nest/unnest. Efficient queries for "get all descendants" (recursive CTE or closure table). |
| Zoom-to-expand | Wren | Double-click (or scroll-zoom) on a parent card to zoom into it, seeing its children in detail. Zoom out to return to the higher level. |
| Layout algorithm | Wren | Children inside a parent auto-arrange (or at minimum do not overlap on creation). Manual repositioning within the parent is allowed. |

**Dependencies:** Requires M1 complete. This is the critical path milestone.

**Testable output:** The bicycle example from the user story works end to end. Five levels of nesting. Drag in, drag out. Auto-resize. Zoom in, zoom out. Persistent.

---

### M3: Polish + Edge Cases
**Goal:** Handle the hard edge cases and make the MVP feel solid.

| Deliverable | Owner | Details |
|---|---|---|
| Multi-select + group move | Wren | Select multiple cards and move them together. |
| Undo/redo | Wren/Silas | At minimum, undo last action. Redo. |
| Keyboard shortcuts | Wren | Create card (Enter/N), delete (Del/Backspace), undo (Ctrl+Z). |
| Performance at scale | Wren | Test with 100+ cards, 5+ nesting levels. Viewport culling (don't render off-screen cards). |
| Edge case: cyclic nesting | Silas | Prevent card A inside card B inside card A. Database constraint or application logic. |
| Edge case: deeply nested drag | Wren | What happens when you drag a card with 3 levels of children inside it into another card? Everything moves together. |
| Map management | Wren/Silas | Create new map, switch between maps, rename maps. (A map is a top-level canvas.) |
| Visual polish | Wren | Card styling, shadows, nesting depth indicators (subtle color/indent), smooth animations on resize/nest. |

**Dependencies:** Requires M2 substantially complete.

**Testable output:** The MVP is shippable. A non-developer can use it for 30 minutes without hitting a confusing bug or missing feature.

---

### M4: MVP Release
**Goal:** Package and release.

| Deliverable | Owner | Details |
|---|---|---|
| Installer/package | Wren | Distributable app for Windows (primary), Mac (stretch). |
| Onboarding | Wren | Minimal first-run experience: "Click to create a card. Drag into another card to nest." |
| Internal testing | All | Team uses it for real thinking tasks. Bug bash. |

---

## 5. Dependency Map

```
Derek (DSRP Spec)
  |
  |---> Silas (Database Schema v2)
  |       |
  |       |---> Wren (Persistence Layer / Data Access)
  |                |
  |                |---> Wren (Cards on Canvas)
  |                        |
  |                        |---> Wren (Nesting Mechanic)
  |                                |
  |                                |---> Wren (Polish + Edge Cases)
  |                                        |
  |                                        |---> MVP Release
  |
  |---> Wren (Canvas Rendering / App Shell) [parallel with Silas]
```

**Critical path:** Derek's DSRP spec -> Silas's schema -> Wren's nesting mechanic.

**Parallelism opportunities:**
- Wren can build the app shell and canvas rendering while Silas builds the schema (M0).
- Wren can build card CRUD with a mock/in-memory data layer, then wire up persistence when Silas delivers.
- Derek can begin writing the Relationships spec (for Phase 2) while Wren and Silas execute M1-M3.

---

## 6. Key Technical Decisions

Both decisions were resolved during M0. No open decisions remain for M1 or M2.

### Decision 1: Canvas Rendering Technology -- RESOLVED

**Decision: Custom React + CSS Transforms.**

Wren prototyped two candidates: tldraw and Custom React + CSS Transforms. React Flow was evaluated and rejected early (designed for node-graph DAGs, no concept of spatial containment). Full evaluation in `docs/canvas-framework-evaluation.md`.

**Why Custom React won:** tldraw's frame model does not support auto-resize natively -- frames are fixed-size containers that clip children. Implementing Plectica's truthful boundary requirement (child always visually inside parent; parent auto-expands bidirectionally) required overriding tldraw's core interaction handlers. The custom approach implements auto-resize as a first-class constraint with zero framework friction. Every other criterion (drag-to-nest, drag-to-unnest, deep nesting) also favored the custom approach. tldraw's advantages (built-in pan/zoom, undo/redo) are buildable and were not deciding factors.

**Working prototype:** `src/prototype/custom-react-canvas/` (~950 lines TypeScript, functional, 5-level nesting demonstrated).

### Decision 2: Application Shell -- RESOLVED

**Decision: Tauri v2.x.**

Wren's recommendation, accepted by the team. Rationale: Tauri's Rust backend owns the SQLite connection directly (`rusqlite`), with no Node.js wrapper layer. For a local-first app where the database is the source of truth, the shorter path to SQLite is an architectural advantage. ~30-40MB memory footprint vs. Electron's ~200-300MB. Sub-10MB distributable. Tauri 2.0 is production-stable.

**Architecture:** Frontend is 100% TypeScript/React. Rust surface area is small: ~5 IPC commands for CRUD operations. IPC layer is a clean TypeScript abstraction (`db.*` interface) so the canvas code never calls Tauri APIs directly.

### Decision 3: Database Schema Approach for Nesting

| Option | Pros | Cons |
|---|---|---|
| **Adjacency List** (parent_id on each node) | Simple, intuitive, easy writes | Recursive queries needed for descendants (SQLite supports recursive CTEs, so this is viable) |
| **Closure Table** (ancestor-descendant pairs) | Fast reads for "all descendants" and "all ancestors" | Extra table, more complex writes (insert/move requires updating closure entries) |
| **Materialized Path** (e.g., "/1/5/12/") | Simple substring queries for ancestry, easy to read | Fragile on moves (must rewrite all descendant paths), string-based |
| **Nested Sets** (left/right integers) | Very fast subtree queries | Extremely expensive moves (renumber entire tree), fragile |

**Recommendation:** Start with **Adjacency List** (parent_id). SQLite's recursive CTEs handle descendant queries well, and the simplicity of writes matters more than read optimization at MVP scale. If performance becomes an issue with deep nesting, add a closure table later as an index optimization. Silas should validate this against expected query patterns.

**DECISION NEEDED FROM SILAS:** Validate adjacency list approach against the DSRP query patterns Derek specifies.

### Decision 4: Spatial Data Storage

Cards need position and size. Options:
- **Per-card x/y/width/height columns** in the nodes table -- simple, direct
- **Separate layout table** (node_id, map_id, x, y, w, h) -- allows same node to appear in multiple maps/views (important for Perspectives later)

**Recommendation:** Use a **separate layout table** from the start. This is trivially more complex now but avoids a painful migration when we add Perspectives in Phase 3. The layout table naturally supports "same data, different arrangements" which is what Perspectives require.

**DECISION NEEDED FROM DEREK:** Confirm that a node should be able to appear in multiple perspectives with different positions.

---

## 7. Team Needs Assessment

### Current Team vs. Needs

| Role | Person | Assessment |
|---|---|---|
| DSRP Expert | Derek | Sufficient. Blocking input at M0 (DSRP spec). On-call for fidelity reviews throughout. |
| Database Architect | Silas | Sufficient. Blocking input at M0 (schema design). Supportive role in M1-M3. |
| Canvas/Whiteboard Developer | Wren | Sufficient. Wren has been retooled as a Canvas/Whiteboard App Developer with deep expertise in infinite canvas architecture, recursive nested containers, tldraw, PixiJS, spatial interactions, and Tauri. The canvas mechanic (the hardest part of this project) is well within her specialization. She carries all frontend work: canvas rendering, nesting mechanic, app shell, packaging. |

### Hiring Recommendations

| Role | Priority | Rationale |
|---|---|---|
| **UX Designer** | MEDIUM | The interaction design for nesting (drop targets, visual affordances, zoom behavior) is subtle and will benefit from dedicated UX thinking. A focused engagement to establish interaction patterns before M1 would reduce rework in M3. |
| **QA/Testing** | LOW (for MVP) | Manual testing by the team is sufficient for MVP. Automated testing becomes important in Phase 2+. |

---

## 8. Open Questions

These need answers before or during MVP development.

### Resolved in M0

| # | Question | Answer |
|---|---|---|
| Q1 | What canvas framework best supports recursive nesting? | **Custom React + CSS Transforms.** See `docs/canvas-framework-evaluation.md`. |
| Q2 | Does the DSRP data model require relationships to be first-class entities at MVP? | **No, but the schema must not foreclose it.** `node_type DEFAULT 'card'` from day one; Phase 2 adds `'relationship'` without migration. No `links` table in Phase 1. Answered by Derek in `docs/dsrp-data-model-spec.md`. |
| Q3 | Should a map be a special node or a separate entity? | **Separate entity (`maps` table).** Top-level cards have `parent_id = NULL`; they are placed on a map via the `layout` table but not structurally contained by it. Answered by Derek in `docs/dsrp-data-model-spec.md`. |
| Q4 | What is the current state of the codebase? | Existing POC in `poc/` (Flask/PKM app). Not reused. Plectica 2.0 is greenfield in `src/`. |
| Q5 | Electron or Tauri? | **Tauri v2.x.** See Decision 2 above. |

### Can Resolve During M1-M2 (Non-Blocking at M0)

| # | Question | Who Answers | Impact |
|---|---|---|---|
| Q6 | How should cards behave when they are too small to show their children? Collapse? Show count? Fade? | Derek/Wren | UX detail; must be resolved before M2 polish. |
| Q7 | What auto-layout algorithm for children inside a parent? Grid? Flow? Force-directed? Manual-only? | Wren | Affects feel of the nesting interaction. Must be resolved before M2. |
| Q8 | Should we support "zoom into" a card (navigating into a card as if it were its own canvas) vs. "zoom the camera" (just magnifying)? Or both? | Derek/Wren | Significant UX and implementation difference. Must be resolved before M2. |
| Q9 | What happens to a card's spatial position when it is unnested? Snap to cursor? Appear beside former parent? | Wren | UX detail; must be resolved before M2. |
| Q10 | How do we handle the transition from current PKM data to the new DSRP schema? Migration, or clean break? | Silas/Larry | Data continuity question; does not block MVP work. |

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| **Nesting mechanic is harder than expected.** Auto-resizing containers with arbitrary depth nesting, smooth zoom, and good performance is a genuinely hard graphics problem. | HIGH | HIGH | Prototype early (M0 spike). Do not proceed to M3 with a shaky M2. Wren's deep canvas specialization is the primary de-risk here. |
| **Canvas framework choice is wrong.** We pick a framework that cannot handle recursive nesting well, and discover this deep into M1-M2 after significant investment. | MEDIUM | HIGH | The M0 prototype spike is the primary mitigation. Prototype the hardest thing first (5 levels of nesting, auto-resize, drag-to-nest), not the easy thing (rendering flat cards). The framework decision must be locked before M1 begins. |
| **DSRP purity vs. shipping tension.** Derek (rightly) holds high standards for DSRP fidelity. This could create scope creep if "true to DSRP" keeps expanding the MVP definition. | MEDIUM | MEDIUM | The MVP scope is locked to Distinctions + Systems only. Derek reviews for fidelity within that scope. Relationships and Perspectives are explicitly deferred. Derek can pre-write specs for Phase 2-3 in parallel with M1-M3 execution. |
| **Schema redesign takes longer than expected.** Moving from a PKM schema to a DSRP-native schema is a significant rethink, not just adding columns. | LOW | MEDIUM | Silas has Derek's spec as input. The MVP schema is simpler than the full DSRP schema (no relationships or perspectives tables yet). Keep it minimal. |
| **Performance with deep nesting.** Rendering 100+ cards with 5+ levels of nesting could be slow, especially with auto-resize propagation. | MEDIUM | MEDIUM | Viewport culling (don't render off-screen). Debounce resize propagation. Test performance early and often. Set a performance target (60fps with 200 cards visible). |

---

## 10. Dependency-Ordered Task List

Tasks are sequenced by what must exist before each task can start. Parallel tasks have no dependency on each other and can execute simultaneously.

### Tier 0: Unblocked -- Start Immediately

- **Larry:** Confirm Electron vs. Tauri decision. (Blocks Wren's app shell work.)
- **Larry:** Confirm codebase state -- existing code or greenfield? (Scopes M0.)
- **Derek:** Write DSRP data model spec for Distinctions + Systems. (Blocks Silas's schema and all downstream work.)
- **Wren:** Prototype recursive nested boxes in tldraw and one alternative framework. Evaluate: does the framework handle arbitrary depth nesting, auto-resize, and drag-to-nest natively, or must that be built on top? (Blocks canvas architecture decision.)

### Tier 1: Requires Tier 0

- **Silas:** Design DSRP-native schema v2. Requires Derek's spec. (Blocks Wren's persistence layer.)
- **Wren:** Select canvas framework based on prototype results. Requires prototype evaluation. Confirm with team. (Blocks all canvas work.)
- **Wren:** Build app shell. Requires Electron vs. Tauri decision. (Can proceed in parallel with Silas's schema work.)
- **Derek:** Confirm whether a node can appear in multiple perspectives with different spatial positions. (Answers the layout table question. Should be resolved before Silas finalizes schema.)

### Tier 2: Requires Tier 1

- **Silas:** Validate schema against DSRP query patterns Derek specified. Confirm adjacency list approach or escalate if recursive CTE performance is a concern. (Finalizes schema before Wren wires persistence.)
- **Wren:** Build infinite canvas with pan/zoom. Requires app shell and canvas framework decision.
- **Derek:** Answer Q2 (relationships as first-class nodes?) and Q3 (map as node or separate entity?) to finalize schema inputs. Requires having written the initial spec.

### Tier 3: M0 Complete -- Requires Tier 2

- **All:** M0 testable output verified: app opens, canvas pans/zooms, database stores and retrieves nodes.
- **Derek:** Begin writing Phase 2 (Relationships) spec. No longer blocking MVP; can execute in parallel with M1-M3.

### Tier 4: M1 -- Requires M0

- **Wren:** Implement card CRUD (create, edit, move, resize, delete) on canvas.
- **Silas/Wren:** Wire persistence -- all card operations persist to SQLite.

### Tier 5: M2 -- Requires M1

- **Wren:** Resolve Q6, Q7, Q8, Q9 (nesting UX questions) with Derek before beginning nesting implementation.
- **Silas:** Implement parent_id updates and recursive descendant queries for nesting.
- **Wren:** Implement drag-to-nest, drag-to-unnest, auto-resize parent, recursive nesting, zoom-to-expand, child layout algorithm. This is the critical path milestone.

### Tier 6: M3 -- Requires M2 Substantially Complete

- **Wren:** Multi-select, undo/redo, keyboard shortcuts, performance optimization, deeply-nested drag behavior, map management, visual polish.
- **Silas:** Cyclic nesting prevention constraint.

### Tier 7: M4 -- Requires M3

- **Wren:** Installer/package, onboarding experience.
- **All:** Internal testing / bug bash.

---

## 11. Current Schema Assessment

The existing database (`data/pkm.db`, schema documented in `data/SCHEMA.md`) was built by Silas as a PKM (personal knowledge management) proof of concept. It is a solid piece of work -- well-normalized, good use of SQLite features (WAL, FTS5, recursive CTEs), sensible indexing.

However, it is **not DSRP-native.** Key gaps:

| DSRP Concept | Current Schema | What Is Needed |
|---|---|---|
| Distinctions (cards) | `notes` table (title, body, kind, status) | A `nodes` or `cards` table: lighter weight, focused on identity + content. No "kind" taxonomy -- every node is a Distinction. |
| Systems (nesting) | `collections` has parent_id nesting; `notes` belong to collections | Nodes must nest inside other nodes directly (not via collections). A node's parent is another node. Arbitrary depth. |
| Relationships | `links` table (from_id, to_id, kind) | Good starting point, but DSRP relationships have action/reaction semantics, not just typed edges. Needs rethinking for Phase 2. |
| Perspectives | Not present | Needed in Phase 3. But spatial layout should be separated from node identity NOW (separate layout table) to prepare. |
| Spatial position | Not present | Nodes need x, y, width, height per canvas/map. |
| Maps/canvases | Not present | Need a concept of "map" as a top-level container. |

**Recommendation:** The new schema should be a clean break, not an evolution of the current one. The current schema can be kept for the PKM use case; the Plectica 2.0 schema is a different data model for a different product. Silas should design it fresh with DSRP as the organizing principle.

---

## 12. Summary

Plectica 2.0 MVP = **cards + nesting on an infinite canvas, persisted locally.**

That is all it needs to do, and it needs to do it exceptionally well. Nesting is the hard part -- technically and in terms of UX. Everything in this plan is oriented around de-risking and nailing that core mechanic.

The blocking decisions to resolve before M0 can complete:
1. **Canvas framework** -- Wren's prototype spike must run first; no architecture decision until results are in.
2. **Electron vs. Tauri** -- Larry's call; blocks Wren's app shell work.
3. **Schema approach** -- Derek specs it, Silas builds it, adjacency list recommended; must be finalized before Wren wires persistence.
4. **DSRP open questions (Q2, Q3, Q8)** -- Derek answers; blocks schema finalization and nesting interaction design.

The canvas specialist concern is resolved. Wren is a Canvas/Whiteboard App Developer with the exact specialization this project requires. The nesting mechanic is her domain.

Ready to begin on Larry's go-ahead.

-- Maren
