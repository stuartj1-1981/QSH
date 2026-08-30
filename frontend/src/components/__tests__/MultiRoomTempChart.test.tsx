import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MultiRoomTempChart } from '../MultiRoomTempChart'
import type { RoomHistoryData } from '../../hooks/useHistory'

describe('MultiRoomTempChart', () => {
  it('renders the title and both room legend names for a two-room fixture', () => {
    const roomHistory: RoomHistoryData = {
      kitchen: [
        { t: 1000, temp: 19.5 },
        { t: 2000, temp: 20.1 },
      ],
      living_room: [
        { t: 1000, temp: 18.2 },
        { t: 2000, temp: 18.9 },
      ],
    }
    render(<MultiRoomTempChart roomHistory={roomHistory} />)
    expect(screen.getByText('All Room Temperatures (24h)')).toBeInTheDocument()
    expect(screen.getByText('kitchen')).toBeInTheDocument()
    expect(screen.getByText('living room')).toBeInTheDocument()
  })

  it('tolerates a room whose points carry null temps', () => {
    const roomHistory: RoomHistoryData = {
      kitchen: [
        { t: 1000, temp: null },
        { t: 2000, temp: null },
      ],
    }
    expect(() => render(<MultiRoomTempChart roomHistory={roomHistory} />)).not.toThrow()
    expect(screen.getByText('All Room Temperatures (24h)')).toBeInTheDocument()
  })

  it('returns null for an empty roomHistory', () => {
    const { container } = render(<MultiRoomTempChart roomHistory={{}} />)
    expect(container).toBeEmptyDOMElement()
  })
})
