# New tasks

**T4-19: Reference architecture document**
We need some sort of reference architecture that all team members should internalize. For example, "extraction over duplication" and so on. Kael can help us write this out.

**T4-20: Double-click leaf size bug**
Small bug with double-click on leaf card to set default size. If the card is smaller than default so it expands, it doesn't trigger push-mode, which might lead it to overlap neighboring cards.

**T4-21: Add "Milestone Scope" section to task files**
Add a section at the top of the task-files called "Milestone Scope", where the scope from the kickoff is restated. This will make it easier for me to add tasks that fit the scope, right now I must admit I just add them as I think of them, the scope is not top of mind for me.

**T4-22: Rework padding to be proportional to nesting level**
Rework padding. I feel that padding should somehow be proportional to the "level". My reasoning is that when working with deeply nested structures, you often tend to zoom out. And the further zoomed out you are, the smaller the current padding seems. So if we could find some nice algorithm for this, I think it would make working at different zoom levels look better. I want to discuss this a bit before though, it is not fully thought through.

# Resolved tasks

**T4-01: Multiple Models**
Create, switch, rename, delete canvases. Left sidebar model picker. Rust backend with cascade delete. Fixed get_map_relationships to filter by map_id. Added map_id column to relationships with migration + backfill.
- **Fixed:** 4 new Rust commands (create_map, get_all_maps, rename_map, delete_map). LeftSidebar component with inline rename, hover delete, create with auto-rename. Canvas keyed on mapId for clean reload on switch.
- Tests:
  - 1. Left sidebar shows list of models - OK!
  - 2. Click a model to switch -> canvas loads that model's cards - OK!
  - 3. Click "New Model" -> creates model, auto-selects it, enters rename mode - OK!
  - 4. Double-click model name -> inline edit, Enter/blur to save, Escape to cancel - OK!
  - 5. Hover model -> delete "x" appears (not on active model, not when only 1 model) - OK!
  - 6. Delete model -> confirmation dialog, then removes it and all its cards/relationships - OK!
    1. Confirmation dialog appears, but the model is not deleted when I press ok.
    2. Now it is ok!
  - 7. Cards created in Model A do not appear in Model B - OK!
  - 8. Relationships created in Model A do not appear in Model B - OK!
  - 9. Switching models preserves each model's cards and layout across switches - OK!
  - 10. All M3 functionality still works (drag, nest, push mode, relationships, etc.) - OK!

**T4-02: Delete key guard while editing title**
Delete key while editing a card title should only delete the character, not the card.
- **Fixed:** isTextFocused guard on Delete handler.
- Tests:
  - 1. Delete key while editing a card title only deletes the character, not the card - OK!

**T4-03: Auto-expanding card titles during edit**
Card expands horizontally while typing in the title to fit text, shrinks on delete (down to pre-edit width), keeps expanded size on commit.
- **Fixed:** Hidden span measurer in Card.tsx for title width. Canvas 2D measureText for reset-to-fit. headerPadding=48 consistent across both.
- Tests:
  - 1. Card expands horizontally while typing in the title to fit text, shrinks on delete (down to pre-edit width), keeps expanded size on commit - OK!
    1. No, and I realize the requirement might have been a bit ambiguous. When a new card is created, it is created with a standard size, like before. And this new card is created with focus in the title field. The thing is, when you start to write in the title field, or paste something in, the card should *expand horizontally during the editing process* to fit the entire text. Also shrink if the user shortens the text (down to the original size). Then when you press enter (or click outside) the new expanded size is kept. This way we ensure that the whole title is always visible (unless you later manually resize the card after the fact). The process repeats if the user edits the title again later on, making it longer. But in this case the minimum size is the size the card had before editing. I realize that this solution is not perfect (you might get very long cards if the titles are long), but for now this is good enough. We can think of word wrapping and multi-line titles later on.
    2. Perfect fix! I just realized one small addition that will make it perfect. The "double-click on leaf"-functionality resets the size of the card to the default. I would like to modify this so that the horizontal size instead resets to "fit the title". The vertical size can still be reset to the default. And while we're at it, please increase the default vertical size to 100 instead of 80.
    3. Amazing! Worked perfectly. You also realized that if the text is so short that the card would shrink below the default, the default still goes. And another very very cool thing, if you keep writing and the card expands, Pushing Mode actually shifts the surrounding cards to make space! Amazing, I'm loving pushing mode so much, and awesome to have it on expansion as well! Love the new default height as well, much better looking and easier to interact with the new cards as well.

