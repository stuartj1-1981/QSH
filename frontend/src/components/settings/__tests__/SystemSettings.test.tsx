// INSTRUCTION-327 — Schedule timezone field on the System settings panel.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { SystemSettings } from '../SystemSettings'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

beforeEach(() => {
  mockFetch.mockReset()
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ updated: 'root', restart_required: false, message: '' }),
  })
})

const baseProps = {
  driver: 'ha' as const,
  onRunWizard: vi.fn(),
  onRefetch: vi.fn(),
}

function patchCalls() {
  return mockFetch.mock.calls.filter(
    (call) => typeof call[0] === 'string' && (call[0] as string).includes('api/config/root')
  )
}

describe('SystemSettings schedule timezone field', () => {
  it('renders the field with current value and help text', () => {
    render(<SystemSettings {...baseProps} scheduleTimezone="Europe/London" />)
    const input = screen.getByLabelText('Schedule timezone') as HTMLInputElement
    expect(input.value).toBe('Europe/London')
    expect(screen.getByText(/Leave blank for automatic/)).toBeDefined()
  })

  it('PATCHes api/config/root with the typed value', async () => {
    render(<SystemSettings {...baseProps} />)
    fireEvent.change(screen.getByLabelText('Schedule timezone'), {
      target: { value: 'Europe/London' },
    })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(patchCalls().length).toBe(1))
    const [url, init] = patchCalls()[0]
    expect(url).toContain('api/config/root')
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      data: { schedule_timezone: 'Europe/London' },
    })
    await waitFor(() => expect(baseProps.onRefetch).toHaveBeenCalled())
  })

  it('accepts a single-token IANA key (UTC) — backend is authoritative', async () => {
    render(<SystemSettings {...baseProps} />)
    fireEvent.change(screen.getByLabelText('Schedule timezone'), {
      target: { value: 'UTC' },
    })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(patchCalls().length).toBe(1))
    expect(screen.queryByText(/Not a valid IANA zone name shape/)).toBeNull()
  })

  it('rejects a leading-slash zone client-side without PATCHing', async () => {
    render(<SystemSettings {...baseProps} />)
    fireEvent.change(screen.getByLabelText('Schedule timezone'), {
      target: { value: '/Europe/London' },
    })
    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText(/Not a valid IANA zone name shape/)).toBeDefined()
    expect(patchCalls().length).toBe(0)
  })

  it('rejects a dangling-separator zone client-side without PATCHing', async () => {
    render(<SystemSettings {...baseProps} />)
    fireEvent.change(screen.getByLabelText('Schedule timezone'), {
      target: { value: 'Europe/' },
    })
    fireEvent.click(screen.getByText('Save'))

    expect(await screen.findByText(/Not a valid IANA zone name shape/)).toBeDefined()
    expect(patchCalls().length).toBe(0)
  })

  it('blank save PATCHes an empty value (clears to automatic)', async () => {
    render(<SystemSettings {...baseProps} scheduleTimezone="Europe/London" />)
    fireEvent.change(screen.getByLabelText('Schedule timezone'), {
      target: { value: '' },
    })
    fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(patchCalls().length).toBe(1))
    expect(JSON.parse((patchCalls()[0][1] as RequestInit).body as string)).toEqual({
      data: { schedule_timezone: '' },
    })
  })
})
