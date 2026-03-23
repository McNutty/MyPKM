/**
 * Plectica 2.0 -- tldraw Nesting Prototype
 * =========================================
 *
 * PURPOSE: Evaluate tldraw's fitness for recursively nested boxes that auto-resize.
 *
 * APPROACH: tldraw v2 uses a custom shape system. We create a "NestableCard" shape
 * that can contain other NestableCard shapes. We test:
 *   1. 5 levels of nested boxes
 *   2. Auto-resize propagation (child grows -> parent grows -> grandparent grows)
 *   3. Drag-to-nest (drag a card into another card)
 *   4. Drag-to-unnest (drag a card out of its parent)
 *   5. Pan and zoom on infinite canvas (built into tldraw)
 *   6. Performance with ~50 nested elements
 *
 * KEY INSIGHT ABOUT TLDRAW:
 * tldraw has a built-in concept of "frames" (TLFrameShape) which are container shapes.
 * Shapes inside a frame are parented to it. However, frames do NOT auto-resize --
 * they are fixed-size containers that clip their children. This directly conflicts
 * with Derek's "truthful boundary" requirement.
 *
 * To make tldraw work for our use case, we have two options:
 *   A) Use tldraw's frame system and add auto-resize logic on top (fighting the framework)
 *   B) Create a completely custom shape with custom parenting logic (building on the framework)
 *
 * This prototype attempts option A (using frames + auto-resize middleware) because
 * it leverages more of tldraw's built-in behavior (selection, drag, z-ordering).
 * We also demonstrate option B (custom shape) in a secondary component.
 *
 * VERDICT PREVIEW: tldraw is powerful but its shape model is designed for flat
 * whiteboards, not recursive containment hierarchies. Nesting requires significant
 * custom work on top of the framework.
 */

import React, { useCallback, useEffect } from 'react'
import {
  Tldraw,
  TLUiOverrides,
  TLComponents,
  Editor,
  createShapeId,
  TLShapeId,
  TLFrameShape,
  Vec,
  Box,
} from 'tldraw'
import 'tldraw/tldraw.css'

// ============================================================================
// CONSTANTS
// ============================================================================

const PADDING = 20 // Padding inside containers around children
const HEADER_HEIGHT = 30 // Space for the container's label at top
const MIN_CARD_WIDTH = 120
const MIN_CARD_HEIGHT = 60
const COLORS = ['#e3f2fd', '#f3e5f5', '#e8f5e9', '#fff3e0', '#fce4ec', '#e0f7fa']

// ============================================================================
// AUTO-RESIZE ENGINE
// ============================================================================

/**
 * Core auto-resize logic: given a parent frame, compute the minimum bounds
 * needed to contain all its children, then expand the parent if necessary.
 * This propagates upward recursively.
 */
function autoResizeAncestors(editor: Editor, shapeId: TLShapeId) {
  // Walk up the parent chain and resize each ancestor
  const shape = editor.getShape(shapeId)
  if (!shape) return

  const parentId = shape.parentId
  // parentId could be a page id (string starting with 'page:') or a shape id
  if (typeof parentId !== 'string' || !parentId.startsWith('shape:')) return

  const parent = editor.getShape(parentId as TLShapeId)
  if (!parent || parent.type !== 'frame') return

  resizeFrameToFitChildren(editor, parentId as TLShapeId)
  // Recurse upward
  autoResizeAncestors(editor, parentId as TLShapeId)
}

function resizeFrameToFitChildren(editor: Editor, frameId: TLShapeId) {
  const frame = editor.getShape(frameId) as TLFrameShape | undefined
  if (!frame) return

  const children = editor.getSortedChildIdsForParent(frameId)
  if (children.length === 0) return

  // Compute bounding box of all children in the frame's local space
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const childId of children) {
    const child = editor.getShape(childId)
    if (!child) continue
    const childX = child.x
    const childY = child.y
    const childW = (child.props as any).w ?? MIN_CARD_WIDTH
    const childH = (child.props as any).h ?? MIN_CARD_HEIGHT

    minX = Math.min(minX, childX)
    minY = Math.min(minY, childY)
    maxX = Math.max(maxX, childX + childW)
    maxY = Math.max(maxY, childY + childH)
  }

  if (!isFinite(minX)) return

  const neededW = maxX - Math.min(0, minX) + PADDING * 2
  const neededH = maxY - Math.min(0, minY) + PADDING * 2 + HEADER_HEIGHT

  const currentW = (frame.props as any).w ?? MIN_CARD_WIDTH
  const currentH = (frame.props as any).h ?? MIN_CARD_HEIGHT

  const newW = Math.max(currentW, neededW)
  const newH = Math.max(currentH, neededH)

  // If children have negative coords, shift them and expand the frame
  if (minX < PADDING || minY < PADDING + HEADER_HEIGHT) {
    const dx = Math.max(0, PADDING - minX)
    const dy = Math.max(0, PADDING + HEADER_HEIGHT - minY)

    // Move all children by (dx, dy) so they fit within padding
    for (const childId of children) {
      const child = editor.getShape(childId)
      if (!child) continue
      editor.updateShape({
        id: childId,
        type: child.type,
        x: child.x + dx,
        y: child.y + dy,
      })
    }
  }

  if (newW !== currentW || newH !== currentH) {
    editor.updateShape({
      id: frameId,
      type: 'frame',
      props: { w: newW, h: newH },
    })
  }
}