**T4-04: Resize always-on pushing mode**
Resizing a card should push overlapping siblings out of the way without needing to hold Shift.
- **Fixed:** applyPushMode called in resize branch.
- Tests:
  - 1. Resizing a card pushes overlapping siblings out of the way (no Shift needed) - OK!

**T4-05: Arrow label inverse Bezier rework**
Arrow label sticks to the pointer at all times when dragging, even near endpoints. Label position computed via inverse Bezier.
- **Fixed:** decomposeRelationshipGeometry rewritten with inverse Bezier (Q solved from label position).
- Tests:
  - 1. Arrow label sticks to the pointer at all times when dragging, even near endpoints - OK!
    1. Not only ok, but I think we might finally have cracked the arrow behavior. It seems perfect to me now, better than the original Plectica and better than any whiteboarding app I have ever tried!

**T4-06: Relationship labels during push mode**
Relationship labels should move along with their endpoint cards when pushed by push mode.
- **Fixed:** Architectural refactor — label positions changed from absolute canvas coordinates to midpoint-relative offsets {dx, dy}. Labels now derive their absolute position at render time (midpoint + offset), eliminating the entire class of label-drift bugs. ~90 lines of manual label-shifting code deleted. Net -53 lines.
- Tests:
  - 1. Relationship labels move along with their endpoint cards when pushed by push mode
    1. Yes, but something is not right with the calculation, now the label moves *too much*. So if the parent card is being pushed downwards, the label also moves downwards, but a bit too much. The same for each of the other directions. This seems like a code smell to me, shouldn't this calculation behave exactly the same way as the other ones?
    2. Still the same problem. The other tests are still ok, but the labels still move too much. This fix also broke simple dragging. On mouse-down, the cursor turns into a "forbidden sign" and the card starts to move when I *release* the mouse button. We must revert this fix and find another solution. I didn't like the ref solution from the beginning.
    3. Ok, dragging works again, but the labels still drift.
    4. Hm, something is off. It seems like the *pushed* cards now work as expected, the labels stay in place and snap back on mouse-up. But the card being dragged (the *pusher*) now has started to have its labels shift. This shouldn't be possible, no change we have done should have affected the behavior of dragged cards.
    5. Still problems with the pushing card. The mor

**T4-07: Relationship labels during fit-to-contents**
Relationship labels should move along with their endpoint cards when fit-to-contents shifts children (double-click parent reset).
- **Fixed:** Part of the midpoint-relative offset architectural refactor (see T4-06).
- Tests:
  - 1. Relationship labels move along with their endpoint cards when fit-to-contents shifts children (double-click parent reset) - OK!
    1. Works great, label stays perfectly in place.

**T4-08: Push buffer margin**
Cards should maintain a 24px gap after push (not edge-to-edge). Applies to Shift+drag, resize push, and drop-push.
- **Fixed:** `resolvePush` inflates mover bounding box by PADDING before computing overlap penetration, achieving smooth continuous gap without oscillation.
- Tests:
  - 1. Shift+drag push leaves a ~24px gap between cards (not edge-to-edge) - OK!
    1. Technically working, but very jerky, the cards being pushed are "bouncing along". Something is wrong here, it should be as smooth as when a child pushes out its parents edge, there is a buffer there as well, so it shouldn't affect the smoothness. Is the same code not being utilized?
    2. Now working perfectly!
  - 2. Resizing a card into a sibling also produces a buffer gap (not edge-to-edge) - OK!
    1. Yes, but the same jerkyness as issue 17.
    2. Now working!

