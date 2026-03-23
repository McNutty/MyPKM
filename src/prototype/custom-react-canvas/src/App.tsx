/**
 * Plectica 2.0 -- Custom React Canvas Nesting Prototype
 * ======================================================
 *
 * PURPOSE: Evaluate a zero-dependency custom approach for recursively nested
 * boxes that auto-resize. No canvas framework -- just React, DOM divs, and
 * CSS transforms.
 *
 * ARCHITECTURE:
 * - Infinite canvas via CSS transform on a container div (translate + scale)
 * - Cards are absolutely positioned divs, nested inside parent divs
 * - Auto-resize propagates up the parent chain on every drag/resize
 * - Drag-to-nest detects when a dragged card's center enters another card
 * - Drag-to-unnest detects when a dragged card's center leaves its parent
 *
 * WHY THIS APPROACH:
 * The DOM's natural nesting model (div inside div) maps directly to our
 * data model (card inside card). Coordinate transforms are handled by the
 * browser automatically. CSS containment provides performance isolation.
 * We are not fighting any framework's assumptions about shapes or groups --
 * we are building exactly the behavior we need.
 *
 * TRADE-OFFS:
 * + Auto-resize is natural: parent div just needs to be big enough
 * + Nested coordinates are free (browser handles transform accumulation)
 * + Text editing will be trivial (it's just DOM inputs)
 * + Accessibility comes naturally (DOM elements, ARIA attributes)
 * - We must build selection, multi-select, undo/redo from scratch
 * - We must build our own minimap, snap-to-grid, etc.
 * - Performance ceiling with 1000+ DOM elements (mitigated by viewport culling)
 * - Pan/zoom must be implemented manually (but it's straightforward)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react'
import { CardData, CanvasViewport, DragState, ResizeState } from './types'
import {
  createSeedData,
  getChildren,
  getAbsolutePosition,
  canvasToLocal,
  isAncestor,
  autoResizeParent,
  normalizeChildPositions,
  getDepthColor,
  PADDING,
  HEADER_HEIGHT,
  MIN_W,
  MIN_H,
} from './store'
import { Card } from './Card'

// ============================================================================
// INFINITE CANVAS COMPONENT
// ============================================================================

export default function App() {
  // ---------------------------------------------------------------------------
  // STATE
  // ---------------------------------------------------------------------------
  const [cards, setCards] = useState<Map<string, CardData>>(() => createSeedData())
  const [viewport, setViewport] = useState<CanvasViewport>({
    panX: 0,
    panY: 0,
    zoom: 0.75,
  })
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [resizeState, setResizeState] = useState<ResizeState | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 })
  const canvasRef = useRef<HTMLDivElement>(null)

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
        // Zoom toward mouse position
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
      if (e.target === canvasRef.current || (e.target as HTMLElement).dataset?.canvas) {
        // Clicked on empty canvas -- start panning
        setSelectedId(null)
        setIsPanning(true)
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          panX: viewport.panX,
          panY: viewport.panY,
        }
      }
    },
    [viewport.panX, viewport.panY]
  )

  // ---------------------------------------------------------------------------
  // DRAG CARD
  // ---------------------------------------------------------------------------
  const handleCardDragStart = useCallback(
    (cardId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      const card = cards.get(cardId)
      if (!card) return

      // Compute the mouse offset relative to the card in canvas space
      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      const absPos = getAbsolutePosition(cards, cardId)

      setDragState({
        cardId,
        offsetX: canvasX - absPos.x,
        offsetY: canvasY - absPos.y,
        nestTargetId: null,
      })
    },
    [cards, viewport]
  )

  // ---------------------------------------------------------------------------
  // RESIZE CARD
  // ---------------------------------------------------------------------------
  const handleCardResizeStart = useCallback(
    (cardId: string, e: React.MouseEvent) => {
      const card = cards.get(cardId)
      if (!card) return
      setResizeState({
        cardId,
        handle: 'se',
        startW: card.w,
        startH: card.h,
        startMouseX: e.clientX,
        startMouseY: e.clientY,
      })
    },
    [cards]
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
        const newW = Math.max(MIN_W, resizeState.startW + dx)
        const newH = Math.max(MIN_H, resizeState.startH + dy)

        setCards((prev) => {
          const updated = new Map(prev)
          const card = updated.get(resizeState.cardId)
          if (!card) return prev
          updated.set(resizeState.cardId, { ...card, w: newW, h: newH })
          // Auto-resize ancestors
          if (card.parentId) {
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

      const card = cards.get(dragState.cardId)
      if (!card) return

      // New absolute position of the card
      const newAbsX = canvasX - dragState.offsetX
      const newAbsY = canvasY - dragState.offsetY

      // Detect nest target: find the smallest card whose bounds contain
      // the center of the dragged card (excluding self and descendants)
      const centerX = newAbsX + card.w / 2
      const centerY = newAbsY + card.h / 2

      let bestTarget: string | null = null
      let bestArea = Infinity

      for (const [id, candidate] of cards) {
        if (id === dragState.cardId) continue
        if (isAncestor(cards, id, dragState.cardId)) continue // Don't nest inside descendant
        if (id === card.parentId) continue // Already our parent

        const absPos = getAbsolutePosition(cards, id)
        const area = candidate.w * candidate.h
        if (
          centerX >= absPos.x &&
          centerX <= absPos.x + candidate.w &&
          centerY >= absPos.y + HEADER_HEIGHT &&
          centerY <= absPos.y + candidate.h &&
          area < bestArea
        ) {
          bestTarget = id
          bestArea = area
        }
      }

      // Check if we should unnest (dragged outside current parent)
      let shouldUnnest = false
      if (card.parentId) {
        const parentAbs = getAbsolutePosition(cards, card.parentId)
        const parent = cards.get(card.parentId)
        if (parent) {
          const parentRight = parentAbs.x + parent.w
          const parentBottom = parentAbs.y + parent.h
          if (
            centerX < parentAbs.x ||
            centerX > parentRight ||
            centerY < parentAbs.y ||
            centerY > parentBottom
          ) {
            shouldUnnest = true
          }
        }
      }

      setDragState((prev) =>
        prev ? { ...prev, nestTargetId: bestTarget } : null
      )

      // Update card position
      setCards((prev) => {
        const updated = new Map(prev)
        const c = updated.get(dragState.cardId)
        if (!c) return prev

        // Convert absolute position to local position relative to current parent
        const localPos = canvasToLocal(
          updated,
          newAbsX,
          newAbsY,
          c.parentId
        )

        updated.set(dragState.cardId, {
          ...c,
          x: localPos.x,
          y: localPos.y,
        })

        // Auto-resize parent chain
        if (c.parentId) {
          return autoResizeParent(updated, c.parentId)
        }
        return updated
      })
    },
    [dragState, resizeState, isPanning, viewport, cards]
  )

  // ---------------------------------------------------------------------------
  // MOUSE UP (end drag, resize, or pan)
  // ---------------------------------------------------------------------------
  const handleMouseUp = useCallback(() => {
    if (isPanning) {
      setIsPanning(false)
      return
    }

    if (resizeState) {
      setResizeState(null)
      return
    }

    if (!dragState) return

    const { cardId, nestTargetId } = dragState
    const card = cards.get(cardId)
    if (!card) {
      setDragState(null)
      return
    }

    // Handle nesting/unnesting
    if (nestTargetId && nestTargetId !== card.parentId) {
      // NEST: Move card into the target
      setCards((prev) => {
        let updated = new Map(prev)
        const c = updated.get(cardId)
        const target = updated.get(nestTargetId)
        if (!c || !target) return prev

        // Convert current absolute position to target's local coords
        const absPos = getAbsolutePosition(updated, cardId)
        const localPos = canvasToLocal(updated, absPos.x, absPos.y, nestTargetId)

        const newDepth = target.depth + 1
        updated.set(cardId, {
          ...c,
          parentId: nestTargetId,
          x: Math.max(PADDING, localPos.x),
          y: Math.max(PADDING, localPos.y),
          depth: newDepth,
          color: getDepthColor(newDepth),
        })

        // Update depths of all descendants
        const updateDescendantDepths = (parentId: string, parentDepth: number) => {
          for (const [id, child] of updated) {
            if (child.parentId === parentId) {
              const d = parentDepth + 1
              updated.set(id, { ...child, depth: d, color: getDepthColor(d) })
              updateDescendantDepths(id, d)
            }
          }
        }
        updateDescendantDepths(cardId, newDepth)

        // Auto-resize the new parent chain
        updated = autoResizeParent(updated, nestTargetId)

        // Auto-resize old parent chain if there was one
        if (card.parentId) {
          updated = autoResizeParent(updated, card.parentId)
        }

        return updated
      })
    } else if (!nestTargetId && card.parentId) {
      // Check if card center is outside parent -- UNNEST
      const absPos = getAbsolutePosition(cards, cardId)
      const centerX = absPos.x + card.w / 2
      const centerY = absPos.y + card.h / 2

      if (card.parentId) {
        const parentAbs = getAbsolutePosition(cards, card.parentId)
        const parent = cards.get(card.parentId)
        if (parent) {
          const outside =
            centerX < parentAbs.x ||
            centerX > parentAbs.x + parent.w ||
            centerY < parentAbs.y ||
            centerY > parentAbs.y + parent.h

          if (outside) {
            setCards((prev) => {
              let updated = new Map(prev)
              const c = updated.get(cardId)
              if (!c) return prev

              const abs = getAbsolutePosition(updated, cardId)

              // Find the grandparent (the parent's parent)
              const oldParent = updated.get(c.parentId!)
              const grandparentId = oldParent?.parentId ?? null

              // Convert to grandparent's local coords
              const localPos = canvasToLocal(updated, abs.x, abs.y, grandparentId)

              const newDepth = grandparentId
                ? (updated.get(grandparentId)?.depth ?? 0) + 1
                : 0

              updated.set(cardId, {
                ...c,
                parentId: grandparentId,
                x: localPos.x,
                y: localPos.y,
                depth: newDepth,
                color: getDepthColor(newDepth),
              })

              // Update descendant depths
              const updateDescendantDepths = (parentId: string, parentDepth: number) => {
                for (const [id, child] of updated) {
                  if (child.parentId === parentId) {
                    const d = parentDepth + 1
                    updated.set(id, { ...child, depth: d, color: getDepthColor(d) })
                    updateDescendantDepths(id, d)
                  }
                }
              }
              updateDescendantDepths(cardId, newDepth)

              // Auto-resize old parent
              if (c.parentId) {
                updated = autoResizeParent(updated, c.parentId)
              }
              // Auto-resize new parent
              if (grandparentId) {
                updated = autoResizeParent(updated, grandparentId)
              }

              return updated
            })
          }
        }
      }
    }

    setDragState(null)
  }, [dragState, cards, isPanning, resizeState])

  // ---------------------------------------------------------------------------
  // CREATE NEW CARD (double-click on empty canvas)
  // ---------------------------------------------------------------------------
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target !== canvasRef.current && !(e.target as HTMLElement).dataset?.canvas)
        return

      const rect = canvasRef.current?.getBoundingClientRect()
      if (!rect) return

      const canvasX = (e.clientX - rect.left - viewport.panX) / viewport.zoom
      const canvasY = (e.clientY - rect.top - viewport.panY) / viewport.zoom

      const id = `card-${Date.now()}`
      setCards((prev) => {
        const updated = new Map(prev)
        updated.set(id, {
          id,
          label: 'New Card',
          x: canvasX,
          y: canvasY,
          w: 150,
          h: 60,
          parentId: null,
          depth: 0,
          color: getDepthColor(0),
        })
        return updated
      })
      setSelectedId(id)
    },
    [viewport]
  )

  // ---------------------------------------------------------------------------
  // DELETE CARD (Delete key)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' && selectedId) {
        setCards((prev) => {
          const updated = new Map(prev)
          // Delete the card and all descendants
          const toDelete = new Set<string>()
          const collectDescendants = (id: string) => {
            toDelete.add(id)
            for (const [cid, c] of updated) {
              if (c.parentId === id) collectDescendants(cid)
            }
          }
          collectDescendants(selectedId)
          for (const id of toDelete) updated.delete(id)

          // Auto-resize parent
          const card = prev.get(selectedId)
          if (card?.parentId) {
            return autoResizeParent(updated, card.parentId)
          }
          return updated
        })
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedId])

  // ---------------------------------------------------------------------------
  // RENDER
  // ---------------------------------------------------------------------------

  // Get top-level cards (no parent)
  const topLevelCards: CardData[] = []
  for (const card of cards.values()) {
    if (card.parentId === null) topLevelCards.push(card)
  }

  return (
    <div
      ref={canvasRef}
      data-canvas="true"
      style={{
        width: '100vw',
        height: '100vh',
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
      {/* Instructions overlay */}
      <div
        style={{
          position: 'absolute',
          top: 10,
          left: 10,
          zIndex: 1000,
          background: 'rgba(255,255,255,0.95)',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: 13,
          lineHeight: 1.6,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          maxWidth: 380,
          pointerEvents: 'none',
        }}
      >
        <strong>Custom React Canvas Prototype</strong>
        <br />
        Bicycle system -- 5 nesting levels, ~50 elements.
        <br />
        <span style={{ color: '#666' }}>
          <b>Drag</b> cards to move. Drag <b>into</b> another card to nest.
          <br />
          Drag <b>outside</b> parent boundary to unnest.
          <br />
          <b>Scroll</b> to pan. <b>Ctrl+Scroll</b> to zoom.
          <br />
          <b>Double-click</b> on empty space to create a card.
          <br />
          <b>Delete</b> key to remove selected card.
          <br />
          <b>Resize</b> handle appears bottom-right when selected.
        </span>
      </div>

      {/* Zoom indicator */}
      <div
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          zIndex: 1000,
          background: 'rgba(255,255,255,0.9)',
          padding: '6px 12px',
          borderRadius: 6,
          fontSize: 12,
          color: '#666',
          pointerEvents: 'none',
        }}
      >
        {Math.round(viewport.zoom * 100)}% | {cards.size} cards
      </div>

      {/* Canvas transform layer */}
      <div
        data-canvas="true"
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
          // This div is "infinite" -- it contains all cards positioned absolutely
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
            zoom={viewport.zoom}
          />
        ))}
      </div>
    </div>
  )
}
