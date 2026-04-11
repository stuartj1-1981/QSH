import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepTelemetryAgreement } from '../StepTelemetryAgreement'

describe('StepTelemetryAgreement', () => {
  it('renders with default state — toggle ON, region selector visible, UK mode', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    expect(screen.getByText('Fleet Data Sharing')).toBeDefined()
    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText('Select your region')).toBeDefined()
  })

  it('toggle defaults to ON', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    const toggle = screen.getByRole('switch')
    expect(toggle.getAttribute('aria-checked')).toBe('true')
  })

  it('calls onUpdate with agreed true and empty region initially', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    expect(onUpdate).toHaveBeenCalledWith('telemetry', { agreed: true, region: '' })
  })

  it('selecting a UK region calls onUpdate with region', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'North West England' } })
    expect(onUpdate).toHaveBeenCalledWith('telemetry', { agreed: true, region: 'North West England' })
  })

  it('switching to international mode shows text input', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText('International'))
    const input = screen.getByPlaceholderText('e.g. Northern France, Southern Ontario')
    expect(input).toBeDefined()
    fireEvent.change(input, { target: { value: 'Northern France' } })
    expect(onUpdate).toHaveBeenCalledWith('telemetry', { agreed: true, region: 'Northern France' })
  })

  it('toggle OFF hides region selector', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('switch'))
    expect(screen.queryByText('Select your region')).toBeNull()
  })

  it('toggle OFF shows informational text', () => {
    const onUpdate = vi.fn()
    render(<StepTelemetryAgreement config={{}} onUpdate={onUpdate} />)
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
})
