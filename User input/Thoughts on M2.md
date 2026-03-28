# New issues (these should be moved to handled when taken care of)

(None currently -- add new issues here)

# Handled issues (either solved in code or updated in documentation)

- Double-click reset size was smaller than a new card. Should be identical.
  - **Fixed:** Leaf reset now uses 150×60 (same dimensions as new card creation) instead of MIN_W×MIN_H (100×50).
- Drop zone rework: use the full card body as a drop target instead of just the title bar. Drop in place (where cursor is), not auto-stacked. Grandparent/ancestor interference when repositioning within parent.
  - **Fixed:** Full-card nest detection. When cursor inside current parent, ancestors skipped as candidates (siblings still valid). Cards land at cursor position (canvas→local conversion). Parent auto-expands on drop.

- Manual resize memory ("size floor"): Cards remember manually-set size as a minimum. Auto-resize still expands past it if children need room, but never shrinks below it. Double-click body on a leaf resets to default; on a parent, shrinks to fit children. Floor clears on reset. Persisted via new `min_width`/`min_height` DB columns.
  - **Fixed:** `minWidth`/`minHeight` fields added to CardData and layout table. `autoResizeParent` uses them as floor. Manual resize sets floor on mouseup. Double-click reset clears floor (leaf → MIN_W×MIN_H, parent → fit-to-children). Full stack: schema migration, Rust commands, IPC, canvas-store, App.tsx.
- Double-click on card body (anywhere but title area) to reset card to default size.
  - **Fixed:** Double-clicking the content area below the header resets size. Leaf cards → MIN_W × MIN_H. Parent cards → smallest size that fits children. Floor cleared in both cases. Persisted to DB.

- I would like the "title" area at the top of the cards (with the separator) to always be visible, even for empty cards without parts. And all card text should be inside this title area for the time being (left aligned)
  - **Fixed:** Card header with separator now renders on all cards unconditionally. Text is left-aligned inside the header area.
- The text area at the top should be selected when the card is created, so the user can start typing immediately. Since the cards they represent distinctions, a title should be a natural requirement.
  - **Fixed:** New cards auto-focus the textarea on creation via a `newCardId` state signal passed to the Card component.
- It is very hard to see what is happening since the cards overlap so much. I think we need some reordering of existing parts a new one is dropped inside. But this naturally leads to a cascading reordering depending on the depth. We need to make this as simple as possible to begin with. Maybe just always expand down to begin with? Plectica uses "layouts" where you can decide if a card should order the parts in a list or column format. Maybe something to consider?
  - **Fixed:** New `computeStackedPosition()` in canvas-store.ts places nested cards in a vertical stack with 10px gaps. No overlap possible on nest.
- As for the expanding of parent cards, it is working, but the parts are overlapping at the bottom. Would be nice to have the parent completely encompass the parts.
  - **Fixed:** `autoResizeParent` now uses `BOTTOM_PADDING = 20` for sufficient clearance below the last child.
- Actually, no cards should ever overlap. I can't think of a single case where that would be useful. Can Derek think of any?
  - **Fixed:** Vertical stacking on nest prevents overlap. (Derek question still open but moot given the auto-layout approach.)
- When I select a part of a part, it is not possible to move it inside its parent without triggering a drop onto its "grandparent". Maybe have the drop target always be the title bar? Since no cards should ever be overlapping, the title bar should always be visible and non-conflicting.
  - **Fixed:** Nest target detection now only checks the title bar area (top `HEADER_HEIGHT` pixels) instead of the full card body. Cursor must be over a card's header to trigger a nest.
- On the same note, the automatic resizing of parent cards makes it look like it is impossible to move parts out of their parents. The parent just keeps resizing. But as i mentioned above, the grandparent actually becomes the drop target. Maybe skip automatic resizing of parents when cards are dragged? Instead only resize on drop and removal of parts?
  - **Fixed:** `autoResizeParent` no longer fires during drag (mouse-move). It only fires on mouse-up (nest, unnest, or reposition complete).
