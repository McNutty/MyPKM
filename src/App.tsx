/**
 * Plectica 2.0 -- Layout Shell
 * ============================
 *
 * Three-panel layout: LeftSidebar | Canvas | RightSidebar
 *
 * App.tsx is a thin orchestrator. All canvas logic lives in <Canvas />.
 * selectedCardId is lifted here so both the Canvas and the RightSidebar
 * can access it (the sidebar will show note panels for the selected card).
 *
 * The active map ID is owned here and driven by the LeftSidebar model picker.
 * When mapId changes, Canvas unmounts and remounts via its key prop, which
 * triggers a fresh data load for the new map.
 */

import { useState } from 'react'
import { LeftSidebar } from './components/LeftSidebar'
import { Canvas } from './components/Canvas'
import { RightSidebar } from './components/RightSidebar'

export default function App() {
  // Active map ID. Defaults to 1 (the seed map). Driven by LeftSidebar.
  const [mapId, setMapId] = useState<number>(1)

  // Selected card ID -- lifted here so both Canvas and RightSidebar can use it.
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null)

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <LeftSidebar mapId={mapId} onSelectMap={setMapId} />
      <Canvas
        key={mapId}
        mapId={mapId}
        selectedCardId={selectedCardId}
        onSelectCard={setSelectedCardId}
      />
      <RightSidebar />
    </div>
  )
}
