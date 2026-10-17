// INSTRUCTION-581 T7 — the TRV Setpoint and Valve Setpoint topics in the wizard.
// Cases W1 to W4, numbered as in T7 of the instruction.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepRooms } from '../StepRooms'
import type { RoomConfigYaml } from '../../../types/config'

describe('StepRooms setpoint topics (INSTRUCTION-581)', () => {
  const mqttConfig = (mqtt_topics: Record<string, unknown>) => ({
    driver: 'mqtt' as const,
    rooms: { lounge: { area_m2: 20, facing: 'S', ceiling_m: 2.4, mqtt_topics } },
  })

  it('W1: a scalar trv_setpoint is edited as before and saved as a string', () => {
    const onUpdate = vi.fn()
    render(<StepRooms config={mqttConfig({ trv_setpoint: 'l/set' })} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    fireEvent.change(screen.getByDisplayValue('l/set'), { target: { value: 'l/set2' } })
    const rooms = onUpdate.mock.calls.at(-1)![1] as Record<string, RoomConfigYaml>
    expect(rooms.lounge.mqtt_topics?.trv_setpoint).toBe('l/set2')
  })

  it('W2: a list trv_setpoint and valve_setpoint show read-only, with every topic', () => {
    render(
      <StepRooms
        config={mqttConfig({ trv_setpoint: ['l/a', 'l/b'], valve_setpoint: ['v/a', 'v/b'] })}
        onUpdate={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByText(/lounge/))
    const trv = screen.getByTestId('lounge-wizard-trv-setpoint-list')
    expect(trv.textContent).toContain('TRV Setpoint (optional)')
    expect(trv.textContent).toContain('l/a, l/b')
    expect(trv.textContent).toContain('Change this list in Settings.')
    const valve = screen.getByTestId('lounge-wizard-valve-setpoint-list')
    expect(valve.textContent).toContain('Valve Setpoint (optional)')
    expect(valve.textContent).toContain('v/a, v/b')
    expect(valve.textContent).toContain('Change this list in Settings.')
    // No text input holds a list topic, so the wizard cannot collapse the list.
    expect(screen.queryByDisplayValue('l/a')).toBeNull()
    expect(screen.queryByDisplayValue('l/b')).toBeNull()
  })

  it('W3: a one-entry list shows the topic in the picker', () => {
    render(
      <StepRooms config={mqttConfig({ trv_setpoint: ['l/a'] })} onUpdate={vi.fn()} />,
    )
    fireEvent.click(screen.getByText(/lounge/))
    expect(screen.getByDisplayValue('l/a')).toBeInTheDocument()
    expect(screen.queryByTestId('lounge-wizard-trv-setpoint-list')).toBeNull()
  })

  it('W4: clearing a scalar valve_setpoint removes the value', () => {
    const onUpdate = vi.fn()
    render(<StepRooms config={mqttConfig({ valve_setpoint: 'v/a' })} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByText(/lounge/))
    fireEvent.change(screen.getByDisplayValue('v/a'), { target: { value: '' } })
    const rooms = onUpdate.mock.calls.at(-1)![1] as Record<string, RoomConfigYaml>
    expect(rooms.lounge.mqtt_topics?.valve_setpoint).toBeUndefined()
  })
})