- When dragging a card, it sometimes appears "behind" the possible targets. Dragged cards should always be visible above all other cards. I'm not entirely sure when this happens, but I see it a lot.
  - **Fixed:** Dragged card is now rendered as a "ghost" at the canvas root level (outside its parent's DOM tree) with `zIndex: 10000`, escaping CSS stacking contexts. The original nested position is suppressed during drag.
- It shouldn't be possible to downsize a parent (by dragging the edges) to a smaller size than what is required to encompass its children. This leads to strange behaviour where the children looks like they are outside the parent.
  - **Fixed:** Resize handler now computes children's bounding box and clamps minimum width/height so the parent can never shrink past its children.
- A previous fix mentioned that "autoResizeParent" fires on mouse-up (nest, unnest and reposition complete). I can verify that it works as intended for nest and unnest, but not for reposition complete (meaning "within" a parent). This would be helpful also, especially to make the parent expand when you reposition a card so that some part of it sticks outside its parent. (the "no-overlapping"-rule).
  - **Fixed:** Layout-only drag (reposition within parent) now calls `autoResizeParent` on mouse-up. If the parent grew, its new size is also persisted to the DB.
- Manual resizing by dragging the edges has now stopped working.
  - **Fixed:** Two bugs: `getChildren` was never imported (runtime crash), and a misplaced `return` in the pendingDrag promotion block prevented the resize processing section from ever running. Resize detection now happens in App.tsx during promotion -- clicks within 16px of the right or bottom edge trigger resize instead of drag.
- It is impossible to edit the name of the card if not done at creation. Double-click to edit title?
  - **Fixed:** Double-click on the card header enters edit mode. Drag threshold system ensures the first mousedown doesn't activate the ghost card, so the double-click event reaches the DOM correctly.
- I would like the mouse pointer to change to the resize symbol when appropriate. Now it is always showing the hand (for move) when hovering over a card.
  - **Fixed:** `isInResizeZone` state in Card.tsx detects cursor proximity to right/bottom edge (16px zone) on mousemove. Cursor changes to `se-resize` in the resize zone.
- We need some visual indication of when a card is being moved inside its parent and when it leaves it. Maybe have the parent always show a blue outline when dragging a child around inside it? This would be consistent with it being a drop zone when releasing the button.
  - **Fixed (v2):** Unified drop target system. Exactly one dashed blue outline (`2px dashed #2196f3`) shows the drop target during drag: nest target > current parent > none. Solid blue = selected card only. Removed the separate isActiveContainer styling.
- The auto-resize is not triggering to the left and up (for example when a child is dragged a bit over the left or top edge) Is this a different situation to right and down? If it is a big thing to change, we need to talk about it first, I don't want to introduce too much complexity.
  - **Fixed:** `normalizeChildPositions` now runs before `autoResizeParent` on layout-only drag, shifting children with negative coords to positive positions before resizing.
- I can't seem to move parts nested more than one level deep back to the canvas. They always end up on their parent.
  - **Fixed:** Unnest now walks the full ancestor chain. If a card is dragged outside all ancestors, it lands at canvas root (parentId = null), not just one level up.
- We have an issue with automatic resizing when the nesting gets too deep. When moving a parent with its child inside another nested structure, often the inner child sticks out outside the parent after the move.
  - **Fixed:** `autoResizeParent` now starts from the nested card itself (bottom-up), so children sizes are correct before the parent resizes around them. Applied to both nest and unnest paths.

# Requirements testing

1. Create card "Bicycle" - OK!
2. Create 4 more cards - OK!
3. Nesting - OK!
4. Go deeper - OK!
5. One more level - OK!
6. Breadcrumb - OK!
7. Create a cycle - Not possible (by design). No problem.
8. Persistence - OK!
9. Title area always visible - OK!
10. Selected text area at creation - OK!
11. Overlap - OK! Parts now stack vertically.
12. Drop target = title bar - OK!
13. No resize during drag - OK!
14. Dragged card always on top - OK!
15. Parent can't shrink past children - OK!
	1. Working great!
16. Parent expands on reposition - OK!
17. Manual resize by dragging edges - OK!
18. Double-click to edit title - OK!
19. Resize cursor on hover - OK! 
20. Drop target indicator (unified dashed outline) - OK!
	1. ~~Parent outline stayed on when dragging outside~~ **Fixed:** dropTargetId now checks card center against parent bounds; outline disappears when card leaves parent.
	2. ~~Cards dropped on ancestor body got nested without title-bar hover~~ **Fixed:** Unnest path now always goes to canvas root. Nesting only via title-bar hover (nest target path).
21. Left/up auto-resize - OK! (better than expected -- shifts siblings)
22. Deep unnest to canvas - OK!
23. Deep nesting auto-resize - OK!
24. Double-click body to reset size - OK!
	1. ~~Leaf-only reset~~ **Fixed:** Leaf cards reset to MIN_W×MIN_H. Parent cards shrink to fit children. Both clear the manual size floor.
25. Manual resize memory (size floor) - OK!
	1. Manually resized cards keep their size as a minimum. Auto-resize expands past it but never shrinks below. Persists across sessions.
26. Reset size matches new card size - OK!
27. Full-card drop zone (replaces title-bar only) - OK!
	1. ~~Grandparent lighting up when dragging inside parent~~ **Fixed:** When cursor is inside current parent, all ancestors are skipped as nest candidates. Siblings still detectable.
	2. ~~Drop in place~~ **Fixed:** Cards land where you release them (canvas coords converted to parent-local). Parent auto-expands if needed.
