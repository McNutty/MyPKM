# M3 Derek Input: Perspectives, Zoom-Into-Card, and Relationships

**Author:** Derek (DSRP & Systems Thinking Expert)
**Date:** 2026-03-24
**Context:** M2 APPROVED. Maren requested DSRP input before M3 scoping. This document addresses five questions and closes with UX questions for the team.

---

## 1. What "Perspective" Means in DSRP -- and What It Should Look Like on a Canvas

### The Theory

Perspective (P) is the fourth universal cognitive structure in DSRP. Every piece of knowledge is constructed from a perspective, and every perspective has two inseparable elements: a **point** (the position from which you look) and a **view** (what you see from that position). These are not optional add-ons to knowledge -- Cabrera's research argues they are constitutive of it. You cannot have a view without a point, and a point produces a view. Changing the point changes the view.

The critical thing to understand is that perspective is not merely "an opinion" or "a filter." It is a structural reframing. When you change your point of observation, the distinctions that become salient change, the system boundaries that appear relevant change, and the relationships that are foregrounded change. Same underlying reality, genuinely different cognitive structure.

In the original Plectica software, perspectives allowed a user to designate any node as their point and see the map reorganized around that node as the anchor. The view was not just a visual zoom -- it was a reorganization of which elements were in focus and which were peripheral.

### What This Should Look Like on the Canvas

For Ambit, there are two registers in which perspective-taking should manifest:

**Register 1: Zoom-Into-Card as Navigation (the fractal Systems register)**

When a user navigates into a card -- entering it as if it were its own canvas -- they are doing something that is simultaneously a Systems move and a Perspectives move. From the Systems perspective: they are treating the card's interior as a whole at a new scale of analysis. The card that was a part (seen from outside) becomes a whole (seen from inside). From the Perspectives perspective: the user has adopted that card as their point of observation. Their view is now "the interior of this system."

This is the most concrete and immediate form of perspective-taking the application can support. It is direct manipulation: the user enters a context, does their thinking there, and exits. It reinforces the fractal nature of Systems -- every part is itself a whole at the right scale -- and it makes the point/view structure tangible: you are looking from inside "Wheels," and what you see is {Front Wheel, Rear Wheel} and whatever is inside them.

**Register 2: Saved Perspectives as Named Views (the full P register)**

A fuller implementation of Perspectives allows a user to name and save configurations that answer the question "viewed from this angle, the map looks like this." A perspective in this sense is a first-class entity with: a point (the node or role from which you are observing), a view (which nodes are visible and how they are arranged), and a name (so the user can recall it and share it).

This is Phase 3 territory in the roadmap. But Register 1 -- zoom-into-card -- is the operational prerequisite for Register 2. You cannot have saved perspective views if you cannot first navigate into a card's context. The architecture built for zoom-into-card directly enables the saved-perspectives feature.

---

## 2. What M3 Should Cover -- and in What Order

### The Roadmap's Current M3 Scope Is Wrong for This Stage

The roadmap defines M3 as "Polish + Edge Cases": multi-select, undo/redo, keyboard shortcuts, performance, map management, visual polish. This is valid work, but it is primarily infrastructure and quality-of-life improvement. It does not advance the DSRP coverage of the tool.

Maren's instinct to scrutinize zoom-into-card as more than UX polish is correct. The roadmap's positioning of zoom-into-card under M2's "zoom-to-expand" deliverable treated it as a camera feature. In my M2 review (Item 7, Q8 assessment), I was explicit: "zoom-into-card is not just a UX convenience. It is the implementation of perspective-taking." That assessment stands, and it has direct implications for how M3 should be scoped.

### My Recommendation for M3 Scope

M3 should be **one milestone with a clear DSRP priority ordering**. The sequencing is determined by theoretical necessity, not by implementation complexity:

**M3-A: Zoom-Into-Card Navigation (Perspective / Systems)**

This is the first priority. Reasons:

