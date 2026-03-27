# New tasks

- Still thinking about this, ignore for now!
	- Hide the empty label when the arrow is not selected. It should only display the dotted line when not selected. The tradeoff being that you need to select the line in order to modify the curvature, since you need the label for that. Or maybe instead reveal it on hover instead of selection? Yes, this would be best.
- Still thinking about this, ignore for now!
	- Add some sort of card alignment choice. A double click aligns all cards according to alignment choice. List, column and no alignment. A resized card gets "no alignment". A double click then works as now.

# Resolved tasks

**T3-01: Relationship labels as cards (DSRP: every R is also a D)**
Relationship "labels" should be cards themselves.
- **Fixed:** Each relationship now creates a backing node (`node_type = 'relationship'`) in the DB. Labels render as card-style HTML elements at the line midpoint. `rel_node_id` column links relationships to their nodes. Schema migration rebuilds nodes table CHECK constraint. Full stack: schema, Rust commands, IPC, RelationshipCard component.
- Tests:
  - 6. Relationship labels render as card-style elements - OK!
  - 7. Relationship label editing (double-click card on line) - OK!

**T3-02: Basic relationships**
Draggable relationship cards with curved arrows. Connection handles appear on hover. Directed lines with arrows. Relationships persist.
- **Fixed:** SVG lines replaced with quadratic Bezier paths. Relationship card is draggable (mousedown/move/up). Position stored as absolute canvas coords in layout table. Curve arcs through card center; degenerates to straight line at default midpoint. Relationship nodes filtered from canvas card rendering.
- Tests:
  - 1. Hover near a card edge -> connection handles appear (all nesting depths) - OK!
  - 2. Drag from a handle to another card -> directed line with arrow - OK!
  - 3. Double-click a line -> edit the label - OK!
  - 4. Select a line + Delete -> removes it - OK!
  - 5. Connecting cards across nesting boundaries - OK!
  - 8. Move a card (reparent) -> its relationships follow - OK!
  - 9. Delete a card with relationships -> relationships silently removed - OK!
  - 10. Relationships persist across reload - OK!
  - 11. Draggable relationship cards with curved arrows - OK!
  - 12. Relationship card position persists across reload - OK!

**T3-03: Connection handles on nested cards**
Connection handles only showing on top-level cards, not nested cards.
- **Fixed:** `onConnectStart` and `isConnecting` props were missing from the recursive child Card render. Now passed through at all nesting depths.

**T3-04: Label cards follow endpoint cards**
Label cards should move when source/destination card is moved, preserving curve shape.
- **Fixed:** Weighted incremental delta in handleMouseMove. Distance-based weight (distToOther / totalDist) moves labels proportionally. Positions persist on card drag end.
- Tests:
  - 13. Drag source/target card -> label moves proportionally, curve shape preserved - OK!
  - 14. Label positions persist after card drag + reload - OK!
  - 15. New relationship (default midpoint label) -> drag source, label stays at midpoint - OK!

**T3-05: Arrow endpoints follow curve direction**
Arrow endpoints should follow curve direction, not center-to-center.
- **Fixed:** `computeEdgePoint` in RelationshipLine now aims toward the label card position instead of the other card's center. Two relationships between the same cards now exit/enter at different edge points.
- Tests:
  - 16. Move destination card to opposite side of source -> arrow emerges from correct edge - OK!
  - 17. Two relationships between same cards, labels opposite directions -> different edge exit/entry points - OK!

**T3-06: Parent card drag moves relationship labels**
Moving a parent card where children have curved relationship arrows -- labels don't move as expected.
- **Fixed:** Label movement now collects all descendants of the dragged card and moves their relationship labels too. Both endpoints moving (sibling relationships) get full delta. `isAncestor` argument order was also corrected.
- Tests:
  - 18. Drag source/target so label passes near other card -> smooth movement without sticking - OK!
  - 19. Move parent card with children that have curved relationship arrows -> labels move correctly - OK!

**T3-07: Relationship label saves on blur**
Relationship label text not saved on blur (clicking outside), only on Enter.
- **Fixed:** `EditInput` already had `onBlur={commit}`, but `handleCanvasMouseDown` and `handleSelectCard` were preemptively clearing `editingRelId` on mousedown, racing against blur. Removed those preemptive clears.
- Tests:
  - 20. Edit relationship label, click outside -> text saves on blur (not just Enter) - OK!

**T3-08: Connection handles on hover — only topmost card**
Connection anchor points appearing on hovered card and all ancestors simultaneously.
- **Fixed:** Moved hover tracking from local Card state to App-level `hoveredCardId`. Hit-tests on every mousemove to find smallest card under cursor. Only that card receives `isHovered={true}`.
- Tests:
  - 21. Hover nested cards -> only topmost card shows connection anchor points - OK!

