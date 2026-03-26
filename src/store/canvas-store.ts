/**
 * Canvas state utilities for Plectica 2.0.
 *
 * Pure utility functions only -- no React state, no side effects.
 * All functions accept and return immutable-style Map<number, CardData>.
 *
 * KEY ALGORITHM: Auto-resize propagation
 * =======================================
 * When any card changes size or position, we must check whether its parent
 * still contains it. If not, the parent must grow. This propagates upward
 * recursively: parent grows -> grandparent must check -> etc.
 *
 * The algorithm:
 * 1. Compute the bounding box of all children of the parent
 * 2. Add padding
 * 3. If the bounding box exceeds the parent's current size, expand the parent
 * 4. Recurse to the parent's parent
 *
 * This is O(depth) per change, which is fine for any reasonable nesting depth.
 */

import type { CardData } from './types'
import type { NodeWithLayout } from '../ipc'

export const PADDING = 24
export const BOTTOM_PADDING = 20  // Extra bottom buffer so children never clip the parent border
export const HEADER_HEIGHT = 28
export const MIN_W = 100
export const MIN_H = 50

const DEPTH_COLORS = [
  '#e3f2fd', // Level 0 - light blue
  '#f3e5f5', // Level 1 - light purple
  '#e8f5e9', // Level 2 - light green
  '#fff3e0', // Level 3 - light orange
  '#fce4ec', // Level 4 - light pink
  '#e0f7fa', // Level 5+ - light cyan
]

export function getDepthColor(depth: number): string {
  return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)]
}

/**
 * Map a DB NodeWithLayout record to a CardData for the canvas.
 * Depth is supplied as a parameter -- use `computeDepths` after building
 * the full Map to get accurate values. Defaults to 0 for callers that
 * are creating brand-new top-level cards (e.g. handleDoubleClick).
 */
export function nodeWithLayoutToCardData(node: NodeWithLayout, depth = 0): CardData {
  return {
    id: node.id,
    content: node.content,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    parentId: node.parent_id,
    depth,
    color: getDepthColor(depth),
  }
}

/**
 * Compute the correct depth for every card in the map and return a new Map
 * with depth and color fields populated.
 *
 * Algorithm: one-pass walk. We maintain a worklist seeded with root cards
 * (parentId === null, depth = 0). For each card we pop, we set its depth,
 * then push its children. This is BFS and handles arbitrary node ordering
 * from the DB -- it does not matter whether parents arrive before children
 * in the raw NodeWithLayout array.
 *
 * This runs once at load time (called from App.tsx after building the
 * initial Map) and must also be called after any nest/unnest operation
 * that changes parentId relationships.
 */
export function computeDepths(cards: Map<number, CardData>): Map<number, CardData> {
  const updated = new Map(cards)

  // Build a children index so we can iterate children efficiently.
  const childrenOf = new Map<number, number[]>()
  for (const card of updated.values()) {
    if (card.parentId !== null) {
      const siblings = childrenOf.get(card.parentId)
      if (siblings) {
        siblings.push(card.id)
      } else {
        childrenOf.set(card.parentId, [card.id])
      }
    }
  }

  // BFS from roots (parentId === null).
  const queue: Array<{ id: number; depth: number }> = []
  for (const card of updated.values()) {
    if (card.parentId === null) {
      queue.push({ id: card.id, depth: 0 })
    }
  }

  while (queue.length > 0) {
    const { id, depth } = queue.shift()!
    const card = updated.get(id)
    if (!card) continue

    if (card.depth !== depth || card.color !== getDepthColor(depth)) {
      updated.set(id, { ...card, depth, color: getDepthColor(depth) })
    }

    const children = childrenOf.get(id)
    if (children) {
      for (const childId of children) {
        queue.push({ id: childId, depth: depth + 1 })
      }
    }
  }

  return updated
}

/**
 * Update depths for a card and all its descendants in-place on an existing Map.
 * Call this after a nest or unnest changes a card's depth so that the entire
 * subtree gets correct depth colors without a full recompute.
 *
 * This is the extracted, shared version of the inline `updateDescendantDepths`
 * closures that existed in the M1 nesting stubs.
 */
