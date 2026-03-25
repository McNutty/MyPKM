# New issues (these should be moved to handled when taken care of)

- Still thinking about this, ignore for now!
	- Hide the empty label when the arrow is not selected. It should only display the dotted line when not selected. The tradeoff being that you need to select the line in order to modify the curvature, since you need the label for that. Or maybe instead reveal it on hover instead of selection? Yes, this would be best.
- Still thinking about this, ignore for now!
	- Add some sort of card alignment choice. A double click aligns all cards according to alignment choice. List, column and no alignment. A resized card gets "no alignment". A double click then works as now.
- Modify the "parent double-click" resizing functionality by adding a top-left alignment of all children cards before resizing. Should also activate when dropping a card on an empty card. It should move all cards to the top left before resizing the parent. The relative positions of all cards should be unchanged, but the top margin to the card highest up, and the left margin to the leftmost card should be the same as the new right- and bottom margins after resizing the parent. It will have the effect of "centering" the contents on double click. Actually, an easier way of explaining might be to say that the end result of a double click should be that the margins between the content and **all** borders should be the same as the right/bottom margins after a current double click. "Fit-to-contents" is a good name!
- ~~Pushing Mode~~ — Moved to Handled.
- We still have some issue with size persistence I've noticed. My tests show that when a child is manually resized but not the parent, the parent shrinks a bit upon restart so the resized child might "stick out".

# Handled issues (either solved in code or updated in documentation)

- Auto-fit on startup so cards are visible without clicking "Fit".
  - **Fixed:** `hasAutoFitted` ref + `zoomToFit()` call after initial card load. App auto-fits to show all cards on first render.

- Hold Space to activate panning mode (works over cards too). Cursor changes to grab/grabbing. Hint overlay shows shortcuts.
  - **Fixed:** `spaceHeldRef` + `spaceHeld` state with keydown/keyup listeners. `onMouseDownCapture` on container intercepts during capture phase when Space is held, enabling panning over cards. CSS `<style>` tag with `!important` overrides all descendant cursors (including crosshair on connection handles) to `grab`/`grabbing` when Space is held. Hint overlay in bottom-left shows "Space: Pan · C: New card · Double-click: New card".

- Press C to create a new card at cursor position (doesn't fire while editing text).
  - **Fixed:** `lastMouseRef` tracks cursor position in handleMouseMove. C key handler creates card at cursor position, guarded by `editingCardId`/`editingRelId` checks.

- Card persistence bug: some cards don't keep their size after reload, children stick out.
  - **Fixed:** `autoResizeParent` correctly resized parent/ancestor cards in memory during nest/unnest, but only the dragged card's layout was persisted to DB. Parent dimensions were lost on reload. Now both nest and unnest paths diff all cards against pre-operation state and persist any whose width/height changed.

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

- Label cards warp curve when dragged near endpoints; labels should "slide" along the arrow.
  - **Fixed:** Decompose stored label position into t (along baseline, clamped 0.05-0.95) and d (perpendicular offset). Control point Q pinned to midpoint perpendicular — curve never warps. Visual label position = Bezier(t). Drag handler applies Newton-step correction so label tracks mouse.

- Re-attaching relationship endpoints by dragging arrow ends to new cards.
  - **Fixed:** When a relationship is selected, draggable handles appear at both endpoints (open circle = source, filled = target). Dragging a handle shows a ghost line; releasing over a card rewires that end via new `reattach_relationship` Rust command. Self-loops rejected. Label position preserved.

- Resize zone too large — resizing triggered from entire right/bottom border instead of just corner.
  - **Fixed:** Resize hit detection changed from `nearRight || nearBottom` to `nearRight && nearBottom` in both Card.tsx (cursor feedback) and App.tsx (drag promotion). Now only the 16×16 corner square triggers resize.

- Shift+Scrollwheel for horizontal panning.
  - **Fixed:** Added Shift+wheel branch in `handleWheel`. `deltaY` applied to `panX` when Shift is held without Ctrl. Scroll up = pan left, scroll down = pan right.

- Pushing Mode: Hold Shift while dragging to push sibling cards out of the way. Cascading collisions, parent auto-expansion, ancestor cascade.
  - **Fixed:** `applyPushMode` in `canvas-store.ts` uses pure AABB min-penetration collision resolution with BFS cascade. `pushCascade` resolves sibling overlaps iteratively (max 20 passes). Parent extends right/down via `autoResizeParent`; immediate parent gets `minWidth`/`minHeight` floor. Ancestor expansion cascades upward — if a parent grows and overlaps its own siblings, they get pushed too. Nested cards clamped to PADDING; root-level cards push freely in all directions. Shift toggle mid-drag via `shiftHeldDuringDragRef`. Single-child parent expansion works (sibling guard removed). Error-recovery path now filters relationship backing nodes.

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
28. Label stays under mouse during drag on curved arrows (no drift) - OK!
29. App auto-fits to show all cards on startup - OK!
30. Hold Space to pan (works over cards too, not just empty canvas) - OK!
31. Cursor changes to grab/grabbing during space panning (including over cards and connection handles) - OK!
32. Press C to create a new card at cursor position - OK!
33. C shortcut doesn't fire while editing text - OK!
34. Hint overlay shows all shortcuts (Space, C, double-click) - OK!
35. Nest a card into a parent (causing auto-expand), reload -> parent keeps its expanded size - OK!
36. Delete leaf card (no parts) -> immediate deletion, no dialog - OK!
37. Delete card with parts -> dialog shows correct part count, Cancel leaves everything intact- OK!
38. Delete All in dialog -> removes card, all descendants, and their relationships - OK!
	1. Works on almost all cards, but on one in particular I get this error: Failed to delete card: delete_node_cascade transaction: FOREIGN KEY constraint failed
	2. The previous failure is now working, so ok as far as I can tell.
39. Deleting a card with parts does NOT briefly remove it then snap it back (old bug) - OK!
	1. This was a technical regression test. The old behavior briefly flashed the deletion before reverting. The new dialog prevents this entirely.
40. F key on selected relationship -> flips direction (arrowhead reverses) - OK
41. No `[db]` prefix in any error message reaching the user - OK as far as I can tell.
42. "Containers" replaced with DSRP terms in code comments - I'll trust you on this one.
43. Resize only triggers from lower-right corner, not full right/bottom border
44. Shift+Scroll pans horizontally (up=left, down=right) - OK!
45. Select an arrow, drag the source handle to a different card -> relationship rewires - OK!
46. Select an arrow, drag the target handle to a different card -> relationship rewires - OK!
47. Re-attach cancels when released on empty canvas - OK!
48. Re-attach rejects self-loops (source === target) - OK!
49. Shift+Drag a card into a sibling -> sibling gets pushed in the drag direction - OK!
50. Shift+Drag a card into a sibling directly on the canvas - OK!
51. Pushing cascades: pushed card pushes further cards it collides with (including parent siblings) - OK!
52. Pushed cards stop at left/top boundary of parent (or canvas edge for root cards) - OK!
53. Dragged card overlaps when a pushed card hits a wall (accepted behavior for now)
54. Parent extends right/down when pushed cards reach the border (immediate parent size remembered) - OK!
55. Release Shift mid-drag -> pushing stops, normal drag resumes - OK!
56. Press Shift mid-drag -> pushing activates without jump/snap - OK!
57. Pushing mode does not interfere with Shift+Scroll horizontal panning - OK!
58. Regular drag (no Shift) still works exactly as before - OK!
59. All pushed card positions persist after mouse-up and reload - OK!
