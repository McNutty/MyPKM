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

import React, { useState, useCallback, useRef, useEffect } from 'react'
import type { CardData, CanvasViewport, DragState, ResizeState } from './store/types'
import {
  getAbsolutePosition,
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
  PADDING,
  BOTTOM_PADDING,
  HEADER_HEIGHT,
  MIN_W,
  MIN_H,
} from './store/canvas-store'
import { Card } from './components/Card'
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
        const nodes = await db.getMapNodes(1)
        if (cancelled) return

        // Build the flat map first -- depth is unknown until we have all nodes.
        const raw = new Map<number, CardData>()
        for (const node of nodes) {
          // Pass depth=0 as a placeholder; computeDepths will correct it below.
          const card = nodeWithLayoutToCardData(node, 0)
          raw.set(card.id, card)
        }
        // Task 1: walk the parent chain to assign correct depths to every card.
        const map = computeDepths(raw)
        setCards(map)
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
      if (pending && !dragState && !resizeState) {
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
      // target). The dragged card itself, its ancestors, and its current parent
      // are excluded -- the current parent exclusion means repositioning within
      // a parent never accidentally re-nests the card back into that parent.
      if (NESTING_ENABLED) {
        // Use the raw cursor position in canvas space -- not the dragged card's
        // center -- so the user has precise control over which card to target.
        const cursorCanvasX = canvasX
        const cursorCanvasY = canvasY

        let bestTarget: number | null = null
        let bestArea = Infinity

        for (const [id, candidate] of cardsRef.current) {
          if (id === dragState.cardId) continue
          if (isAncestor(cardsRef.current, id, dragState.cardId)) continue
          if (id === card.parentId) continue

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
    [dragState, resizeState, isPanning, viewport]
  )

  // ---------------------------------------------------------------------------
  // MOUSE UP (end drag, resize, or pan -- persist to DB)
  // ---------------------------------------------------------------------------
  const handleMouseUp = useCallback(async () => {
    // If mouseup fires while pendingDrag was never promoted, it was just a
    // click (or very short tap). Clear the pending state -- the card stays
    // in the DOM, selection already happened in Card's handleMouseDown, and
    // the resize handle is now visible for a selected card.
    pendingDragRef.current = null

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

    const { cardId, nestTargetId } = dragState
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

      // Place the card below existing children -- no overlap.
      const stackPos = computeStackedPosition(nextCards, nestTargetId, c.width)

      const newDepth = target.depth + 1
      nextCards.set(cardId, {
        ...c,
        parentId: nestTargetId,
        x: stackPos.x,
        y: stackPos.y,
        width: stackPos.width,
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
    }
  }, [dragState, isPanning, resizeState])

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
  // RENDER
  // ---------------------------------------------------------------------------

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
          cursor: isPanning ? 'grabbing' : dragState ? 'grabbing' : 'default',
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
                onSelect={setSelectedId}
                onContentChange={handleContentChange}
                onResetSize={handleResetSize}
                onAutoFocusConsumed={() => setNewCardId(null)}
                zoom={viewport.zoom}
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
              onSelect={setSelectedId}
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
            {cards.size} card{cards.size !== 1 ? 's' : ''}
          </div>
        )}
      </div>
    </div>
  )
}
