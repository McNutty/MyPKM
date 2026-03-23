# DSRP Review: Plectica 2.0 Roadmap

**Reviewer:** Derek, DSRP & Systems Thinking Expert
**Date:** 2026-03-23
**Document reviewed:** `docs/roadmap.md` (authored by Maren, 2026-03-23)
**Status:** FOR TEAM DISCUSSION

---

## Bottom Line Up Front

Maren's roadmap is genuinely solid. The phasing is correct, the non-negotiables are mostly right, and the instinct to treat nesting as the critical mechanic is exactly right from a DSRP standpoint. There are no fundamental misconceptions about the theory.

That said, I have specific additions, one significant omission, a few clarifications on the non-negotiables that matter for implementation, and concerns about two technical decisions that have DSRP fidelity implications. I also have a serious issue with how Relationships and Perspectives are framed in Phase 2 and 3 -- not the timing, but the semantics.

This review is organized by Maren's section structure, then adds material she asked me to produce.

---

## 1. On the Phase Ordering: Correct, With a Caveat

The D+S -> R -> P ordering is right. This is the correct pedagogical and implementation sequence.

The caveat: **Distinctions and Systems are not truly separable.** In DSRP theory, making a Distinction always simultaneously creates a System potential. When you draw a boundary and say "this is a thing," you have implicitly created something that can have parts. These are co-arising cognitive operations, not sequential ones.

What this means practically: Maren's MVP framing of "Distinctions + Systems" as a unified pair is correct. Do not let anyone on the team think of Phase 1 as "just Distinctions" with Systems added later. They are one move. The roadmap gets this right -- I'm flagging it because team conversations could drift toward treating cards as "Distinctions" and nesting as a separate "Systems feature" bolted on. That framing is wrong and would lead to a brittle architecture. A card that cannot contain other cards is not a proper Distinction in DSRP; it is a dead end.

**Phasing verdict: Correct. No changes needed.**

---

## 2. Review of MVP Non-Negotiables

Maren lists six non-negotiables. My assessment of each, plus what I'm adding.

### Non-Negotiable 1: Arbitrary depth nesting
**Correct and essential.** DSRP systems are fractal -- every part can be a whole at another scale. Any artificial depth limit is a DSRP violation. No notes here.

### Non-Negotiable 2: Any card can contain any other card
**Correct, but the wording needs sharpening for Silas and Wren.** The phrase "there is no distinction between container cards and leaf cards" is right in intent, but in implementation it is tempting to add a `has_children` flag or a `type = 'container'` column as an optimization. That would be a DSRP violation. The schema must not encode a distinction between "things that can be parents" and "things that cannot." Every node is equally capable of being a parent. Whether it currently has children is a runtime fact, not a property of the node's identity.

**Specific instruction for Silas:** Do not add a `node_type`, `is_container`, or `can_have_children` column to the nodes table. The presence of children is determined by querying for nodes whose `parent_id` points to this node -- not by a flag on the node itself.

### Non-Negotiable 3: Auto-adjusting containers
**Correct in principle.** I want to add the DSRP reason it matters beyond visual polish: the visual boundary of a card IS the system boundary. It is not decorative. If a card's visual boundary does not contain its children, the user is looking at a lie -- the system relationship is being misrepresented. This must be treated as a correctness requirement, not a UX nicety.

### Non-Negotiable 4: Drag-to-nest, drag-to-unnest
**Correct.** The physical directness of the interaction models the cognitive act of placing something inside a category or removing it. No notes.

### Non-Negotiable 5: Identity preservation on restructure
**Correct and important.** This is the distinction between a DSRP Distinction (an identity) and a position in a System (a role). Moving a card does not change what it is -- it changes where it is. The card's ID, content, and any future relationships must be fully preserved across moves. This will become critical in Phase 2 when cards have relationships: moving a card between parents must not orphan its relationship lines.

**Flag for Silas:** The database implementation must treat parent changes as updates to a `parent_id` foreign key on an otherwise unchanged row. Do not implement "move" as delete + re-insert. This would break referential integrity for future relationship edges.

### Non-Negotiable 6: Persistence
**Correct, obviously necessary.** No notes.

### What Is Missing From the Non-Negotiables

