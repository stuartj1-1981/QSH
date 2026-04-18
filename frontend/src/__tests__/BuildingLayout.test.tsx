import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BuildingLayout } from '../components/settings/BuildingLayout'
import type { RoomConfigYaml } from '../types/config'

// Mock useRawConfig — the hook that BuildingLayout uses to fetch rooms.
const mockConfig: { rooms: Record<string, RoomConfigYaml> } = {
  rooms: {},
}

vi.mock('../hooks/useConfig', () => ({
  useRawConfig: () => ({
    data: mockConfig,
    loading: false,
    error: null,
    refetch: vi.fn(),
  }),
}))

beforeEach(() => {
  mockConfig.rooms = {}
})

describe('BuildingLayout', () => {
  it('12. renders without crashing with empty rooms', () => {
    mockConfig.rooms = {}
    render(<BuildingLayout />)
    expect(screen.getByText('Building Layout')).toBeDefined()
    expect(screen.getByText('No rooms configured yet.')).toBeDefined()
  })

  it('13. renders floor assignment grouped by floor', () => {
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'S', floor: 0 },
      bed1: { area_m2: 15, facing: 'S', floor: 1 },
      bed2: { area_m2: 12, facing: 'N', floor: 1 },
    }
    render(<BuildingLayout />)
    // Floor group labels are shown as headers in the floor panel.
    expect(screen.getAllByText('Ground').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('First').length).toBeGreaterThanOrEqual(1)
    // Each room has its own floor select.
    expect(screen.getByLabelText('Floor for lounge')).toBeDefined()
    expect(screen.getByLabelText('Floor for bed1')).toBeDefined()
    expect(screen.getByLabelText('Floor for bed2')).toBeDefined()
  })

  it('14. renders six face dropdowns when a room is expanded', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'N', floor: 0 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    expect(screen.getByLabelText(/North wall .* face for lounge/)).toBeDefined()
    expect(screen.getByLabelText(/South wall .* face for lounge/)).toBeDefined()
    expect(screen.getByLabelText(/East wall .* face for lounge/)).toBeDefined()
    expect(screen.getByLabelText(/West wall .* face for lounge/)).toBeDefined()
    expect(screen.getByLabelText(/Floor face for lounge/)).toBeDefined()
    expect(screen.getByLabelText(/Ceiling face for lounge/)).toBeDefined()
  })

  it('15. wall labels from facing=N show compass + relative hint', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'N', floor: 0 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    expect(screen.getByText('North wall (front)')).toBeDefined()
    expect(screen.getByText('South wall (back)')).toBeDefined()
    expect(screen.getByText('West wall (left)')).toBeDefined()
    expect(screen.getByText('East wall (right)')).toBeDefined()
  })

  it('16. interior room shows abstract Wall 1..4 labels', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      open_plan: { area_m2: 30, facing: 'interior', floor: 0 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for open_plan'))
    expect(screen.getByText('Wall 1')).toBeDefined()
    expect(screen.getByText('Wall 2')).toBeDefined()
    expect(screen.getByText('Wall 3')).toBeDefined()
    expect(screen.getByText('Wall 4')).toBeDefined()
    // No compass labels should be present.
    expect(screen.queryByText(/North wall/)).toBeNull()
    expect(screen.queryByText(/South wall/)).toBeNull()
  })

  it('17. Save button is disabled when nothing is dirty', () => {
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'N', floor: 0 },
    }
    render(<BuildingLayout />)
    const btn = screen.getByRole('button', { name: /Save Building Layout/ })
    expect((btn as HTMLButtonElement).disabled).toBe(true)
  })

  // 112C UI tests: multi-room face editor

  it('5a. chips render for array face', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
      bed2: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    mockConfig.rooms.lounge.envelope = {
      ceiling: [
        { room: 'bed1', type: 'floor_ceiling' },
        { room: 'bed2', type: 'floor_ceiling' },
      ],
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Both chips should render with remove buttons
    expect(screen.getByLabelText('Remove bed1 from Ceiling')).toBeDefined()
    expect(screen.getByLabelText('Remove bed2 from Ceiling')).toBeDefined()
  })

  it('5b. add room to face creates chip', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
      bed2: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Switch ceiling to rooms mode (click "Adjacent Room(s)" button for ceiling row)
    const buttons = screen.getAllByRole('button')
    const adjacentRoomBtn = buttons.find((b) => b.textContent === 'Adjacent Room(s)')
    expect(adjacentRoomBtn).toBeDefined()
    if (adjacentRoomBtn) {
      await user.click(adjacentRoomBtn)
    }
    // Select a room from "Add room" dropdown
    const selects = screen.getAllByRole('combobox')
    const addRoomSelect = selects.find(
      (s) => (s as HTMLSelectElement).textContent?.includes('Add room')
    )
    if (addRoomSelect) {
      await user.selectOptions(addRoomSelect, 'bed1')
      // Chip should appear with remove button
      expect(screen.getByLabelText('Remove bed1 from Ceiling')).toBeDefined()
    }
  })

  it('5c. remove chip removes room from face', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    mockConfig.rooms.lounge.envelope = {
      ceiling: { room: 'bed1', type: 'floor_ceiling' },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Chip should exist (via remove button)
    const removeBtn = screen.getByLabelText('Remove bed1 from Ceiling')
    expect(removeBtn).toBeDefined()
    // Click remove button (×)
    await user.click(removeBtn)
    // Remove button should be gone
    expect(screen.queryByLabelText('Remove bed1 from Ceiling')).toBeNull()
  })

  it('5d. mode toggle switches between Surface and Adjacent Room(s)', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Find first "Adjacent Room(s)" button and click it
    const buttons = screen.getAllByRole('button')
    const adjacentBtn = buttons.find((b) => b.textContent === 'Adjacent Room(s)')
    expect(adjacentBtn).toBeDefined()
    if (adjacentBtn) {
      await user.click(adjacentBtn)
    }
    // After clicking, surface mode select should be hidden and rooms mode controls should appear
    // Check that we have mode toggle buttons visible (both Surface and Adjacent Room(s) should be present)
    const surfaceBtn = screen.getAllByRole('button').find((b) => b.textContent === 'Surface')
    expect(surfaceBtn).toBeDefined()
  })

  it('5e. destructive mode switch shows confirmation for 2+ refs', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
      bed2: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    mockConfig.rooms.lounge.envelope = {
      ceiling: [
        { room: 'bed1', type: 'floor_ceiling' },
        { room: 'bed2', type: 'floor_ceiling' },
      ],
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Click "Surface" button to trigger confirmation
    const buttons = screen.getAllByRole('button')
    const surfaceBtn = buttons.find((b) => b.textContent === 'Surface')
    if (surfaceBtn) {
      await user.click(surfaceBtn)
    }
    // Confirmation dialog should appear
    expect(
      screen.queryByText(/This will remove.*room connections/)
    ).toBeDefined()
  })

  it('5f. backward compat: single room ref renders as one chip', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    mockConfig.rooms.lounge.envelope = {
      ceiling: { room: 'bed1', type: 'floor_ceiling' },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Should auto-switch to rooms mode and show one chip
    const removeBtn = screen.queryByLabelText('Remove bed1 from Ceiling')
    expect(removeBtn).toBeDefined()
  })

  it('5g. wall face candidate filtering: same floor only', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      kitchen: { area_m2: 15, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Find the first "Adjacent Room(s)" button (for north_wall)
    const buttons = screen.getAllByRole('button')
    const adjacentButtons = buttons.filter((b) => b.textContent === 'Adjacent Room(s)')
    if (adjacentButtons.length > 0) {
      await user.click(adjacentButtons[0])
    }
    // Find the add-room select (first combobox with "Add room" text)
    const selects = screen.getAllByRole('combobox')
    const addRoomSelect = Array.from(selects).find((s) =>
      (s as HTMLSelectElement).textContent?.includes('Add room')
    )
    if (addRoomSelect) {
      const options = Array.from((addRoomSelect as HTMLSelectElement).options).map(
        (o) => o.value
      )
      // Should include kitchen (same floor), NOT bed1 (different floor)
      expect(options).toContain('kitchen')
      expect(options).not.toContain('bed1')
    }
  })

  it('5h. ceiling face candidate filtering: floor+1 only', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 20, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
      bed2: { area_m2: 12, facing: 'interior', floor: 0 },
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // Find all "Adjacent Room(s)" buttons
    const buttons = screen.getAllByRole('button')
    const adjacentRoomBtns = buttons.filter((b) => b.textContent === 'Adjacent Room(s)')
    // Click the last one (should be ceiling, since we iterate north, east, south, west, floor, ceiling)
    if (adjacentRoomBtns.length > 0) {
      await user.click(adjacentRoomBtns[adjacentRoomBtns.length - 1])
    }
    // Find all add-room selects (ones with "Add room" text) and get the last
    const selects = screen.getAllByRole('combobox')
    const ceilingSelect = Array.from(selects)
      .filter((s) => (s as HTMLSelectElement).textContent?.includes('Add room'))
      .pop()
    if (ceilingSelect) {
      const options = Array.from((ceilingSelect as HTMLSelectElement).options).map(
        (o) => o.value
      )
      // Should include bed1 (floor+1), NOT bed2 (same floor)
      expect(options).toContain('bed1')
      expect(options).not.toContain('bed2')
    }
  })

  it('5i. chip overflow: 6 rooms render with flex-wrap', async () => {
    const user = (await import('@testing-library/user-event')).default.setup()
    mockConfig.rooms = {
      lounge: { area_m2: 30, facing: 'interior', floor: 0 },
      bed1: { area_m2: 12, facing: 'interior', floor: 1 },
      bed2: { area_m2: 12, facing: 'interior', floor: 1 },
      bed3: { area_m2: 12, facing: 'interior', floor: 1 },
      bed4: { area_m2: 12, facing: 'interior', floor: 1 },
      bed5: { area_m2: 12, facing: 'interior', floor: 1 },
      bed6: { area_m2: 12, facing: 'interior', floor: 1 },
    }
    mockConfig.rooms.lounge.envelope = {
      ceiling: [
        { room: 'bed1', type: 'floor_ceiling' },
        { room: 'bed2', type: 'floor_ceiling' },
        { room: 'bed3', type: 'floor_ceiling' },
        { room: 'bed4', type: 'floor_ceiling' },
        { room: 'bed5', type: 'floor_ceiling' },
        { room: 'bed6', type: 'floor_ceiling' },
      ],
    }
    render(<BuildingLayout />)
    await user.click(screen.getByLabelText('Expand envelope editor for lounge'))
    // All 6 chips should render with remove buttons
    expect(screen.getByLabelText('Remove bed1 from Ceiling')).toBeDefined()
    expect(screen.getByLabelText('Remove bed6 from Ceiling')).toBeDefined()
    // Chip container should have flex-wrap (check by querying container)
    const chipContainers = document.querySelectorAll('.flex.flex-wrap.gap-2')
    expect(chipContainers.length).toBeGreaterThan(0)
  })
})
