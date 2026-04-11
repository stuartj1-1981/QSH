import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ExternalSetpointSettings } from '../ExternalSetpointSettings'

const mockSave = vi.fn()
const mockRefetch = vi.fn()

const MOCK_DATA = {
  comfort_temp: 'input_number.ct',
  flow_min_temp: '',
  flow_max_temp: '',
  antifrost_oat_threshold: '',
  shoulder_threshold: 'input_number.shoulder',
  overtemp_protection: '',
}

let mockHookReturn = {
  data: MOCK_DATA,
  loading: false,
  error: null as string | null,
  saving: false,
  save: mockSave,
  refetch: vi.fn(),
}

let mockResolvedReturn = {
  resolved: {} as Record<string, { friendly_name: string; state: string; unit: string }>,
  loading: false,
}

vi.mock('../../../hooks/useExternalSetpoints', () => ({
  useExternalSetpoints: () => mockHookReturn,
}))

vi.mock('../../../hooks/useEntityResolve', () => ({
  useEntityResolve: () => mockResolvedReturn,
}))

describe('ExternalSetpointSettings', () => {
  beforeEach(() => {
    mockSave.mockReset()
    mockRefetch.mockReset()
    mockSave.mockResolvedValue(undefined)
    mockHookReturn = {
      data: MOCK_DATA,
      loading: false,
      error: null,
      saving: false,
      save: mockSave,
      refetch: vi.fn(),
    }
    mockResolvedReturn = {
      resolved: {},
      loading: false,
    }
  })

  it('renders 4 entity fields', () => {
    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    expect(screen.getByText(/Comfort Temperature/)).toBeInTheDocument()
    expect(screen.getByText(/Antifrost OAT Threshold/)).toBeInTheDocument()
    expect(screen.getByText(/Shoulder Shutdown Threshold/)).toBeInTheDocument()
    expect(screen.getByText(/Overtemp Protection/)).toBeInTheDocument()

    // Flow min/max should NOT be rendered
    expect(screen.queryByText(/Flow Min/)).toBeNull()
    expect(screen.queryByText(/Flow Max/)).toBeNull()
  })

  it('displays current entity IDs from hook', () => {
    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    expect(screen.getByDisplayValue('input_number.ct')).toBeInTheDocument()
    expect(screen.getByDisplayValue('input_number.shoulder')).toBeInTheDocument()
  })

  it('shows resolved entity names and current values', () => {
    mockResolvedReturn = {
      resolved: {
        'input_number.ct': { friendly_name: 'Comfort Temp', state: '21.5', unit: '°C' },
      },
      loading: false,
    }

    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    expect(screen.getByText('Comfort Temp')).toBeInTheDocument()
    expect(screen.getByText('Current: 21.5°C')).toBeInTheDocument()
  })

  it('shows amber warning for out-of-range value', () => {
    mockResolvedReturn = {
      resolved: {
        'input_number.ct': { friendly_name: 'Comfort Temp', state: '35.0', unit: '°C' },
      },
      loading: false,
    }

    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    expect(screen.getByText(/outside safe range/)).toBeInTheDocument()
    expect(screen.getByText(/Value 35°C is outside safe range/)).toBeInTheDocument()
  })

  it('shows "(using internal value)" for empty fields', () => {
    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    const internalTexts = screen.getAllByText('(using internal value)')
    // antifrost_oat_threshold and overtemp_protection are empty
    expect(internalTexts.length).toBe(2)
  })

  it('save button disabled while saving', () => {
    mockHookReturn = { ...mockHookReturn, saving: true }

    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    const saveButton = screen.getByRole('button', { name: /Save Changes/ })
    expect(saveButton).toBeDisabled()
  })

  it('displays error message', () => {
    mockHookReturn = { ...mockHookReturn, error: 'Something failed' }

    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    expect(screen.getByText('Something failed')).toBeInTheDocument()
  })

  it('calls onRefetch after successful save', async () => {
    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    // Modify a field to create a diff
    const input = screen.getByDisplayValue('input_number.ct')
    fireEvent.change(input, { target: { value: 'input_number.new' } })

    const saveButton = screen.getByRole('button', { name: /Save Changes/ })
    fireEvent.click(saveButton)

    await waitFor(() => {
      expect(mockSave).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(mockRefetch).toHaveBeenCalled()
    })
  })

  it('does not warn for non-numeric entity state', () => {
    mockResolvedReturn = {
      resolved: {
        'input_number.ct': { friendly_name: 'Comfort Temp', state: 'unavailable', unit: '' },
      },
      loading: false,
    }

    render(<ExternalSetpointSettings onRefetch={mockRefetch} />)

    expect(screen.queryByText(/outside safe range/)).toBeNull()
    // Should not show "Current:" for non-numeric state
    expect(screen.queryByText(/Current:/)).toBeNull()
  })
})