**Missing Non-Negotiable 7: A node must be able to exist without a parent (top-level Distinction).**

This sounds obvious, but it must be explicit. A Distinction does not require a containing System to exist. A card floating freely on the canvas is a valid DSRP state. The schema must allow `parent_id = NULL` and the canvas must render orphan cards correctly. This matters because some frameworks and data models implicitly require a root node, which would force every card into a hierarchy even when the user has not placed it there.

**Missing Non-Negotiable 8: The same card cannot appear in two places simultaneously (at MVP).**

In MVP, a node has exactly one parent (or none). It cannot be in two Systems at once. This is not a DSRP limitation in the general theory -- Perspectives will later allow a node to appear in multiple views -- but at MVP, before Perspectives exist, one-parent-or-none must be enforced. This is the constraint that makes the visual representation unambiguous. Maren's roadmap implies this but never states it, which means it could be accidentally violated in implementation.

**Note:** This constraint will need to be revisited carefully in Phase 3. When we add Perspectives, a node should be able to appear in multiple Perspectives with different positions -- that is the whole point. The layout table recommendation in the roadmap (Section 6, Decision 4) is correct for exactly this reason. I'm flagging it here so the team understands *why* we want a separate layout table now.

**Missing Non-Negotiable 9: The canvas is the map, and the map is a first-class entity.**

A "map" in Plectica is not just a file or a container. It is the System at the top level -- the outermost context that gives meaning to everything inside it. The data model must represent maps as first-class entities, not as implicit files or session states. This directly answers Q3 in the roadmap (addressed further below).

---

## 3. Answers to the Open Questions (Section 8)

These are the questions Maren flagged for me. I will answer them directly here so they are on record.

### Q2: Should relationships be first-class entities (their own nodes) even at MVP?

**Answer for MVP: No, but the schema must be designed as if they will be.**

Full answer: In DSRP theory, a Relationship is not just a typed edge. It has two sides -- an action and a reaction -- and it can itself be named, described, and related to other things. A Relationship between A and B is itself a kind of Distinction, and could in theory be part of a System. So yes, eventually, Relationships need to be first-class entities.

However, at MVP we are not implementing Relationships at all. The question for Silas is whether the MVP schema needs to pre-accommodate Relationships as nodes. My answer: do not implement it yet, but leave the door unblocked. Specifically:

- Do not create a `links` table at MVP. (It will be tempting to port over the existing PKM `links` table. Resist.)
- The `nodes` table structure should not assume that only "card" entities will ever exist. A future `node_type` column (added in Phase 2) should be able to distinguish `card` from `relationship` without a schema migration.
- At MVP, every node is implicitly a card/Distinction. But the primary key strategy and ID space should be shared so that Relationship nodes (Phase 2) live in the same `nodes` table as card nodes.

**Practical recommendation:** In the nodes table, add a `node_type TEXT NOT NULL DEFAULT 'card'` column from day one. It will always be `'card'` in Phase 1. In Phase 2 it gets `'relationship'` as a valid value. This costs nothing now and avoids a painful schema change later.

### Q3: Should a "map" be a special node (a root-level System), or a separate entity?

**Answer: A separate entity, with a clear reason.**

A map is not a DSRP System in the same sense as a card. It is the canvas context -- the frame within which Systems are built. In DSRP terms, it is closer to a Perspective (a point of view from which the thinking is organized) than to a System (a set of parts forming a whole).

If we make a map a special node (i.e., a card with `parent_id = NULL` and some `is_map` flag), we conflate two different things: the thing being thought about (cards and their nesting) and the context in which the thinking is being done (the map). A user should be able to have multiple maps, switch between them, and in Phase 3, a single node should be able to appear in multiple maps as different Perspectives. That last capability requires maps to be separate entities with their own IDs, not special nodes.

**Recommendation for the schema:** A `maps` table with `id`, `name`, `created_at`, `updated_at`. The layout table (see Decision 4 in the roadmap) has a `map_id` foreign key, placing a node into a map with specific spatial coordinates. A node that appears in no layout rows is not on any map (it exists in the database but is not currently visible on any canvas -- this is a valid state).

### Q6: How should cards behave when too small to show their children?

**Answer: Show a visual indicator of contained depth, not the children themselves.**

