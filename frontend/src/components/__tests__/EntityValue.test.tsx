import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntityValue } from '../EntityValue'

describe('EntityValue', () => {
  it('renders children with title when entityId provided', () => {
    render(<EntityValue entityId="sensor.outdoor_temp">21.3°C</EntityValue>)
    const el = screen.getByText('21.3°C')
    expect(el.closest('[title]')?.getAttribute('title')).toBe('sensor.outdoor_temp')
  })

  it('renders children without title when entityId not provided', () => {
    render(<EntityValue>21.3°C</EntityValue>)
    const el = screen.getByText('21.3°C')
    expect(el.closest('[title]')).toBeNull()
  })

  it('renders children without title when entityId is empty string', () => {
    render(<EntityValue entityId="">21.3°C</EntityValue>)
    const el = screen.getByText('21.3°C')
    expect(el.closest('[title]')).toBeNull()
  })

  it('renders children without title when entityId is null', () => {
    render(<EntityValue entityId={null}>21.3°C</EntityValue>)
    const el = screen.getByText('21.3°C')
    expect(el.closest('[title]')).toBeNull()
  })

  it('shows dotted underline when engineering=true and entityId present', () => {
    render(
      <EntityValue entityId="sensor.outdoor_temp" engineering={true}>
        21.3°C
      </EntityValue>
    )
    const el = screen.getByText('21.3°C').closest('span')!
    expect(el.style.textDecorationStyle).toBe('dotted')
  })

  it('no dotted underline when engineering=false and entityId present', () => {
    render(
      <EntityValue entityId="sensor.outdoor_temp" engineering={false}>
        21.3°C
      </EntityValue>
    )
    const el = screen.getByText('21.3°C').closest('span')!
    expect(el.style.textDecorationStyle).toBe('')
  })

  it('no dotted underline when engineering=true but no entityId', () => {
    render(
      <EntityValue engineering={true}>21.3°C</EntityValue>
    )
    const el = screen.getByText('21.3°C').closest('span')!
    expect(el.style.textDecorationStyle).toBe('')
  })

  it('passes className through', () => {
    render(
      <EntityValue entityId="sensor.x" className="test-class">
        value
      </EntityValue>
    )
    const el = screen.getByText('value').closest('span')!
    expect(el.className).toContain('test-class')
  })
})
