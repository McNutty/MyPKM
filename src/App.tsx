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
  getDepthColor,
  nodeWithLayoutToCardData,
  computeDepths,
  updateDescendantDepths,
  normalizeChildPositions,
  PADDING,
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
  const [isPanning, setIsPanning] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

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
      const card = cardsRef.current.get(cardId)
      if (!card) return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      const absPos = getAbsolutePosition(cardsRef.current, cardId)

      setDragState({
        cardId,
        offsetX: canvasX - absPos.x,
        offsetY: canvasY - absPos.y,
        nestTargetId: null,
      })
    },
    [viewport]
  )

  // ---------------------------------------------------------------------------
  // RESIZE CARD
  // ---------------------------------------------------------------------------
  const handleCardResizeStart = useCallback(
    (cardId: number, e: React.MouseEvent) => {
      const card = cardsRef.current.get(cardId)
      if (!card) return
      setResizeState({
        cardId,
        handle: 'se',
        startWidth: card.width,
        startHeight: card.height,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
      })
    },
    []
  )

  // ---------------------------------------------------------------------------
  // MOUSE MOVE (handles drag, resize, and pan)
  // ---------------------------------------------------------------------------
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

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
        const newW = Math.max(MIN_W, resizeState.startWidth + dx)
        const newH = Math.max(MIN_H, resizeState.startHeight + dy)

        setCards((prev) => {
          const updated = new Map(prev)
          const card = updated.get(resizeState.cardId)
          if (!card) return prev
          updated.set(resizeState.cardId, { ...card, width: newW, height: newH })
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

      // --- NEST TARGET DETECTION (disabled at M1) ---
      if (NESTING_ENABLED) {
        const centerX = newAbsX + card.width / 2
        const centerY = newAbsY + card.height / 2

        let bestTarget: number | null = null
        let bestArea = Infinity

        for (const [id, candidate] of cardsRef.current) {
          if (id === dragState.cardId) continue
          if (isAncestor(cardsRef.current, id, dragState.cardId)) continue
          if (id === card.parentId) continue

          const absPos = getAbsolutePosition(cardsRef.current, id)
          const area = candidate.width * candidate.height
          if (
            centerX >= absPos.x &&
            centerX <= absPos.x + candidate.width &&
            centerY >= absPos.y + HEADER_HEIGHT &&
            centerY <= absPos.y + candidate.height &&
            area < bestArea
          ) {
            bestTarget = id
            bestArea = area
          }
        }

        setDragState((prev) =>
          prev ? { ...prev, nestTargetId: bestTarget } : null
        )
      }

      // Update card position (local coords relative to current parent)
      setCards((prev) => {
        const updated = new Map(prev)
        const c = updated.get(dragState.cardId)
        if (!c) return prev

        const localPos = canvasToLocal(updated, newAbsX, newAbsY, c.parentId)
        updated.set(dragState.cardId, { ...c, x: localPos.x, y: localPos.y })

        if (c.parentId !== null) {
          return autoResizeParent(updated, c.parentId)
        }
        return updated
      })
    },
    [dragState, resizeState, isPanning, viewport]
  )

  // ---------------------------------------------------------------------------
  // MOUSE UP (end drag, resize, or pan -- persist to DB)
  // ---------------------------------------------------------------------------
  const handleMouseUp = useCallback(async () => {
    if (isPanning) {
      setIsPanning(false)
      return
    }

    if (resizeState) {
      // Persist resize
      const card = cardsRef.current.get(resizeState.cardId)
      setResizeState(null)

      if (card) {
        try {
          await db.updateNodeLayout(card.id, 1, card.x, card.y, card.width, card.height)
        } catch (err) {
          console.error('[App] Failed to persist resize:', err)
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

    const { cardId, nestTargetId } = dragState
    const card = cardsRef.current.get(cardId)
    setDragState(null)

    if (!card) return

    // M1: NESTING DISABLED -- just persist the new position
    if (!NESTING_ENABLED) {
      try {
        await db.updateNodeLayout(card.id, 1, card.x, card.y, card.width, card.height)
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

      const absPos = getAbsolutePosition(nextCards, cardId)
      const localPos = canvasToLocal(nextCards, absPos.x, absPos.y, nestTargetId)

      const newDepth = target.depth + 1
      nextCards.set(cardId, {
        ...c,
        parentId: nestTargetId,
        x: Math.max(PADDING, localPos.x),
        y: Math.max(PADDING, localPos.y),
        depth: newDepth,
        color: getDepthColor(newDepth),
      })

      // Propagate depth changes to all descendants via the shared utility.
      nextCards = updateDescendantDepths(nextCards, cardId, newDepth)

      // Normalize child positions (shift negative-coordinate children back inside padding).
      nextCards = normalizeChildPositions(nextCards, nestTargetId)

      // Resize the new parent (and its ancestors) to contain the newly nested card.
      nextCards = autoResizeParent(nextCards, nestTargetId)
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
          finalCard.height
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
    if (!nestTargetId && card.parentId !== null) {
      const absPos = getAbsolutePosition(cardsRef.current, cardId)
      const centerX = absPos.x + card.width / 2
      const centerY = absPos.y + card.height / 2

      const parentAbs = getAbsolutePosition(cardsRef.current, card.parentId)
      const parent = cardsRef.current.get(card.parentId)

      if (parent) {
        const outside =
          centerX < parentAbs.x ||
          centerX > parentAbs.x + parent.width ||
          centerY < parentAbs.y ||
          centerY > parentAbs.y + parent.height

        if (outside) {
          const stateBefore = new Map(cardsRef.current)

          let nextCards = new Map(cardsRef.current)
          const c = nextCards.get(cardId)
          if (!c) return

          // The card exits one level up. Its new parent is the current parent's parent.
          const oldParent = nextCards.get(c.parentId!)
          const grandparentId = oldParent?.parentId ?? null

          // Convert absolute position to the grandparent's local space
          // (or canvas root if grandparentId is null).
          const abs = getAbsolutePosition(nextCards, cardId)
          const localPos = canvasToLocal(nextCards, abs.x, abs.y, grandparentId)

          const newDepth = grandparentId !== null
            ? (nextCards.get(grandparentId)?.depth ?? 0) + 1
            : 0

          nextCards.set(cardId, {
            ...c,
            parentId: grandparentId,
            x: localPos.x,
            y: localPos.y,
            depth: newDepth,
            color: getDepthColor(newDepth),
          })

          // Propagate depth change to all descendants.
          nextCards = updateDescendantDepths(nextCards, cardId, newDepth)

          // Resize the old parent (may now be smaller) and the grandparent.
          if (c.parentId !== null) nextCards = autoResizeParent(nextCards, c.parentId)
          if (grandparentId !== null) nextCards = autoResizeParent(nextCards, grandparentId)

          setCards(nextCards)

          // Persist: updateNodeParent with newParentId = grandparentId (possibly null).
          const finalCard = nextCards.get(cardId)!
          try {
            await db.updateNodeParent(
              cardId,
              grandparentId,
              1,
              finalCard.x,
              finalCard.y,
              finalCard.width,
              finalCard.height
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
    const finalCard = cardsRef.current.get(cardId)
    if (finalCard) {
      try {
        await db.updateNodeLayout(finalCard.id, 1, finalCard.x, finalCard.y, finalCard.width, finalCard.height)
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
        }
        setCards((prev) => {
          const updated = new Map(prev)
          updated.set(id, newCard)
          return updated
        })
        setSelectedId(id)
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

  const topLevelCards: CardData[] = []
  for (const card of cards.values()) {
    if (card.parentId === null) topLevelCards.push(card)
  }

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
          {topLevelCards.map((card) => (
            <Card
              key={card.id}
              card={card}
              allCards={cards}
              dragState={dragState}
              selectedId={selectedId}
              onDragStart={handleCardDragStart}
              onResizeStart={handleCardResizeStart}
              onSelect={setSelectedId}
              onContentChange={handleContentChange}
              zoom={viewport.zoom}
            />
          ))}
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