The parent card's boundary must always be visible and must always visually contain its children -- but when zoomed far out, individual children become too small to read. The correct behavior is to show the parent card with a visual indicator (a subtle fill pattern, a child count, a "contains N items" label, or nested bounding-box echoes) rather than attempting to render unreadable text. The key DSRP requirement is: the user must always be able to tell that this card contains other cards. Invisible children are fine. Ambiguous containment is not.

**Do not collapse a parent card to hide its children.** Collapsing implies the system relationship goes away when not viewed. In DSRP the structure exists regardless of whether you are looking at it. A collapse/expand metaphor is acceptable only if it is understood as a *visibility toggle*, not as a structural change -- and even then it is risky because it invites the misconception that the parts only exist when expanded.

### Q8: "Zoom into" vs. "zoom the camera" -- or both?

**Answer: Both are valid DSRP navigation moves, but they are conceptually distinct and must be clearly differentiated in the UI.**

- **Zoom the camera** (pan and zoom the infinite canvas): You are moving your perspective on the whole map. Everything stays in its structural place; you are just seeing more or less of it. This is a Perspective change in the informal sense, not in the DSRP technical sense.
- **Zoom into a card** (navigate into a card as if it were its own canvas): You are changing your point of reference -- treating the card as the new "whole" and its children as the things you care about right now. This is a much more powerful move. It is the act of zooming in on a System and treating it, temporarily, as the entire world.

Both should exist. The camera zoom is essential navigation. The "navigate into" zoom is the key pedagogical move that teaches users how DSRP works: any System, examined closely enough, becomes a new canvas with its own complexity.

These must be differentiated visually. A user must always know: "Am I looking at a zoomed-in camera view of the full map, or am I inside a specific card's sub-canvas?" A breadcrumb trail (e.g., "Map > Bicycle > Wheels > Front Wheel") satisfies this. This is a UX requirement, but it has a DSRP basis: losing track of which level of the system you are in is a classic failure mode of systems thinking.

---

## 4. Concerns About Technical Decisions (Section 6)

### Decision 3: Database Schema for Nesting -- Adjacency List

**I agree with the adjacency list recommendation for MVP.** SQLite's recursive CTEs handle it well. The key queries (get all children, get all ancestors, get subtree) are all standard and well-understood.

However, I want to flag one query pattern that is non-obvious and Silas must plan for: **"get all descendants, ordered by depth, including their spatial positions on a given map."** This is the query that powers "zoom into this card and render its sub-canvas." It requires joining the nodes table (for content) with the layout table (for position) across a recursive CTE. Silas should prototype this specific query before finalizing the schema, because it is the most complex read in the whole MVP.

### Decision 4: Separate Layout Table

**Strongly agree.** This is the right call for exactly the DSRP reason I cited under Q3 and Missing Non-Negotiable 8. A node's identity is separate from its spatial position in a given view. A node's `x, y, width, height` are properties of how it appears in a specific map/Perspective, not properties of the node itself.

One addition: the layout table should also track `parent_id_in_map` or use the nodes `parent_id` for rendering order. Actually, let me be precise: **the structural parent-child relationship belongs on the node, not on the layout.** The layout table stores visual coordinates. The `parent_id` on the node stores the DSRP structural relationship. These are different things that happen to be correlated in Phase 1 (your structural parent is also your visual container). In Phase 3 (Perspectives), they may diverge -- a node might appear visually isolated in one Perspective even though structurally it is a child of something. The schema must not conflate them.

**Instruction for Silas:** `parent_id` stays on the `nodes` table (structural). `x, y, width, height` go in the `layout` table (visual). Do not put a structural relationship on the layout table and do not put visual coordinates on the nodes table.

### Canvas Rendering and the Nesting Mechanic

I do not have a strong opinion on tldraw vs. React Flow -- that is Wren's domain. But I have one DSRP-derived requirement that must be tested in the prototype spike: **the visual boundary of a parent card must be a hard constraint on the rendering of its children.**

What I mean: a child card must not be visually renderable outside its parent's boundary. If a user manually resizes a child card to be larger than its parent, the parent must auto-expand to accommodate it. This must be bidirectional: shrinking all children shrinks the parent; adding a child expands the parent; growing a child expands the parent. The visual container must always truthfully represent the structural containment.

