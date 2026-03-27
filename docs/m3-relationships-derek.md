# M3 DSRP Analysis: Relationships (R)

**Author:** Derek (DSRP & Systems Thinking Expert)
**Date:** 2026-03-24
**Context:** M3 scoping. M2 delivered Distinctions (cards) and Systems (nesting). M3 adds Relationships. This document is the authoritative DSRP theory and requirements reference for all Relationship work in M3.
**Referenced by:** `docs/m3-kickoff.md`

---

## 1. What a Relationship Is in DSRP

### The Theory

Relationship (R) is the third universal cognitive structure in Cabrera's DSRP framework. The claim is not merely that things can be related -- that is trivial. The claim is that the act of relating is itself a fundamental cognitive pattern that structures how we know and organize information. Every relationship consists of two inseparable elements: an **action** (the directed influence of one thing on another) and a **reaction** (the response, effect, or reciprocal influence flowing back). Together these constitute the full relational structure.

The directionality is not cosmetic. "Water dissolves salt" and "salt is dissolved by water" are not the same cognitive assertion even though they describe the same physical process. The direction of the action determines what is the agent and what is the patient. In systems thinking, this matters enormously: causal chains, feedback loops, and leverage points are all defined by the direction of influence. A tool that treats relationships as undirected -- as mere lines between boxes -- is not implementing DSRP. It is implementing a generic mind-map, which is a significantly weaker cognitive instrument.

The action carries semantic content: it names what is happening between the two things. "A causes B" is a different relationship than "A is part of B" or "A regulates B." The label is not metadata -- it is the substance of the relational claim. An unlabeled relationship is an incomplete thought: the user has noticed a connection exists but has not yet articulated what kind of connection it is.

### Relationship as Distinction

This is a subtle but important point that Cabrera makes explicit in his work: a relationship can itself be a distinction. That is, the relationship between A and B can be treated as a thing in its own right -- named, analyzed, given parts, made the subject of further relationships. "The relationship between the engine and the fuel system" is not just a line on a diagram; it can be examined, has its own properties, and can itself be related to other things.

For M3, we are implementing the basic level: relationships as first-class entities with stable IDs, source, target, and action label. The deeper affordance -- treating a relationship as a system, giving it parts, nesting things inside it -- is explicitly deferred. But the M3 data model must not preclude this. The fact that relationships live in their own table with stable IDs (R-5) is the architectural prerequisite for eventually treating them as nodes themselves.

### The DSRP Position on "Action and Reaction"

