import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepMqttBroker } from '../StepMqttBroker'

describe('StepMqttBroker', () => {
  const defaultConfig = {
    driver: 'mqtt',
    mqtt: { broker: '', port: 1883, inputs: {} },
  }

  it('renders all form fields', () => {
    render(<StepMqttBroker config={defaultConfig} onUpdate={vi.fn()} />)
    expect(screen.getByPlaceholderText('192.168.1.50 or hostname')).toBeDefined()
    expect(screen.getByText('Port')).toBeDefined()
    expect(screen.getByText('Username')).toBeDefined()
    expect(screen.getByText('Password')).toBeDefined()
    expect(screen.getByText('Client ID')).toBeDefined()
    expect(screen.getByText('TLS')).toBeDefined()
    expect(screen.getByText('Topic Prefix')).toBeDefined()
  })

  it('broker field is required (has asterisk)', () => {
    render(<StepMqttBroker config={defaultConfig} onUpdate={vi.fn()} />)
    const brokerLabel = screen.getByText('Broker')
    expect(brokerLabel.parentElement?.querySelector('.text-\\[var\\(--red\\)\\]')).toBeDefined()
  })

  it('test connection button exists and is disabled without broker', () => {
    render(<StepMqttBroker config={defaultConfig} onUpdate={vi.fn()} />)
    const btn = screen.getByText('Test Connection')
    expect(btn.closest('button')?.disabled).toBe(true)
  })

  it('test connection button is enabled with broker', () => {
    const config = {
      ...defaultConfig,
      mqtt: { ...defaultConfig.mqtt, broker: 'localhost' },
    }
    render(<StepMqttBroker config={config} onUpdate={vi.fn()} />)
    const btn = screen.getByText('Test Connection')
    expect(btn.closest('button')?.disabled).toBe(false)
  })

  it('output topic fields render', () => {
    render(<StepMqttBroker config={defaultConfig} onUpdate={vi.fn()} />)
    expect(screen.getByText('Flow Temperature')).toBeDefined()
    expect(screen.getByText('Mode')).toBeDefined()
    expect(screen.getByPlaceholderText('heatpump/flow_temp/set')).toBeDefined()
  })

  it('broker input calls onUpdate', () => {
    const onUpdate = vi.fn()
    render(<StepMqttBroker config={defaultConfig} onUpdate={onUpdate} />)
    const input = screen.getByPlaceholderText('192.168.1.50 or hostname')
    fireEvent.change(input, { target: { value: 'test.local' } })
    expect(onUpdate).toHaveBeenCalledWith('mqtt', expect.objectContaining({ broker: 'test.local' }))
  })
})
