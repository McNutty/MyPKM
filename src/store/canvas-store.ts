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

export const PADDING = 16
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

    const neededW = Math.max(MIN_W, maxRight + PADDING)
    const neededH = Math.max(MIN_H, maxBottom + PADDING + HEADER_HEIGHT)

    const newW = Math.max(MIN_W, neededW)
    const newH = Math.max(MIN_H, neededH)

    if (newW !== parent.width || newH !== parent.height) {
      updated.set(currentParentId, { ...parent, width: newW, height: newH })
    }

    currentParentId = parent.parentId
  }

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
