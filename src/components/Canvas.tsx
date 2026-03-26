/**
 * Canvas component -- the infinite canvas / whiteboard surface.
 *
 * Extracted from App.tsx (Pre-2 refactor). Contains ALL canvas-related state,
 * refs, handlers, effects, and rendering. App.tsx is now a thin layout shell
 * that hosts this component alongside the sidebar panels.
 *
 * Props:
 *   mapId           -- which model to display (drives all IPC calls)
 *   selectedCardId  -- lifted to App so the right sidebar can read it
 *   onSelectCard    -- callback when the user selects/deselects a card
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { CardData, CanvasViewport, DragState, ResizeState, RelationshipData, ConnectingState, ReattachState } from '../store/types'
import {
  getAbsolutePosition,
  getAbsoluteCenter,
  canvasToLocal,
  isAncestor,
  autoResizeParent,
  getChildren,
  getDepthColor,
  nodeWithLayoutToCardData,
  computeDepths,
  updateDescendantDepths,
  normalizeChildPositions,
  computeEdgePoint,
  applyPushMode,
  applyDropPush,
  fitToContents,
  PADDING,
  BOTTOM_PADDING,
  HEADER_HEIGHT,
  MIN_W,
  MIN_H,
} from '../store/canvas-store'
import { Card } from './Card'
import { RelationshipOverlay } from './RelationshipLine'
import { db } from '../ipc'

// ============================================================================
// FEATURE FLAGS
// ============================================================================

/** M2: nesting, persistence, and breadcrumb are fully wired */
const NESTING_ENABLED = true

// Pixels the cursor must travel (Manhattan distance) from the mousedown point
// before a card drag is committed. Keeps clicks and double-clicks from
// activating the ghost system, while still feeling instant for real drags.
const DRAG_THRESHOLD = 4

// ============================================================================
// HELPERS (module-level, no React deps)
// ============================================================================

/**
 * Computes the edge-to-edge midpoint for a relationship, in absolute canvas
 * coordinates. Returns null if either card is missing from the map.
 *
 * This is the anchor point for the offset-based label storage: the label's
 * absolute canvas position is always `midpoint + {dx, dy}`.
 */
function computeRelMidpoint(
  cards: Map<number, CardData>,
  rel: RelationshipData,
): { x: number; y: number } | null {
  const srcCard = cards.get(rel.sourceId)
  const tgtCard = cards.get(rel.targetId)
  if (!srcCard || !tgtCard) return null

  const srcAbs = getAbsolutePosition(cards, rel.sourceId)
  const tgtAbs = getAbsolutePosition(cards, rel.targetId)

  const srcCenter = { x: srcAbs.x + srcCard.width / 2, y: srcAbs.y + srcCard.height / 2 }
  const tgtCenter = { x: tgtAbs.x + tgtCard.width / 2, y: tgtAbs.y + tgtCard.height / 2 }

  const edgeStart = computeEdgePoint(srcCenter, tgtCenter, {
    x: srcAbs.x, y: srcAbs.y, w: srcCard.width, h: srcCard.height,
  })
  const edgeEnd = computeEdgePoint(tgtCenter, srcCenter, {
    x: tgtAbs.x, y: tgtAbs.y, w: tgtCard.width, h: tgtCard.height,
  })

  return {
    x: (edgeStart.x + edgeEnd.x) / 2,
    y: (edgeStart.y + edgeEnd.y) / 2,
  }
}

// ============================================================================
// PROPS
// ============================================================================

interface CanvasProps {
  mapId: number
  selectedCardId: number | null
  onSelectCard: (id: number | null) => void
}

// ============================================================================
// CANVAS COMPONENT
// ============================================================================