export function updateDescendantDepths(
  cards: Map<number, CardData>,
  rootId: number,
  rootDepth: number
): Map<number, CardData> {
  const updated = new Map(cards)
  const root = updated.get(rootId)
  if (!root) return cards

  updated.set(rootId, { ...root, depth: rootDepth, color: getDepthColor(rootDepth) })

  // Recurse into children.
  const recurse = (parentId: number, parentDepth: number) => {
    for (const [id, card] of updated) {
      if (card.parentId === parentId) {
        const d = parentDepth + 1
        updated.set(id, { ...card, depth: d, color: getDepthColor(d) })
        recurse(id, d)
      }
    }
  }
  recurse(rootId, rootDepth)

  return updated
}

/** Get all direct children of a card */
export function getChildren(cards: Map<number, CardData>, parentId: number): CardData[] {
  const result: CardData[] = []
  for (const card of cards.values()) {
    if (card.parentId === parentId) result.push(card)
  }
  return result
}

/** Get all descendants of a card (recursive) */
export function getDescendants(cards: Map<number, CardData>, parentId: number): CardData[] {
  const result: CardData[] = []
  for (const card of cards.values()) {
    if (card.parentId === parentId) {
      result.push(card)
      result.push(...getDescendants(cards, card.id))
    }
  }
  return result
}

/** Check if candidateAncestor is an ancestor of cardId */
export function isAncestor(
  cards: Map<number, CardData>,
  cardId: number,
  candidateAncestor: number
): boolean {
  let current = cards.get(cardId)
  while (current && current.parentId !== null) {
    if (current.parentId === candidateAncestor) return true
    current = cards.get(current.parentId)
  }
  return false
}

/**
 * Auto-resize a card to contain all its children, then propagate upward.
 * Returns a new Map with all affected cards updated.
 */
export function autoResizeFromCard(
  cards: Map<number, CardData>,
  cardId: number
): Map<number, CardData> {
  const card = cards.get(cardId)
  if (!card || card.parentId === null) return cards
  return autoResizeParent(cards, card.parentId)
}

export function autoResizeParent(
  cards: Map<number, CardData>,
  parentId: number
): Map<number, CardData> {
  let updated = new Map(cards)
  let currentParentId: number | null = parentId

  // Walk up the parent chain
  while (currentParentId !== null) {
    const parent = updated.get(currentParentId)
    if (!parent) break

    const children = getChildren(updated, currentParentId)
    if (children.length === 0) {
      currentParentId = parent.parentId
      continue
    }

    // Compute bounding box of children
    let maxRight = 0
    let maxBottom = 0

    for (const child of children) {
      maxRight = Math.max(maxRight, child.x + child.width)
      maxBottom = Math.max(maxBottom, child.y + child.height)
    }

    // Grow-only: use the card's current size as the floor.
    // autoResizeParent never shrinks a card -- only expands it to contain children.
    // Users explicitly shrink via double-click fit-to-contents.
    const neededW = Math.max(parent.width, maxRight + PADDING)
    const neededH = Math.max(parent.height, HEADER_HEIGHT + maxBottom + BOTTOM_PADDING)

    const newW = neededW
    const newH = neededH

    if (newW !== parent.width || newH !== parent.height) {
      updated.set(currentParentId, { ...parent, width: newW, height: newH })
    }

    currentParentId = parent.parentId
  }

  return updated
}

/**
 * Fit a parent card tightly around its children with equal margins on all four
 * sides. The margin on every side is PADDING (same as the right/bottom margin
 * that autoResizeParent would produce after an expansion).
 *
 * Algorithm:
 * 1. Find the bounding box of all direct children (local coords).
 * 2. Shift every child so that the top-left of the bounding box sits at
 *    (PADDING, PADDING) inside the parent's content area.  All children
 *    shift by the same delta, preserving their relative layout.
 * 3. Resize the parent to: width = contentW + 2*PADDING,
 *    height = HEADER_HEIGHT + contentH + 2*PADDING.
 *
 * Returns the updated Map.  Does nothing if the parent has no children.
 */
