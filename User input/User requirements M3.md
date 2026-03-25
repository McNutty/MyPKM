# New issues (these should be moved to handled when taken care of)

- I want to try a slightly different approach when it comes to moving arrow labels. I think I have identified what feels a bit off. The current implementation has the label fixed to the midpoint of the arrow, and this leads to some strange twisting when the label is moved too close to either of the endpoints. When the label is mostly midway between the endpoints, everything works and looks perfect. My thinking is that I would like to try to have the label "slide" along the arrow when it is moved, in addition to moving the arrow itself. I think this would alleviate the strange twisting. But at the same time, I don't want to break any movement functionality, I just want to get rid of the warping arrows when labels move to close to the endpoints.

# Handled issues (either solved in code or updated in documentation)

- Draggable relationship cards with curved arrows. Card can be placed anywhere; arrow bends as a smooth arc through the card's position. Position persists to DB via the backing node's layout row.
  - **Fixed:** SVG lines replaced with quadratic Bezier paths. Relationship card is draggable (mousedown/move/up). Position stored as absolute canvas coords in layout table. Curve arcs through card center; degenerates to straight line at default midpoint. Relationship nodes filtered from canvas card rendering.

- Relationship "labels" should be cards themselves (DSRP: every R is also a D).
  - **Fixed:** Each relationship now creates a backing node (`node_type = 'relationship'`) in the DB. Labels render as card-style HTML elements at the line midpoint. `rel_node_id` column links relationships to their nodes. Schema migration rebuilds nodes table CHECK constraint. Full stack: schema, Rust commands, IPC, RelationshipCard component.

- Connection handles only showing on top-level cards, not nested cards.
  - **Fixed:** `onConnectStart` and `isConnecting` props were missing from the recursive child Card render. Now passed through at all nesting depths.

- Label cards should move when source/destination card is moved, preserving curve shape.
  - **Fixed:** Weighted incremental delta in handleMouseMove. Distance-based weight (distToOther / totalDist) moves labels proportionally. Positions persist on card drag end.

- Arrow endpoints should follow curve direction, not center-to-center.
  - **Fixed:** `computeEdgePoint` in RelationshipLine now aims toward the label card position instead of the other card's center. Two relationships between the same cards now exit/enter at different edge points.

- Moving a parent card where children have curved relationship arrows -- labels don't move as expected.
  - **Fixed:** Label movement now collects all descendants of the dragged card and moves their relationship labels too. Both endpoints moving (sibling relationships) get full delta. `isAncestor` argument order was also corrected.

- Relationship label text not saved on blur (clicking outside), only on Enter.
  - **Fixed:** `EditInput` already had `onBlur={commit}`, but `handleCanvasMouseDown` and `handleSelectCard` were preemptively clearing `editingRelId` on mousedown, racing against blur. Removed those preemptive clears.

- Connection anchor points appearing on hovered card and all ancestors simultaneously.
  - **Fixed:** Moved hover tracking from local Card state to App-level `hoveredCardId`. Hit-tests on every mousemove to find smallest card under cursor. Only that card receives `isHovered={true}`.

# Requirements testing

1. Hover near a card edge -> connection handles appear (all nesting depths) - OK!
2. Drag from a handle to another card -> directed line with arrow - OK!
3. Double-click a line -> edit the label - OK!
4. Select a line + Delete -> removes it - OK!
5. Connecting cards across nesting boundaries - OK!
6. Relationship labels render as card-style elements - OK!
7. Relationship label editing (double-click card on line) - OK!
8. Move a card (reparent) -> its relationships follow - OK!
9. Delete a card with relationships -> relationships silently removed - OK!
10. Relationships persist across reload - OK!
11. Draggable relationship cards with curved arrows - OK!
12. Relationship card position persists across reload - OK!
13. Drag source/target card -> label moves proportionally, curve shape preserved - OK!
14. Label positions persist after card drag + reload - OK!
15. New relationship (default midpoint label) -> drag source, label stays at midpoint - OK!
16. Move destination card to opposite side of source -> arrow emerges from correct edge - OK!
17. Two relationships between same cards, labels opposite directions -> different edge exit/entry points - OK!
18. Drag source/target so label passes near other card -> smooth movement without sticking - OK!
19. Move parent card with children that have curved relationship arrows -> labels move correctly - OK!
20. Edit relationship label, click outside -> text saves on blur (not just Enter) - OK!
21. Hover nested cards -> only topmost card shows connection anchor points - OK!
22. Default (never-dragged) labels render at midpoint of straight line -- same as before - OK!
23. Perpendicular drag bends the curve -- same feel as before - OK!
24. Parallel drag slides label along curve without changing curvature
	1. Yes, this is really nice. I just have one small comment. The more curved the arrow is, the more the label moves away from the mouse pointer when sliding. Not a super big deal, but it would be even better if the label always was connected to the mouse pointer, i.e it should feel as if it is the label you're moving, and the curvature of the arrow adjusts accordingly. The current behavior also makes it hard to perform this exact test.
25. Labels near endpoints -- NO curve warping - OK!
	1. And it looks GLORIOUS!
26. Two relationships between same cards -- independently positioned, no interference - OK!
27. Double-click to edit opens at visual (on-curve) position - OK!