Cabrera's formulation specifies that a full relationship includes both an action and a reaction. In implementation terms: the directed relationship A -> B (action: "drives") implies a reaction on B's side (something changes in B as a result of A's action). We do not require users to name the reaction explicitly in M3 -- that would be prohibitive. But the architecture should not treat relationships as having only one endpoint's semantics. The reaction register exists even when unnamed.

Practically: a single directed edge in our data model is the minimum. If a user wants to model a bidirectional relationship (mutual influence), they create two relationships: A -> B and B -> A, each with its own action label. This is the correct DSRP representation. A special "bidirectional" flag would collapse two distinct relational claims into one, losing the semantic distinction between the two directions of influence. Bidirectional convenience is therefore deferred -- not because it is hard to implement, but because it would be theoretically incorrect as a first-class primitive.

---

## 2. How Relationships Appear on the Canvas

### Directed Lines as the Visual Form

The visual representation of a relationship is a directed line: a line with an arrowhead at the target end. The arrowhead is not decorative. It is the visual encoding of the action direction. The source card is the agent (the thing doing the acting); the target card is the patient (the thing being acted upon). The arrowhead points at the patient.

The action label appears on or near the midpoint of the line. This positioning communicates that the label names the action -- the content of the relationship itself -- not a property of either endpoint. A label sitting near the source card would suggest it describes the source; a label sitting near the target card would suggest it describes the target. Midpoint placement correctly anchors it to the relationship.

### The Incomplete State

A relationship without a label is structurally incomplete. The user has drawn a line between two things, which says "these two things are connected." But the relationship is not yet a cognitive claim -- it has no action. This state should be visually distinct from a labeled relationship: dashed line, reduced opacity, or similar. The incomplete marker communicates "I know something connects here but I have not yet articulated what." This is a legitimate intermediate state (the user may need to think before naming it), but it must not be mistaken for a complete relationship.

Removing the incomplete marker is the reward for adding a label. This creates a small but useful feedback loop: the user is visually prompted that their relational claim is unfinished.

### What the Visual Encoding Must Preserve

Three properties are load-bearing in the visual representation and must never be violated:

1. **Direction.** The arrowhead must always be present and must always point from source to target. There is no symmetric arrow, no double-headed arrow that represents a single relationship. Direction is a first-class property of every relationship.

2. **Label at midpoint.** The action label is the semantic content of the relationship. Its position on the line (not near either endpoint) communicates that it belongs to the relationship, not to either card.

3. **Line crossing system boundaries.** When a relationship connects a card inside System A to a card inside System B, the line must visually cross the system boundary. It should be clearly visible traversing the border of one parent card and entering the interior of another (or running from inside a system to outside it). The line must not be clipped, hidden, or routed in a way that makes the cross-boundary nature of the connection ambiguous.

---

## 3. How Relationships Interact with Systems

### Cross-Boundary Is the Point

The reason Relationships are the feature that makes Ambit a systems thinking tool -- rather than a hierarchical note-taker -- is precisely that relationships can cross system boundaries. A nested hierarchy (Systems) shows you the part-whole structure of your knowledge. Relationships show you the connections between parts that may live in entirely different areas of the hierarchy. The intersection of the two is where emergent properties become visible: you can see that a part of System A acts on a part of System B, and now you understand why changes in A produce unexpected effects in B.

If relationships were restricted to cards within the same system (the same parent), the tool would only support intra-system connections. That is a much weaker analytical instrument. The whole power of cross-disciplinary thinking, of understanding feedback loops that traverse organizational boundaries, of seeing how a decision in one domain cascades into another -- all of this depends on relationships being able to freely cross system boundaries.

This is not a nice-to-have. Cross-boundary relationships are what DSRP Systems + Relationships is for.

### Relationships Are Independent of Hierarchy

The hierarchy (parent-child nesting) is one dimension of a DSRP map. Relationships are a second, orthogonal dimension. A card's position in the hierarchy (its `parent_id` chain) says nothing about its relationships, and its relationships say nothing about its position in the hierarchy. These are independent structures. They coexist in the same visual space, but they are not the same thing.

This independence has a critical implementation implication: reparenting a card (changing its `parent_id`) must not affect its relationships. The relationship is between the stable identities of two cards -- their IDs -- not between their positions. Moving a card to a new parent changes where it appears in the hierarchy. It does not change what it is connected to. The relationships survive (R-4).

This also means the data model must store relationships as references to card IDs, not as positional or hierarchical references. A relationship expressed as "card 42 acts on card 99" is stable across any amount of reparenting, renesting, and reorganization. A relationship expressed as "the third child of the second card inside System A acts on the top-level card called Brakes" is fragile and position-dependent. The ID-based model is the only DSRP-correct model.

### Parent-Child Relationships Are NOT Relationship Lines

This is a distinction the team must be clear on. The nesting of a card inside a parent card is a Systems (S) structure: it represents a part-whole relationship. This is encoded in the `parent_id` field. It is NOT a Relationship (R) in the DSRP sense, and it must not be rendered as a relationship line.

The visual distinction matters: nesting is shown by containment (a card is physically inside another card, bounded by the parent card's border). Relationships are shown by lines connecting cards. If we were to draw a line between every parent card and its children, we would be conflating Systems structure with Relationships structure. That is a DSRP error -- it treats containment and connection as the same kind of cognitive structure when they are fundamentally different.

There is no "Systems line" that connects a parent to its children. The only lines on the canvas are Relationship lines.

---

## 4. Hard Constraints: R-1 through R-6

These constraints are non-negotiable. They derive directly from DSRP theory. An implementation that violates any of them is not implementing DSRP Relationships. M3 cannot close until all six hold.

---

**R-1: Every relationship must have a direction (source -> target).**

Relationships in DSRP are not symmetric. The data model must store `source_id` and `target_id` as distinct fields. The UI must render a directed line with an arrowhead at the target end. There is no undirected relationship type. There is no "symmetric" or "bidirectional" relationship as a single entity. If a user needs to model mutual influence, they create two relationships: A -> B and B -> A.

What this rules out: an edge that lacks directionality (an undirected graph edge), a line without an arrowhead, a UI gesture that creates a connection without specifying which card is the source.

Verification: any relationship in the system can be interrogated and will return a distinct source and a distinct target. The visual rendering always shows the arrowhead at the target end, never ambiguously between both cards.

---

**R-2: Labels name the action. Unlabeled relationships are flagged as incomplete.**

The action label is the semantic content of the relationship. An unlabeled relationship has a source and a target but no action -- it is a structural placeholder. This state is allowed (the user may not yet know the label), but it must be visually flagged as incomplete (dashed line, reduced opacity, or similar treatment).

Double-clicking an unlabeled line (or its label area) opens the inline label editor. When the user adds a label, the incomplete visual state clears.

What this rules out: treating an unlabeled relationship as equivalent to a labeled one visually. An unlabeled line and a labeled line must be visually distinct.

Verification: a newly drawn relationship with no label renders as visually distinct from one with a label. Adding a label changes the visual state. The label appears at or near the midpoint of the line.

---

**R-3: Any two nodes can be connected regardless of their position in the hierarchy.**

A relationship is not constrained by nesting depth, by parent, or by subtree. A card at the root level can be connected to a card nested five levels deep inside a different subtree. A card that is a part of System A can be connected to a card that is a part of System B, regardless of whether Systems A and B have any hierarchical relationship.

The implementation must compute absolute canvas positions for both endpoints to correctly render lines that cross system (parent card) boundaries. Restricting relationships to cards within the same parent, or to cards within the same depth, is a DSRP violation.

What this rules out: any code path that checks whether source and target share a parent before allowing a connection; any rendering code that clips lines at system boundaries; any UI gesture that only reveals connection handles on cards that are "compatible" targets.

Verification: draw a relationship from a deeply nested card to a top-level card in a different subtree. The line renders correctly, crossing visible system boundaries. The relationship is indistinguishable in capability from a relationship between two top-level cards.

---

**R-4: Moving a node (reparenting) must not destroy its relationships.**

A card's relationships are properties of its identity, not properties of its position. Dragging a card into a new parent (changing its `parent_id`) changes where the card lives in the hierarchy. It does not change what the card is connected to. All incoming and outgoing relationships must survive the reparenting operation and must re-render with updated anchor points to reflect the card's new position.

What this rules out: any implementation where relationships are stored as references to hierarchical position rather than to card ID; any cleanup step on reparenting that removes "stale" relationships; any rendering code that cannot handle a relationship whose endpoint has moved.

Verification: create a card with incoming and outgoing relationships. Drag the card into a new parent. All relationships are still present in the DB and on the canvas. Lines re-anchor to the card's new position.

---

**R-5: Relationships are first-class entities with stable IDs.**

Relationships must be stored in their own table with their own primary key. They are not JSON attached to nodes. They are not inferred from node positions or proximity. They are not ephemeral state that is reconstructed on load. A relationship created in one session is present in the next session. Editing the label on a relationship does not change its ID. Moving endpoint cards does not change the relationship's ID.

The stable ID is the prerequisite for every future elaboration of Relationships: typing relationships, treating a relationship as a system, building queries over the relationship graph. Without stable IDs, none of that is possible.

What this rules out: storing relationships as a JSON field on the node record; constructing relationships from proximity heuristics; any architecture where the relationship "lives in" one of its endpoint cards rather than in its own record.

Verification: create a relationship, note its ID, edit its label, reload the app. The relationship is present with the same ID and the updated label.

---

**R-6: Deleting a node cascades to its relationships silently.**

When a card is deleted (leaf delete or subtree delete), all relationships where that card is the source or target are deleted automatically. No additional confirmation is needed beyond whatever confirmation the card deletion itself requires. The user chose to delete the card; its connections follow. This is implemented via `ON DELETE CASCADE` on the `relationships` table foreign keys.

The cascade is silent because the alternative -- requiring the user to manually delete relationships before deleting a card -- creates a trap. A heavily-connected card could become undeletable in practice if the user must first hunt down and remove every relationship. That would make the tool worse as the user builds more structure. The cascade model is also theoretically consistent: if a Distinction ceases to exist, any Relationship that depended on that Distinction's existence also ceases to exist.

What this rules out: blocking card deletion because relationships exist; requiring explicit relationship deletion before card deletion; leaving orphaned relationship records in the DB after card deletion.

Verification: delete a card with incoming and outgoing relationships. The relationships are gone from the DB and from the canvas. No orphaned lines remain.

---

## 5. UX Questions Q17-Q23

These questions must be answered before Wren begins visual implementation (Tasks 3-5 in the M3 kickoff). Q17-Q21 are drawn from the kickoff doc; Q22-Q23 are additional questions I am raising from the DSRP perspective that were not in the kickoff.

| Q# | Question | Who Decides | Blocking What |
|---|---|---|---|
| Q17 | When drawing a relationship, how is the "ghost" line visualized while dragging from a handle? Dashed line from source to cursor? Solid with arrowhead tracking cursor? | Wren (implementation) | Task 3 draw gesture |
| Q18 | Where exactly do handles appear on a card? Edge midpoints (top/bottom/left/right)? Corners? All of the above? | Wren (UX), Derek (DSRP check) | Task 3 handle placement |
| Q19 | How is "flip direction" exposed when a relationship is selected? Small inline toolbar near the line? Keyboard shortcut only? Right-click context menu? | Wren (implementation) | Task 4 editing UI |
| Q20 | How does the SVG relationship layer interact with card z-ordering? Lines should appear above card backgrounds but potentially below card text. What z-order is correct? | Wren (implementation) | Task 4 rendering layer |
| Q21 | Should the anchor point auto-route to the nearest edge of each card (nearest-edge heuristic) or use a fixed edge per relationship? For M3, nearest-edge is recommended; confirm. | Wren (implementation) | Task 4 anchor computation |
| Q22 | When a card is selected and the user presses Delete, the existing behavior deletes the card. When a relationship line is selected and the user presses Delete, the relationship should be deleted. Are these two Delete handlers composed at the App level (a single handler that checks what is selected) or at the component level (Card and RelationshipLine each handle their own Delete event)? This is a UX architecture question with implications for keyboard event propagation. | Wren (implementation), Derek (DSRP check on what "selected" means) | Task 5 App.tsx orchestration |
| Q23 | Should it be possible to create a self-loop (a relationship from a card to itself)? DSRP does not preclude it -- a system can act on itself (e.g., a feedback loop where a single node both influences and is influenced by its own state). However, it is an edge case visually and in anchor point computation. My recommendation: block self-loops in M3, allow them in M4+ when we have better routing. But this should be an explicit decision. | Derek (DSRP), Wren (implementation) | Task 3 draw gesture; target validation |

### My Positions on Q18 and Q23

**Q18 (handle placement):** From a DSRP perspective, there is no constraint on where handles appear -- DSRP specifies that relationships connect two things; it does not specify the visual entry point on the card's boundary. The practical concern is that handles should be clearly distinct from the card drag target (the card body) so that the two gestures do not conflict. Edge midpoints (top/bottom/left/right, four handles per card) are my recommendation. They are unambiguous, they are clearly not "inside" the card body, and they provide a natural visual affordance for the directional nature of the relationship (drawing from the right edge of Card A toward Card B suggests A is sending something toward B).

**Q23 (self-loops):** Block in M3. A self-loop is a valid DSRP construct (reflexive relationship: a system that acts on itself, common in cybernetic models and feedback systems). But the visual rendering of a self-loop requires a curved arc that starts and ends on the same card, which is a distinct rendering case that will complicate anchor point logic. The semantic value is real; the implementation complexity is disproportionate for M3. Revisit in M4.

---

## 6. Data Model Requirements

### The `relationships` Table

The minimal data model for DSRP Relationships is a directed edge table. Every Relationship is a record with:

- A stable primary key (`id`) -- required by R-5
- A source node reference (`source_id`) -- the agent in the relational action
- A target node reference (`target_id`) -- the patient in the relational action
- An action label (`action`) -- the semantic content of the relationship, may be empty string (incomplete state per R-2)
- Timestamps (`created_at`, `updated_at`) -- for audit and potential future undo/redo
- A metadata field (`metadata`, JSON) -- reserved for future rendering hints, relationship type classification, reaction label, and anything else that is not yet specified

The foreign key references on `source_id` and `target_id` must include `ON DELETE CASCADE` to implement R-6.

```sql
CREATE TABLE IF NOT EXISTS relationships (
    id          INTEGER PRIMARY KEY,
    source_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    target_id   INTEGER NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
    action      TEXT    NOT NULL DEFAULT '',
    created_at  TEXT    NOT NULL,
    updated_at  TEXT    NOT NULL,
    metadata    TEXT    -- JSON; reserved for future use
);
CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_id);
```

Indexes on both `source_id` and `target_id` are required, not optional. When a card is loaded, the application needs to efficiently retrieve all relationships where that card is either the source or the target. Without indexes on both columns, this requires a full table scan. As the number of relationships grows, this becomes unacceptable.

### Why Not a Separate `reaction` Column?

One might ask whether the `action` / `reaction` distinction from DSRP theory should produce two columns: `action` (the forward label) and `reaction` (the backward label). I am recommending against this for M3, for these reasons:

1. In practice, most users will name the action and leave the reaction implicit. Requiring or even offering a reaction field at this stage would complicate the UI without proportionate benefit.
2. The `metadata` JSON field is the appropriate place to store a reaction label if and when we support it. It can be added without schema migration.
3. The theoretical completeness of DSRP (action + reaction) is preserved by the fact that users can create two relationships: A -> B (action: "drives") and B -> A (action: "responds to"). Two explicit directed relationships are theoretically cleaner than one record with two labels.

### What the `metadata` Field Is Reserved For

The `metadata` JSON column is intentionally unspecified in M3. It is reserved for:

- **Relationship type** (`rel_type`): a classification of the kind of relationship (causal, structural, informational, regulatory, etc.). This adds semantic richness beyond the free-text label. It is a Phase 2+ feature.
- **Reaction label**: if we later want to name the reaction as well as the action in a single record.
- **Rendering hints**: curvature preferences, waypoints for custom routing, preferred anchor edges.
- **Relationship-as-system**: if a relationship is later promoted to a node (treated as a Distinction with its own identity and parts), metadata could carry a reference to that node.

None of these are implemented in M3. The field exists so that adding them later does not require a schema migration or a data structure change.

### What the Data Model Does Not Constrain

The data model places no constraint on which nodes can be related. There is no check that `source_id` and `target_id` belong to the same map, the same subtree, or the same depth level. Any node ID is a valid endpoint. The application-level IPC command for `get_map_relationships` filters by map (via a JOIN to verify both endpoints belong to the map), but the table itself is unrestricted. This is correct: R-3 demands that any two nodes can be connected, and the data model should not impose a constraint that the theory does not.

---

## 7. Minimum Viable R for M3 vs. Future Phases

### What M3 Must Deliver (Minimum Viable R)

The minimum viable Relationships implementation for M3 is the one that correctly implements all six DSRP constraints with no shortcuts that would require a schema rewrite or architectural reversal later.

That minimum is:

- Directed relationships (source -> target) with an action label. Arrowhead at target end.
- Incomplete state (empty label) visually distinct from complete state.
- Cross-boundary connections: any card can connect to any other card.
- First-class persistence with stable IDs in their own table.
- Cascade delete: deleting a card removes its relationships.
- Reparenting safety: moving a card does not affect its relationships.
- Basic editing: draw a relationship, add/edit label, flip direction, delete relationship.

This is a complete implementation of the R structure in DSRP. A user who has M3 can express what connects their distinctions, in what direction, and with what named action. That is the full cognitive move.

### What Is Deferred and Why

The following are theoretically valid DSRP Relationship features that are not needed for M3 and should not be built in M3:

**Relationship type classification.** Naming whether a relationship is causal, structural, informational, etc. This enriches the R structure but is not required for basic use. Adding it later is a `metadata` JSON addition and does not require a schema change. Deferred to M4+.

**Bidirectional shorthand.** A single entity representing mutual influence (A <-> B). As argued above, this is theoretically incorrect as a primitive -- mutual influence is two relationships. If we build a bidirectional shorthand at all, it should be a UI convenience that creates two directed relationships under the hood, not a distinct data entity. Deferred to M4+.

**Reaction label.** Naming the reaction as well as the action in a single relationship record. Useful for advanced modeling; not required for basic use. Storable in `metadata` when needed. Deferred to M4+.

**Relationship-as-system.** Treating a relationship as a Distinction in its own right, giving it parts and making it the subject of further relationships. This is the advanced DSRP construct I mentioned in Section 1. The stable ID in M3 makes this possible later. Deferred to M4+.

**Self-loops.** A card related to itself. Valid in DSRP; requires distinct rendering logic; deferred to M4+.

**Curved routing.** Relationship lines that curve to avoid overlapping with card bodies. M3 uses straight lines with nearest-edge anchor heuristics. Good enough for M3; better routing is a visual polish item for later.

**Relationship filtering / perspective-based visibility.** Showing only certain relationships based on type, endpoint, or user-defined perspective. This belongs in the Perspectives (P) milestone (Phase 3), not in R.

### The Architectural Principle Underlying These Deferrals

Everything deferred above is an elaboration of the basic R structure, not a correction of it. The M3 implementation is not a simplified version of Relationships that will need to be replaced -- it is the full, correct, minimal implementation of DSRP Relationships. Everything added later will extend this foundation without requiring a rewrite.

This is the test I apply when deciding what belongs in M3: if a feature deferred from M3 requires changing the schema, changing the data model, or reversing an implementation decision made in M3, then it is not actually deferrable -- it belongs in M3. If deferring it means adding a column to `metadata`, adding a new UI affordance, or building on top of the stable-ID foundation, then it is genuinely deferrable.

By this test, all six items listed above are genuinely deferrable. None of them requires undoing M3 work. The M3 implementation is designed to accumulate them.

---

## Summary Positions

**On what a Relationship is:** A directed connection between two Distinctions with a named action. The direction is semantic, not cosmetic. The label names the action. Unlabeled relationships are incomplete cognitive claims. Every implementation detail should serve these theoretical facts.

**On cross-boundary connections:** The whole point of Relationships is to see connections that cut across system boundaries. This is what separates systems thinking from hierarchical thinking. Cross-boundary must work, must render correctly, and must not be artificially restricted.

**On the data model:** ID-based, table-per-entity, ON DELETE CASCADE on both foreign keys. This is the only DSRP-correct model. No positional encoding, no JSON embedding in node records, no ephemeral relationship state.

**On what R does not include:** The parent-child (Systems) structure is not a Relationship. It is containment, not connection. There are no lines between parents and children. The only lines are Relationship lines.

**On sequencing:** R before P is the correct ordering. Systems without Relationships is a hierarchy tool. Systems + Relationships is a systems thinking tool. Perspectives (zoom-into-card, saved views) build on top of a complete DSRP canvas. The canvas is not complete until Relationships exist. M3 completes the canvas.

**On M3 done criteria from the DSRP perspective:** M3 is done when all six R constraints hold and have been verified through the test scenarios. No constraint may be partially satisfied. No constraint may be satisfied in common cases but broken in edge cases (the cross-boundary case is the most likely edge case to be broken; it must be explicitly verified).

-- Derek