export function fitToContents(
  cards: Map<number, CardData>,
  parentId: number
): Map<number, CardData> {
  const parent = cards.get(parentId)
  if (!parent) return cards

  const children = getChildren(cards, parentId)
  if (children.length === 0) return cards

  // Step 1: bounding box in parent-local content-area coordinates.
  let minX = Infinity
  let minY = Infinity
  let maxRight = -Infinity
  let maxBottom = -Infinity
  for (const child of children) {
    minX = Math.min(minX, child.x)
    minY = Math.min(minY, child.y)
    maxRight = Math.max(maxRight, child.x + child.width)
    maxBottom = Math.max(maxBottom, child.y + child.height)
  }

  const contentW = maxRight - minX
  const contentH = maxBottom - minY

  // Step 2: shift delta so content box top-left lands at (PADDING, PADDING).
  const dx = PADDING - minX
  const dy = PADDING - minY

  const updated = new Map(cards)

  if (dx !== 0 || dy !== 0) {
    for (const child of children) {
      updated.set(child.id, { ...child, x: child.x + dx, y: child.y + dy })
    }
  }

  // Step 3: resize parent to equal-margin fit.
  const newW = Math.max(MIN_W, contentW + 2 * PADDING)
  const newH = Math.max(MIN_H, HEADER_HEIGHT + contentH + 2 * PADDING)
  updated.set(parentId, { ...parent, width: newW, height: newH })

  return updated
}

/**
 * Ensure all children have positive coordinates within their parent's content area.
 * If any child has been dragged to a negative position, shift all children and
 * potentially expand the parent.
 */
export function normalizeChildPositions(
  cards: Map<number, CardData>,
  parentId: number
): Map<number, CardData> {
  const children = getChildren(cards, parentId)
  if (children.length === 0) return cards

  let minX = Infinity
  let minY = Infinity
  for (const child of children) {
    minX = Math.min(minX, child.x)
    minY = Math.min(minY, child.y)
  }

  if (minX >= PADDING && minY >= PADDING) return cards // All positions are fine

  const dx = minX < PADDING ? PADDING - minX : 0
  const dy = minY < PADDING ? PADDING - minY : 0

  const updated = new Map(cards)
  for (const child of children) {
    updated.set(child.id, { ...child, x: child.x + dx, y: child.y + dy })
  }

  return updated
}

/**
 * Compute the absolute (canvas-space) position of a card by walking up the
 * parent chain. Used for coordinate conversion.
 */
export function getAbsolutePosition(
  cards: Map<number, CardData>,
  cardId: number
): { x: number; y: number } {
  let x = 0
  let y = 0
  let current = cards.get(cardId)

  while (current) {
    x += current.x
    y += current.y
    if (current.parentId !== null) {
      // Add the parent's content area offset (header)
      y += HEADER_HEIGHT
      current = cards.get(current.parentId)
    } else {
      break
    }
  }

  return { x, y }
}


/**
 * Return the absolute canvas-space center point of a card, accounting for the
 * header height offset that the content area introduces.
 */
export function getAbsoluteCenter(
  cards: Map<number, CardData>,
  cardId: number
): { x: number; y: number } {
  const card = cards.get(cardId)
  if (!card) return { x: 0, y: 0 }
  const abs = getAbsolutePosition(cards, cardId)
  return {
    x: abs.x + card.width / 2,
    y: abs.y + card.height / 2,
  }
}

/**
 * Given two centers (source and target), compute where the line from center1
 * toward center2 intersects the axis-aligned boundary rectangle of the card
 * at center1. Returns the edge intersection point for clean edge-to-edge lines.
 *
 * cardRect is { x, y, w, h } in absolute canvas coordinates (top-left origin).
 */
export function computeEdgePoint(
  center1: { x: number; y: number },
  center2: { x: number; y: number },
  cardRect: { x: number; y: number; w: number; h: number }
): { x: number; y: number } {
  const dx = center2.x - center1.x
  const dy = center2.y - center1.y

  // Same-center guard: return center if source === target
  if (dx === 0 && dy === 0) return { x: center1.x, y: center1.y }

  // Half-dimensions
  const hw = cardRect.w / 2
  const hh = cardRect.h / 2

  // Find parametric t where the ray from center1 hits the rectangle edge.
  // We intersect with all four edges and take the smallest positive t.
  const candidates: number[] = []
  if (dx !== 0) {
    candidates.push((cardRect.x + cardRect.w - center1.x) / dx) // right edge
    candidates.push((cardRect.x - center1.x) / dx)               // left edge
  }
  if (dy !== 0) {
    candidates.push((cardRect.y + cardRect.h - center1.y) / dy)  // bottom edge
    candidates.push((cardRect.y - center1.y) / dy)               // top edge
  }

  // We want the smallest t that is > 0 and places us inside the rectangle bounds.
  let best = Infinity
  for (const t of candidates) {
    if (t <= 0) continue
    const ix = center1.x + dx * t
    const iy = center1.y + dy * t
    // Check the point lies on the rectangle boundary (with tiny epsilon for float safety)
    const eps = 0.5
    const onBounds =
      ix >= cardRect.x - eps && ix <= cardRect.x + cardRect.w + eps &&
      iy >= cardRect.y - eps && iy <= cardRect.y + cardRect.h + eps
    if (onBounds && t < best) best = t
  }

  if (!isFinite(best)) {
    // Fallback: return center (shouldn't happen for normal cards)
    return { x: center1.x, y: center1.y }
  }

  return { x: center1.x + dx * best, y: center1.y + dy * best }
}