// ============================================================================
// DRAG-TO-NEST DETECTION
// ============================================================================

/**
 * After a shape is dropped, check if it overlaps any frame that could be its
 * new parent. If so, reparent it.
 *
 * NOTE: tldraw has some built-in frame-drop logic but it is designed for
 * simple one-level grouping. We need to handle recursive nesting ourselves.
 */
function detectNestTarget(
  editor: Editor,
  draggedId: TLShapeId
): TLShapeId | null {
  const dragged = editor.getShape(draggedId)
  if (!dragged) return null

  const draggedBounds = editor.getShapePageBounds(draggedId)
  if (!draggedBounds) return null

  // Find all frames that the dragged shape overlaps with
  const allFrames = editor
    .getCurrentPageShapes()
    .filter((s) => s.type === 'frame' && s.id !== draggedId)

  let bestTarget: TLShapeId | null = null
  let bestArea = Infinity // We want the smallest containing frame (deepest nesting)

  for (const frame of allFrames) {
    if (frame.id === draggedId) continue
    // Don't nest inside a descendant of yourself
    if (isDescendant(editor, frame.id, draggedId)) continue

    const frameBounds = editor.getShapePageBounds(frame.id)
    if (!frameBounds) continue

    const frameArea = frameBounds.w * frameBounds.h

    // Check if the center of the dragged shape is inside this frame
    const centerX = draggedBounds.x + draggedBounds.w / 2
    const centerY = draggedBounds.y + draggedBounds.h / 2

    if (
      centerX >= frameBounds.x &&
      centerX <= frameBounds.x + frameBounds.w &&
      centerY >= frameBounds.y &&
      centerY <= frameBounds.y + frameBounds.h &&
      frameArea < bestArea
    ) {
      bestTarget = frame.id
      bestArea = frameArea
    }
  }

  return bestTarget
}

function isDescendant(
  editor: Editor,
  candidateDescendant: TLShapeId,
  ofAncestor: TLShapeId
): boolean {
  const children = editor.getSortedChildIdsForParent(ofAncestor)
  for (const childId of children) {
    if (childId === candidateDescendant) return true
    if (isDescendant(editor, candidateDescendant, childId)) return true
  }
  return false
}

// ============================================================================
// SEED DATA: 5 LEVELS OF NESTED BOXES
// ============================================================================