This "truthful boundary" requirement is the single most important visual property of the MVP. If the framework makes it hard to enforce, it is the wrong framework, regardless of its other virtues.

---

## 5. DSRP Violations and Misconceptions to Avoid

These are not in the roadmap as written, but they are the common failure modes I've seen in DSRP software implementations. Flag them for the whole team.

### Violation 1: Encoding "type" distinctions into the node itself

The biggest recurring mistake: giving nodes a type (`note`, `concept`, `system`, `container`) that controls what they can do. In DSRP, every node is a Distinction, every Distinction is potentially a System, and no Distinction is more "systemic" than another by nature. The software must not create a caste system among nodes.

This is directly relevant to the existing PKM schema, which has a `notes.kind` column with values like `moc`, `note`, `idea`. That typing is fine for the PKM product. It has no place in the Plectica schema.

### Violation 2: Treating "no children" as a fundamentally different state from "has children"

A leaf node and a parent node are the same kind of thing. The UI should not make a leaf node look fundamentally different from a parent node (beyond the obvious visual fact that a parent has visible children inside it). In particular, do not create an explicit "add children to this node" affordance that appears only on leaf nodes -- as if becoming a container is a mode change rather than a natural extension. Every node already is a container. It just happens to have zero things in it right now.

### Violation 3: Assuming the Map is the top-level System

This is subtle. The map is not the System -- it is the context within which Systems are built. Users should not be forced to create a "root card" that contains everything. Cards at the top level of a map are not "parts of the map" in a DSRP sense. They are Distinctions that exist within the map's viewing context. The map is more like a workspace than a container.

**Practical implication:** Do not add a constraint that forces all top-level cards to be children of a map node. They are placed on a map (tracked in the layout table), but they are not structurally contained by the map. `parent_id = NULL` for top-level cards is correct.

### Violation 4: Conflating "relationship" with "nesting"

Nesting (parent-child) is a Systems relationship in DSRP: part-whole. It is not the same as a Relationship (R), which is a connection between two Distinctions that are not necessarily in a part-whole arrangement. In Phase 2, when we add Relationship lines, users must be able to draw a line from Card A to Card B even if A is nested inside B, or even if A is nested five levels deep and B is at the top level. The relationship line is a different kind of connection than the nesting boundary.

**Schema implication:** The `parent_id` on a node encodes the Systems (part-whole) structure. Future `relationships` records will encode the R structure. These are separate, parallel layers of the data model that can both be true simultaneously. Do not design the schema as if relationships and nesting are alternatives to each other.

### Violation 5: Perspectives as "saved views" (the most dangerous misconception)

Maren's roadmap describes Phase 3 Perspectives as: "A user can save, name, and switch between perspectives (views) of the same map."

This framing is not wrong, but it understates what Perspectives are in DSRP and risks building them wrong.

In Cabrera's framework, a Perspective has two components: a **point** (the entity doing the viewing -- the observer) and a **view** (what is being looked at from that point). A Perspective is not just a camera angle or a filter. It is an assertion about who is looking and what they see from where they stand.

Building Perspectives as "saved camera positions + optional filter" is the v0 implementation -- useful and shippable, but incomplete. The v1.0 Perspective feature needs to support:
1. Naming what/who the perspective belongs to (the "point")
2. Showing different subsets of nodes/relationships depending on the perspective
3. Potentially showing the same node with different emphasis or additional annotations depending on perspective

Phase 3 "basic Perspectives" can absolutely be camera positions + layout variants. But Phase 4 "rich perspectives with point/view semantics" should be designed with this full model in mind from Phase 3 onward. If Phase 3 treats Perspectives as purely cosmetic saved views, Phase 4 will require a painful rebuild.

