import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopicPicker } from '../TopicPicker'
import type { MqttTopicCandidate } from '../../../types/config'

const MOCK_RESULTS: MqttTopicCandidate[] = [
  { topic: 'sensors/outdoor/temp', payload: '7.5', is_numeric: true, suggested_field: 'outdoor_temp' },
  { topic: 'sensors/hp/power', payload: '2100', is_numeric: true },
  { topic: 'rooms/lounge/temp', payload: '20.5', is_numeric: true, suggested_field: 'room_temp' },
]

describe('TopicPicker', () => {
  it('renders text input with placeholder', () => {
    render(<TopicPicker value="" onChange={vi.fn()} placeholder="Enter topic..." />)
    expect(screen.getByPlaceholderText('Enter topic...')).toBeDefined()
  })

  it('manual text entry calls onChange', () => {
    const onChange = vi.fn()
    render(<TopicPicker value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('Enter MQTT topic...')
    fireEvent.change(input, { target: { value: 'test/topic' } })
    expect(onChange).toHaveBeenCalledWith('test/topic')
  })

  it('shows browse button when scanResults provided', () => {
    render(<TopicPicker value="" onChange={vi.fn()} scanResults={MOCK_RESULTS} />)
    expect(screen.getByTitle('Browse discovered topics')).toBeDefined()
  })

  it('does not show browse button without scanResults', () => {
    render(<TopicPicker value="" onChange={vi.fn()} />)
    expect(screen.queryByTitle('Browse discovered topics')).toBeNull()
  })

  it('clicking browse opens dropdown with topics', () => {
    render(<TopicPicker value="" onChange={vi.fn()} scanResults={MOCK_RESULTS} />)
    fireEvent.click(screen.getByTitle('Browse discovered topics'))
    expect(screen.getByText('sensors/outdoor/temp')).toBeDefined()
    expect(screen.getByText('sensors/hp/power')).toBeDefined()
  })

  it('clicking a topic populates the input', () => {
    const onChange = vi.fn()
    render(<TopicPicker value="" onChange={onChange} scanResults={MOCK_RESULTS} />)
    fireEvent.click(screen.getByTitle('Browse discovered topics'))
    fireEvent.click(screen.getByText('sensors/outdoor/temp'))
    expect(onChange).toHaveBeenCalledWith('sensors/outdoor/temp')
  })
})