export const Canvas: React.FC<CanvasProps> = ({ mapId, selectedCardId, onSelectCard }) => {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  const [cards, setCards] = useState<Map<number, CardData>>(new Map())
  const [viewport, setViewport] = useState<CanvasViewport>({
    panX: 0,
    panY: 0,
    zoom: 1.0,
  })
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [newCardId, setNewCardId] = useState<number | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Hover hit-test: ID of the smallest regular card under the cursor.
  // Computed on every mousemove in handleMouseMove (App level) so that nested
  // cards don't all show connection handles simultaneously -- only the topmost
  // (smallest area) card at the cursor position is considered hovered.
  const [hoveredCardId, setHoveredCardId] = useState<number | null>(null)

  // Use the lifted selectedCardId from props, but also maintain a local
  // selectedRelId for relationship selection (not lifted yet).
  const selectedId = selectedCardId
  const setSelectedId = onSelectCard

  // M3: Relationships
  const [relationships, setRelationships] = useState<RelationshipData[]>([])
  const [selectedRelId, setSelectedRelId] = useState<number | null>(null)
  const [connectingState, setConnectingState] = useState<ConnectingState | null>(null)
  // Current mouse position in canvas coordinates, tracked during connection draw
  const [connectingMousePos, setConnectingMousePos] = useState<{ x: number; y: number } | null>(null)
  const [editingRelId, setEditingRelId] = useState<number | null>(null)

  // M3: Re-attach gesture -- dragging an endpoint handle to rewire a relationship
  const [reattachState, setReattachState] = useState<ReattachState | null>(null)
  const [reattachMousePos, setReattachMousePos] = useState<{ x: number; y: number } | null>(null)

  // M3: Relationship card drag state
  // relCardPositions: offset from the computed edge-to-edge midpoint for each
  // relationship label card, keyed by relationship ID. {dx:0, dy:0} means the
  // label sits exactly at the midpoint (the default). Labels automatically
  // follow their endpoints -- no manual shifting needed when cards move.
  const [relCardPositions, setRelCardPositions] = useState<Map<number, { dx: number; dy: number }>>(new Map())
  const [draggingRelCardId, setDraggingRelCardId] = useState<number | null>(null)
  // Offset from the card's center to the mouse position at drag-start, in canvas space
  const [relCardDragOffset, setRelCardDragOffset] = useState<{ x: number; y: number } | null>(null)

  // CF-2: Subtree delete confirmation -- set when the selected card has descendants
  const [deleteConfirm, setDeleteConfirm] = useState<{ cardId: number; descendantCount: number } | null>(null)

  // Keep stable refs for use inside async handlers
  const relCardPositionsRef = useRef(relCardPositions)
  useEffect(() => { relCardPositionsRef.current = relCardPositions }, [relCardPositions])

  // Keep a stable ref for relationships (needed in async handlers and key listeners)
  const relationshipsRef = useRef(relationships)
  useEffect(() => { relationshipsRef.current = relationships }, [relationships])

  // Index: card ID -> all relationships that card is an endpoint of.
  // Used during card drag to move connected relationship label cards proportionally.
  const relsByCard = useMemo(() => {
    const map = new Map<number, RelationshipData[]>()
    for (const rel of relationships) {
      if (!map.has(rel.sourceId)) map.set(rel.sourceId, [])
      map.get(rel.sourceId)!.push(rel)
      if (!map.has(rel.targetId)) map.set(rel.targetId, [])
      map.get(rel.targetId)!.push(rel)
    }
    return map
  }, [relationships])
  const relsByCardRef = useRef(relsByCard)
  useEffect(() => { relsByCardRef.current = relsByCard }, [relsByCard])

  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)
  // Space bar pan mode: tracked as a ref so keydown/keyup don't cause re-renders.
  // We only need React state for the cursor change, handled separately below.
  const spaceHeldRef = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

  // Pending drag: records the mousedown position before the cursor has moved
  // far enough to commit to a real drag. Using a ref avoids re-renders on every
  // mousedown. Only promoted to dragState once the threshold is exceeded in
  // handleMouseMove. This allows clicks (select) and double-clicks (edit) to
  // reach their handlers without the ghost system activating prematurely.
  const pendingDragRef = useRef<{
    cardId: number
    startClientX: number
    startClientY: number
    cardRect: DOMRect | null
  } | null>(null)

  // Tracks whether Shift is held during the current drag frame. Updated from
  // e.shiftKey on every mousemove. A ref (not state) so it doesn't cause
  // re-renders when the user taps Shift mid-drag.
  const shiftHeldDuringDragRef = useRef(false)

  // Snapshot of cards state captured at the moment a card drag is promoted from
  // pendingDrag. Used by handleMouseUp to diff against the final state and
  // persist all cards that moved (including pushed siblings in pushing mode).
  const dragStartCardsRef = useRef<Map<number, CardData> | null>(null)

  // Last known mouse position in screen space (clientX/clientY), for keyboard shortcuts
  // that need to know where the cursor is (e.g. "C" to create card at cursor).
  const lastMouseRef = useRef({ clientX: 0, clientY: 0 })

  // Keep a stable ref to cards for use inside event handlers that close over stale state
  const cardsRef = useRef(cards)
  useEffect(() => { cardsRef.current = cards }, [cards])

  // Guard: auto-fit runs once after the initial card load, never again
  const hasAutoFitted = useRef(false)

  // ---------------------------------------------------------------------------
  // INITIALIZATION -- load cards from DB on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function loadCards() {
      try {
        const [nodes, rels] = await Promise.all([
          db.getMapNodes(mapId),
          db.getMapRelationships(mapId),
        ])
        if (cancelled) return

        // Separate card nodes from relationship companion nodes.
        // Relationship companion nodes (node_type='relationship') carry the
        // relationship card's position in their layout row but should NOT
        // appear as regular cards on the canvas.
        const raw = new Map<number, CardData>()
        const relNodePositions = new Map<number, { nodeId: number; x: number; y: number }>()

        for (const node of nodes) {
          if (node.node_type === 'relationship') {
            // We'll join this to the relationship by relNodeId after loading rels.
            relNodePositions.set(node.id, { nodeId: node.id, x: node.x, y: node.y })
          } else {
            // Pass depth=0 as a placeholder; computeDepths will correct it below.
            const card = nodeWithLayoutToCardData(node, 0)
            raw.set(card.id, card)
          }
        }

        // Task 1: walk the parent chain to assign correct depths to every card.
        const map = computeDepths(raw)
        setCards(map)

        // Auto-fit on startup: sync the ref now (before React re-renders) so
        // zoomToFit can read the freshly loaded cards immediately.
        if (!hasAutoFitted.current) {
          hasAutoFitted.current = true
          cardsRef.current = map
          zoomToFit()
        }

        setRelationships(rels)

        // Build relCardPositions: map each rel.id -> offset from computed midpoint.
        // The DB stores absolute canvas positions; we convert to {dx, dy} here so
        // labels automatically follow their endpoints when cards move.
        // An offset of {dx:0, dy:0} means the label is at the midpoint (the default).
        const positions = new Map<number, { dx: number; dy: number }>()
        for (const rel of rels) {
          if (rel.relNodeId !== null) {
            const nodePos = relNodePositions.get(rel.relNodeId)
            if (nodePos && (nodePos.x !== 0 || nodePos.y !== 0)) {
              // Convert absolute DB position to offset from the computed midpoint.
              const mid = computeRelMidpoint(map, rel)
              if (mid) {
                positions.set(rel.id, { dx: nodePos.x - mid.x, dy: nodePos.y - mid.y })
              } else {
                positions.set(rel.id, { dx: 0, dy: 0 })
              }
            } else {
              // Position (0,0) means never-dragged: store as zero offset (at midpoint).
              positions.set(rel.id, { dx: 0, dy: 0 })
            }
          }
        }
        setRelCardPositions(positions)
        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('[Canvas] Failed to load map nodes:', err)
        setError(`Failed to load canvas data: ${err}`)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadCards()
    return () => { cancelled = true }
  }, [mapId])

  // ---------------------------------------------------------------------------
  // ZOOM-TO-FIT utility
  // ---------------------------------------------------------------------------
  const zoomToFit = useCallback(() => {
    const currentCards = cardsRef.current
    if (currentCards.size === 0) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return

    // Compute bounding box of all top-level cards in canvas space
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const card of currentCards.values()) {
      if (card.parentId !== null) continue
      minX = Math.min(minX, card.x)
      minY = Math.min(minY, card.y)
      maxX = Math.max(maxX, card.x + card.width)
      maxY = Math.max(maxY, card.y + card.height)
    }

    if (!isFinite(minX)) return

    const FIT_PADDING = 60
    const contentW = maxX - minX + FIT_PADDING * 2
    const contentH = maxY - minY + FIT_PADDING * 2
    const viewW = rect.width
    const viewH = rect.height

    const zoom = Math.min(1.5, Math.max(0.1, Math.min(viewW / contentW, viewH / contentH)))
    const panX = (viewW - contentW * zoom) / 2 - (minX - FIT_PADDING) * zoom
    const panY = (viewH - contentH * zoom) / 2 - (minY - FIT_PADDING) * zoom

    setViewport({ panX, panY, zoom })
  }, [])

  // ---------------------------------------------------------------------------
  // PAN & ZOOM
  // ---------------------------------------------------------------------------
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    if (e.ctrlKey) {
      // Zoom (pinch-to-zoom on trackpad sends ctrlKey+wheel)
      const zoomFactor = e.deltaY > 0 ? 0.92 : 1.08
      setViewport((v) => {
        const newZoom = Math.max(0.1, Math.min(4, v.zoom * zoomFactor))
        const rect = canvasRef.current?.getBoundingClientRect()
        if (!rect) return { ...v, zoom: newZoom }
        const mouseX = e.clientX - rect.left
        const mouseY = e.clientY - rect.top
        return {
          zoom: newZoom,
          panX: mouseX - (mouseX - v.panX) * (newZoom / v.zoom),
          panY: mouseY - (mouseY - v.panY) * (newZoom / v.zoom),
        }
      })
    } else if (e.shiftKey) {
      // Shift+scroll -- horizontal pan (deltaY drives left/right)
      setViewport((v) => ({
        ...v,
        panX: v.panX - e.deltaY,
      }))
    } else {
      // Pan
      setViewport((v) => ({
        ...v,
        panX: v.panX - e.deltaX,
        panY: v.panY - e.deltaY,
      }))
    }
  }, [])

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent) => {
      const isCanvas =
        e.target === canvasRef.current ||
        (e.target as HTMLElement).dataset?.canvas === 'true'

      // Start panning on: left-click on empty canvas, middle-mouse anywhere,
      // or left-click anywhere when Space is held (Figma-style space-bar pan).
      if (isCanvas || e.button === 1 || (e.button === 0 && spaceHeldRef.current)) {
        setSelectedId(null)
        setSelectedRelId(null)
        // Do NOT call setEditingRelId(null) here -- if the label EditInput is
        // open, clicking the canvas steals focus, which fires onBlur on the
        // input, which calls onCommit (saving the text) and clears editingRelId
        // itself. Forcing it null here races against onBlur and can drop edits.
        setIsPanning(true)
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: viewport.panX,
          panY: viewport.panY,
        }
        if (e.button === 1) e.preventDefault()
      }
    },
    [viewport.panX, viewport.panY, setSelectedId]
  )

  // Ctrl+0 keyboard shortcut for zoom-to-fit
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '0') {
        e.preventDefault()
        zoomToFit()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [zoomToFit])

  // Space bar pan mode.
  // keydown activates it; keyup deactivates it and stops any active pan.
  // Guard: skip when a text input / textarea / contenteditable is focused so
  // Space still works normally while editing card labels.
  useEffect(() => {
    const isTextFocused = () => {
      const el = document.activeElement
      if (!el) return false
      const tag = (el as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return true
      if ((el as HTMLElement).isContentEditable) return true
      return false
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      if (isTextFocused()) return
      if (spaceHeldRef.current) return // already held -- suppress repeated keydown events
      e.preventDefault()
      spaceHeldRef.current = true
      setSpaceHeld(true)
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      spaceHeldRef.current = false
      setSpaceHeld(false)
      // If the user releases Space while mid-pan, stop panning cleanly.
      setIsPanning(false)
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // DRAG CARD
  // ---------------------------------------------------------------------------
  const handleCardDragStart = useCallback(
    (cardId: number, e: React.MouseEvent) => {
      e.stopPropagation()
      // Do NOT set dragState yet. Store the mousedown position as a pending
      // drag. handleMouseMove will promote this to a real dragState once the
      // cursor moves more than DRAG_THRESHOLD pixels. This keeps the card in
      // the normal DOM tree for the duration of a click or double-click, so
      // onDoubleClick and the resize handle work correctly.
      // Store the card's screen rect so we can detect resize zone at promotion time
      const cardEl = document.querySelector(`[data-card-id="${cardId}"]`) as HTMLElement | null
      const cardRect = cardEl?.getBoundingClientRect() ?? null
      pendingDragRef.current = {
        cardId,
        startClientX: e.clientX,
        startClientY: e.clientY,
        cardRect,
      }
    },
    []
  )

  // ---------------------------------------------------------------------------
  // CONNECTION DRAW -- start, track, and complete a relationship drag
  // ---------------------------------------------------------------------------
  const handleConnectStart = useCallback(
    (cardId: number, e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      // Start the line from the center of the source card
      const center = getAbsoluteCenter(cardsRef.current, cardId)
      setConnectingState({ sourceId: cardId, startX: center.x, startY: center.y })
      setConnectingMousePos(center) // start at center, will track to cursor immediately
      // Clear any active card/rel selection so the canvas is in a clean state
      setSelectedId(null)
      setSelectedRelId(null)
    },
    [setSelectedId]
  )

  // ---------------------------------------------------------------------------
  // RELATIONSHIP CARD DRAG -- start a drag on a relationship label card
  // ---------------------------------------------------------------------------
  const handleRelCardDragStart = useCallback(
    (relId: number, e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      // Convert the mousedown screen position to canvas space
      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      // Resolve the card's actual visual position as midpoint + stored offset.
      // {dx:0, dy:0} (the default) means the label is at the midpoint itself.
      const stored = relCardPositionsRef.current.get(relId)
      let visualX: number = canvasX
      let visualY: number = canvasY
      const rel = relationshipsRef.current.find((r) => r.id === relId)
      if (rel) {
        const mid = computeRelMidpoint(cardsRef.current, rel)
        if (mid) {
          visualX = mid.x + (stored?.dx ?? 0)
          visualY = mid.y + (stored?.dy ?? 0)
        }
      }

      // Store offset from card center to mouse so the card doesn't jump on drag
      setRelCardDragOffset({
        x: canvasX - visualX,
        y: canvasY - visualY,
      })
      setDraggingRelCardId(relId)
      // Clear card/rel selection while dragging
      setSelectedId(null)
      setSelectedRelId(null)
    },
    [viewport.panX, viewport.panY, viewport.zoom, setSelectedId]
  )

  // ---------------------------------------------------------------------------
  // ENDPOINT DRAG (re-attach gesture) -- start dragging a relationship endpoint
  // ---------------------------------------------------------------------------
  const handleEndpointDragStart = useCallback(
    (relId: number, end: 'source' | 'target', e: React.MouseEvent) => {
      e.stopPropagation()
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const rel = relationshipsRef.current.find((r) => r.id === relId)
      if (!rel) return

      const fixedCardId = end === 'source' ? rel.targetId : rel.sourceId
      const fixedCard = cardsRef.current.get(fixedCardId)
      if (!fixedCard) return

      // Anchor the ghost line at the fixed card's center
      const fixedAbs = getAbsoluteCenter(cardsRef.current, fixedCardId)

      // Start the mouse position at the dragged endpoint so the line appears
      // in-place before the cursor moves
      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      setReattachState({ relId, end, fixedCardId, fixedX: fixedAbs.x, fixedY: fixedAbs.y })
      setReattachMousePos({ x: canvasX, y: canvasY })
      // Keep the relationship selected so the context is visible
      setSelectedId(null)
    },
    [viewport.panX, viewport.panY, viewport.zoom, setSelectedId]
  )

  // (Resize is now detected in handleMouseMove during pendingDrag promotion)

  // ---------------------------------------------------------------------------
  // MOUSE MOVE (handles drag, resize, and pan)
  // ---------------------------------------------------------------------------
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      lastMouseRef.current = { clientX: e.clientX, clientY: e.clientY }
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      // --- HOVER HIT-TEST ---
      // Runs on every mousemove to find the smallest regular card (non-relationship
      // node) whose absolute bounds contain the cursor. This is the "topmost" card
      // in nesting terms -- the most specific card at the cursor position. We set
      // hoveredCardId at the App level rather than letting each Card track its own
      // hover state, which was causing all ancestor cards to light up simultaneously.
      // Lightweight: O(N) over cardsRef.current, no DOM queries.
      // Skip entirely during active gestures -- connection handles are irrelevant
      // while the user is dragging, resizing, connecting, reattaching, or panning.
      if (dragState || resizeState || connectingState || reattachState || draggingRelCardId !== null || isPanning) {
        setHoveredCardId(null)
      } else {
        const cursorCanvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
        const cursorCanvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom
        let bestId: number | null = null
        let bestArea = Infinity
        for (const [id, candidate] of cardsRef.current) {
          // cardsRef.current only contains regular cards (relationship companion
          // nodes are never inserted into this map -- see load logic).
          const absPos = getAbsolutePosition(cardsRef.current, id)
          const area = candidate.width * candidate.height
          if (
            cursorCanvasX >= absPos.x &&
            cursorCanvasX <= absPos.x + candidate.width &&
            cursorCanvasY >= absPos.y &&
            cursorCanvasY <= absPos.y + candidate.height &&
            area < bestArea
          ) {
            bestId = id
            bestArea = area
          }
        }
        setHoveredCardId(bestId)
      }

      // --- PENDING DRAG THRESHOLD CHECK ---
      // If a mousedown was recorded but we haven't started a real drag yet,
      // check whether the cursor has moved far enough to commit. We only
      // promote once there is no active drag or resize already in progress
      // (those are mutually exclusive with a pending drag in practice, but
      // the guard keeps the logic airtight).
      const pending = pendingDragRef.current
      if (pending && !dragState && !resizeState && draggingRelCardId === null && !reattachState) {
        const dist =
          Math.abs(e.clientX - pending.startClientX) +
          Math.abs(e.clientY - pending.startClientY)
        if (dist <= DRAG_THRESHOLD) {
          // Below threshold: do nothing, wait for more movement or mouseup.
          return
        }

        // Threshold crossed -- decide whether this is a RESIZE or a DRAG
        // based on where the original mousedown landed relative to the card.
        pendingDragRef.current = null
        const card = cardsRef.current.get(pending.cardId)
        if (!card) return

        const RESIZE_EDGE = 16
        let isResize = false
        if (pending.cardRect) {
          const localX = pending.startClientX - pending.cardRect.left
          const localY = pending.startClientY - pending.cardRect.top
          const nearRight = localX >= pending.cardRect.width - RESIZE_EDGE
          const nearBottom = localY >= pending.cardRect.height - RESIZE_EDGE
          isResize = nearRight && nearBottom
        }

        if (isResize) {
          // Promote to resize. We also apply the first frame of resize movement
          // immediately here, rather than waiting for the next mousemove event
          // after React commits the state update. Without this, the promotion
          // frame is always dropped and resize feels unresponsive.
          const promotedResize: ResizeState = {
            cardId: pending.cardId,
            handle: 'se',
            startWidth: card.width,
            startHeight: card.height,
            startMouseX: pending.startClientX,
            startMouseY: pending.startClientY,
          }
          setResizeState(promotedResize)

          // Apply first resize delta inline using the locally-scoped state object.
          const dx = (e.clientX - promotedResize.startMouseX) / viewport.zoom
          const dy = (e.clientY - promotedResize.startMouseY) / viewport.zoom
          let newW = Math.max(MIN_W, promotedResize.startWidth + dx)
          let newH = Math.max(MIN_H, promotedResize.startHeight + dy)
          const kids = getChildren(cardsRef.current, pending.cardId)
          if (kids.length > 0) {
            let maxRight = 0
            let maxBottom = 0
            for (const kid of kids) {
              maxRight = Math.max(maxRight, kid.x + kid.width)
              maxBottom = Math.max(maxBottom, kid.y + kid.height)
            }
            newW = Math.max(newW, maxRight + PADDING)
            newH = Math.max(newH, HEADER_HEIGHT + maxBottom + BOTTOM_PADDING)
          }
          setCards((prev) => {
            const updated = new Map(prev)
            const c = updated.get(pending.cardId)
            if (!c) return prev
            updated.set(pending.cardId, { ...c, width: newW, height: newH })
            if (c.parentId !== null) {
              return autoResizeParent(updated, c.parentId)
            }
            return updated
          })
          return
        }

        // Promote to drag
        const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
        const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom
        const absPos = getAbsolutePosition(cardsRef.current, pending.cardId)
        setDragState({
          cardId: pending.cardId,
          offsetX: canvasX - absPos.x,
          offsetY: canvasY - absPos.y,
          nestTargetId: null,
          absX: absPos.x,
          absY: absPos.y,
        })
        // Snapshot cards at drag start so handleMouseUp can detect all changes
        // (including pushed siblings in pushing mode) relative to pre-drag state.
        dragStartCardsRef.current = new Map(cardsRef.current)
        // Fall through: the dragging section below will process the first drag
        // frame on this same event, using the dragState we just set. But since
        // setDragState is async, we return here and let the next mousemove
        // (where dragState is committed) handle the first actual move delta.
        // This is acceptable for drag -- the ghost appears instantly and the
        // first pixel of offset is negligible. Resize needs immediate response
        // because the user sees the card edge moving, which is why we handle
        // resize inline above.
        return
      }

      // --- RELATIONSHIP CARD DRAG ---
      if (draggingRelCardId !== null && relCardDragOffset) {
        const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
        const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom
        // The new absolute label position (mouse minus drag offset).
        const newX = canvasX - relCardDragOffset.x
        const newY = canvasY - relCardDragOffset.y
        // Compute the current midpoint and store the offset from it.
        const rel = relationshipsRef.current.find((r) => r.id === draggingRelCardId)
        if (rel) {
          const mid = computeRelMidpoint(cardsRef.current, rel)
          if (mid) {
            setRelCardPositions((prev) => {
              const next = new Map(prev)
              next.set(draggingRelCardId, { dx: newX - mid.x, dy: newY - mid.y })
              return next
            })
          }
        }
        return
      }

      // --- CONNECTION DRAW ---
      if (connectingState) {
        const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
        const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom
        setConnectingMousePos({ x: canvasX, y: canvasY })
        return
      }

      // --- RE-ATTACH GESTURE ---
      if (reattachState) {
        const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
        const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom
        setReattachMousePos({ x: canvasX, y: canvasY })
        return
      }

      // --- PANNING ---
      if (isPanning) {
        const dx = e.clientX - panStartRef.current.x
        const dy = e.clientY - panStartRef.current.y
        setViewport((v) => ({
          ...v,
          panX: panStartRef.current.panX + dx,
          panY: panStartRef.current.panY + dy,
        }))
        return
      }

      // --- RESIZING ---
      if (resizeState) {
        const dx = (e.clientX - resizeState.startMouseX) / viewport.zoom
        const dy = (e.clientY - resizeState.startMouseY) / viewport.zoom
        let newW = Math.max(MIN_W, resizeState.startWidth + dx)
        let newH = Math.max(MIN_H, resizeState.startHeight + dy)

        // Fix 2: prevent shrinking a container below the bounding box of its
        // children. Without this, manually dragging the resize handle can push
        // children outside the visible area of their parent.
        const currentCard = cardsRef.current.get(resizeState.cardId)
        if (currentCard) {
          const kids = getChildren(cardsRef.current, resizeState.cardId)
          if (kids.length > 0) {
            let maxRight = 0
            let maxBottom = 0
            for (const kid of kids) {
              maxRight = Math.max(maxRight, kid.x + kid.width)
              maxBottom = Math.max(maxBottom, kid.y + kid.height)
            }
            // Children occupy local coords; add padding/header to get container minimums.
            const minWFromChildren = maxRight + PADDING
            const minHFromChildren = HEADER_HEIGHT + maxBottom + BOTTOM_PADDING
            newW = Math.max(newW, minWFromChildren)
            newH = Math.max(newH, minHFromChildren)
          }
        }

        setCards((prev) => {
          const updated = new Map(prev)
          const card = updated.get(resizeState.cardId)
          if (!card) return prev
          updated.set(resizeState.cardId, { ...card, width: newW, height: newH })

          // Always-on push mode during resize: after growing the card, push any
          // overlapping siblings out of the way. The card's position hasn't
          // changed -- only its size -- so pass its absolute position as both
          // prev and new. applyPushMode reads the card's current dimensions from
          // the map (which now include the new width/height) to detect overlaps.
          const absPos = getAbsolutePosition(updated, resizeState.cardId)
          return applyPushMode(updated, resizeState.cardId, absPos.x, absPos.y, absPos.x, absPos.y)
        })
        return
      }

      // --- DRAGGING ---
      if (!dragState) return

      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      const card = cardsRef.current.get(dragState.cardId)
      if (!card) return

      const newAbsX = canvasX - dragState.offsetX
      const newAbsY = canvasY - dragState.offsetY

      // --- NEST TARGET DETECTION ---
      // A card becomes a nest target when the cursor is anywhere over its body.
      // Among all overlapping candidates, the smallest card wins (most specific
      // target). Only two cards are excluded from consideration:
      //   - The dragged card itself (can't nest into itself).
      //   - Descendants of the dragged card (can't nest a parent into its child).
      // Ancestors (parent, grandparent, etc.) are valid targets -- the user can
      // explicitly drag a card out of a deep nest and drop it onto a grandparent.
      // The key guard against accidental ancestor highlighting: if the cursor is
      // still inside the current parent's bounds, the current parent is excluded
      // as a nest target, but siblings and other cards are still checked.
      if (NESTING_ENABLED) {
        // Use the raw cursor position in canvas space -- not the dragged card's
        // center -- so the user has precise control over which card to target.
        const cursorCanvasX = canvasX
        const cursorCanvasY = canvasY

        // Determine whether the cursor is still inside the current parent's bounds.
        // When it is, the current parent is excluded as a nest target (the user is
        // repositioning within the parent, not trying to re-nest into it). All other
        // cards -- including siblings -- remain valid candidates. When the cursor has
        // left the parent's bounds, every card (including the parent) is a valid target.
        let cursorInsideCurrentParent = false
        if (card.parentId !== null) {
          const parentAbs = getAbsolutePosition(cardsRef.current, card.parentId)
          const parent = cardsRef.current.get(card.parentId)
          if (parent) {
            cursorInsideCurrentParent =
              cursorCanvasX >= parentAbs.x &&
              cursorCanvasX <= parentAbs.x + parent.width &&
              cursorCanvasY >= parentAbs.y &&
              cursorCanvasY <= parentAbs.y + parent.height
          }
        }

        let bestTarget: number | null = null
        let bestArea = Infinity

        for (const [id, candidate] of cardsRef.current) {
          if (id === dragState.cardId) continue
          // Skip descendants of the dragged card (can't nest a parent into its child).
          if (isAncestor(cardsRef.current, id, dragState.cardId)) continue
          // When the cursor is inside the current parent, skip the current parent AND
          // all of its ancestors -- the user is repositioning within the parent, not
          // trying to nest into any ancestor. Siblings and unrelated cards are still
          // valid targets. When the cursor has left the parent's bounds, ancestors
          // are fair game again (explicit drag-out-and-up is intentional).
          if (cursorInsideCurrentParent && isAncestor(cardsRef.current, dragState.cardId, id)) continue

          const absPos = getAbsolutePosition(cardsRef.current, id)
          const area = candidate.width * candidate.height

          // Hit zone is the full card bounds -- dropping anywhere on a card nests into it.
          if (
            cursorCanvasX >= absPos.x &&
            cursorCanvasX <= absPos.x + candidate.width &&
            cursorCanvasY >= absPos.y &&
            cursorCanvasY <= absPos.y + candidate.height &&
            area < bestArea
          ) {
            bestTarget = id
            bestArea = area
          }
        }

        // Fix 1: also update absX/absY so the root-level ghost follows the cursor.
        setDragState((prev) =>
          prev ? { ...prev, nestTargetId: bestTarget, absX: newAbsX, absY: newAbsY } : null
        )
      } else {
        // NESTING_ENABLED is false -- still need to keep absX/absY current for
        // the ghost renderer.
        setDragState((prev) =>
          prev ? { ...prev, absX: newAbsX, absY: newAbsY } : null
        )
      }

      // Track whether Shift is held this frame. The ref updates mid-drag so
      // pushing mode can be toggled on/off without interrupting the drag.
      shiftHeldDuringDragRef.current = e.shiftKey

      // Update card position (local coords relative to current parent).
      // No autoResizeParent here for normal drags -- parent resize fires once on
      // mouse-up. Exception: pushing mode calls autoResizeParent inside
      // applyPushMode so pushed cards that hit the right/bottom edge expand the parent.
      setCards((prev) => {
        const updated = new Map(prev)
        const c = updated.get(dragState.cardId)
        if (!c) return prev

        const localPos = canvasToLocal(updated, newAbsX, newAbsY, c.parentId)
        updated.set(dragState.cardId, { ...c, x: localPos.x, y: localPos.y })

        // Pushing mode: shift held, collision cascade + parent auto-resize.
        // Always call applyPushMode even with zero siblings -- a lone child
        // dragged to the edge must still trigger autoResizeParent to expand
        // the parent container.
        if (shiftHeldDuringDragRef.current) {
          return applyPushMode(
            updated,
            dragState.cardId,
            dragState.absX,  // prevAbsX
            dragState.absY,  // prevAbsY
            newAbsX,
            newAbsY,
          )
        }

        return updated
      })
    },
    [dragState, resizeState, isPanning, connectingState, reattachState, draggingRelCardId, relCardDragOffset, viewport]
  )

  // ---------------------------------------------------------------------------
  // HELPERS
  // ---------------------------------------------------------------------------

  // Returns the deduplicated set of relationships connected to a dragged card
  // OR to any of its descendants. Used by handleMouseUp to persist label
  // positions for all relationships that may have shifted during the drag,
  // including those on child cards that moved because their parent was dragged.
  const getRelsForDraggedSubtree = useCallback((cardId: number) => {
    const seenIds = new Set<number>()
    const result: typeof relationshipsRef.current = []

    const addRels = (id: number) => {
      const rels = relsByCardRef.current.get(id)
      if (!rels) return
      for (const rel of rels) {
        if (!seenIds.has(rel.id)) {
          seenIds.add(rel.id)
          result.push(rel)
        }
      }
    }

    addRels(cardId)
    for (const [id] of cardsRef.current) {
      if (isAncestor(cardsRef.current, id, cardId)) {
        addRels(id)
      }
    }

    return result
  }, [])

  // Persists rel card positions for all relationships in the given list.
  // Converts stored {dx, dy} offsets to absolute canvas positions for DB storage.
  // Skips rels with no relNodeId and those whose midpoint cannot be computed
  // (missing endpoints -- should not occur in practice after a card drag).
  const persistRelCardPositions = useCallback(async (rels: typeof relationshipsRef.current) => {
    const writes: Promise<void>[] = []
    for (const rel of rels) {
      if (rel.relNodeId === null) continue
      const stored = relCardPositionsRef.current.get(rel.id)
      if (!stored) continue
      // Skip if offset is exactly zero AND no non-zero entry was ever set
      // (i.e. the label has never been dragged away from the midpoint).
      // We still write it if it's zero but was explicitly set (dx/dy exist in the map).
      const mid = computeRelMidpoint(cardsRef.current, rel)
      if (!mid) continue
      const absX = mid.x + stored.dx
      const absY = mid.y + stored.dy
      writes.push(
        db.updateNodeLayout(rel.relNodeId, mapId, absX, absY, 80, 28, null, null).catch((err) => {
          console.error('[Canvas] Failed to persist rel card position after card drag:', err)
        })
      )
    }
    await Promise.all(writes)
  }, [mapId])

  // ---------------------------------------------------------------------------
  // MOUSE UP (end drag, resize, or pan -- persist to DB)
  // ---------------------------------------------------------------------------
  const handleMouseUp = useCallback(async () => {
    // If mouseup fires while pendingDrag was never promoted, it was just a
    // click (or very short tap). Clear the pending state -- the card stays
    // in the DOM, selection already happened in Card's handleMouseDown, and
    // the resize handle is now visible for a selected card.
    pendingDragRef.current = null

    // --- RELATIONSHIP CARD DRAG END -- persist position ---
    if (draggingRelCardId !== null) {
      const relId = draggingRelCardId
      setDraggingRelCardId(null)
      setRelCardDragOffset(null)

      // Find the relationship to get its relNodeId for DB persistence.
      // The DB stores absolute canvas positions, so convert offset -> absolute here.
      const rel = relationshipsRef.current.find((r) => r.id === relId)
      if (rel && rel.relNodeId !== null) {
        const stored = relCardPositionsRef.current.get(relId)
        if (stored) {
          const mid = computeRelMidpoint(cardsRef.current, rel)
          if (mid) {
            const absX = mid.x + stored.dx
            const absY = mid.y + stored.dy
            try {
              await db.updateNodeLayout(rel.relNodeId, mapId, absX, absY, 80, 28, null, null)
            } catch (err) {
              console.error('[Canvas] Failed to persist relationship card position:', err)
              setError('Failed to save relationship card position.')
            }
          }
        }
      }
      return
    }

    // --- CONNECTION DRAW COMPLETE ---
    if (connectingState) {
      const { sourceId } = connectingState
      const mousePos = connectingMousePos
      setConnectingState(null)
      setConnectingMousePos(null)

      if (!mousePos) return

      // Find the topmost card under the current mouse position (canvas coords),
      // excluding the source card itself.
      let targetId: number | null = null
      let bestArea = Infinity
      for (const [id, candidate] of cardsRef.current) {
        if (id === sourceId) continue
        const absPos = getAbsolutePosition(cardsRef.current, id)
        const area = candidate.width * candidate.height
        if (
          mousePos.x >= absPos.x &&
          mousePos.x <= absPos.x + candidate.width &&
          mousePos.y >= absPos.y &&
          mousePos.y <= absPos.y + candidate.height &&
          area < bestArea
        ) {
          targetId = id
          bestArea = area
        }
      }

      if (targetId === null) return // Released on empty canvas -- cancel

      try {
        const rel = await db.createRelationship(sourceId, targetId, '', mapId)
        setRelationships((prev) => [...prev, rel])
        // Register the new rel with zero offset -- label starts at the midpoint.
        setRelCardPositions((prev) => {
          const next = new Map(prev)
          next.set(rel.id, { dx: 0, dy: 0 })
          return next
        })
        setSelectedRelId(rel.id)
        // Immediately open label editor so user can name the relationship
        setEditingRelId(rel.id)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to create relationship:', err)
        setError(`Failed to create relationship: ${err}`)
      }
      return
    }

    // --- RE-ATTACH GESTURE COMPLETE ---
    if (reattachState) {
      const { relId, end, fixedCardId } = reattachState
      const mousePos = reattachMousePos
      setReattachState(null)
      setReattachMousePos(null)

      if (!mousePos) return

      // Find the topmost card under the cursor, excluding the fixed endpoint card
      // (can't collapse both ends to the same card) and excluding the same card
      // already attached to this end (no-op re-attach).
      const rel = relationshipsRef.current.find((r) => r.id === relId)
      if (!rel) return

      const currentEndCardId = end === 'source' ? rel.sourceId : rel.targetId

      let targetId: number | null = null
      let bestArea = Infinity
      for (const [id, candidate] of cardsRef.current) {
        // Can't re-attach to the fixed endpoint card (self-loop)
        if (id === fixedCardId) continue
        const absPos = getAbsolutePosition(cardsRef.current, id)
        const area = candidate.width * candidate.height
        if (
          mousePos.x >= absPos.x &&
          mousePos.x <= absPos.x + candidate.width &&
          mousePos.y >= absPos.y &&
          mousePos.y <= absPos.y + candidate.height &&
          area < bestArea
        ) {
          targetId = id
          bestArea = area
        }
      }

      // Released on empty canvas, or on the same card already on this end -- cancel
      if (targetId === null || targetId === currentEndCardId) return

      const newSourceId = end === 'source' ? targetId : rel.sourceId
      const newTargetId = end === 'target' ? targetId : rel.targetId

      // Optimistic update
      const relsBefore = [...relationshipsRef.current]
      setRelationships((prev) =>
        prev.map((r) =>
          r.id === relId ? { ...r, sourceId: newSourceId, targetId: newTargetId } : r
        )
      )
      setSelectedRelId(relId)

      try {
        await db.reattachRelationship(relId, newSourceId, newTargetId)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to reattach relationship:', err)
        setError(`Failed to rewire relationship: ${err}`)
        setRelationships(relsBefore)
      }
      return
    }

    if (isPanning) {
      setIsPanning(false)
      return
    }

    if (resizeState) {
      // Snapshot state before clearing so we can diff pushed siblings below.
      const stateBefore = new Map(cardsRef.current)
      const card = cardsRef.current.get(resizeState.cardId)
      setResizeState(null)

      if (card) {
        const nextCards = new Map(cardsRef.current)
        setCards(nextCards)

        try {
          await db.updateNodeLayout(card.id, mapId, card.x, card.y, card.width, card.height)

          // Persist every card that changed during the resize: ancestors that grew
          // via autoResizeParent, siblings that were pushed via applyPushMode,
          // and ancestors of those siblings. Diff nextCards against stateBefore
          // and write any card whose position or size changed (excluding the
          // resized card itself, which was already written above).
          const changedWrites: Promise<void>[] = []
          for (const [id, nc] of nextCards) {
            if (id === resizeState.cardId) continue
            const before = stateBefore.get(id)
            if (
              !before ||
              nc.x !== before.x || nc.y !== before.y ||
              nc.width !== before.width || nc.height !== before.height
            ) {
              changedWrites.push(
                db.updateNodeLayout(id, mapId, nc.x, nc.y, nc.width, nc.height)
              )
            }
          }
          await Promise.all(changedWrites)

          setError(null)
        } catch (err) {
          console.error('[Canvas] Failed to persist resize:', err)
          setError('Failed to save resize. Changes may be lost.')
          // Revert: restore the pre-resize size
          setCards((prev) => {
            const updated = new Map(prev)
            const current = updated.get(resizeState.cardId)
            if (!current) return prev
            updated.set(resizeState.cardId, {
              ...current,
              width: resizeState.startWidth,
              height: resizeState.startHeight,
            })
            return updated
          })
        }
      }
      return
    }

    if (!dragState) return

    const { cardId, nestTargetId, absX: dragAbsX, absY: dragAbsY } = dragState
    const card = cardsRef.current.get(cardId)
    setDragState(null)

    if (!card) return

    // M1: NESTING DISABLED -- just persist the new position
    if (!NESTING_ENABLED) {
      try {
        await db.updateNodeLayout(card.id, mapId, card.x, card.y, card.width, card.height)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to persist drag position:', err)
        setError('Failed to save position. Changes may be lost.')
        // Revert position -- we stored the pre-drag values in dragState offsets
        // but we don't have the original coords. We re-fetch from DB to be safe.
        try {
          const nodes = await db.getMapNodes(mapId)
          const raw = new Map<number, CardData>()
          for (const node of nodes) {
            // Filter out relationship backing nodes, same as the primary load path.
            if (node.node_type !== 'relationship') {
              raw.set(node.id, nodeWithLayoutToCardData(node, 0))
            }
          }
          setCards(computeDepths(raw))
        } catch (fetchErr) {
          console.error('[Canvas] Failed to revert after drag error:', fetchErr)
        }
      }

      // Persist relationship label positions for the dragged card and all its
      // descendants (children move with the parent, so their rel labels shift too).
      await persistRelCardPositions(getRelsForDraggedSubtree(cardId))

      return
    }

    // NESTING_ENABLED path (M2) -- handle nest / unnest / layout-only drag

    // --- NEST: card dropped onto a new parent ---
    if (nestTargetId && nestTargetId !== card.parentId) {
      // Capture state before the optimistic update so we can revert if the DB call fails.
      const stateBefore = new Map(cardsRef.current)

      // Compute final in-memory state.
      let nextCards = new Map(cardsRef.current)
      const c = nextCards.get(cardId)
      const target = nextCards.get(nestTargetId)
      if (!c || !target) return

      // Drop the card at the cursor release position, converted to the new
      // parent's local coordinate space. This gives the user direct spatial
      // control over where the card lands -- it drops where they let go, not
      // at a computed stack position. We clamp to PADDING so the card never
      // lands partially outside the content area.
      const dropLocal = canvasToLocal(nextCards, dragAbsX, dragAbsY, nestTargetId)
      const dropX = Math.max(PADDING, dropLocal.x)
      const dropY = Math.max(PADDING, dropLocal.y)

      const newDepth = target.depth + 1
      nextCards.set(cardId, {
        ...c,
        parentId: nestTargetId,
        x: dropX,
        y: dropY,
        depth: newDepth,
        color: getDepthColor(newDepth),
      })

      // Propagate depth changes to all descendants via the shared utility.
      nextCards = updateDescendantDepths(nextCards, cardId, newDepth)

      // Normalize child positions (shift negative-coordinate children back inside padding).
      nextCards = normalizeChildPositions(nextCards, nestTargetId)

      // No-overlap on drop: if the nest target already has children, move the
      // dropped card so it doesn't overlap any sibling. Existing children stay
      // put -- only the newcomer relocates. autoResizeParent runs below.
      const existingChildCount = getChildren(new Map(cardsRef.current), nestTargetId).length
      if (existingChildCount > 0) {
        nextCards = applyDropPush(nextCards, cardId)
      }

      // Issue 1 fix: resize bottom-up. If the card being nested is itself a
      // parent with children, its own dimensions must be correct BEFORE we ask
      // the new parent to fit around it. autoResizeParent(cardId) sizes the
      // nested card based on its children, then walks up through nestTargetId
      // and all further ancestors -- so one call handles the entire chain.
      const nestedHasChildren = getChildren(nextCards, cardId).length > 0
      if (nestedHasChildren) {
        nextCards = autoResizeParent(nextCards, cardId)
      }
      // applyPushMode handles autoResizeParent + ancestor cascade in one pass:
      // it resizes the immediate parent (nestTargetId) and then pushes any
      // siblings of that parent that are now overlapping after it grew.
      nextCards = applyPushMode(nextCards, cardId, 0, 0, 0, 0)
      // Also resize the old parent if the card had one (it may now be smaller).
      if (card.parentId !== null) {
        nextCards = autoResizeParent(nextCards, card.parentId)
      }

      setCards(nextCards)

      // Persist: updateNodeParent atomically sets parent_id and layout coordinates
      // for the dragged card. Then persist any parent/ancestor cards whose size
      // changed due to autoResizeParent -- those are not covered by updateNodeParent.
      const finalCard = nextCards.get(cardId)!
      try {
        await db.updateNodeParent(
          cardId,
          nestTargetId,
          mapId,
          finalCard.x,
          finalCard.y,
          finalCard.width,
          finalCard.height,
        )
        // Persist all cards whose size changed due to autoResizeParent (parents
        // and ancestors of the nest target, and possibly the old parent). Without
        // this, auto-resized containers lose their expanded size on reload and
        // children appear to overflow them.
        const ancestorWrites: Promise<void>[] = []
        for (const [id, c] of nextCards) {
          if (id === cardId) continue // already persisted via updateNodeParent
          const before = stateBefore.get(id)
          if (
            !before ||
            c.x !== before.x || c.y !== before.y ||
            c.width !== before.width || c.height !== before.height
          ) {
            ancestorWrites.push(
              db.updateNodeLayout(id, mapId, c.x, c.y, c.width, c.height)
            )
          }
        }
        await Promise.all(ancestorWrites)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to persist nest:', err)
        // Surface the error. Rust returns user-readable strings for cycle violations.
        const msg = String(err)
        if (msg.includes('circular containment')) {
          setError('Cannot nest: this would create a circular containment.')
        } else if (msg.includes('cannot be its own parent')) {
          setError('Cannot nest a card inside itself.')
        } else {
          setError(`Failed to save nesting: ${err}`)
        }
        // Revert in-memory state to what it was before the optimistic update.
        setCards(stateBefore)
      }

      // Persist relationship label positions for the dragged card and all its
      // descendants (children move with the parent, so their rel labels shift too).
      await persistRelCardPositions(getRelsForDraggedSubtree(cardId))

      return
    }

    // --- UNNEST: card dragged outside its current parent ---
    // If the card's center is outside its immediate parent, unnest it to canvas
    // root unconditionally. Re-nesting into an ancestor only happens via the
    // explicit nest-target path above (cursor over another card). This keeps
    // the rule consistent: dragging over a card nests; leaving a parent with
    // no target under the cursor always means going to the canvas root.
    if (!nestTargetId && card.parentId !== null) {
      const absPos = getAbsolutePosition(cardsRef.current, cardId)
      const centerX = absPos.x + card.width / 2
      const centerY = absPos.y + card.height / 2

      // Check whether the card center is outside its immediate parent first.
      // If it is still inside, nothing to do.
      const immediateParent = cardsRef.current.get(card.parentId)
      if (immediateParent) {
        const immediateParentAbs = getAbsolutePosition(cardsRef.current, card.parentId)
        const stillInsideImmediate =
          centerX >= immediateParentAbs.x &&
          centerX <= immediateParentAbs.x + immediateParent.width &&
          centerY >= immediateParentAbs.y &&
          centerY <= immediateParentAbs.y + immediateParent.height

        if (!stillInsideImmediate) {
          // The card left its immediate parent. Always unnest to canvas root.
          // If the user was hovering a title bar, nestTargetId would have been
          // set and handled by the NEST path above -- so reaching here means
          // the user genuinely dragged out with no re-nest intent.
          const newParentId: number | null = null

          const stateBefore = new Map(cardsRef.current)

          let nextCards = new Map(cardsRef.current)
          const c = nextCards.get(cardId)
          if (!c) return

          // Convert absolute position to the new parent's local space
          // (or canvas root if newParentId is null).
          const abs = getAbsolutePosition(nextCards, cardId)
          const localPos = canvasToLocal(nextCards, abs.x, abs.y, newParentId)

          const newDepth = newParentId !== null
            ? (nextCards.get(newParentId)?.depth ?? 0) + 1
            : 0

          nextCards.set(cardId, {
            ...c,
            parentId: newParentId,
            x: localPos.x,
            y: localPos.y,
            depth: newDepth,
            color: getDepthColor(newDepth),
          })

          // Propagate depth change to all descendants.
          nextCards = updateDescendantDepths(nextCards, cardId, newDepth)

          // Issue 1 fix: resize bottom-up for unnest too. If the card being
          // unnested has children, its own size may need correcting first.
          // autoResizeParent(cardId) fixes the card itself then walks up to
          // newParentId and beyond in a single upward pass.
          const unnestHasChildren = getChildren(nextCards, cardId).length > 0
          if (unnestHasChildren && newParentId !== null) {
            nextCards = autoResizeParent(nextCards, cardId)
          } else {
            if (newParentId !== null) nextCards = autoResizeParent(nextCards, newParentId)
          }
          // Always resize the old parent -- the card left it, so it may shrink.
          if (c.parentId !== null) nextCards = autoResizeParent(nextCards, c.parentId)

          setCards(nextCards)

          // Persist: updateNodeParent with newParentId (possibly null = canvas root).
          const finalCard = nextCards.get(cardId)!
          try {
            await db.updateNodeParent(
              cardId,
              newParentId,
              mapId,
              finalCard.x,
              finalCard.y,
              finalCard.width,
              finalCard.height,
            )
            // Persist all cards whose size changed due to autoResizeParent (old
            // parent shrinks when a card leaves it). Without this, the old parent
            // reloads at its pre-unnest size and children appear to overflow it.
            const ancestorWrites: Promise<void>[] = []
            for (const [id, c] of nextCards) {
              if (id === cardId) continue // already persisted via updateNodeParent
              const before = stateBefore.get(id)
              if (!before || c.width !== before.width || c.height !== before.height) {
                ancestorWrites.push(
                  db.updateNodeLayout(id, mapId, c.x, c.y, c.width, c.height)
                )
              }
            }
            await Promise.all(ancestorWrites)
            setError(null)
          } catch (err) {
            console.error('[Canvas] Failed to persist unnest:', err)
            setError(`Failed to save unnesting: ${err}`)
            setCards(stateBefore)
          }

          // Persist relationship label positions for the dragged card and all its
          // descendants (children move with the parent, so their rel labels shift too).
          await persistRelCardPositions(getRelsForDraggedSubtree(cardId))

          return
        }
      }
    }

    // --- LAYOUT-ONLY DRAG: same parent, just moved within it ---
    // Fix 3: if the card has a parent, run normalizeChildPositions then
    // autoResizeParent now. During the drag we intentionally skip both (they
    // would cause the parent to chase the card), so this is the one moment we
    // reconcile positions and parent size. normalizeChildPositions first
    // shifts any children that ended up with negative coords back to the
    // padding boundary; then autoResizeParent can see the correct bounding box
    // and grow rightward/downward to contain them.
    //
    // Pushing mode: applyPushMode runs autoResizeParent during drag for right/bottom
    // expansions, but we still run normalizeChildPositions here on mouseup to catch
    // any left/top boundary cleanup. The dragStartCardsRef snapshot (taken when the
    // drag was promoted) is used as the baseline for the persist diff so that pushed
    // siblings are included in the DB writes.
    const preMouseUpCards = cardsRef.current
    const dragStartSnapshot = dragStartCardsRef.current
    dragStartCardsRef.current = null

    const finalCard = preMouseUpCards.get(cardId)
    if (finalCard) {
      if (finalCard.parentId !== null) {
        // normalizeChildPositions may shift children; feed its result into
        // autoResizeParent/applyPushMode so the two operations see a consistent state.
        // If shift was held during the drag, use applyPushMode so any ancestor that
        // grew due to push-mode also cascades into its own siblings. For normal drags,
        // plain autoResizeParent is correct -- no sibling pushing intended.
        const afterNorm = normalizeChildPositions(preMouseUpCards, finalCard.parentId)
        const afterResize = shiftHeldDuringDragRef.current
          ? applyPushMode(afterNorm, cardId, 0, 0, 0, 0)
          : autoResizeParent(afterNorm, finalCard.parentId)
        const parentAfter = afterResize.get(finalCard.parentId)
        const parentBefore = preMouseUpCards.get(finalCard.parentId)

        // Determine which cards actually changed so we only write what changed.
        // normalizeChildPositions may have shifted children (left/up overflow fix),
        // and autoResizeParent may have grown the parent -- either or both may apply.
        const normChanged = afterNorm !== preMouseUpCards
        const resizeChanged =
          parentAfter &&
          parentBefore &&
          (parentAfter.width !== parentBefore.width || parentAfter.height !== parentBefore.height)

        if (normChanged || resizeChanged) {
          setCards(afterResize)

          // Persist all cards that differ from the pre-drag snapshot (covers
          // pushed siblings in pushing mode) AND cards changed by normalize/resize.
          const baseline = dragStartSnapshot ?? preMouseUpCards
          const writes: Promise<void>[] = []
          for (const [id, card] of afterResize) {
            const before = baseline.get(id)
            if (
              !before ||
              card.x !== before.x ||
              card.y !== before.y ||
              card.width !== before.width ||
              card.height !== before.height
            ) {
              writes.push(db.updateNodeLayout(id, mapId, card.x, card.y, card.width, card.height))
            }
          }
          try {
            await Promise.all(writes)
            setError(null)
          } catch (err) {
            console.error('[Canvas] Failed to persist layout-only drag with normalize/resize:', err)
            setError('Failed to save position.')
          }

          // Persist relationship label positions for the dragged card and all its
          // descendants (children move with the parent, so their rel labels shift too).
          await persistRelCardPositions(getRelsForDraggedSubtree(cardId))

          return
        }
      }

      // No parent-level normalize/resize needed (or card is top-level).
      // Still need to persist any cards that moved (dragged card + pushed siblings).
      const baseline = dragStartSnapshot ?? preMouseUpCards
      const writes: Promise<void>[] = []
      for (const [id, card] of preMouseUpCards) {
        const before = baseline.get(id)
        if (
          !before ||
          card.x !== before.x ||
          card.y !== before.y ||
          card.width !== before.width ||
          card.height !== before.height
        ) {
          writes.push(db.updateNodeLayout(id, mapId, card.x, card.y, card.width, card.height))
        }
      }
      if (writes.length > 0) {
        try {
          await Promise.all(writes)
          setError(null)
        } catch (err) {
          console.error('[Canvas] Failed to persist drag position (layout-only):', err)
          setError('Failed to save position.')
        }
      } else {
        // Fallback: just persist the dragged card if the snapshot was unavailable.
        try {
          await db.updateNodeLayout(finalCard.id, mapId, finalCard.x, finalCard.y, finalCard.width, finalCard.height)
          setError(null)
        } catch (err) {
          console.error('[Canvas] Failed to persist drag position (layout-only fallback):', err)
          setError('Failed to save position.')
        }
      }

      // Persist relationship label positions for the dragged card and all its
      // descendants (children move with the parent, so their rel labels shift too).
      await persistRelCardPositions(getRelsForDraggedSubtree(cardId))
    }
  }, [dragState, isPanning, resizeState, connectingState, connectingMousePos, reattachState, reattachMousePos, draggingRelCardId, relCardDragOffset, persistRelCardPositions, getRelsForDraggedSubtree, mapId, setSelectedId])

  // ---------------------------------------------------------------------------
  // CREATE NEW CARD (double-click on empty canvas)
  // ---------------------------------------------------------------------------
  const handleDoubleClick = useCallback(
    async (e: React.MouseEvent) => {
      const isCanvas =
        e.target === canvasRef.current ||
        (e.target as HTMLElement).dataset?.canvas === 'true'
      if (!isCanvas) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      try {
        const id = await db.createNode(mapId, '', canvasX, canvasY, 200, 100)
        const newCard: CardData = {
          id,
          content: '',
          x: canvasX,
          y: canvasY,
          width: 200,
          height: 100,
          parentId: null,
          depth: 0,
          color: getDepthColor(0),
        }
        setCards((prev) => {
          const updated = new Map(prev)
          updated.set(id, newCard)
          return updated
        })
        setSelectedId(id)
        setNewCardId(id)  // Signal Card to auto-focus the textarea
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to create card:', err)
        setError(`Failed to create card: ${err}`)
      }
    },
    [viewport, mapId, setSelectedId]
  )

  // ---------------------------------------------------------------------------
  // UPDATE CARD CONTENT (from Card inline edit)
  // ---------------------------------------------------------------------------
  const handleContentChange = useCallback(
    async (cardId: number, newContent: string) => {
      // Optimistic update
      setCards((prev) => {
        const updated = new Map(prev)
        const card = updated.get(cardId)
        if (!card) return prev
        updated.set(cardId, { ...card, content: newContent })
        return updated
      })

      try {
        await db.updateNodeContent(cardId, newContent)
        // Also persist the card's current width -- it may have grown during
        // the editing session via handleWidthChange (auto-expand on typing).
        const currentCard = cardsRef.current.get(cardId)
        if (currentCard) {
          await db.updateNodeLayout(
            cardId, mapId,
            currentCard.x, currentCard.y,
            currentCard.width, currentCard.height,
          )
        }
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to update card content:', err)
        setError('Failed to save text.')
        // Revert optimistic update
        setCards((prev) => {
          const updated = new Map(prev)
          const card = updated.get(cardId)
          if (!card) return prev
          // We don't have the old value easily; re-fetch to be safe
          return prev
        })
      }
    },
    [mapId]
  )

  // ---------------------------------------------------------------------------
  // WIDTH CHANGE (Card title auto-expand while typing)
  // ---------------------------------------------------------------------------
  // Called on every keystroke while editing a card title. Updates card width
  // in state immediately (optimistic) and runs push-mode so the expanding card
  // can nudge siblings. Width is not persisted here -- that happens in
  // handleContentChange when the user commits the edit (Enter / blur).
  const handleWidthChange = useCallback(
    (cardId: number, newWidth: number) => {
      setCards((prev) => {
        const updated = new Map(prev)
        const card = updated.get(cardId)
        if (!card) return prev
        updated.set(cardId, { ...card, width: newWidth })
        // Run push mode so the widening card pushes any siblings out of the way.
        const abs = getAbsolutePosition(updated, cardId)
        return applyPushMode(updated, cardId, abs.x, abs.y, abs.x, abs.y)
      })
    },
    []
  )

  // ---------------------------------------------------------------------------
  // RESET CARD SIZE (double-click on card body)
  // ---------------------------------------------------------------------------
  const handleResetSize = useCallback(
    async (cardId: number) => {
      const card = cardsRef.current.get(cardId)
      if (!card) return

      const children = getChildren(cardsRef.current, cardId)
      const isParent = children.length > 0

      let resetW: number
      let resetH: number

      if (isParent) {
        // Parent card: center children inside the parent with equal margins on
        // all four sides, then fit the parent to that centered content.
        // fitToContents handles the shift + resize + floor clear in one step.
        const stateBefore = new Map(cardsRef.current)

        const nextCards = fitToContents(cardsRef.current, cardId)
        setCards(nextCards)

        // Persist all changed cards (shifted children + resized parent).
        try {
          const writes: Promise<void>[] = []
          for (const [id, c] of nextCards) {
            const before = stateBefore.get(id)
            if (!before) continue
            const posChanged = c.x !== before.x || c.y !== before.y
            const sizeChanged = c.width !== before.width || c.height !== before.height
            if (posChanged || sizeChanged) {
              writes.push(db.updateNodeLayout(id, mapId, c.x, c.y, c.width, c.height))
            }
          }
          await Promise.all(writes)
          // If the parent itself has a parent, re-run auto-resize upward so
          // ancestors reflect the parent's new (potentially smaller) size.
          const updatedParent = nextCards.get(cardId)
          if (updatedParent?.parentId !== null && updatedParent?.parentId !== undefined) {
            setCards((prev) => autoResizeParent(prev, updatedParent.parentId!))
          }
          setError(null)
        } catch (err) {
          console.error('[Canvas] Failed to persist fit-to-contents:', err)
          setError('Failed to save fit-to-contents.')
          setCards(stateBefore)
        }
        return
      } else {
        // Leaf card: measure title text width so the card fits its content.
        // Font parameters must match Card.tsx's measureAndResize exactly.
        const fontSize = Math.max(10, Math.min(14, 14 / Math.max(1, card.depth * 0.3 + 0.7)))
        const measurer = document.createElement('canvas')
        const ctx = measurer.getContext('2d')
        resetW = 200  // default creation width as fallback
        if (ctx) {
          ctx.font = `600 ${fontSize}px system-ui, -apple-system, sans-serif`
          const measured = ctx.measureText(card.content || '')
          const headerPadding = 48  // matches Card.tsx measureAndResize headerPadding
          resetW = Math.max(200, Math.ceil(measured.width) + headerPadding)
        }
        resetH = 100
      }

      // Optimistic update.
      setCards((prev) => {
        let updated = new Map(prev)
        const c = updated.get(cardId)
        if (!c) return prev
        updated.set(cardId, { ...c, width: resetW, height: resetH })
        // If the card has a parent, re-run auto-resize so the parent adjusts.
        if (c.parentId !== null) {
          updated = autoResizeParent(updated, c.parentId)
        }
        return updated
      })

      // Persist.
      try {
        await db.updateNodeLayout(cardId, mapId, card.x, card.y, resetW, resetH)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to persist reset size:', err)
        setError('Failed to save size reset.')
        // Revert to original size and floor
        setCards((prev) => {
          const updated = new Map(prev)
          const c = updated.get(cardId)
          if (!c) return prev
          updated.set(cardId, { ...c, width: card.width, height: card.height })
          return updated
        })
      }
    },
    [mapId]
  )

  // ---------------------------------------------------------------------------
  // DELETE CARD (Delete key when a card is selected)
  // ---------------------------------------------------------------------------

  /** Collect all descendant IDs (not including the card itself) by walking parentId links. */
  const collectDescendants = useCallback((rootId: number, allCards: Map<number, CardData>): Set<number> => {
    const result = new Set<number>()
    const walk = (id: number) => {
      for (const [cid, c] of allCards) {
        if (c.parentId === id) {
          result.add(cid)
          walk(cid)
        }
      }
    }
    walk(rootId)
    return result
  }, [])

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteConfirm) return
    const { cardId } = deleteConfirm
    const snapshot = cardsRef.current
    const descendants = collectDescendants(cardId, snapshot)
    const deletedIds = new Set([cardId, ...descendants])

    try {
      await db.deleteNodeCascade(cardId)
      setError(null)

      // Remove all deleted cards from state
      setCards((prev) => {
        const updated = new Map(prev)
        for (const id of deletedIds) updated.delete(id)
        return updated
      })

      // Clean up relationships: remove any that touch a deleted card
      setRelationships((prev) => prev.filter((r) => !deletedIds.has(r.sourceId) && !deletedIds.has(r.targetId)))

      // Clean up relationship card positions for removed relationships
      setRelCardPositions((prev) => {
        const next = new Map(prev)
        // We need to know which rel IDs to remove -- those whose source or target was deleted
        for (const [relId] of next) {
          const rel = relationshipsRef.current.find((r) => r.id === relId)
          if (rel && (deletedIds.has(rel.sourceId) || deletedIds.has(rel.targetId))) {
            next.delete(relId)
          }
        }
        return next
      })

      // Clear selection/editing state if they reference deleted items
      if (selectedId !== null && deletedIds.has(selectedId)) setSelectedId(null)
      if (selectedRelId !== null) {
        const rel = relationshipsRef.current.find((r) => r.id === selectedRelId)
        if (rel && (deletedIds.has(rel.sourceId) || deletedIds.has(rel.targetId))) setSelectedRelId(null)
      }
      if (editingRelId !== null) {
        const rel = relationshipsRef.current.find((r) => r.id === editingRelId)
        if (rel && (deletedIds.has(rel.sourceId) || deletedIds.has(rel.targetId))) setEditingRelId(null)
      }
    } catch (err) {
      console.error('[Canvas] Failed to cascade-delete card:', err)
      setError(`Failed to delete card: ${err}`)
    }

    setDeleteConfirm(null)
  }, [deleteConfirm, collectDescendants, selectedId, selectedRelId, editingRelId, setSelectedId])

  const handleCancelDelete = useCallback(() => {
    setDeleteConfirm(null)
  }, [])

  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedId !== null) {
        // Guard: let the browser handle Delete normally when a text field is focused
        const el = document.activeElement
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return
        if (el instanceof HTMLElement && el.isContentEditable) return

        // Don't double-trigger if the confirmation dialog is already showing
        if (deleteConfirm !== null) return

        const id = selectedId
        const currentCards = cardsRef.current
        const descendants = collectDescendants(id, currentCards)

        if (descendants.size === 0) {
          // Leaf card: delete directly, no confirmation needed
          try {
            await db.deleteNode(id)
            setError(null)
            setCards((prev) => { const updated = new Map(prev); updated.delete(id); return updated })
            setSelectedId(null)
          } catch (err) {
            console.error('[Canvas] Failed to delete card:', err)
            setError(`Failed to delete card: ${err}`)
          }
        } else {
          // Card with parts: show confirmation dialog
          setDeleteConfirm({ cardId: id, descendantCount: descendants.size })
        }
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId, deleteConfirm, collectDescendants, setSelectedId])

  // ---------------------------------------------------------------------------
  // RELATIONSHIP KEYBOARD ACTIONS (Delete, F to flip, Escape)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (selectedRelId === null) return

      if (e.key === 'Delete') {
        const id = selectedRelId
        const relsBefore = [...relationshipsRef.current]
        const posBefore = new Map(relCardPositionsRef.current)
        setRelationships((prev) => prev.filter((r) => r.id !== id))
        setRelCardPositions((prev) => { const next = new Map(prev); next.delete(id); return next })
        setSelectedRelId(null)
        setEditingRelId(null)
        try {
          await db.deleteRelationship(id)
          setError(null)
        } catch (err) {
          console.error('[Canvas] Failed to delete relationship:', err)
          setError(`Failed to delete relationship: ${err}`)
          setRelationships(relsBefore)
          setRelCardPositions(posBefore)
          setSelectedRelId(id)
        }
      } else if (e.key === 'f' || e.key === 'F') {
        // Flip direction
        const id = selectedRelId
        const relsBefore = [...relationshipsRef.current]
        setRelationships((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, sourceId: r.targetId, targetId: r.sourceId } : r
          )
        )
        try {
          await db.flipRelationship(id)
          setError(null)
        } catch (err) {
          console.error('[Canvas] Failed to flip relationship:', err)
          setError(`Failed to flip relationship: ${err}`)
          setRelationships(relsBefore)
        }
      } else if (e.key === 'Escape') {
        setSelectedRelId(null)
        setEditingRelId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedRelId])

  // ---------------------------------------------------------------------------
  // DELETE CONFIRM MODAL -- Escape key to cancel
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!deleteConfirm) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleCancelDelete()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteConfirm, handleCancelDelete])

  // ---------------------------------------------------------------------------
  // CREATE CARD KEYBOARD SHORTCUT ("C" key)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key !== 'c' && e.key !== 'C') return
      // Don't fire when typing inside a text field or contenteditable
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      ) return

      // Convert the last known mouse position to canvas coordinates
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return
      const canvasX = (lastMouseRef.current.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (lastMouseRef.current.clientY - rect.top - viewport.panY) / viewport.zoom

      try {
        const id = await db.createNode(mapId, '', canvasX, canvasY, 200, 100)
        const newCard: CardData = {
          id,
          content: '',
          x: canvasX,
          y: canvasY,
          width: 200,
          height: 100,
          parentId: null,
          depth: 0,
          color: getDepthColor(0),
        }
        setCards((prev) => {
          const updated = new Map(prev)
          updated.set(id, newCard)
          return updated
        })
        setSelectedId(id)
        setNewCardId(id)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to create card:', err)
        setError(`Failed to create card: ${err}`)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewport, mapId, setSelectedId])

  // ---------------------------------------------------------------------------
  // RELATIONSHIP LABEL COMMIT
  // ---------------------------------------------------------------------------
  const handleRelLabelCommit = useCallback(
    async (relId: number, action: string) => {
      setEditingRelId(null)
      const relsBefore = [...relationshipsRef.current]
      setRelationships((prev) =>
        prev.map((r) => (r.id === relId ? { ...r, action } : r))
      )
      try {
        await db.updateRelationship(relId, action)
        setError(null)
      } catch (err) {
        console.error('[Canvas] Failed to update relationship label:', err)
        setError(`Failed to save relationship label: ${err}`)
        setRelationships(relsBefore)
      }
    },
    []
  )

  // ---------------------------------------------------------------------------
  // SELECT RELATIONSHIP (from line click)
  // ---------------------------------------------------------------------------
  const handleSelectRel = useCallback((relId: number) => {
    setSelectedRelId(relId)
    setSelectedId(null) // Clear card selection
  }, [setSelectedId])

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  // Selecting a card clears any active relationship selection
  const handleSelectCard = useCallback((cardId: number) => {
    setSelectedId(cardId)
    setSelectedRelId(null)
    // Do NOT clear editingRelId here -- if the label EditInput is open, clicking
    // a card fires onBlur on the input first, which commits and clears it. Forcing
    // null here races against that blur and can drop the in-progress edit.
  }, [setSelectedId])

  // Issue 2: compute the single drop target ID for the current drag.
  // Priority: explicit nest target > current parent (only if card is still inside it) > null.
  // The indicator must always reflect what will actually happen on mouse-up.
  const dropTargetId: number | null = (() => {
    if (!dragState) return null
    if (dragState.nestTargetId !== null) return dragState.nestTargetId
    const dragged = cards.get(dragState.cardId)
    if (!dragged || dragged.parentId === null) return null
    // Only show the parent highlight while the card is still physically inside it.
    const parentCard = cards.get(dragged.parentId)
    if (!parentCard) return null
    const absPos = getAbsolutePosition(cards, dragState.cardId)
    const centerX = absPos.x + dragged.width / 2
    const centerY = absPos.y + dragged.height / 2
    const parentAbs = getAbsolutePosition(cards, dragged.parentId)
    const insideParent =
      centerX >= parentAbs.x &&
      centerX <= parentAbs.x + parentCard.width &&
      centerY >= parentAbs.y &&
      centerY <= parentAbs.y + parentCard.height
    return insideParent ? dragged.parentId : null
  })()

  const topLevelCards: CardData[] = []
  for (const card of cards.values()) {
    if (card.parentId === null) topLevelCards.push(card)
  }

  // Fix 1: the ghost card for the currently-dragged card.
  // We render it once at the root level of the canvas transform div so it
  // escapes all nested CSS stacking contexts. The card is omitted from its
  // normal nested position in the render below (see the `isDraggingThisCard`
  // guard inside the Card component).
  const draggingId = dragState?.cardId ?? null
  const ghostCard: CardData | null = (() => {
    if (!dragState) return null
    const c = cards.get(dragState.cardId)
    if (!c) return null
    // Return a modified copy positioned at absolute canvas coordinates.
    // parentId is set to null so the ghost div is placed directly on the
    // canvas transform layer (left: absX, top: absY).
    return { ...c, x: dragState.absX, y: dragState.absY, parentId: null }
  })()

  // Task 4: Breadcrumb -- walk the ancestor chain of the selected card.
  // Result is ordered root-first: ["Canvas", "Bicycle", "Wheels", "Front Wheel"]
  // This is display-only in M2; clicking segments is deferred to M3 navigation.
  const breadcrumb: Array<{ id: number | null; label: string }> = [
    { id: null, label: 'Canvas' },
  ]
  if (selectedId !== null) {
    const chain: Array<{ id: number; label: string }> = []
    let current = cards.get(selectedId)
    while (current) {
      chain.unshift({
        id: current.id,
        label: current.content || `Card ${current.id}`,
      })
      current = current.parentId !== null ? cards.get(current.parentId) : undefined
    }
    breadcrumb.push(...chain)
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

      {/* Breadcrumb bar */}
      <div
        style={{
          height: 36,
          backgroundColor: '#fff',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          alignItems: 'center',
          padding: '0 16px',
          gap: 8,
          flexShrink: 0,
          zIndex: 2000,
        }}
      >
        {/* Ancestor trail -- display only in M2, navigation in M3 */}
        {breadcrumb.map((crumb, index) => (
          <React.Fragment key={crumb.id ?? 'root'}>
            {index > 0 && (
              <span style={{ fontSize: 12, color: '#bbb', userSelect: 'none' }}>{'>'}</span>
            )}
            <span
              style={{
                fontSize: 13,
                fontWeight: index === breadcrumb.length - 1 ? 600 : 400,
                color: index === breadcrumb.length - 1 ? '#333' : '#888',
                maxWidth: 140,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              {crumb.label}
            </span>
          </React.Fragment>
        ))}
        <div style={{ flex: 1 }} />
        {/* Error indicator */}
        {error && (
          <span style={{ fontSize: 12, color: '#c62828', marginRight: 8 }}>
            {error}
          </span>
        )}
        {/* Zoom-to-fit button */}
        <button
          onClick={zoomToFit}
          title="Zoom to fit all cards (Ctrl+0)"
          style={{
            padding: '4px 10px',
            fontSize: 12,
            borderRadius: 4,
            border: '1px solid #bdbdbd',
            background: '#fafafa',
            cursor: 'pointer',
            color: '#444',
          }}
        >
          Fit
        </button>
        <span style={{ fontSize: 12, color: '#999', minWidth: 40, textAlign: 'right' }}>
          {Math.round(viewport.zoom * 100)}%
        </span>
      </div>

      {/* Canvas area */}
      <div
        ref={canvasRef}
        data-canvas="true"
        style={{
          flex: 1,
          overflow: 'hidden',
          backgroundColor: '#f5f5f5',
          cursor: isPanning ? 'grabbing' : (dragState || draggingRelCardId !== null) ? 'grabbing' : (reattachState || connectingState) ? 'crosshair' : spaceHeld ? 'grab' : 'default',
          position: 'relative',
        }}
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseDownCapture={(e) => {
          // When Space is held, intercept ALL mousedowns (even on cards) to start panning.
          // Capture phase fires before card mousedown handlers, so e.stopPropagation()
          // prevents them from starting a card drag.
          if (e.button === 0 && spaceHeldRef.current) {
            e.stopPropagation()
            e.preventDefault()
            setSelectedId(null)
            setSelectedRelId(null)
            setIsPanning(true)
            panStartRef.current = {
              x: e.clientX,
              y: e.clientY,
              panX: viewport.panX,
              panY: viewport.panY,
            }
          }
        }}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={() => setHoveredCardId(null)}
        onDoubleClick={handleDoubleClick}
      >
        {/* Global cursor override when Space is held for panning.
            !important beats crosshair on connection handles, grab on card roots,
            and text on textareas -- everything defers to the pan cursor. */}
        {(spaceHeld || isPanning) && (
          <style>{`
            [data-canvas="true"] * {
              cursor: ${isPanning ? 'grabbing' : 'grab'} !important;
            }
          `}</style>
        )}

        {/* Loading overlay */}
        {isLoading && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(245,245,245,0.9)',
              zIndex: 2000,
              fontSize: 14,
              color: '#666',
            }}
          >
            Loading canvas...
          </div>
        )}

        {/* Empty state hint */}
        {!isLoading && cards.size === 0 && (
          <div
            data-canvas="true"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <span style={{ fontSize: 14, color: '#bbb', userSelect: 'none' }}>
              Double-click or press C to create a card
            </span>
          </div>
        )}

        {/* Canvas transform layer */}
        <div
          data-canvas="true"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            transformOrigin: '0 0',
            transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          }}
        >
          {/* Relationship SVG overlay -- rendered before cards so lines appear
              visually behind card content but the SVG hit areas still work.
              The SVG has pointer-events: none; only the hit-area strokes and
              text inside it have pointer-events: all. */}
          <RelationshipOverlay
            relationships={relationships}
            cards={cards}
            relCardPositions={relCardPositions}
            selectedRelId={selectedRelId}
            editingRelId={editingRelId}
            onSelectRel={handleSelectRel}
            onLabelCommit={handleRelLabelCommit}
            onEditStart={setEditingRelId}
            onEditCancel={() => setEditingRelId(null)}
            onRelCardDragStart={handleRelCardDragStart}
            onEndpointDragStart={handleEndpointDragStart}
            connectingSource={connectingState ? { x: connectingState.startX, y: connectingState.startY } : null}
            connectingMouse={connectingMousePos}
            reattachFixed={reattachState ? { x: reattachState.fixedX, y: reattachState.fixedY } : null}
            reattachMouse={reattachMousePos}
          />

          {topLevelCards.map((card) => {
            // Fix 1: skip the dragged card in its normal tree position.
            // It will be rendered as a root-level ghost below, escaping all
            // nested stacking contexts.
            if (card.id === draggingId) return null
            return (
              <Card
                key={card.id}
                card={card}
                allCards={cards}
                dragState={dragState}
                draggingId={draggingId}
                selectedId={selectedId}
                newCardId={newCardId}
                dropTargetId={dropTargetId}
                onDragStart={handleCardDragStart}
                onSelect={handleSelectCard}
                onContentChange={handleContentChange}
                onResetSize={handleResetSize}
                onAutoFocusConsumed={() => setNewCardId(null)}
                onWidthChange={handleWidthChange}
                zoom={viewport.zoom}
                onConnectStart={handleConnectStart}
                isConnecting={connectingState !== null}
                isHovered={hoveredCardId === card.id}
                hoveredCardId={hoveredCardId}
              />
            )
          })}

          {/* Fix 1: root-level ghost for the card being dragged.
              Rendered outside its parent's DOM subtree so CSS z-index works
              across all stacking contexts. zIndex 10000 puts it above everything. */}
          {ghostCard && (
            <Card
              key={`ghost-${ghostCard.id}`}
              card={ghostCard}
              allCards={cards}
              dragState={dragState}
              draggingId={draggingId}
              selectedId={selectedId}
              newCardId={newCardId}
              dropTargetId={dropTargetId}
              onDragStart={handleCardDragStart}
              onSelect={handleSelectCard}
              onContentChange={handleContentChange}
              onResetSize={handleResetSize}
              onAutoFocusConsumed={() => setNewCardId(null)}
              onWidthChange={handleWidthChange}
              zoom={viewport.zoom}
              ghostZIndex={10000}
              isHovered={false}
            />
          )}
        </div>

        {/* Keyboard hint -- bottom-left */}
        {!isLoading && (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              left: 10,
              zIndex: 1000,
              background: 'rgba(255,255,255,0.9)',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              color: '#bbb',
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          >
            Space: Pan&nbsp;&nbsp;·&nbsp;&nbsp;C: New card&nbsp;&nbsp;·&nbsp;&nbsp;Double-click: New card
          </div>
        )}

        {/* Card count indicator */}
        {!isLoading && (
          <div
            style={{
              position: 'absolute',
              bottom: 10,
              right: 10,
              zIndex: 1000,
              background: 'rgba(255,255,255,0.9)',
              padding: '4px 10px',
              borderRadius: 6,
              fontSize: 12,
              color: '#999',
              pointerEvents: 'none',
            }}
          >
            {cards.size} card{cards.size !== 1 ? 's' : ''}{relationships.length > 0 ? ` · ${relationships.length} relationship${relationships.length !== 1 ? 's' : ''}` : ''}
          </div>
        )}
      </div>

      {/* CF-2: Subtree delete confirmation modal */}
      {deleteConfirm !== null && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0,0,0,0.35)',
            zIndex: 9000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseDown={handleCancelDelete}
        >
          <div
            style={{
              backgroundColor: '#fff',
              borderRadius: 10,
              boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              padding: '28px 32px 24px',
              minWidth: 340,
              maxWidth: 420,
              display: 'flex',
              flexDirection: 'column',
              gap: 20,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 15, color: '#222', lineHeight: 1.5 }}>
              This card contains{' '}
              <strong>{deleteConfirm.descendantCount}</strong>{' '}
              part{deleteConfirm.descendantCount !== 1 ? 's' : ''}.
              Delete the card and everything inside it?
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button
                onClick={handleCancelDelete}
                style={{
                  padding: '7px 18px',
                  borderRadius: 6,
                  border: '1px solid #d0d0d0',
                  backgroundColor: '#f5f5f5',
                  color: '#444',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                style={{
                  padding: '7px 18px',
                  borderRadius: 6,
                  border: 'none',
                  backgroundColor: '#c62828',
                  color: '#fff',
                  fontSize: 13,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                Delete all
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