**Recommendation:** In Phase 3, build Perspectives so that each one has a named owner/point (even if it defaults to "Default" or the user's name) and a separate layout record per node per perspective. The data model Maren recommends (separate layout table) supports this correctly. The interaction design needs to surface the point-view distinction, even minimally.

---

## 6. DSRP Data Model Spec: High-Level Outline for MVP

This is the outline for the formal spec document I will deliver to Silas. Posting it here so the team can validate the scope before I write the full thing.

### Spec Document Structure

**Section 1: DSRP Concepts Encoded in MVP**

Map the theory to the data:

| DSRP Concept | Data Representation | Notes |
|---|---|---|
| Distinction | A row in `nodes` | The act of making a thing is creating a node. The node's identity is its ID. |
| Distinction boundary | The node's label/content | What makes this thing this thing and not something else. |
| System (whole) | A node whose `id` appears as `parent_id` on other nodes | Being a whole is a relational fact, not an intrinsic property. |
| System (part) | A node with a non-null `parent_id` | Being a part is also relational. The same node can be a whole at one scale and a part at another. |
| Part-whole relationship | `parent_id` FK on `nodes` | One level of the hierarchy. Arbitrary depth via recursive CTE. |
| Map / canvas | A row in `maps` | The workspace context. Not a DSRP System -- a viewing context. |
| Spatial position | A row in `layout` (node_id, map_id, x, y, width, height) | Visual representation. Separate from structural identity. |

**Section 2: The `nodes` Table**

Core columns:
- `id` INTEGER PK (auto-increment)
- `parent_id` INTEGER FK REFERENCES nodes(id) NULL (NULL = top-level card on some map, or node not yet placed on any map)
- `content` TEXT NOT NULL DEFAULT '' (the label/text of the card)
- `node_type` TEXT NOT NULL DEFAULT 'card' CHECK(node_type IN ('card')) -- will expand to 'relationship' in Phase 2
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL
- `metadata` TEXT (JSON escape hatch, per Silas's established practice)

**Section 3: The `maps` Table**

Core columns:
- `id` INTEGER PK
- `name` TEXT NOT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

**Section 4: The `layout` Table**

Core columns:
- `id` INTEGER PK
- `node_id` INTEGER FK REFERENCES nodes(id) NOT NULL
- `map_id` INTEGER FK REFERENCES maps(id) NOT NULL
- `x` REAL NOT NULL
- `y` REAL NOT NULL
- `width` REAL NOT NULL
- `height` REAL NOT NULL
- UNIQUE constraint on (node_id, map_id) -- at MVP, a node appears at most once per map

**Section 5: Constraints and Invariants**

These must be enforced either as database constraints or as application logic (with clear documentation of which):

1. **No cycles:** A node cannot be its own ancestor. (Application logic or trigger; SQLite CHECK constraints cannot express recursive conditions.)
2. **Parent must be on the same map:** If node A is a child of node B, and B is on map M, then A's layout record must also be on map M. (Application logic.)
3. **Child visual bounds within parent visual bounds:** Enforced at the application layer, not the database layer.
4. **node_type = 'card' for all Phase 1 nodes:** Enforced by the DEFAULT and CHECK constraint.

**Section 6: Key Queries**

I will provide annotated SQL for:
- Get all children of a node (direct)
- Get all descendants of a node (subtree, recursive CTE)
- Get the full ancestor chain of a node (path to root)
- Get all top-level nodes on a map (nodes with parent_id = NULL that have a layout row for this map)
- Get a node with its layout position on a specific map
- Get the full subtree of a node with layout positions (the "render sub-canvas" query)
- Check for cycles before inserting/updating parent_id

**Section 7: What the Schema Intentionally Defers**

- Relationship edges (Phase 2): will add a `relationship_nodes` concept and a `relationship_edges` table
- Perspective-aware layouts (Phase 3): the layout table already supports this; the `maps` table will evolve or a `perspectives` table will be added
- Full-text search (post-MVP): FTS5 virtual table over `nodes.content`, same pattern as the existing PKM schema
- Collaboration (future): all IDs will need to be UUIDs instead of auto-increment integers if we ever do multi-user sync; flag this as a future migration concern

---

## 7. The Trickiest DSRP Concepts to Get Right in Software

For the whole team's awareness. These are the places where DSRP implementations go wrong.

### 1. The co-arising of D and S

As discussed at the top: every Distinction is simultaneously a potential System. This is easy to understand abstractly and easy to violate in implementation. Every time someone proposes a distinction between "container nodes" and "leaf nodes" in code, this principle is being violated. Stay vigilant.

### 2. Relationships as genuinely different from Systems

The part-whole relationship (Systems) and the R relationship (Relationships) are fundamentally different cognitive moves. Nesting a card inside another says "this is a part of that whole." Drawing a line between two cards says "these two things are connected in some way." These must be separate data structures, separate visual affordances, and never conflated. The temptation in Phase 2 will be to implement Relationships as a "lightweight nesting" or to let people choose between a line and a containment. Do not allow this confusion to manifest in the UI.

### 3. Perspectives as non-obvious

Most people, when they hear "Perspectives," think "views" in the sense of filtered or sorted presentations of the same data. DSRP Perspectives are richer: they are claims about who is looking and what they see. Cabrera's point/view distinction is the thing that separates DSRP from generic systems mapping. Getting this right in Phase 4 requires not building Phase 3 in a way that forecloses it. I've flagged this above; I'm repeating it here because it is the single most likely place for DSRP fidelity to erode under shipping pressure.

### 4. The identity/position distinction

A node's identity (what it is, its Distinction) is separate from its position in any given System or on any given map. This seems obvious but produces non-obvious implementation requirements: moves must be updates, not re-creates; IDs must be stable; the layout must be decoupled from the node. The roadmap handles this correctly. Wren and Silas need to hold this principle clearly during implementation.

### 5. The map is not the territory

The Plectica map is a model of someone's thinking. It is not the truth. Users need to be able to rearrange, rename, and restructure freely without the software imposing semantic penalties. The software should never say "you can't do that" except for structural impossibilities (cycles). Every other constraint should be a default that users can override. Ease of restructuring is not just a UX nicety -- it is a DSRP requirement, because thinking is iterative and systems boundaries are always provisional.

---

## 8. Additional Items for the Team

### On the Risk Register: DSRP Purity vs. Shipping

Maren listed this as a risk and named me as the source of potential scope creep. Fair. My commitment: the MVP scope is D+S, and I will not expand it. The six (now nine) non-negotiables in Section 3 are fixed. I will not add to them during M1-M3. What I will do during M1-M3 is write the Phase 2 spec so that when we get there, we are not designing Relationships under time pressure.

### On UX Design Hire

Maren rates this MEDIUM priority. I want to raise it slightly. The interaction design for nesting -- specifically the visual affordances for "this card is now inside that card" -- is where DSRP fidelity and usability intersect most acutely. Getting this wrong teaches users the wrong mental model. A UX-focused engagement specifically on the nesting interaction (drop targets, visual boundary rendering, zoom behavior, the "navigate into" flow) would be worth doing before M2, not after.

### On the Current PKM Schema

Maren's assessment (Section 11) is accurate and correct. The PKM schema is a solid piece of work. The `links` table is a reasonable starting point for thinking about Relationships but needs rethinking for DSRP semantics (action/reaction, not just typed edges). The `collections` pattern (self-referential adjacency list with parent_id) is structurally what we want for nodes. The right call is a clean break for the Plectica schema, with Silas designing it fresh.

One thing to preserve from the PKM schema philosophy: Silas's `metadata TEXT` (JSON) column on core tables. This is good practice and should carry into the Plectica schema. It saved us from schema migrations before and will again.

### On Tauri vs. Electron

Not my domain, but noting that the local-first, performance-matters, SQLite-as-the-data-layer architecture is cleaner in Tauri where the Rust backend owns the database connection. In Electron, you are running SQLite through Node.js which adds a layer. If the team has any Rust comfort at all, Tauri is the right choice for this specific application profile.

---

## Summary: What I Need to Produce (Tier 0 Task)

My Tier 0 deliverable is the DSRP data model spec. Based on this review, it will contain:

1. The formal mapping of D+S concepts to tables (as outlined in Section 6 above)
2. Full annotated DDL for `nodes`, `maps`, and `layout` tables
3. The constraint inventory (what is enforced where and why)
4. The six key queries with annotated SQL
5. A "what this defers and why" section for Phase 2-3 schema evolution
6. Explicit answers to Q2 and Q3 from the open questions, formalized as design decisions

Estimated delivery: ready for Silas review within 2 working days of go-ahead from Larry.

---

*Questions or pushback on any of this: come find me. The goal is to get the DSRP right the first time so we are not refactoring the data model in Phase 2.*

-- Derek
