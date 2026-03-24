# M2 UX Decisions

**Author:** Wren (Canvas/Whiteboard App Developer)
**Date:** 2026-03-24
**Status:** RESOLVED -- all four questions answered before NESTING_ENABLED activation

---

## Decisions

| Q# | Question | Decision | DSRP Status |
|---|---|---|---|
| Q6 | What happens when a parent card is too small to show children? | `autoResizeParent` enforces a minimum parent size that always contains all children with padding. A count badge `(N)` appears in the parent header when children exist. No collapse interaction. Children are never hidden. | DSRP non-negotiable: hiding children would misrepresent the system boundary. A "Bicycle" card that contains "Wheels" must always visually contain "Wheels". |
| Q7 | What auto-layout algorithm for children inside a parent? | Manual positioning only. When a card is first dropped into a parent, it lands at its converted local coordinates. If that position overlaps an existing sibling, `normalizeChildPositions` shifts it to avoid negative-coordinate clipping. No grid, flow, or force-directed auto-arrangement. | Neutral -- DSRP does not prescribe spatial arrangement of parts within a system. Free positioning lets the user express their own mental model of the system's internal structure. |
| Q8 | Zoom-into-card (navigate) vs. zoom camera (magnify)? | Camera zoom only for M2. The breadcrumb shows the real ancestor chain of the selected card so the user knows where they are in the hierarchy. Zoom-into-card (enter/exit navigation, per-card viewport) is deferred to M3. The breadcrumb is wired correctly now so M3 can use it without rework. | Camera zoom is DSRP-compatible. Zoom-into-card better reinforces the fractal/recursive nature of Systems (each card IS its own system and can be navigated into as a canvas). This is a strong M3 motivation -- defer but do not abandon. |
| Q9 | Where does a card snap when unnested? | The card drops at its absolute canvas position at the moment of release, converted to top-level coordinates via `getAbsolutePosition`. No snapping, no forced proximity to former parent, no grid alignment. The card ends up exactly where the user let go of it. | Correct -- the user chose where to put the card. Forcing it to snap elsewhere would override their spatial intent. |

---

## Implementation Notes

**Q6 -- minimum parent size:**
`autoResizeParent` computes `neededW = max(MIN_W, maxRight + PADDING)` and `neededH = max(MIN_H, maxBottom + PADDING + HEADER_HEIGHT)`. This is called on every nest, unnest, and child move. The parent can never be smaller than its children require.

**Q7 -- collision nudge:**
On nest, the card's local position is computed via `canvasToLocal`. If the result has `x < PADDING` or `y < PADDING`, it is clamped to `PADDING`. `normalizeChildPositions` is called after nesting to shift any overlapping siblings. This is lightweight and preserves the user's relative drop position.

**Q8 -- breadcrumb:**
The breadcrumb bar walks the `parentId` chain of the selected card upward through the in-memory `Map<number, CardData>`. It renders as `Canvas > Parent Label > Child Label`. This is a display element only in M2 -- clicking breadcrumb segments does not navigate. Navigation is M3.

**Q9 -- unnest position:**
On unnest, `getAbsolutePosition` returns the card's absolute canvas position at the instant of mouse-up. This is converted to root-level coordinates via `canvasToLocal(cards, abs.x, abs.y, grandparentId)` where `grandparentId` may be `null` (top-level) or the grandparent card (one level up). The card's `parentId` becomes `grandparentId`.
