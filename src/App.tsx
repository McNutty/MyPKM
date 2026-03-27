/**
 * Ambit -- Layout Shell
 * ============================
 *
 * Layout: TopBar (breadcrumbs + zoom controls) | Canvas | RightSidebar
 *
 * App.tsx is a thin orchestrator. All canvas logic lives in <Canvas />.
 * selectedCardId is lifted here so both the Canvas and the RightSidebar
 * can access it (the sidebar will show note panels for the selected card).
 *
 * The active map ID is owned here and driven by model card navigation.
 * When mapId changes, Canvas unmounts and remounts via its key prop, which
 * triggers a fresh data load for the new map.
 *
 * zoom and error are lifted here from Canvas via callbacks so the TopBar
 * can display them without being a child of Canvas.
 */

import { useState, useRef, useCallback } from 'react'
import { TopBar } from './components/TopBar'
import { Canvas } from './components/Canvas'
import type { CanvasHandle } from './components/Canvas'
import { RightSidebar } from './components/RightSidebar'

export default function App() {
  // Active map ID. Defaults to 1 (the seed map). Changes when user enters a model card.
  const [mapId, setMapId] = useState<number>(1)

  // Selected card ID -- lifted here so both Canvas and RightSidebar can use it.
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  // Zoom level reflected up from Canvas for display in TopBar.
  const [zoom, setZoom] = useState<number>(1.0)

  // Error string reflected up from Canvas for display in TopBar.
  const [canvasError, setCanvasError] = useState<string | null>(null)

  // Ref to Canvas imperative handle so TopBar's Fit button can call zoomToFit.
  const canvasRef = useRef<CanvasHandle>(null)

  const handleZoomToFit = useCallback(() => {
    canvasRef.current?.zoomToFit()
  }, [])

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <TopBar
          mapId={mapId}
          onNavigateToMap={setMapId}
          zoom={zoom}
          onZoomToFit={handleZoomToFit}
          error={canvasError}
        />
        <Canvas
          ref={canvasRef}
          key={mapId}
          mapId={mapId}
          selectedCardId={selectedCardId}
          onSelectCard={setSelectedCardId}
          onNavigateToMap={setMapId}
          onZoomChange={setZoom}
          onErrorChange={setCanvasError}
        />
      </div>
      <RightSidebar />
    </div>
  )
}
