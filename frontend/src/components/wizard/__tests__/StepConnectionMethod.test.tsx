import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepConnectionMethod } from '../StepConnectionMethod'

describe('StepConnectionMethod', () => {
  it('renders both HA and MQTT options', () => {
    const onUpdate = vi.fn()
    render(<StepConnectionMethod config={{}} onUpdate={onUpdate} />)
    expect(screen.getByText('Home Assistant')).toBeDefined()
    expect(screen.getByText('MQTT')).toBeDefined()
  })

  it('clicking HA sets driver to ha', () => {
    const onUpdate = vi.fn()
    render(<StepConnectionMethod config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText('Home Assistant'))
    expect(onUpdate).toHaveBeenCalledWith('driver', 'ha')
  })

  it('clicking MQTT sets driver to mqtt', () => {
    const onUpdate = vi.fn()
    render(<StepConnectionMethod config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText('MQTT'))
    expect(onUpdate).toHaveBeenCalledWith('driver', 'mqtt')
  })

  it('both options have accessible descriptions', () => {
    const onUpdate = vi.fn()
    render(<StepConnectionMethod config={{}} onUpdate={onUpdate} />)
    expect(screen.getByText('Sensors and control via Home Assistant entities')).toBeDefined()
    expect(screen.getByText('Direct MQTT broker connection')).toBeDefined()
  })
})
