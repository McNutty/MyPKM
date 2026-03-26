# New issues (these should be moved to handled when taken care of)

(No new issues)
# Handled issues (either solved in code or updated in documentation)

- Shift+double-click cascading fit-to-contents: Shift+double-click on any card does the normal reset, then cascades fitToContents upward through all ancestors.
  - **Fixed:** Pass shiftKey from Card.tsx through to handleResetSize. Walk ancestor chain calling fitToContents at each level. Leaf branch refactored to synchronous pre-computation for proper persist.

- Unified drop-push: All card drops (same-parent and new-parent) now resolve overlaps via applyDropPush + applyPushMode. Same code path, same behavior everywhere.
  - **Fixed:** Layout-only drag path now calls applyDropPush → applyPushMode for nested cards. Added dropPushChanged detection for state updates.
- Cascade bug fix: Pushed siblings no longer escape their parent. Root cause: autoResizeParent sized all ancestors before pushCascade ran, freezing heights before siblings moved.
  - **Fixed:** Extracted resizeOneParent from autoResizeParent. Rewrote applyPushMode Phase 2 to interleave resize + push at each ancestor level. Each resize now sees post-push sibling positions from the level below.
- DB schema cleanup: Dropped min_width/min_height columns from layout table, removed from Rust struct/commands/SQL, cleaned frontend IPC.
  - **Fixed:** Idempotent DROP COLUMN migration in db.rs. Removed from NodeWithLayout struct, all SQL queries, all command signatures. Frontend IPC no longer passes null params.

- Multiple Models: Create, switch, rename, delete canvases. Left sidebar model picker. Rust backend with cascade delete. Fixed get_map_relationships to filter by map_id. Added map_id column to relationships with migration + backfill.
  - **Fixed:** 4 new Rust commands (create_map, get_all_maps, rename_map, delete_map). LeftSidebar component with inline rename, hover delete, create with auto-rename. Canvas keyed on mapId for clean reload on switch.
- Delete key guard while editing title. Resize always-on pushing mode. Arrow label inverse Bezier rework (label sticks to pointer). Auto-expanding card titles during edit. Reset-to-fit on double-click. Default card height 100.
  - **Fixed:** isTextFocused guard on Delete handler. applyPushMode called in resize branch. decomposeRelationshipGeometry rewritten with inverse Bezier (Q solved from label position). Hidden span measurer in Card.tsx for title width. Canvas 2D measureText for reset-to-fit. headerPadding=48 consistent across both.
- Relationship labels follow endpoint cards automatically during push mode, fit-to-contents, drag, and all card-moving operations.
  - **Fixed:** Architectural refactor — label positions changed from absolute canvas coordinates to midpoint-relative offsets {dx, dy}. Labels now derive their absolute position at render time (midpoint + offset), eliminating the entire class of label-drift bugs. ~90 lines of manual label-shifting code deleted. Net -53 lines.
- No-overlap on drop: Dropping a card into a parent with existing children reuses push-mode to resolve overlaps. Biggest-overlap sibling pushes the dropped card away. Parent resize cascades up via applyPushMode.
  - **Fixed:** New `applyDropPush` function resolves drop overlaps. `resolvePush` extracted to module scope with inflated mover rect for smooth 24px buffer. NEST branch now calls `applyPushMode` for full cascade. Dead code removed (`STACK_GAP`, `computeStackedPosition`).
- Push buffer margin: Cards maintain a 24px gap after push (not edge-to-edge). Applies to Shift+drag, resize push, and drop-push.
  - **Fixed:** `resolvePush` inflates mover bounding box by PADDING before computing overlap penetration, achieving smooth continuous gap without oscillation.
- Remove auto-shrink: All cards now behave the same — grow to fit children, never auto-shrink. Explicit shrink via double-click fit-to-contents only. minWidth/minHeight tracking removed from frontend.
  - **Fixed:** `autoResizeParent` is now grow-only (uses current size as floor). Removed `minWidth`/`minHeight` from CardData, all canvas handlers, IPC layer. Removed fitToContents call on empty-parent drop. DB columns left inert (migration pending).

# Requirements testing

1. Left sidebar shows list of models - OK!
2. Click a model to switch -> canvas loads that model's cards - OK!
3. Click "New Model" -> creates model, auto-selects it, enters rename mode - OK!
4. Double-click model name -> inline edit, Enter/blur to save, Escape to cancel - OK!
5. Hover model -> delete "x" appears (not on active model, not when only 1 model) - OK!
6. Delete model -> confirmation dialog, then removes it and all its cards/relationships - OK!
	1. Confirmation dialog appears, but the model is not deleted when I press ok.
	2. Now it is ok!
