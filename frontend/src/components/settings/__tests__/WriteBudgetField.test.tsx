/**
 * INSTRUCTION-216B — WriteBudgetField (Settings page integer spinner with
 * caption + error plumbing for flow_writes_per_hour / mode_writes_per_hour).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { WriteBudgetField } from '../WriteBudgetField'
import type { QshConfigYaml } from '../../../types/config'

const mockFetch = vi.fn()
const onSuccess = vi.fn()

beforeEach(() => {
  mockFetch.mockReset()
  onSuccess.mockReset()
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderField(rootConfig: Partial<QshConfigYaml> | undefined = undefined) {
  return render(
    <WriteBudgetField
      label="Flow writes per hour"
      fieldKey="flow_writes_per_hour"
      apiPath="api/control/flow-writes-per-hour"
      rootConfig={rootConfig as QshConfigYaml | undefined}
      onSuccess={onSuccess}
    />,
  )
}

describe('WriteBudgetField — render + caption', () => {
  it('renders flow_writes_per_hour field with default value 6 when rootConfig is undefined', () => {
    renderField(undefined)
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('6')
  })

  it('renders with configured value from rootConfig', () => {
    renderField({ flow_writes_per_hour: 4 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('4')
  })

  it('renders mode_writes_per_hour as a separate field with default 6', () => {
    render(
      <WriteBudgetField
        label="Mode writes per hour"
        fieldKey="mode_writes_per_hour"
        apiPath="api/control/mode-writes-per-hour"
        rootConfig={undefined}
        onSuccess={onSuccess}
      />,
    )
    const input = screen.getByLabelText('Mode writes per hour') as HTMLInputElement
    expect(input.value).toBe('6')
  })

  it('caption shows "10 min" at value 6', () => {
    renderField({ flow_writes_per_hour: 6 })
    expect(screen.getByText(/≈ one update every 10 min/)).toBeInTheDocument()
  })

  it('caption shows "15 min" at value 4', () => {
    renderField({ flow_writes_per_hour: 4 })
    expect(screen.getByText(/≈ one update every 15 min/)).toBeInTheDocument()
  })

  it('caption shows "20 min" at value 3', () => {
    renderField({ flow_writes_per_hour: 3 })
    expect(screen.getByText(/≈ one update every 20 min/)).toBeInTheDocument()
  })
})

describe('WriteBudgetField — onChange validation', () => {
  it('onChange to valid value (4) sets state without error', () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    expect(input.value).toBe('4')
    expect(screen.queryByText('Must be 3–6')).toBeNull()
  })

  it('onChange to invalid integer (2) sets error span "Must be 3–6"', () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
  })

  it('onChange to invalid integer (9) sets error span "Must be 3–6"', () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
  })

  it('onChange to empty string does NOT change state or error', () => {
    renderField({ flow_writes_per_hour: 4 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    // State still 4 (empty string is the only no-op path), no error
    expect(input.value).toBe('4')
    expect(screen.queryByText('Must be 3–6')).toBeNull()
  })

  it('error span clears on next valid onChange', () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '4' } })
    expect(screen.queryByText('Must be 3–6')).toBeNull()
  })
})

describe('WriteBudgetField — onBlur clamping', () => {
  it('onBlur clamps value 2 to 3 and dispatches PATCH with value=3', async () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '2' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
    const call = mockFetch.mock.calls[0]
    expect(call[0]).toContain('api/control/flow-writes-per-hour')
    expect(call[1]).toMatchObject({ method: 'PATCH' })
    const body = JSON.parse((call[1] as { body: string }).body)
    expect(body).toEqual({ value: 3 })
    expect(input.value).toBe('3')
  })

  it('onBlur clamps value 9 to 6 and dispatches PATCH with value=6 (when initial differs)', async () => {
    renderField({ flow_writes_per_hour: 3 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).toEqual({ value: 6 })
  })

  it('onChange to valid (4) → onBlur dispatches PATCH with value=4', async () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1)
    })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).toEqual({ value: 4 })
  })

  it('onBlur clears error span when clamped value is valid even if no PATCH dispatches (initial=6, typed=6.4)', async () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    // Typing "6.4" — non-integer, triggers error, state unchanged (stays 6)
    fireEvent.change(input, { target: { value: '6.4' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    fireEvent.blur(input)
    // clamp(6) === 6 === initial → no PATCH, but error MUST clear.
    await waitFor(() => {
      expect(screen.queryByText('Must be 3–6')).toBeNull()
    })
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('onBlur clears error span and dispatches when typed integer was out-of-range (typed=9 → clamp=6, initial=3)', async () => {
    renderField({ flow_writes_per_hour: 3 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '9' } })
    expect(screen.getByText('Must be 3–6')).toBeInTheDocument()
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.queryByText('Must be 3–6')).toBeNull()
    })
    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body as string)
    expect(body).toEqual({ value: 6 })
  })
})

describe('WriteBudgetField — server / network error paths', () => {
  it('server returns 422 → error span "Rejected by server" + displayed value reverts to initial', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 422,
      json: () => Promise.resolve({ detail: 'out of range' }),
    })
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.getByText('Rejected by server')).toBeInTheDocument()
    })
    expect(input.value).toBe('6')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('network rejection → error span "Save failed, retry" + displayed value reverts', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'))
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(screen.getByText('Save failed, retry')).toBeInTheDocument()
    })
    expect(input.value).toBe('6')
    expect(onSuccess).not.toHaveBeenCalled()
  })

  it('successful PATCH triggers onSuccess callback (refresh contract)', async () => {
    renderField({ flow_writes_per_hour: 6 })
    const input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    fireEvent.change(input, { target: { value: '4' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1)
    })
  })
})

describe('WriteBudgetField — useEffect sync with external rootConfig', () => {
  it('local state re-syncs when rootConfig changes externally', () => {
    const { rerender } = render(
      <WriteBudgetField
        label="Flow writes per hour"
        fieldKey="flow_writes_per_hour"
        apiPath="api/control/flow-writes-per-hour"
        rootConfig={{ flow_writes_per_hour: 6 } as QshConfigYaml}
        onSuccess={onSuccess}
      />,
    )
    let input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('6')
    rerender(
      <WriteBudgetField
        label="Flow writes per hour"
        fieldKey="flow_writes_per_hour"
        apiPath="api/control/flow-writes-per-hour"
        rootConfig={{ flow_writes_per_hour: 4 } as QshConfigYaml}
        onSuccess={onSuccess}
      />,
    )
    input = screen.getByLabelText('Flow writes per hour') as HTMLInputElement
    expect(input.value).toBe('4')
  })
})