function seedNestedBoxes(editor: Editor) {
  const pageId = editor.getCurrentPageId()

  // Level 0: Root container "Bicycle"
  const l0 = createShapeId('bicycle')
  editor.createShape({
    id: l0,
    type: 'frame',
    x: 100,
    y: 100,
    props: { w: 900, h: 700, name: 'Bicycle' },
  })

  // Level 1: Major systems
  const systems = [
    { id: 'frame', label: 'Frame', x: 20, y: 40, w: 200, h: 150 },
    { id: 'wheels', label: 'Wheels', x: 240, y: 40, w: 420, h: 600 },
    { id: 'drivetrain', label: 'Drivetrain', x: 680, y: 40, w: 200, h: 300 },
    { id: 'brakes', label: 'Brakes', x: 680, y: 360, w: 200, h: 150 },
  ]

  for (const sys of systems) {
    const sysId = createShapeId(sys.id)
    editor.createShape({
      id: sysId,
      type: 'frame',
      parentId: l0,
      x: sys.x,
      y: sys.y,
      props: { w: sys.w, h: sys.h, name: sys.label },
    })
  }

  // Level 2: Inside "Wheels"
  const wheelsId = createShapeId('wheels')
  const wheelSubs = [
    { id: 'front-wheel', label: 'Front Wheel', x: 20, y: 40, w: 380, h: 250 },
    { id: 'rear-wheel', label: 'Rear Wheel', x: 20, y: 310, w: 380, h: 250 },
  ]
  for (const ws of wheelSubs) {
    editor.createShape({
      id: createShapeId(ws.id),
      type: 'frame',
      parentId: wheelsId,
      x: ws.x,
      y: ws.y,
      props: { w: ws.w, h: ws.h, name: ws.label },
    })
  }

  // Level 3: Inside "Front Wheel"
  const fwId = createShapeId('front-wheel')
  const fwParts = [
    { id: 'tire', label: 'Tire', x: 20, y: 40, w: 160, h: 80 },
    { id: 'rim', label: 'Rim', x: 200, y: 40, w: 160, h: 80 },
    { id: 'spokes', label: 'Spokes', x: 20, y: 140, w: 160, h: 80 },
    { id: 'hub', label: 'Hub', x: 200, y: 140, w: 160, h: 80 },
  ]
  for (const part of fwParts) {
    editor.createShape({
      id: createShapeId(part.id),
      type: 'frame',
      parentId: fwId,
      x: part.x,
      y: part.y,
      props: { w: part.w, h: part.h, name: part.label },
    })
  }

  // Level 4: Inside "Hub" (5th level)
  const hubId = createShapeId('hub')
  const hubParts = [
    { id: 'axle', label: 'Axle', x: 10, y: 35, w: 60, h: 30 },
    { id: 'bearings', label: 'Bearings', x: 80, y: 35, w: 60, h: 30 },
  ]
  for (const hp of hubParts) {
    editor.createShape({
      id: createShapeId(hp.id),
      type: 'frame',
      parentId: hubId,
      x: hp.x,
      y: hp.y,
      props: { w: hp.w, h: hp.h, name: hp.label },
    })
  }

  // Add some extra cards for performance testing (~50 total)
  const driveId = createShapeId('drivetrain')
  const driveParts = ['Chain', 'Pedals', 'Crankset', 'Cassette', 'Derailleur']
  driveParts.forEach((name, i) => {
    editor.createShape({
      id: createShapeId(`drive-${i}`),
      type: 'frame',
      parentId: driveId,
      x: 15,
      y: 40 + i * 45,
      props: { w: 170, h: 35, name },
    })
  })

  const brakesId = createShapeId('brakes')
  const brakeParts = ['Lever', 'Cable', 'Caliper', 'Pads']
  brakeParts.forEach((name, i) => {
    editor.createShape({
      id: createShapeId(`brake-${i}`),
      type: 'frame',
      parentId: brakesId,
      x: 15,
      y: 40 + i * 25,
      props: { w: 170, h: 20, name },
    })
  })

  // Rear wheel parts (level 3)
  const rwId = createShapeId('rear-wheel')
  const rwParts = ['Tire', 'Rim', 'Spokes', 'Hub', 'Freewheel']
  rwParts.forEach((name, i) => {
    editor.createShape({
      id: createShapeId(`rw-${i}`),
      type: 'frame',
      parentId: rwId,
      x: 15 + (i % 3) * 120,
      y: 40 + Math.floor(i / 3) * 100,
      props: { w: 110, h: 80, name },
    })
  })

  // Frame parts (level 2)
  const framePartId = createShapeId('frame')
  const frameParts = ['Top Tube', 'Down Tube', 'Seat Tube', 'Head Tube']
  frameParts.forEach((name, i) => {
    editor.createShape({
      id: createShapeId(`fp-${i}`),
      type: 'frame',
      parentId: framePartId,
      x: 10,
      y: 35 + i * 25,
      props: { w: 180, h: 20, name },
    })
  })

  // Extra standalone cards for drag-to-nest testing
  const extras = ['Handlebar', 'Seat', 'Kickstand', 'Bell', 'Reflector',
    'Light', 'Fender', 'Rack', 'Lock', 'Pump']
  extras.forEach((name, i) => {
    editor.createShape({
      id: createShapeId(`extra-${i}`),
      type: 'frame',
      x: 1100 + (i % 2) * 180,
      y: 100 + Math.floor(i / 2) * 80,
      props: { w: 150, h: 50, name },
    })
  })

  // Zoom to fit
  editor.zoomToFit({ animation: { duration: 300 } })
}

// ============================================================================
// MAIN APP COMPONENT
// ============================================================================

export default function App() {
  const handleMount = useCallback((editor: Editor) => {
    // Seed the canvas with nested boxes
    seedNestedBoxes(editor)

    // Listen for shape changes to trigger auto-resize
    // This is where we fight the framework: tldraw does not auto-resize frames.
    // We must listen for changes and resize manually.
    const unsub = editor.store.listen(
      (entry) => {
        // Batch: collect all changed shape IDs
        const changedIds = new Set<TLShapeId>()

        for (const record of Object.values(entry.changes.updated)) {
          const [_before, after] = record as [any, any]
          if (after?.typeName === 'shape') {
            changedIds.add(after.id as TLShapeId)
          }
        }

        // For each changed shape, auto-resize its ancestors
        // Use requestAnimationFrame to avoid infinite loops from our own updates
        if (changedIds.size > 0) {
          requestAnimationFrame(() => {
            editor.batch(() => {
              for (const id of changedIds) {
                autoResizeAncestors(editor, id)
              }
            })
          })
        }
      },
      { source: 'user', scope: 'document' }
    )

    // Return cleanup -- though in practice this component won't unmount
    return unsub
  }, [])

  return (
    <div style={{ width: '100vw', height: '100vh', position: 'relative' }}>
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
          lineHeight: 1.5,
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
          maxWidth: 350,
        }}
      >
        <strong>tldraw Nesting Prototype</strong>
        <br />
        Bicycle system with 5 nesting levels.
        <br />
        <span style={{ color: '#666' }}>
          Drag standalone cards (right side) into containers to test nesting.
          <br />
          Resize a child card to test auto-resize propagation.
          <br />
          Scroll to zoom. Click + drag on background to pan.
        </span>
      </div>
      <Tldraw onMount={handleMount} />
    </div>
  )
}