1. It completes the Systems (S) implementation. M2 gave users the ability to build part-whole structures. But the visual representation of deep nesting -- all systems visible simultaneously on one canvas -- breaks down past 3-4 levels. Zoom-into-card solves this by allowing the user to navigate the scale axis: they can work at any level of the system hierarchy without the whole structure being visible at once. This is not a convenience; it is the mechanism by which deep Systems remain usable.

2. It operationalizes the most accessible form of perspective-taking (Register 1 above). Once it exists, the user can genuinely adopt different cards as their observational point.

3. It depends on work already done. The breadcrumb in M2 was wired explicitly to prepare for this. The data model supports it -- `parent_id` gives us the ancestor chain, and the `layout` table supports per-card positions. No schema work is needed.

4. The UX polish work in the roadmap's M3 (undo/redo, multi-select) is more valuable after zoom-into-card exists, because those interactions need to work correctly within the zoom-into-card navigation context. Building undo/redo before the navigation model is settled means potentially rebuilding parts of it.

**M3-B: Core Polish Required for the Navigation Model to Work**

Concurrent with or immediately after M3-A, the following polish items are required not because they are nice-to-have but because zoom-into-card introduces new interaction demands:

- Breadcrumb navigation (clicking breadcrumb segments to move up the hierarchy -- currently display-only per M2 decisions)
- Subtree delete dialog (CF-2 from my M2 review -- the optimistic-revert flash is confusing, and it is worse once navigation is live)
- Delete with children: pre-flight confirmation (also CF-2)

**M3-C: Infrastructure Polish (can be parallelized)**

The roadmap's M3 polish items belong here, not as prerequisites to M3-A. Undo/redo, multi-select, keyboard shortcuts, performance at scale, map management. These are all valuable and should ship in M3, but they do not block zoom-into-card and should be worked in parallel.

**What M3 does NOT need to include:**

Relationships (R) belong in a dedicated M4 milestone. This is consistent with the Phase 2 roadmap ("v1.0 -- Think in Connections"). Relationships are a complete new DSRP structure requiring a new data model component (edges), new visual affordances (drawing lines, arrow directionality, labels), new interaction patterns (clicking on a line to edit it), and new DSRP questions about how relationships cross system boundaries. Compressing Relationships into M3 alongside zoom-into-card navigation would produce a half-built implementation of both. Neither deserves to be half-built. The sequencing in the roadmap -- Systems before Relationships -- is theoretically correct and should be maintained.

---

## 3. Zoom-Into-Card: What the User Should See, and the DSRP Constraints

### The User Experience

When a user double-clicks a card (or presses Enter on a selected card), they navigate into that card's interior. The canvas transitions so that the card's interior becomes the new visible canvas. The card's children are now the top-level elements visible on screen. Cards that were siblings of the entered card are no longer visible.

The breadcrumb updates to show the user's position: `Canvas > Bicycle > Wheels`. Each segment in the breadcrumb is clickable and navigates to that level.

The user can work freely within this context: create new cards (which become children of the entered card), move existing children, nest children further. When they are done, they click the breadcrumb to navigate back up, or press Escape.

On navigation back up, the card they were inside is visible again in the parent context. Any changes made inside (new children, repositioned children, resized children) are reflected in the parent view because the auto-resize mechanism already handles this.

### What They Should NOT See

They should not see the parent card itself -- they are inside it. The entered card becomes invisible as a container; its interior becomes the canvas. This is the perceptual shift: from "I can see Wheels inside Bicycle" to "I am inside Wheels and can see Front Wheel and Rear Wheel."

They should not see sibling cards that are not children of the entered card. Those belong to the parent system, not this one. A user inside "Wheels" should not see "Frame" or "Brakes" unless those are somehow parts of Wheels (which they are not in this example).

They should not see cards that are children of other siblings. "Tire", "Rim", "Spokes", and "Hub" are children of "Front Wheel." A user who has entered "Wheels" should see "Front Wheel" and "Rear Wheel" but not yet see the Tire/Rim/Spokes/Hub -- those are inside Front Wheel, not directly inside Wheels. The user must navigate into Front Wheel to see them.