**T3-09: Label sliding along curve**
Label cards warp curve when dragged near endpoints; labels should "slide" along the arrow.
- **Fixed:** Decompose stored label position into t (along baseline, clamped 0.05-0.95) and d (perpendicular offset). Control point Q pinned to midpoint perpendicular — curve never warps. Visual label position = Bezier(t). Drag handler applies Newton-step correction so label tracks mouse.
- Tests:
  - 22. Default (never-dragged) labels render at midpoint of straight line -- same as before - OK!
  - 23. Perpendicular drag bends the curve -- same feel as before - OK!
  - 24. Parallel drag slides label along curve without changing curvature
    1. Yes, this is really nice. I just have one small comment. The more curved the arrow is, the more the label moves away from the mouse pointer when sliding. Not a super big deal, but it would be even better if the label always was connected to the mouse pointer, i.e it should feel as if it is the label you're moving, and the curvature of the arrow adjusts accordingly. The current behavior also makes it hard to perform this exact test.
  - 25. Labels near endpoints -- NO curve warping - OK!
    1. And it looks GLORIOUS!
  - 26. Two relationships between same cards -- independently positioned, no interference - OK!
  - 27. Double-click to edit opens at visual (on-curve) position - OK!
  - 28. Label stays under mouse during drag on curved arrows (no drift) - OK!

**T3-10: Re-attaching relationship endpoints**
Re-attaching relationship endpoints by dragging arrow ends to new cards.
- **Fixed:** When a relationship is selected, draggable handles appear at both endpoints (open circle = source, filled = target). Dragging a handle shows a ghost line; releasing over a card rewires that end via new `reattach_relationship` Rust command. Self-loops rejected. Label position preserved.
- Tests:
  - 45. Select an arrow, drag the source handle to a different card -> relationship rewires - OK!
  - 46. Select an arrow, drag the target handle to a different card -> relationship rewires - OK!
  - 47. Re-attach cancels when released on empty canvas - OK!
  - 48. Re-attach rejects self-loops (source === target) - OK!

**T3-11: Auto-fit on startup**
App should auto-fit to show all cards on startup without clicking "Fit".
- **Fixed:** `hasAutoFitted` ref + `zoomToFit()` call after initial card load. App auto-fits to show all cards on first render.
- Tests:
  - 29. App auto-fits to show all cards on startup - OK!

**T3-12: Space to pan**
Hold Space to activate panning mode (works over cards too). Cursor changes to grab/grabbing. Hint overlay shows shortcuts.
- **Fixed:** `spaceHeldRef` + `spaceHeld` state with keydown/keyup listeners. `onMouseDownCapture` on container intercepts during capture phase when Space is held, enabling panning over cards. CSS `<style>` tag with `!important` overrides all descendant cursors (including crosshair on connection handles) to `grab`/`grabbing` when Space is held. Hint overlay in bottom-left shows "Space: Pan · C: New card · Double-click: New card".
- Tests:
  - 30. Hold Space to pan (works over cards too, not just empty canvas) - OK!
  - 31. Cursor changes to grab/grabbing during space panning (including over cards and connection handles) - OK!
  - 34. Hint overlay shows all shortcuts (Space, C, double-click) - OK!