**T4-09: No-overlap on drop / drop-push**
Dropping a card into a parent with existing children should reuse push-mode to resolve overlaps. Biggest-overlap sibling pushes the dropped card away. Parent resize cascades up via applyPushMode.
- **Fixed:** New `applyDropPush` function resolves drop overlaps. `resolvePush` extracted to module scope with inflated mover rect for smooth 24px buffer. NEST branch now calls `applyPushMode` for full cascade. Dead code removed (`STACK_GAP`, `computeStackedPosition`).
- Tests:
  - 1. Dropping a card into a parent with existing children pushes the dropped card away from overlapping siblings (with gap) - OK!
  - 2. Dropping a card overlapping multiple children resolves against the one with the biggest overlap - OK!
  - 3. Parent auto-resizes to fit all children after drop-push - OK!
    1. The parent auto-resizes, but it is not cascading. When the parent expands, adjacent cards to that parent is not being pushed in turn. This makes me afraid that push-mode isn't really a mode that can be applied, but random code spread around the codebase for different situations. If this utilized proper push-mode, then the cascading pushes would just have worked. When I say that we should use push-mode, I mean it literally, not to write something "like" it.
    2. Now working!
  - 4. Drop-push respects PADDING from the parent edge (card doesn't escape the parent) - OK!

**T4-10: Remove auto-shrink / grow-only**
All cards now behave the same — grow to fit children, never auto-shrink. Explicit shrink via double-click fit-to-contents only. minWidth/minHeight tracking removed from frontend.
- **Fixed:** `autoResizeParent` is now grow-only (uses current size as floor). Removed `minWidth`/`minHeight` from CardData, all canvas handlers, IPC layer. Removed fitToContents call on empty-parent drop. DB columns left inert (migration pending).
- Tests:
  - 1. Parents grow to fit children but never auto-shrink (all cards behave the same regardless of manual resize history) - OK!
    1. With one exception, dropping a card into a empty card that is bigger, will auto-shrink the new parent.
    2. Now working!
  - 2. Double-click fit-to-contents still shrinks parent to fit children - OK!
  - 3. Shift+drag push causes parent to grow — parent stays grown after releasing Shift - OK!
  - 4. Typing a long title grows the card — card does NOT shrink when shortening the text (until double-click reset) - OK!
  - 5. Drop-push into parent — parent grows if needed — stays at new size - OK!

**T4-11: Manual resize**
Manual resize still works and size persists.
- **Fixed:** Part of the grow-only refactor (see T4-10).
- Tests:
  - 1. Manual resize still works and size persists - OK!

**T4-12: DB schema cleanup**
Dropped min_width/min_height columns from layout table, removed from Rust struct/commands/SQL, cleaned frontend IPC.
- **Fixed:** Idempotent DROP COLUMN migration in db.rs. Removed from NodeWithLayout struct, all SQL queries, all command signatures. Frontend IPC no longer passes null params.

**T4-13: Unified drop-push and cascade bug fix**
All card drops (same-parent and new-parent) now resolve overlaps via applyDropPush + applyPushMode. Same code path, same behavior everywhere. Pushed siblings no longer escape their parent (root cause: autoResizeParent sized all ancestors before pushCascade ran, freezing heights before siblings moved).
- **Fixed:** Layout-only drag path now calls applyDropPush → applyPushMode for nested cards. Added dropPushChanged detection for state updates. Extracted resizeOneParent from autoResizeParent. Rewrote applyPushMode Phase 2 to interleave resize + push at each ancestor level. Each resize now sees post-push sibling positions from the level below.
- Tests:
  - 1. Cascade: A has children C, D. B below A. Drop card into C → C grows → D pushed → A grows → B pushed (no escaping) - OK!
  - 2. Same-parent drop: move card within parent, drop on sibling → pushed away with gap - OK!
  - 3. Same-parent cascade: same as above, parent grows → parent's siblings get pushed - OK!
  - 4. Resize cascade still works: resize C downward → D pushed → A grows → B pushed - OK!
  - 5. Title expand in nested card → cascade propagates upward correctly - OK!
  - 6. Root-level drop: cards without a parent — no push, just normal move - OK!
  - 7. Shift+drag still smooth with 20px gap (no regression) - OK!

**T4-14: Normal double-click**
Normal double-click (no Shift) still works as before — fits one card only.
- Tests:
  - 1. Normal double-click (no Shift) still works as before — fits one card only - OK!

**T4-15: Shift+double-click cascading fit-to-contents**
Shift+double-click on any card does the normal reset, then cascades fitToContents upward through all ancestors.
- **Fixed:** Pass shiftKey from Card.tsx through to handleResetSize. Walk ancestor chain calling fitToContents at each level. Leaf branch refactored to synchronous pre-computation for proper persist.
- Tests:
  - 1. Shift+double-click on leaf card → resets leaf to title width, then each ancestor shrinks to fit - OK!
  - 2. Shift+double-click on parent card → fitToContents on that parent, then each ancestor shrinks - OK!
  - 3. Shift+double-click on root card → fits that card only (no ancestors) - OK!
  - 4. Shift+double-click deeply nested (3+ levels) → all ancestor levels tighten up in one action - OK!

**T4-16: Revised "New card" handling**
Pressing "c" creates a card attached to the mouse pointer that follows the cursor (like a drag). Click to drop, reusing the exact same drag/drop/push/nest logic. Escape cancels. Title enters edit mode after drop.
- **Fixed:** Extracted `performDrop` from mouseup into a shared callback. "c" key handler creates card in DB, sets `dragState` with `offsetX/offsetY: 0`, and sets `placementCardIdRef`. `onMouseDownCapture` intercepts the click to trigger `performDrop` + `setNewCardId`. Escape deletes the card from state and DB.
- Tests:
  - 1. Press "c" → card appears at cursor (top-left), follows mouse movement - OK!
  - 2. During placement, hover over a card → nest target highlights - OK!
  - 3. Click to drop → card drops with push/nest logic, title enters edit mode - OK!
  - 4. Press "c" then Escape → card disappears, no leftover DB record - OK!
  - 5. Press "c", hover over parent with children, click → drop-push resolves overlaps - OK!
  - 6. Double-click on canvas → still creates card instantly (no placement drag) - OK!
  - 7. Normal drag/drop → no regression from placement mode changes - OK!

**T4-17: Revised "New relationship" handling**
Pressing "r" or "l" activates connecting mode (crosshair cursor everywhere). Mouse-down on a card starts the connection from that card, mouse-up on another card completes it. Same logic as anchor-point click-drag, fully reused.
- **Fixed:** Added `connectingMode` state + "r"/"l" key handler. Extracted `findCardAtPoint` helper from inline hit-test (shared by mouseup target detection and mousedown source detection). `onMouseDownCapture` intercepts click to call `handleConnectStart`. Crosshair cursor propagated to Card.tsx via `isConnecting` prop. Escape cancels.
- Tests:
  - 1. Press "r" → cursor turns to crosshair - OK!
    1. Only when over the canvas. When over cards, the hand cursor still shows.
    2. All ok now!
  - 2. Click on a card → dashed line starts from card center, follows cursor - OK!
  - 3. Release on another card → relationship created, label editor opens - OK!
  - 4. Release on empty canvas → connection cancelled - OK!
  - 5. Press "l" → same behavior as "r" - OK!
  - 6. Press "r" then Escape → mode cancelled, cursor returns to normal - OK!
  - 7. Press "r" then click on empty canvas (no card) → mode cancelled - OK!
  - 8. Existing anchor-point click-drag still works as before - OK!
  - 9. No regression on card drag, placement mode, or other interactions - OK!

**T4-18: Restructure task tracking files**
Rename "requirements" files to "tasks", reorganize format with IDs, indent test cases under each task, split compound tasks into separate entries.
- **Fixed:** git mv to rename files, restructured M3 and M4 into new format with T3-XX and T4-XX IDs.