7. Cards created in Model A do not appear in Model B - OK!
8. Relationships created in Model A do not appear in Model B - OK!
9. Switching models preserves each model's cards and layout across switches - OK!
10. All M3 functionality still works (drag, nest, push mode, relationships, etc.) - OK!
11. Delete key while editing a card title only deletes the character, not the card - OK!
12. Card expands horizontally while typing in the title to fit text, shrinks on delete (down to pre-edit width), keeps expanded size on commit - OK!
	1. No, and I realize the requirement might have been a bit ambiguous. When a new card is created, it is created with a standard size, like before. And this new card is created with focus in the title field. The thing is, when you start to write in the title field, or paste something in, the card should *expand horizontally during the editing process* to fit the entire text. Also shrink if the user shortens the text (down to the original size). Then when you press enter (or click outside) the new expanded size is kept. This way we ensure that the whole title is always visible (unless you later manually resize the card after the fact). The process repeats if the user edits the title again later on, making it longer. But in this case the minimum size is the size the card had before editing. I realize that this solution is not perfect (you might get very long cards if the titles are long), but for now this is good enough. We can think of word wrapping and multi-line titles later on.
	2. Perfect fix! I just realized one small addition that will make it perfect. The "double-click on leaf"-functionality resets the size of the card to the default. I would like to modify this so that the horizontal size instead resets to "fit the title". The vertical size can still be reset to the default. And while we're at it, please increase the default vertical size to 100 instead of 80.
	3. Amazing! Worked perfectly. You also realized that if the text is so short that the card would shrink below the default, the default still goes. And another very very cool thing, if you keep writing and the card expands, Pushing Mode actually shifts the surrounding cards to make space! Amazing, I'm loving pushing mode so much, and awesome to have it on expansion as well! Love the new default height as well, much better looking and easier to interact with the new cards as well.
13. Resizing a card pushes overlapping siblings out of the way (no Shift needed) - OK!
14. Arrow label sticks to the pointer at all times when dragging, even near endpoints - OK!
	1. Not only ok, but I think we might finally have cracked the arrow behavior. It seems perfect to me now, better than the original Plectica and better than any whiteboarding app I have ever tried!
15. Relationship labels move along with their endpoint cards when pushed by push mode
	1. Yes, but something is not right with the calculation, now the label moves *too much*. So if the parent card is being pushed downwards, the label also moves downwards, but a bit too much. The same for each of the other directions. This seems like a code smell to me, shouldn't this calculation behave exactly the same way as the other ones?
	2. Still the same problem. The other tests are still ok, but the labels still move too much. This fix also broke simple dragging. On mouse-down, the cursor turns into a "forbidden sign" and the card starts to move when I *release* the mouse button. We must revert this fix and find another solution. I didn't like the ref solution from the beginning.
	3. Ok, dragging works again, but the labels still drift.
	4. Hm, something is off. It seems like the *pushed* cards now work as expected, the labels stay in place and snap back on mouse-up. But the card being dragged (the *pusher*) now has started to have its labels shift. This shouldn't be possible, no change we have done should have affected the behavior of dragged cards.
	5. Still problems with the pushing card. The mor
16. Relationship labels move along with their endpoint cards when fit-to-contents shifts children (double-click parent reset) - OK!
	1. Works great, label stays perfectly in place.
17. Shift+drag push leaves a ~24px gap between cards (not edge-to-edge) - OK!
	1. Technically working, but very jerky, the cards being pushed are "bouncing along". Something is wrong here, it should be as smooth as when a child pushes out its parents edge, there is a buffer there as well, so it shouldn't affect the smoothness. Is the same code not being utilized?
	2. Now working perfectly!
18. Dropping a card into a parent with existing children pushes the dropped card away from overlapping siblings (with gap) - OK!
19. Dropping a card overlapping multiple children resolves against the one with the biggest overlap - OK!
20. Parent auto-resizes to fit all children after drop-push - OK!
	1. The parent auto-resizes, but it is not cascading. When the parent expands, adjacent cards to that parent is not being pushed in turn. This makes me afraid that push-mode isn't really a mode that can be applied, but random code spread around the codebase for different situations. If this utilized proper push-mode, then the cascading pushes would just have worked. When I say that we should use push-mode, I mean it literally, not to write something "like" it.
	2. Now working!
21. Drop-push respects PADDING from the parent edge (card doesn't escape the parent) - OK!
22. Resizing a card into a sibling also produces a buffer gap (not edge-to-edge) - OK!
	1. Yes, but the same jerkyness as issue 17.
	2. Now working!
23. Parents grow to fit children but never auto-shrink (all cards behave the same regardless of manual resize history) - OK!
	1. With one exception, dropping a card into a empty card that is bigger, will auto-shrink the new parent.
	2. Now working!
24. Double-click fit-to-contents still shrinks parent to fit children - OK!
25. Manual resize still works and size persists - OK!
26. Shift+drag push causes parent to grow — parent stays grown after releasing Shift- OK!
27. Typing a long title grows the card — card does NOT shrink when shortening the text (until double-click reset) - OK!
28. Drop-push into parent — parent grows if needed — stays at new size - OK!
29. Cascade: A has children C, D. B below A. Drop card into C → C grows → D pushed → A grows → B pushed (no escaping) - OK!
30. Same-parent drop: move card within parent, drop on sibling → pushed away with gap - OK!
31. Same-parent cascade: same as above, parent grows → parent's siblings get pushed - OK!
32. Resize cascade still works: resize C downward → D pushed → A grows → B pushed- OK!
33. Title expand in nested card → cascade propagates upward correctly - OK!
34. Root-level drop: cards without a parent — no push, just normal move - OK!
35. Shift+drag still smooth with 20px gap (no regression) - OK!
36. Normal double-click (no Shift) still works as before — fits one card only - OK!
37. Shift+double-click on leaf card → resets leaf to title width, then each ancestor shrinks to fit - OK!
38. Shift+double-click on parent card → fitToContents on that parent, then each ancestor shrinks - OK!
39. Shift+double-click on root card → fits that card only (no ancestors) - OK!
40. Shift+double-click deeply nested (3+ levels) → all ancestor levels tighten up in one action - OK!