**T3-13: Press C to create card at cursor**
Press C to create a new card at cursor position (doesn't fire while editing text).
- **Fixed:** `lastMouseRef` tracks cursor position in handleMouseMove. C key handler creates card at cursor position, guarded by `editingCardId`/`editingRelId` checks.
- Tests:
  - 32. Press C to create a new card at cursor position - OK!
  - 33. C shortcut doesn't fire while editing text - OK!

**T3-14: Card persistence bug / size persistence**
Card persistence bug: some cards don't keep their size after reload, children stick out. Also size persistence: parent shrinks on reload after child is manually resized.
- **Fixed:** `autoResizeParent` correctly resized parent/ancestor cards in memory during nest/unnest, but only the dragged card's layout was persisted to DB. Parent dimensions were lost on reload. Now both nest and unnest paths diff all cards against pre-operation state and persist any whose width/height changed. Resize mouseup handler now walks the ancestor chain and persists every parent whose dimensions changed.
- Tests:
  - 35. Nest a card into a parent (causing auto-expand), reload -> parent keeps its expanded size - OK!
  - 65. Manually resize a child card (make it bigger), reload -> parent still contains the child (no sticking out) - OK!

**T3-15: Delete card with parts dialog**
Delete leaf card with no parts → immediate deletion. Delete card with parts → confirmation dialog with part count.
- Tests:
  - 36. Delete leaf card (no parts) -> immediate deletion, no dialog - OK!
  - 37. Delete card with parts -> dialog shows correct part count, Cancel leaves everything intact - OK!
  - 38. Delete All in dialog -> removes card, all descendants, and their relationships - OK!
    1. Works on almost all cards, but on one in particular I get this error: Failed to delete card: delete_node_cascade transaction: FOREIGN KEY constraint failed
    2. The previous failure is now working, so ok as far as I can tell.
  - 39. Deleting a card with parts does NOT briefly remove it then snap it back (old bug) - OK!
    1. This was a technical regression test. The old behavior briefly flashed the deletion before reverting. The new dialog prevents this entirely.

**T3-16: Flip relationship direction**
F key on selected relationship flips direction (arrowhead reverses).
- Tests:
  - 40. F key on selected relationship -> flips direction (arrowhead reverses) - OK

**T3-17: Error message cleanup**
No `[db]` prefix in any error message reaching the user. "Containers" replaced with DSRP terms in code comments.
- Tests:
  - 41. No `[db]` prefix in any error message reaching the user - OK as far as I can tell.
  - 42. "Containers" replaced with DSRP terms in code comments - I'll trust you on this one.

**T3-18: Resize corner only**
Resize zone too large — resizing triggered from entire right/bottom border instead of just corner.
- **Fixed:** Resize hit detection changed from `nearRight || nearBottom` to `nearRight && nearBottom` in both Card.tsx (cursor feedback) and App.tsx (drag promotion). Now only the 16×16 corner square triggers resize.
- Tests:
  - 43. Resize only triggers from lower-right corner, not full right/bottom border

**T3-19: Shift+Scroll horizontal panning**
Shift+Scrollwheel for horizontal panning.
- **Fixed:** Added Shift+wheel branch in `handleWheel`. `deltaY` applied to `panX` when Shift is held without Ctrl. Scroll up = pan left, scroll down = pan right.
- Tests:
  - 44. Shift+Scroll pans horizontally (up=left, down=right) - OK!

**T3-20: Pushing Mode**
Hold Shift while dragging to push sibling cards out of the way. Cascading collisions, parent auto-expansion, ancestor cascade.
- **Fixed:** `applyPushMode` in `canvas-store.ts` uses pure AABB min-penetration collision resolution with BFS cascade. `pushCascade` resolves sibling overlaps iteratively (max 20 passes). Parent extends right/down via `autoResizeParent`; immediate parent gets `minWidth`/`minHeight` floor. Ancestor expansion cascades upward — if a parent grows and overlaps its own siblings, they get pushed too. Nested cards clamped to PADDING; root-level cards push freely in all directions. Shift toggle mid-drag via `shiftHeldDuringDragRef`. Single-child parent expansion works (sibling guard removed). Error-recovery path now filters relationship backing nodes.
- Tests:
  - 49. Shift+Drag a card into a sibling -> sibling gets pushed in the drag direction - OK!
  - 50. Shift+Drag a card into a sibling directly on the canvas - OK!
  - 51. Pushing cascades: pushed card pushes further cards it collides with (including parent siblings) - OK!
  - 52. Pushed cards stop at left/top boundary of parent (or canvas edge for root cards) - OK!
  - 53. Dragged card overlaps when a pushed card hits a wall (accepted behavior for now)
  - 54. Parent extends right/down when pushed cards reach the border (immediate parent size remembered) - OK!
  - 55. Release Shift mid-drag -> pushing stops, normal drag resumes - OK!
  - 56. Press Shift mid-drag -> pushing activates without jump/snap - OK!
  - 57. Pushing mode does not interfere with Shift+Scroll horizontal panning - OK!
  - 58. Regular drag (no Shift) still works exactly as before - OK!
  - 59. All pushed card positions persist after mouse-up and reload - OK!

**T3-21: Fit-to-contents**
Double-click a parent card to center children with equal margins and shrink parent to fit. Also triggers on drop-on-empty-card.
- **Fixed:** `fitToContents` in `canvas-store.ts` computes children bounding box, shifts all children by uniform delta to center content, resizes parent to `contentSize + 2*PADDING`, clears size floor. Called from `handleResetSize` (parent branch) and nest handler (when target was empty). PADDING increased from 16 to 24.
- Tests:
  - 60. Double-click parent card -> children shift to equal margins on all sides, parent shrinks to fit - OK!
  - 61. Double-click parent card -> size floor (minWidth/minHeight) is cleared - OK!
  - 62. Double-click parent card -> relative positions of children to each other are preserved - OK!
  - 63. Drop a card onto an empty card -> fit-to-contents applied automatically - OK!
  - 64. Double-click leaf card -> still resets to default size (no regression) - OK!

**T3-22: Connection handles regression check**
Regression check: connection handles still appear on hover when no gesture is active.
- Tests:
  - 66. Connection handles still appear on hover when no gesture is active (no regression) - OK!

**T3-23: Relationship label position persistence after card drag**
Relationship label positions persist correctly after dragging cards with relationships.
- Tests:
  - 67. Relationship label positions persist correctly after dragging cards with relationships - OK!
