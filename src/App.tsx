/**
 * Plectica 2.0 -- Production Canvas App (M1)
 * ============================================
 *
 * M1 scope: Cards on canvas. Create, edit, move, resize, delete.
 * Every mutation persists immediately to SQLite via the IPC layer.
 * Nesting is M2 -- drag-to-nest detection is disabled via NESTING_ENABLED flag.
 *
 * Architecture:
 * - Infinite canvas via CSS transform (translate + scale) on a container div
 * - Cards are absolutely positioned divs rendered by <Card />
 * - In-memory Map<number, CardData> is the render cache; DB is source of truth
 * - All DB writes are async with try/catch; UI reverts on failure
 *
 * Pan/zoom:
 * - Scroll to pan, Ctrl+Scroll to zoom (centered on cursor)
 * - Middle-mouse drag to pan
 * - Ctrl+0 or zoom-to-fit button to fit all cards
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import type { CardData, CanvasViewport, DragState, ResizeState, RelationshipData, ConnectingState } from './store/types'
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
  computeStackedPosition,
  computeEdgePoint,
  PADDING,
  BOTTOM_PADDING,
  HEADER_HEIGHT,
  MIN_W,
  MIN_H,
} from './store/canvas-store'
import { Card } from './components/Card'
import { RelationshipOverlay } from './components/RelationshipLine'
import { db } from './ipc'

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
// INFINITE CANVAS COMPONENT
// ============================================================================

export default function App() {
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
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newCardId, setNewCardId] = useState<number | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // M3: Relationships
  const [relationships, setRelationships] = useState<RelationshipData[]>([])
  const [selectedRelId, setSelectedRelId] = useState<number | null>(null)
  const [connectingState, setConnectingState] = useState<ConnectingState | null>(null)
  // Current mouse position in canvas coordinates, tracked during connection draw
  const [connectingMousePos, setConnectingMousePos] = useState<{ x: number; y: number } | null>(null)
  const [editingRelId, setEditingRelId] = useState<number | null>(null)

  // M3: Relationship card drag state
  // relCardPositions: absolute canvas-space position of each relationship card,
  // keyed by relationship ID. Populated from relationship node layout rows on
  // load; updated on drag; persisted to DB on mouseup.
  const [relCardPositions, setRelCardPositions] = useState<Map<number, { x: number; y: number }>>(new Map())
  const [draggingRelCardId, setDraggingRelCardId] = useState<number | null>(null)
  // Offset from the card's center to the mouse position at drag-start, in canvas space
  const [relCardDragOffset, setRelCardDragOffset] = useState<{ x: number; y: number } | null>(null)

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

  // Keep a stable ref to cards for use inside event handlers that close over stale state
  const cardsRef = useRef(cards)
  useEffect(() => { cardsRef.current = cards }, [cards])

  // ---------------------------------------------------------------------------
  // INITIALIZATION -- load cards from DB on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false

    async function loadCards() {
      try {
        const [nodes, rels] = await Promise.all([
          db.getMapNodes(1),
          db.getMapRelationships(1),
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
        setRelationships(rels)

        // Build relCardPositions: map each rel.id -> its node's canvas position.
        // A position of (0, 0) means the relationship was just created and the
        // card hasn't been moved -- RelationshipOverlay will use the computed
        // midpoint as the fallback.
        const positions = new Map<number, { x: number; y: number }>()
        for (const rel of rels) {
          if (rel.relNodeId !== null) {
            const nodePos = relNodePositions.get(rel.relNodeId)
            if (nodePos) {
              positions.set(rel.id, { x: nodePos.x, y: nodePos.y })
            }
          }
        }
        setRelCardPositions(positions)
        setError(null)
      } catch (err) {
        if (cancelled) return
        console.error('[App] Failed to load map nodes:', err)
        setError(`Failed to load canvas data: ${err}`)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    loadCards()
    return () => { cancelled = true }
  }, [])

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

      if (isCanvas || e.button === 1) {
        // Left click on empty canvas or middle-mouse: start panning
        setSelectedId(null)
        setSelectedRelId(null)
        setEditingRelId(null)
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
    [viewport.panX, viewport.panY]
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
    []
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

      // Resolve the card's actual visual position. A stored position of (0, 0)
      // means the card has never been dragged -- RelationshipOverlay uses the
      // computed edge-to-edge midpoint as the fallback, so we must match that
      // logic here. Using (0, 0) as the card position would make the drag offset
      // equal to the full canvas coordinate of the cursor, causing the card to
      // fly to the upper-left on the first drag frame.
      const stored = relCardPositionsRef.current.get(relId)
      let visualX: number
      let visualY: number
      if (stored && (stored.x !== 0 || stored.y !== 0)) {
        visualX = stored.x
        visualY = stored.y
      } else {
        // Recompute the same midpoint that RelationshipOverlay shows as the default.
        const rel = relationshipsRef.current.find((r) => r.id === relId)
        if (rel) {
          const srcCard = cardsRef.current.get(rel.sourceId)
          const tgtCard = cardsRef.current.get(rel.targetId)
          if (srcCard && tgtCard) {
            const srcAbs = getAbsolutePosition(cardsRef.current, rel.sourceId)
            const tgtAbs = getAbsolutePosition(cardsRef.current, rel.targetId)
            const srcCenter = { x: srcAbs.x + srcCard.width / 2, y: srcAbs.y + srcCard.height / 2 }
            const tgtCenter = { x: tgtAbs.x + tgtCard.width / 2, y: tgtAbs.y + tgtCard.height / 2 }
            const edgeStart = computeEdgePoint(srcCenter, tgtCenter, { x: srcAbs.x, y: srcAbs.y, w: srcCard.width, h: srcCard.height })
            const edgeEnd = computeEdgePoint(tgtCenter, srcCenter, { x: tgtAbs.x, y: tgtAbs.y, w: tgtCard.width, h: tgtCard.height })
            visualX = (edgeStart.x + edgeEnd.x) / 2
            visualY = (edgeStart.y + edgeEnd.y) / 2
          } else {
            visualX = canvasX
            visualY = canvasY
          }
        } else {
          visualX = canvasX
          visualY = canvasY
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
    [viewport.panX, viewport.panY, viewport.zoom]
  )

  // (Resize is now detected in handleMouseMove during pendingDrag promotion)

  // ---------------------------------------------------------------------------
  // MOUSE MOVE (handles drag, resize, and pan)
  // ---------------------------------------------------------------------------
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      // --- PENDING DRAG THRESHOLD CHECK ---
      // If a mousedown was recorded but we haven't started a real drag yet,
      // check whether the cursor has moved far enough to commit. We only
      // promote once there is no active drag or resize already in progress
      // (those are mutually exclusive with a pending drag in practice, but
      // the guard keeps the logic airtight).
      const pending = pendingDragRef.current
      if (pending && !dragState && !resizeState && draggingRelCardId === null) {
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
          isResize = nearRight || nearBottom
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
            // Set the floor immediately so autoResizeParent respects it even on
            // the very first frame of a resize drag.
            updated.set(pending.cardId, { ...c, width: newW, height: newH, minWidth: newW, minHeight: newH })
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
        const newX = canvasX - relCardDragOffset.x
        const newY = canvasY - relCardDragOffset.y
        setRelCardPositions((prev) => {
          const next = new Map(prev)
          next.set(draggingRelCardId, { x: newX, y: newY })
          return next
        })
        return
      }

      // --- CONNECTION DRAW ---
      if (connectingState) {
        const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
        const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom
        setConnectingMousePos({ x: canvasX, y: canvasY })
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
          // Update minWidth/minHeight in-memory during drag so that if
          // autoResizeParent fires on the parent chain the floor is already set.
          updated.set(resizeState.cardId, { ...card, width: newW, height: newH, minWidth: newW, minHeight: newH })
          if (card.parentId !== null) {
            return autoResizeParent(updated, card.parentId)
          }
          return updated
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

      // Move connected relationship label cards proportionally.
      // When a card moves by (dx, dy), each label card on a connected relationship
      // shifts by a weighted fraction of that delta. Weight is how close the label
      // is to the moving card (1.0 = at the moving card, 0.0 = at the other endpoint).
      // Labels at (0,0) (never dragged -- auto-recomputed as midpoint each frame) are skipped.
      const prevAbsX = dragState.absX
      const prevAbsY = dragState.absY
      const dxLabel = newAbsX - prevAbsX
      const dyLabel = newAbsY - prevAbsY

      if (dxLabel !== 0 || dyLabel !== 0) {
        // Collect the full set of card IDs that are physically moving this frame:
        // the dragged card itself plus all its descendants (they translate by the
        // same absolute delta because their positions are expressed in their
        // parent's local coordinate space, which moves with the dragged card).
        const movingCardIds = new Set<number>([dragState.cardId])
        for (const [id] of cardsRef.current) {
          if (isAncestor(cardsRef.current, id, dragState.cardId)) {
            movingCardIds.add(id)
          }
        }

        // Union of all relationships touching any moving card, deduped by rel.id.
        const seenRelIds = new Set<number>()
        const allMovingRels: RelationshipData[] = []
        for (const movingId of movingCardIds) {
          const rels = relsByCardRef.current.get(movingId)
          if (!rels) continue
          for (const rel of rels) {
            if (!seenRelIds.has(rel.id)) {
              seenRelIds.add(rel.id)
              allMovingRels.push(rel)
            }
          }
        }

        if (allMovingRels.length) {
          setRelCardPositions((prev) => {
            const next = new Map(prev)
            for (const rel of allMovingRels) {
              const stored = next.get(rel.id)
              if (!stored || (stored.x === 0 && stored.y === 0)) continue // default midpoint recomputes naturally

              const sourceMoving = movingCardIds.has(rel.sourceId)
              const targetMoving = movingCardIds.has(rel.targetId)

              // Both endpoints are moving (e.g. relationship between two children of
              // the dragged card) -- the label translates by the full delta.
              if (sourceMoving && targetMoving) {
                next.set(rel.id, { x: stored.x + dxLabel, y: stored.y + dyLabel })
                continue
              }

              // One endpoint is moving. Determine which card is the "moving" one
              // and which is the stationary "other" so we can compute a weight.
              const movingCardId = sourceMoving ? rel.sourceId : rel.targetId
              const otherCardId  = sourceMoving ? rel.targetId  : rel.sourceId

              const movingCard = cardsRef.current.get(movingCardId)
              const otherCard  = cardsRef.current.get(otherCardId)

              if (!otherCard) {
                next.set(rel.id, { x: stored.x + dxLabel * 0.5, y: stored.y + dyLabel * 0.5 })
                continue
              }

              // Moving card's center: use its current absolute position (before
              // the in-frame update) as the reference point for weight calculation.
              const movingAbs = movingCardId === dragState.cardId
                ? { x: prevAbsX, y: prevAbsY }
                : getAbsolutePosition(cardsRef.current, movingCardId)
              const movingCx = movingAbs.x + (movingCard?.width ?? 0) / 2
              const movingCy = movingAbs.y + (movingCard?.height ?? 0) / 2

              const otherAbs = getAbsolutePosition(cardsRef.current, otherCardId)
              const otherCx = otherAbs.x + otherCard.width / 2
              const otherCy = otherAbs.y + otherCard.height / 2

              // Distance-based weight: how far the label is from each endpoint.
              // weight=1.0 → label is at the moving card (moves fully with it).
              // weight=0.0 → label is at the other card (stays put).
              // Stable for curved arrows, close cards, and crossing cards because
              // distances are always positive -- no axis direction or sign flips.
              const distToMoving = Math.hypot(stored.x - movingCx, stored.y - movingCy)
              const distToOther  = Math.hypot(stored.x - otherCx,  stored.y - otherCy)
              const totalDist = distToMoving + distToOther
              const weight = totalDist > 1 ? distToOther / totalDist : 0.5
              next.set(rel.id, { x: stored.x + dxLabel * weight, y: stored.y + dyLabel * weight })
            }
            return next
          })
        }
      }

      // Update card position (local coords relative to current parent).
      // No autoResizeParent here -- parent resize fires once on mouse-up, not
      // on every frame. Firing it during drag caused the parent to chase the
      // card and made it visually impossible to drag a child outside its parent.
      setCards((prev) => {
        const updated = new Map(prev)
        const c = updated.get(dragState.cardId)
        if (!c) return prev

        const localPos = canvasToLocal(updated, newAbsX, newAbsY, c.parentId)
        updated.set(dragState.cardId, { ...c, x: localPos.x, y: localPos.y })
        return updated
      })
    },
    [dragState, resizeState, isPanning, connectingState, draggingRelCardId, relCardDragOffset, viewport]
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
  // Skips rels with no relNodeId and positions still at the default (0,0).
  const persistRelCardPositions = useCallback(async (rels: typeof relationshipsRef.current) => {
    for (const rel of rels) {
      if (rel.relNodeId === null) continue
      const pos = relCardPositionsRef.current.get(rel.id)
      if (!pos || (pos.x === 0 && pos.y === 0)) continue
      try {
        await db.updateNodeLayout(rel.relNodeId, 1, pos.x, pos.y, 80, 28, null, null)
      } catch (err) {
        console.error('[App] Failed to persist rel card position after card drag:', err)
      }
    }
  }, [])

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

      // Find the relationship to get its relNodeId for DB persistence
      const rel = relationshipsRef.current.find((r) => r.id === relId)
      if (rel && rel.relNodeId !== null) {
        const pos = relCardPositionsRef.current.get(relId)
        if (pos) {
          // Persist the relationship card position using the rel node's layout row.
          // We store x,y as the absolute canvas position. Width/height stay at
          // 80x28 -- the same values the Rust backend sets on create_relationship.
          // The layout table requires width > 0 and height > 0.
          try {
            await db.updateNodeLayout(rel.relNodeId, 1, pos.x, pos.y, 80, 28, null, null)
          } catch (err) {
            console.error('[App] Failed to persist relationship card position:', err)
            setError('Failed to save relationship card position.')
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
        const rel = await db.createRelationship(sourceId, targetId, '', 1)
        setRelationships((prev) => [...prev, rel])
        // Register the new rel with position (0,0) -- RelationshipOverlay falls
        // back to the computed midpoint when x===0 && y===0.
        setRelCardPositions((prev) => {
          const next = new Map(prev)
          next.set(rel.id, { x: 0, y: 0 })
          return next
        })
        setSelectedRelId(rel.id)
        // Immediately open label editor so user can name the relationship
        setEditingRelId(rel.id)
        setError(null)
      } catch (err) {
        console.error('[App] Failed to create relationship:', err)
        setError(`Failed to create relationship: ${err}`)
      }
      return
    }

    if (isPanning) {
      setIsPanning(false)
      return
    }

    if (resizeState) {
      // Persist resize. The card already has minWidth/minHeight set to its current
      // dimensions (updated during the drag in handleMouseMove), so we read them
      // back from state and write them through to the DB.
      const card = cardsRef.current.get(resizeState.cardId)
      setResizeState(null)

      if (card) {
        // Commit the floor: the post-resize size becomes the new minimum.
        const finalMinW = card.width
        const finalMinH = card.height
        setCards((prev) => {
          const updated = new Map(prev)
          const c = updated.get(resizeState.cardId)
          if (!c) return prev
          updated.set(resizeState.cardId, { ...c, minWidth: finalMinW, minHeight: finalMinH })
          return updated
        })
        try {
          await db.updateNodeLayout(card.id, 1, card.x, card.y, card.width, card.height, finalMinW, finalMinH)
        } catch (err) {
          console.error('[App] Failed to persist resize:', err)
          setError('Failed to save resize. Changes may be lost.')
          // Revert: restore the pre-resize size and clear the floor
          setCards((prev) => {
            const updated = new Map(prev)
            const current = updated.get(resizeState.cardId)
            if (!current) return prev
            updated.set(resizeState.cardId, {
              ...current,
              width: resizeState.startWidth,
              height: resizeState.startHeight,
              minWidth: null,
              minHeight: null,
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
        await db.updateNodeLayout(card.id, 1, card.x, card.y, card.width, card.height, card.minWidth, card.minHeight)
        setError(null)
      } catch (err) {
        console.error('[App] Failed to persist drag position:', err)
        setError('Failed to save position. Changes may be lost.')
        // Revert position -- we stored the pre-drag values in dragState offsets
        // but we don't have the original coords. We re-fetch from DB to be safe.
        try {
          const nodes = await db.getMapNodes(1)
          const raw = new Map<number, CardData>()
          for (const node of nodes) {
            raw.set(node.id, nodeWithLayoutToCardData(node, 0))
          }
          setCards(computeDepths(raw))
        } catch (fetchErr) {
          console.error('[App] Failed to revert after drag error:', fetchErr)
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

      // Issue 1 fix: resize bottom-up. If the card being nested is itself a
      // parent with children, its own dimensions must be correct BEFORE we ask
      // the new parent to fit around it. autoResizeParent(cardId) sizes the
      // nested card based on its children, then walks up through nestTargetId
      // and all further ancestors -- so one call handles the entire chain.
      const nestedHasChildren = getChildren(nextCards, cardId).length > 0
      if (nestedHasChildren) {
        nextCards = autoResizeParent(nextCards, cardId)
      } else {
        nextCards = autoResizeParent(nextCards, nestTargetId)
      }
      // Also resize the old parent if the card had one (it may now be smaller).
      if (card.parentId !== null) {
        nextCards = autoResizeParent(nextCards, card.parentId)
      }

      setCards(nextCards)

      // Persist: updateNodeParent atomically sets parent_id and layout coordinates.
      const finalCard = nextCards.get(cardId)!
      try {
        await db.updateNodeParent(
          cardId,
          nestTargetId,
          1,
          finalCard.x,
          finalCard.y,
          finalCard.width,
          finalCard.height,
          finalCard.minWidth,
          finalCard.minHeight
        )
        setError(null)
      } catch (err) {
        console.error('[App] Failed to persist nest:', err)
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
              1,
              finalCard.x,
              finalCard.y,
              finalCard.width,
              finalCard.height,
              finalCard.minWidth,
              finalCard.minHeight
            )
            setError(null)
          } catch (err) {
            console.error('[App] Failed to persist unnest:', err)
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
    const finalCard = cardsRef.current.get(cardId)
    if (finalCard) {
      if (finalCard.parentId !== null) {
        // normalizeChildPositions may shift children; feed its result into
        // autoResizeParent so the two operations see a consistent state.
        const afterNorm = normalizeChildPositions(cardsRef.current, finalCard.parentId)
        const afterResize = autoResizeParent(afterNorm, finalCard.parentId)
        const parentAfter = afterResize.get(finalCard.parentId)
        const parentBefore = cardsRef.current.get(finalCard.parentId)

        // Determine which cards actually changed so we only write what changed.
        // normalizeChildPositions may have shifted children (left/up overflow fix),
        // and autoResizeParent may have grown the parent -- either or both may apply.
        const normChanged = afterNorm !== cardsRef.current
        const resizeChanged =
          parentAfter &&
          parentBefore &&
          (parentAfter.width !== parentBefore.width || parentAfter.height !== parentBefore.height)

        if (normChanged || resizeChanged) {
          setCards(afterResize)

          // Persist all affected cards. Collect cards that differ from the
          // pre-drag snapshot so we don't over-write cards that didn't move.
          const writes: Promise<void>[] = []
          for (const [id, card] of afterResize) {
            const before = cardsRef.current.get(id)
            if (
              !before ||
              card.x !== before.x ||
              card.y !== before.y ||
              card.width !== before.width ||
              card.height !== before.height
            ) {
              writes.push(db.updateNodeLayout(id, 1, card.x, card.y, card.width, card.height, card.minWidth, card.minHeight))
            }
          }
          try {
            await Promise.all(writes)
            setError(null)
          } catch (err) {
            console.error('[App] Failed to persist layout-only drag with normalize/resize:', err)
            setError('Failed to save position.')
          }

          // Persist relationship label positions for the dragged card and all its
          // descendants (children move with the parent, so their rel labels shift too).
          await persistRelCardPositions(getRelsForDraggedSubtree(cardId))

          return
        }
      }

      // No parent changes needed (or card is top-level) -- just persist the card.
      try {
        await db.updateNodeLayout(finalCard.id, 1, finalCard.x, finalCard.y, finalCard.width, finalCard.height, finalCard.minWidth, finalCard.minHeight)
        setError(null)
      } catch (err) {
        console.error('[App] Failed to persist drag position (layout-only):', err)
        setError('Failed to save position.')
      }

      // Persist relationship label positions for the dragged card and all its
      // descendants (children move with the parent, so their rel labels shift too).
      await persistRelCardPositions(getRelsForDraggedSubtree(cardId))
    }
  }, [dragState, isPanning, resizeState, connectingState, connectingMousePos, draggingRelCardId, relCardDragOffset, persistRelCardPositions, getRelsForDraggedSubtree])

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
        const id = await db.createNode(1, '', canvasX, canvasY, 150, 60)
        const newCard: CardData = {
          id,
          content: '',
          x: canvasX,
          y: canvasY,
          width: 150,
          height: 60,
          parentId: null,
          depth: 0,
          color: getDepthColor(0),
          minWidth: null,
          minHeight: null,
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
        console.error('[App] Failed to create card:', err)
        setError(`Failed to create card: ${err}`)
      }
    },
    [viewport]
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
        setError(null)
      } catch (err) {
        console.error('[App] Failed to update card content:', err)
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
        // Parent card: fit tightly to the children bounding box (same logic as
        // autoResizeParent, but applied directly so we can compute the target size
        // without triggering the floor guard -- we're clearing the floor here).
        let maxRight = 0
        let maxBottom = 0
        for (const child of children) {
          maxRight = Math.max(maxRight, child.x + child.width)
          maxBottom = Math.max(maxBottom, child.y + child.height)
        }
        resetW = Math.max(MIN_W, maxRight + PADDING)
        resetH = Math.max(MIN_H, HEADER_HEIGHT + maxBottom + BOTTOM_PADDING)
      } else {
        // Leaf card: snap back to the same dimensions used when a new card is
        // created (handleDoubleClick). Must stay in sync with that path.
        resetW = 150
        resetH = 60
      }

      // Optimistic update -- clear the floor (minWidth/minHeight = null) so
      // autoResizeParent can shrink this card freely from now on.
      setCards((prev) => {
        let updated = new Map(prev)
        const c = updated.get(cardId)
        if (!c) return prev
        updated.set(cardId, { ...c, width: resetW, height: resetH, minWidth: null, minHeight: null })
        // If the card has a parent, re-run auto-resize so the parent adjusts.
        if (c.parentId !== null) {
          updated = autoResizeParent(updated, c.parentId)
        }
        return updated
      })

      // Persist -- floor cleared (null, null).
      try {
        await db.updateNodeLayout(cardId, 1, card.x, card.y, resetW, resetH, null, null)
        setError(null)
      } catch (err) {
        console.error('[App] Failed to persist reset size:', err)
        setError('Failed to save size reset.')
        // Revert to original size and floor
        setCards((prev) => {
          const updated = new Map(prev)
          const c = updated.get(cardId)
          if (!c) return prev
          updated.set(cardId, { ...c, width: card.width, height: card.height, minWidth: card.minWidth, minHeight: card.minHeight })
          return updated
        })
      }
    },
    []
  )

  // ---------------------------------------------------------------------------
  // DELETE CARD (Delete key when a card is selected)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = async (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedId !== null) {
        const id = selectedId
        const cardsBefore = new Map(cardsRef.current)

        // Optimistic: remove card and all descendants from local state
        setCards((prev) => {
          const updated = new Map(prev)
          const toDelete = new Set<number>()
          const collectDescendants = (targetId: number) => {
            toDelete.add(targetId)
            for (const [cid, c] of updated) {
              if (c.parentId === targetId) collectDescendants(cid)
            }
          }
          collectDescendants(id)
          for (const did of toDelete) updated.delete(did)
          return updated
        })
        setSelectedId(null)

        try {
          await db.deleteNode(id)
          setError(null)
        } catch (err) {
          console.error('[App] Failed to delete card:', err)
          // Rust returns a descriptive message for the FK RESTRICT case.
          const msg = String(err)
          if (msg.includes('has children')) {
            setError('Cannot delete: this card contains other cards. Remove or move its children first.')
          } else {
            setError(`Failed to delete card: ${err}`)
          }
          // Revert: restore the pre-delete state
          setCards(cardsBefore)
          setSelectedId(id)
        }
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId])

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
          console.error('[App] Failed to delete relationship:', err)
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
          console.error('[App] Failed to flip relationship:', err)
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
        console.error('[App] Failed to update relationship label:', err)
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
  }, [])

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  // Selecting a card clears any active relationship selection
  const handleSelectCard = useCallback((cardId: number) => {
    setSelectedId(cardId)
    setSelectedRelId(null)
    setEditingRelId(null)
  }, [])

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
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

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
          cursor: isPanning ? 'grabbing' : (dragState || draggingRelCardId !== null) ? 'grabbing' : 'default',
          position: 'relative',
        }}
        onWheel={handleWheel}
        onMouseDown={handleCanvasMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
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
              Double-click anywhere to create a card
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
            connectingSource={connectingState ? { x: connectingState.startX, y: connectingState.startY } : null}
            connectingMouse={connectingMousePos}
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
                zoom={viewport.zoom}
                onConnectStart={handleConnectStart}
                isConnecting={connectingState !== null}
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
              zoom={viewport.zoom}
              ghostZIndex={10000}
            />
          )}
        </div>

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
    </div>
  )
}