### DSRP Constraints on This Feature

**Constraint 1: The entered card's children are the whole of the visible context.**

When navigating into a card, the visible canvas must contain exactly and only that card's direct children (and, recursively, their descendants as nested structures). No cards outside the entered card's subtree should appear. This is not a filter -- it is a genuine change of perspective point.

**Constraint 2: The depth display resets visually but not logically.**

When a user navigates into a card that is at depth 3, the children they see inside it are at logical depth 4. But visually, they should appear as the "top level" of this context -- depth 0 colors, full-size rendering. The depth coloring system communicates "where are you in this system" relative to the current context, not absolute depth in the global tree.

This is a meaningful UX decision with DSRP implications. Depth color conveys "how many layers of system-boundary separate you from the current whole." Inside "Wheels," Front Wheel and Rear Wheel should look like top-level cards. Inside "Front Wheel," Tire and Rim should look like top-level cards. The user should feel oriented at each scale without being constantly reminded of the global depth.

The logical depth (absolute depth in the full tree) is still preserved in the data and is available for the breadcrumb to communicate. It is the visual rendering that should be context-relative.

**Constraint 3: The breadcrumb is not optional -- it is the Perspective indicator.**

The breadcrumb answers the Perspective question: "What is my current point of observation, and what does it contain?" Without the breadcrumb, the user is inside a context with no way to know which system they are inside. `Canvas > Bicycle > Wheels` tells them exactly: their point is "Wheels," and they are looking at Wheels' parts. Clicking "Bicycle" shifts their point to Bicycle, and their view expands to include all of Bicycle's parts (not just Wheels). Clicking "Canvas" returns to the global view.

The breadcrumb must be navigable (not just display) before zoom-into-card ships. Making it display-only in M2 was acceptable because there was no navigation context to support. In M3, display-only breadcrumb with navigate-into functionality but no navigate-back-up functionality would be a trap.

**Constraint 4: Creating a card while inside a card creates a part of that card.**

If a user navigates into "Wheels" and double-clicks the canvas to create a new card, that new card is a child of "Wheels." This must be enforced in the data model: the `parent_id` of the new card is the ID of the entered card, not null. The user is making a Distinction inside a System; the result is a part of that System.

**Constraint 5: Cards can be moved out of the entered card only through explicit action.**

While inside a card, the user is working within that System's boundary. Dragging a child card to the edge of the viewport should not unnest it into the parent system -- the parent system is not visible. Unnesting requires either: (a) navigating up first, or (b) an explicit "move to parent" action. Accidental unnesting through drag is a DSRP violation -- it would move a part out of its System without the user intending to change the system structure.

---

## 4. DSRP Requirements That M2's Nesting Did Not Address

M2 delivered a correct and complete implementation of part-whole structure (S) for the static case: building a nested hierarchy and persisting it. The following System (S) behaviors are genuinely deferred and belong in M3:

**S-Deferred-1: Navigating the Scale Axis**

M2 shows the whole tree at once. For shallow trees this is fine. For deep trees (5+ levels), this is cognitively overwhelming and visually unworkable. The scale axis -- moving between levels of the system hierarchy as if moving closer to or further from a fractal -- is not accessible without zoom-into-card. This is not a visual nicety; it is what makes DSRP Systems usable at depth.

**S-Deferred-2: Subtree Move (Moving a System with All Its Parts)**