/**
 * Min-penetration collision: push `sibling` out of `mover` along the axis
 * with the smallest overlap, adding a PADDING gap so cards land with breathing
 * room rather than edge-to-edge. Returns new {x, y} for sibling, or null if
 * there is no overlap.
 *
 * Internal helper -- not exported. Used by both applyPushMode and applyDropPush.
 */
function resolvePush(mover: CardData, sibling: CardData): { x: number; y: number } | null {
  // Inflate the mover's bounding box by PADDING on all four sides before
  // computing penetration. This guarantees a PADDING-wide gap at rest while
  // pushing by only the raw penetration amount -- no overshoot, no oscillation.
  const mL = mover.x - PADDING
  const mR = mover.x + mover.width + PADDING
  const mT = mover.y - PADDING
  const mB = mover.y + mover.height + PADDING

  const penR = mR - sibling.x
  const penL = (sibling.x + sibling.width) - mL
  const penD = mB - sibling.y
  const penU = (sibling.y + sibling.height) - mT

  if (penR <= 0 || penL <= 0 || penD <= 0 || penU <= 0) return null

  const minX = Math.min(penR, penL)
  const minY = Math.min(penD, penU)

  if (minX <= minY) {
    // Push by raw penetration -- no extra + PADDING (gap is baked into inflation)
    const pushX = penR <= penL ? penR : -penL
    return { x: sibling.x + pushX, y: sibling.y }
  } else {
    const pushY = penD <= penU ? penD : -penU
    return { x: sibling.x, y: sibling.y + pushY }
  }
}

/**
 * Push-mode: when Shift is held during drag, the dragged card pushes its
 * siblings out of the way using pure min-penetration collision resolution.
 *
 * Algorithm:
 * 1. The dragged card is already at its new position in the map.
 * 2. Find siblings that overlap the dragged card, resolve each with
 *    min-penetration (push along the axis with smaller overlap).
 * 3. Cascade: pushed siblings may now overlap other siblings. Repeat
 *    until no overlaps remain (max 20 iterations for safety).
 * 4. Auto-resize the immediate parent; set its size floor.
 * 5. Walk up ancestors: if an ancestor now overlaps its own siblings
 *    after growing, push them with the same min-penetration logic.
 *
 * No drag direction. Pure min-penetration everywhere.
 */
export function applyPushMode(
  cards: Map<number, CardData>,
  draggedId: number,
  _prevAbsX: number,
  _prevAbsY: number,
  _newAbsX: number,
  _newAbsY: number,
): Map<number, CardData> {
  const dragged = cards.get(draggedId)
  if (!dragged) return cards

  let updated = new Map(cards)

  // ---------------------------------------------------------------------------
  // Push cascade at one nesting level: starting from `moverId`, push all
  // overlapping siblings, then cascade until stable (max 20 iterations).
  // ---------------------------------------------------------------------------
  function pushCascade(state: Map<number, CardData>, moverId: number): Map<number, CardData> {
    const result = new Map(state)
    const moverCard = result.get(moverId)
    if (!moverCard) return result

    const parentId = moverCard.parentId
    const visited = new Set<number>([moverId])
    const queue = [moverId]
    let iterations = 0

    while (queue.length > 0 && iterations++ < 20) {
      const currentId = queue.shift()!
      const current = result.get(currentId)
      if (!current) continue

      for (const [id, card] of result) {
        if (id === currentId || card.parentId !== parentId) continue
        const resolved = resolvePush(current, card)
        if (!resolved) continue

        // Only clamp nested cards to PADDING (keeps them inside parent content area).
        // Root-level cards (parentId === null) can be at any canvas position.
        const clampedX = parentId !== null ? Math.max(PADDING, resolved.x) : resolved.x
        const clampedY = parentId !== null ? Math.max(PADDING, resolved.y) : resolved.y
        result.set(id, { ...card, x: clampedX, y: clampedY })

        if (!visited.has(id)) {
          visited.add(id)
          queue.push(id)
        }
      }
    }

    return result
  }

  // ---------------------------------------------------------------------------
  // Phase 1: push siblings of the dragged card
  // ---------------------------------------------------------------------------
  updated = pushCascade(updated, draggedId)

  // ---------------------------------------------------------------------------
  // Phase 2: auto-resize parent + ancestor push cascade
  // ---------------------------------------------------------------------------
  const card = updated.get(draggedId)
  if (card && card.parentId !== null) {
    const immediateParentId = card.parentId

    // Expand the parent (and ancestors) to contain children.
    // autoResizeParent is already grow-only, so no floor tracking needed.
    updated = autoResizeParent(updated, immediateParentId)

    // Walk up ancestors: if an ancestor grew and now overlaps its siblings,
    // push them. We must visit every ancestor in the chain because
    // autoResizeParent already grew all of them -- each one may independently
    // overlap its own siblings regardless of whether a lower level changed.
    let ancestorId: number | null = immediateParentId
    while (ancestorId !== null) {
      const ancestor = updated.get(ancestorId)
      if (!ancestor) break

      updated = pushCascade(updated, ancestorId)
      ancestorId = ancestor.parentId
    }
  }

  return updated
}

