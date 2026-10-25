import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { StepTelemetryAgreement } from '../StepTelemetryAgreement'

describe('StepTelemetryAgreement', () => {
  it('renders with default state — toggle OFF, no region selector, the Settings text', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    expect(screen.getByText('Fleet Data Sharing')).toBeDefined()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByText('Select your region')).toBeNull()
    expect(screen.getByText(/You can enable data sharing later in Settings/)).toBeDefined()
  })

  it('toggle defaults to OFF', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Select your region')).toBeNull()
    expect(screen.getByText(/You can enable data sharing later in Settings/)).toBeDefined()
  })

  it('calls onUpdate with agreed false and no region initially', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    expect(onUpdate).toHaveBeenCalledWith('telemetry', { agreed: false, region: undefined })
  })

  it('selecting a UK region calls onUpdate with region', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'London' } })
    expect(onUpdate).toHaveBeenCalledWith('telemetry', { agreed: true, region: 'London' })
  })

  it('switching to international mode shows text input', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByText('International'))
    const input = screen.getByPlaceholderText('e.g. Northern France, Southern Ontario')
    expect(input).toBeDefined()
    fireEvent.change(input, { target: { value: 'Northern France' } })
    expect(onUpdate).toHaveBeenCalledWith('telemetry', { agreed: true, region: 'Northern France' })
  })

  it('toggle OFF hides region selector', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{ telemetry: { agreed: true, region: 'London' } }} onUpdate={onUpdate} />)
    expect(screen.getByText('Select your region')).toBeDefined()
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('Select your region')).toBeNull()
    expect(onUpdate).toHaveBeenLastCalledWith('telemetry', { agreed: false, region: undefined })
  })

  it('toggle OFF shows informational text', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{ telemetry: { agreed: true } }} onUpdate={onUpdate} />)
    expect(screen.queryByText(/You can enable data sharing later in Settings/)).toBeNull()
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.getByText(/You can enable data sharing later in Settings/)).toBeDefined()
  })

  it('pre-fills from existing config with UK region', () => {
    const onUpdate = vi.fn()
    render(
      <StepTelemetryAgreement
        config={{ telemetry: { agreed: true, region: 'London' } }}
        onUpdate={onUpdate}
      />
    )
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
    const select = screen.getByRole('combobox') as HTMLSelectElement
    expect(select.value).toBe('London')
  })

  it('pre-fills opted-out config', () => {
    const onUpdate = vi.fn()
    render(
      <StepTelemetryAgreement
        config={{ telemetry: { agreed: false } }}
        onUpdate={onUpdate}
      />
    )
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(screen.queryByText('Select your region')).toBeNull()
  })
  // -------------------------------------------------------------------------
  // INSTRUCTION-570C — the location level
  // -------------------------------------------------------------------------

  it('a default render sends no location level and shows no level control', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    expect(onUpdate.mock.calls[0][1]).not.toHaveProperty('location_level')
    expect(screen.queryByRole('radiogroup')).toBeNull()
  })

  it('a district chosen with a typed fragment is sent with the fragment as typed', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'London' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Postcode district' }))
    fireEvent.change(screen.getByLabelText('First part of your postcode'), { target: { value: ' zz99 ' } })
    expect(onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]).toEqual({
      agreed: true,
      region: 'London',
      location_level: 'district',
      location_code: ' zz99 ',
    })
  })

  it('International mode sends no location level', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'London' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Postcode district' }))
    fireEvent.change(screen.getByLabelText('First part of your postcode'), { target: { value: ' zz99 ' } })
    fireEvent.click(screen.getByText('International'))
    expect(onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]).not.toHaveProperty('location_level')
  })

  it('pre-fills a stored sector and its fragment', () => {
    const onUpdate = vi.fn()
    render(
      <StepTelemetryAgreement
        config={{ telemetry: { agreed: true, region: 'London', location_level: 'sector', location_code: 'ZZ99 9' } }}
        onUpdate={onUpdate}
      />
    )
    expect(screen.getByRole('radio', { name: 'Postcode sector' })).toBeChecked()
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('ZZ99 9')
  })

  it('International then UK leaves the region level and no text box', () => {
    const onUpdate = vi.fn()
    render(
      <StepTelemetryAgreement
        config={{ telemetry: { agreed: true, region: 'London', location_level: 'sector', location_code: 'ZZ99 9' } }}
        onUpdate={onUpdate}
      />
    )
    fireEvent.click(screen.getByText('International'))
    fireEvent.click(screen.getByText('UK'))
    expect(screen.getByRole('radio', { name: 'Region only' })).toBeChecked()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]).not.toHaveProperty('location_level')
  })

  it('turning data sharing off sends no location level', () => {
    const onUpdate = vi.fn()
    render(
      <StepTelemetryAgreement
        config={{ telemetry: { agreed: true, region: 'London', location_level: 'sector', location_code: 'ZZ99 9' } }}
        onUpdate={onUpdate}
      />
    )
    fireEvent.click(screen.getByRole('switch'))
    expect(onUpdate.mock.calls[onUpdate.mock.calls.length - 1][1]).not.toHaveProperty('location_level')
  })

  it('the list of what is collected has ten items', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    const button = screen.getByRole('button', { name: /What exactly is collected\?/ })
    fireEvent.click(button)
    const list = button.parentElement?.querySelector('ul') as HTMLElement
    expect(within(list).getAllByRole('listitem')).toHaveLength(10)
    expect(screen.getByText('Operating state, about every 15 minutes')).toBeInTheDocument()
  })

  it('a stored district beside a region outside the UK list opens in International mode and sends the region only', () => {
    const onUpdate = vi.fn()
    render(
      <StepTelemetryAgreement
        config={{ telemetry: { agreed: true, region: 'Northern France', location_level: 'district', location_code: 'ZZ99' } }}
        onUpdate={onUpdate}
      />
    )
    expect(onUpdate.mock.calls[0][1]).toEqual({ agreed: true, region: 'Northern France' })
  })
})
