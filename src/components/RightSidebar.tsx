/**
 * RightSidebar -- placeholder for note panels and future detail views.
 * Designed as a vertical stack of panels; empty for now.
 */

import React from 'react'

export const RightSidebar: React.FC = () => {
  return (
    <div
      style={{
        width: 0,
        flexShrink: 0,
        borderLeft: '1px solid #e0e0e0',
        backgroundColor: '#fafafa',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    />
  )
}