/**
 * Convert a canvas-space position to a position relative to a target parent's
 * content area.
 */
export function canvasToLocal(
  cards: Map<number, CardData>,
  canvasX: number,
  canvasY: number,
  targetParentId: number | null
): { x: number; y: number } {
  if (targetParentId === null) return { x: canvasX, y: canvasY }

  // Get the absolute position of the parent's content area origin
  const parentAbs = getAbsolutePosition(cards, targetParentId)
  const parent = cards.get(targetParentId)
  if (!parent) return { x: canvasX, y: canvasY }

  return {
    x: canvasX - parentAbs.x,
    y: canvasY - parentAbs.y - HEADER_HEIGHT,
  }
}

/**
 * No-overlap on drop: after a card is reparented into a container that already
 * has children, resolve any overlaps between the dropped card and its new
 * siblings. The dropped card moves; existing siblings stay put.
 *
 * This is intentionally the inverse of push-mode: the newcomer is the one that
 * relocates, so existing children are never disturbed by a drop. We achieve
 * this by passing the sibling as the "mover" (fixed reference point) and the
 * dropped card as the "sibling" (the card that gets displaced) in resolvePush.
 *
 * Algorithm:
 * 1. Find the sibling with the largest overlap area with the dropped card.
 * 2. Resolve: the dropped card moves away from that sibling.
 * 3. Clamp the dropped card to PADDING inside its parent content area.
 * 4. Repeat up to 20 iterations until no sibling overlaps remain.
 *
 * Does NOT call autoResizeParent -- that is the caller's responsibility.
 */
export function applyDropPush(
  cards: Map<number, CardData>,
  droppedId: number,
): Map<number, CardData> {
  const dropped = cards.get(droppedId)
  if (!dropped || dropped.parentId === null) return cards

  const parentId = dropped.parentId
  let updated = new Map(cards)

  for (let iteration = 0; iteration < 20; iteration++) {
    const current = updated.get(droppedId)!
    const siblings = Array.from(updated.values()).filter(
      (c) => c.parentId === parentId && c.id !== droppedId
    )

    // Find the sibling with the largest overlap area.
    let biggestSibling: CardData | null = null
    let biggestArea = 0

    for (const sibling of siblings) {
      const overlapW = Math.min(current.x + current.width, sibling.x + sibling.width) - Math.max(current.x, sibling.x)
      const overlapH = Math.min(current.y + current.height, sibling.y + sibling.height) - Math.max(current.y, sibling.y)
      if (overlapW <= 0 || overlapH <= 0) continue
      const area = overlapW * overlapH
      if (area > biggestArea) {
        biggestArea = area
        biggestSibling = sibling
      }
    }

    if (!biggestSibling) break // No overlaps -- done.

    // Sibling is "mover" (fixed), dropped card is "sibling" (moves).
    const resolved = resolvePush(biggestSibling, current)
    if (!resolved) break

    // Clamp to PADDING so the dropped card stays inside the parent content area.
    const clampedX = Math.max(PADDING, resolved.x)
    const clampedY = Math.max(PADDING, resolved.y)
    updated.set(droppedId, { ...current, x: clampedX, y: clampedY })
  }

  return updated
}
