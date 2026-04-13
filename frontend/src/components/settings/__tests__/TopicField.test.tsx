import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TopicField } from '../TopicField'

describe('TopicField', () => {
  it('renders label and input', () => {
    render(
      <TopicField label="Outdoor Temp" value="" onChange={() => {}} />
    )
    expect(screen.getByText('Outdoor Temp')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('temps/outsideTemp')).toBeInTheDocument()
  })

  it('renders custom placeholder', () => {
    render(
      <TopicField label="Flow" value="" onChange={() => {}} placeholder="heating/flow" />
    )
    expect(screen.getByPlaceholderText('heating/flow')).toBeInTheDocument()
  })

  it('invokes onChange on typing', () => {
    const onChange = vi.fn()
    render(
      <TopicField label="Topic" value="" onChange={onChange} />
    )
    const input = screen.getByPlaceholderText('temps/outsideTemp')
    fireEvent.change(input, { target: { value: 'test/topic' } })
    expect(onChange).toHaveBeenCalledWith('test/topic')
  })

  it('renders lastPayload when provided', () => {
    render(
      <TopicField
        label="Topic"
        value="temps/outside"
        onChange={() => {}}
        lastPayload="21.3"
      />
    )
    expect(screen.getByText(/Last: 21.3/)).toBeInTheDocument()
  })

  it('renders lastPayload with relative timestamp', () => {
    const recent = new Date().toISOString()
    render(
      <TopicField
        label="Topic"
        value="temps/outside"
        onChange={() => {}}
        lastPayload="21.3"
        lastSeenAt={recent}
      />
    )
    expect(screen.getByText(/Last: 21.3/)).toBeInTheDocument()
    expect(screen.getByText(/just now/)).toBeInTheDocument()
  })

  it('does not render lastPayload section when not provided', () => {
    render(
      <TopicField label="Topic" value="" onChange={() => {}} />
    )
    expect(screen.queryByText(/Last:/)).toBeNull()
  })

  it('renders Discover button only when onDiscover is provided', () => {
    const { rerender } = render(
      <TopicField label="Topic" value="" onChange={() => {}} />
    )
    expect(screen.queryByText('Discover')).toBeNull()

    const onDiscover = vi.fn()
    rerender(
      <TopicField label="Topic" value="" onChange={() => {}} onDiscover={onDiscover} />
    )
    expect(screen.getByText('Discover')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Discover'))
    expect(onDiscover).toHaveBeenCalledOnce()
  })

  it('applies maxLength=256 to the input', () => {
    render(
      <TopicField label="Topic" value="" onChange={() => {}} />
    )
    const input = screen.getByPlaceholderText('temps/outsideTemp')
    expect(input).toHaveAttribute('maxLength', '256')
  })

  it('respects disabled prop', () => {
    render(
      <TopicField label="Topic" value="" onChange={() => {}} disabled />
    )
    expect(screen.getByPlaceholderText('temps/outsideTemp')).toBeDisabled()
  })
})