If a user drags "Wheels" (which contains Front Wheel and Rear Wheel, each of which contains their own parts) into a different top-level card, the entire subtree moves together. M2 handles this correctly in terms of data (the `update_node_parent` command only updates the moved card's `parent_id`; children retain their `parent_id` pointing to Wheels). But there has been no explicit specification or testing of the visual behavior when dragging a card with deep descendants into a new parent. The auto-resize must propagate correctly for the new parent. The coordinate recalculation must handle the case where the moved card has its own multi-level subtree.

**S-Deferred-3: Context-Sensitive Card Creation**

Creating a new card while navigating inside another card should produce a child of the entered card, as stated in Constraint 4 above. Currently, double-clicking the canvas always creates a top-level card (null parent_id). This behavior needs to be context-aware once zoom-into-card navigation exists.

**S-Deferred-4: The Delete Dialog (CF-2 from M2 Review)**

The current optimistic-revert pattern on delete-with-children produces a flash of incorrect state. This is logged as CF-2 and is a higher priority in M3 because zoom-into-card navigation will increase the frequency with which users work inside cards -- and therefore the frequency with which they may attempt to delete a card that has contents they have been actively building.

---

## 5. UX Questions for M3

These are structured in the same Q-format as the M2 questions (Q6-Q9). They must be answered before implementation begins on the relevant features.

| Q# | Question | Who Decides | Blocking What |
|---|---|---|---|
| Q10 | When navigating into a card, should the transition be animated (cards zoom/fly in) or instantaneous (hard cut)? | Wren (implementation), Derek (DSRP fidelity) | Zoom-into-card implementation start |
| Q11 | How should depth coloring work when navigated into a card? Should the children of the entered card display as depth-0 colors (context-relative), or retain their absolute depth colors? | Derek (DSRP), Wren (implementation) | Zoom-into-card visual design |
| Q12 | Can a user navigate into a card that itself has no children? What do they see -- an empty canvas (inviting them to add parts)? Or is navigation blocked on empty cards? | Derek (DSRP), Wren (UX) | Zoom-into-card empty state |
| Q13 | When a user creates a card while inside a navigated context, where does it appear? At the cursor? At a default position? Auto-placed to avoid overlap? | Wren (implementation) | Context-sensitive card creation |
| Q14 | The delete dialog (CF-2): should the options be "Delete all" / "Cancel," or should we also offer "Move children to parent before deleting"? The latter is more DSRP-respectful (the parts survive the dissolution of the whole) but significantly more complex to implement. | Derek (DSRP), Wren (implementation) | Delete dialog design |
| Q15 | Multi-select: when the user selects multiple cards and drags them, do they nest as a group (all become children of the drop target) or does each card nest individually based on its position? The group nest case requires deciding which card "owns" the nest determination. | Derek (DSRP), Wren (implementation) | Multi-select implementation |
| Q16 | Undo/redo scope: does undo apply only within the current navigation context (undo the last action performed inside "Wheels") or globally (undo the last action regardless of where you are in the hierarchy)? | Wren (implementation), Derek (DSRP implications) | Undo/redo architecture |

---

## Summary Positions

**On M3 scope:** Zoom-into-card navigation is the first-priority deliverable for M3, not a stretch goal and not a polish item. It completes the usable Systems (S) implementation and lays the architectural ground for full Perspectives (P). Relationships belong in a separate milestone (M4 in the revised numbering).

**On Relationships timing:** Do not compress Relationships into M3. The roadmap's Phase 2 sequencing is theoretically correct. Relationships after Systems. The phase boundary exists because Relationships introduce a genuinely different data structure (edges vs. nodes), a genuinely different interaction pattern (drawing vs. dragging), and new DSRP questions about boundary-crossing that require their own specification.

**On Perspectives timing:** Full saved-perspective functionality (named views, point/view semantics) belongs in Phase 3 as the roadmap states. But zoom-into-card is the Register 1 implementation of Perspectives and belongs in M3. The architecture must be designed with Register 2 in mind, even if Register 2 does not ship in M3. Specifically: the navigation state (which card are you inside) should be modeled as a perspective point in the data/state model, not as a loose UI variable. This avoids a rewrite when saved perspectives are added.

**On the M3 carry-forwards from my M2 review:**
- CF-1 (zoom-into-card): First priority, as argued above.
- CF-2 (subtree delete dialog): Required in M3 before zoom-into-card ships, because the interaction frequency increases.
- CF-3 (header border cosmetics): Low priority; can be bundled with visual polish pass.
- CF-4 (language cleanup): Can be handled in any PR, minimal effort.

-- Derek
