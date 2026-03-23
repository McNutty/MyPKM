/**
 * Canvas state store.
 *
 * Simple React state management -- no external state library needed for a prototype.
 * In the real app this would be backed by SQLite via Tauri IPC.
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

import { CardData } from './types'

const PADDING = 16
const HEADER_HEIGHT = 28
const MIN_W = 100
const MIN_H = 50

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

/** Get all direct children of a card */
export function getChildren(cards: Map<string, CardData>, parentId: string): CardData[] {
  const result: CardData[] = []
  for (const card of cards.values()) {
    if (card.parentId === parentId) result.push(card)
  }
  return result
}

/** Get all descendants of a card (recursive) */
export function getDescendants(cards: Map<string, CardData>, parentId: string): CardData[] {
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
  cards: Map<string, CardData>,
  cardId: string,
  candidateAncestor: string
): boolean {
  let current = cards.get(cardId)
  while (current && current.parentId) {
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
  cards: Map<string, CardData>,
  cardId: string
): Map<string, CardData> {
  const card = cards.get(cardId)
  if (!card || !card.parentId) return cards

  return autoResizeParent(cards, card.parentId)
}

export function autoResizeParent(
  cards: Map<string, CardData>,
  parentId: string
): Map<string, CardData> {
  let updated = new Map(cards)
  let currentParentId: string | null = parentId

  // Walk up the parent chain
  while (currentParentId) {
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
      maxRight = Math.max(maxRight, child.x + child.w)
      maxBottom = Math.max(maxBottom, child.y + child.h)
    }

    const neededW = Math.max(MIN_W, maxRight + PADDING)
    const neededH = Math.max(MIN_H, maxBottom + PADDING + HEADER_HEIGHT)

    // Only expand, never shrink below needed size
    // But DO shrink if current size is larger than needed (bidirectional)
    const newW = Math.max(MIN_W, neededW)
    const newH = Math.max(MIN_H, neededH)

    if (newW !== parent.w || newH !== parent.h) {
      updated.set(currentParentId, { ...parent, w: newW, h: newH })
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
  cards: Map<string, CardData>,
  parentId: string
): Map<string, CardData> {
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
  cards: Map<string, CardData>,
  cardId: string
): { x: number; y: number } {
  let x = 0
  let y = 0
  let current = cards.get(cardId)

  while (current) {
    x += current.x
    y += current.y
    if (current.parentId) {
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
  cards: Map<string, CardData>,
  canvasX: number,
  canvasY: number,
  targetParentId: string | null
): { x: number; y: number } {
  if (!targetParentId) return { x: canvasX, y: canvasY }

  // Get the absolute position of the parent's content area origin
  const parentAbs = getAbsolutePosition(cards, targetParentId)
  const parent = cards.get(targetParentId)
  if (!parent) return { x: canvasX, y: canvasY }

  return {
    x: canvasX - parentAbs.x,
    y: canvasY - parentAbs.y - HEADER_HEIGHT,
  }
}

// ============================================================================
// SEED DATA
// ============================================================================

let nextId = 1
function makeId(): string {
  return `card-${nextId++}`
}

export function createSeedData(): Map<string, CardData> {
  const cards = new Map<string, CardData>()

  function addCard(
    label: string,
    parentId: string | null,
    x: number,
    y: number,
    w: number,
    h: number,
    depth: number
  ): string {
    const id = makeId()
    cards.set(id, {
      id,
      label,
      x,
      y,
      w,
      h,
      parentId,
      depth,
      color: getDepthColor(depth),
    })
    return id
  }

  // Level 0: Bicycle
  const bicycle = addCard('Bicycle', null, 50, 50, 950, 700, 0)

  // Level 1
  const frame = addCard('Frame', bicycle, PADDING, PADDING, 200, 200, 1)
  const wheels = addCard('Wheels', bicycle, 230, PADDING, 450, 620, 1)
  const drivetrain = addCard('Drivetrain', bicycle, 700, PADDING, 220, 300, 1)
  const brakes = addCard('Brakes', bicycle, 700, 340, 220, 180, 1)

  // Level 2: Frame parts
  const frameParts = ['Top Tube', 'Down Tube', 'Seat Tube', 'Head Tube']
  frameParts.forEach((name, i) => {
    addCard(name, frame, PADDING, PADDING + i * 38, 168, 30, 2)
  })

  // Level 2: Wheels
  const frontWheel = addCard('Front Wheel', wheels, PADDING, PADDING, 410, 270, 2)
  const rearWheel = addCard('Rear Wheel', wheels, PADDING, 310, 410, 270, 2)

  // Level 3: Front Wheel parts
  const tire = addCard('Tire', frontWheel, PADDING, PADDING, 180, 100, 3)
  const rim = addCard('Rim', frontWheel, 210, PADDING, 180, 100, 3)
  const spokes = addCard('Spokes', frontWheel, PADDING, 130, 180, 100, 3)
  const hub = addCard('Hub', frontWheel, 210, 130, 180, 100, 3)

  // Level 4: Hub parts (5th level!)
  addCard('Axle', hub, PADDING, PADDING, 70, 30, 4)
  addCard('Bearings', hub, 100, PADDING, 70, 30, 4)
  addCard('Seal', hub, PADDING, 55, 70, 30, 4)

  // Level 3: Rear Wheel parts
  const rwParts = ['Tire', 'Rim', 'Spokes', 'Hub', 'Freewheel']
  rwParts.forEach((name, i) => {
    addCard(name, rearWheel, PADDING + (i % 3) * 130, PADDING + Math.floor(i / 3) * 120, 120, 100, 3)
  })

  // Level 2: Drivetrain parts
  const driveParts = ['Chain', 'Pedals', 'Crankset', 'Cassette', 'Derailleur']
  driveParts.forEach((name, i) => {
    addCard(name, drivetrain, PADDING, PADDING + i * 50, 188, 40, 2)
  })

  // Level 2: Brakes parts
  const brakeParts = ['Lever', 'Cable', 'Caliper', 'Pads']
  brakeParts.forEach((name, i) => {
    addCard(name, brakes, PADDING, PADDING + i * 35, 188, 28, 2)
  })

  // Standalone cards for drag-to-nest testing
  const extras = [
    'Handlebar', 'Seat', 'Kickstand', 'Bell', 'Reflector',
    'Light', 'Fender', 'Rack', 'Lock', 'Pump',
  ]
  extras.forEach((name, i) => {
    addCard(
      name,
      null,
      1100 + (i % 2) * 170,
      50 + Math.floor(i / 2) * 70,
      140,
      50,
      0
    )
  })

  return cards
}

export { PADDING, HEADER_HEIGHT, MIN_W, MIN_H }
