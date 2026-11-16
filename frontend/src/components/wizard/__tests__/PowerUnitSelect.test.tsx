/**
 * INSTRUCTION-629D — the unit selector of an MQTT power topic.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PowerUnitSelect } from '../PowerUnitSelect'

function select(): HTMLSelectElement {
  return screen.getByLabelText('Power Input unit') as HTMLSelectElement
}

describe('PowerUnitSelect (INSTRUCTION-629D)', () => {
  it('shows kW when the entry holds no unit', () => {
    render(<PowerUnitSelect label="Power Input" stored="" onChange={vi.fn()} />)
    expect(select().value).toBe('kW')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the stored W and the stored kW', () => {
    const { unmount } = render(<PowerUnitSelect label="Power Input" stored="W" onChange={vi.fn()} />)
    expect(select().value).toBe('W')
    unmount()
    render(<PowerUnitSelect label="Power Input" stored="kW" onChange={vi.fn()} />)
    expect(select().value).toBe('kW')
  })

  it('gives W and kW to onChange', () => {
    const onChange = vi.fn()
    render(<PowerUnitSelect label="Power Input" stored="" onChange={onChange} />)
    fireEvent.change(select(), { target: { value: 'W' } })
    fireEvent.change(select(), { target: { value: 'kW' } })
    expect(onChange).toHaveBeenCalledTimes(2)
    expect(onChange).toHaveBeenNthCalledWith(1, 'W')
    expect(onChange).toHaveBeenNthCalledWith(2, 'kW')
  })

  it('shows a stored value that is not W or kW, with an alert, and has only W and kW to select', () => {
    const onChange = vi.fn()
    render(<PowerUnitSelect label="Power Input" stored="watts" onChange={onChange} />)
    expect(select().value).toBe('watts')
    expect(screen.getByRole('alert')).toHaveTextContent('Select W or kW.')
    const options = Array.from(select().options)
    expect(options.map((o) => o.value)).toEqual(['watts', 'kW', 'W'])
    expect(options[0].disabled).toBe(true)
    fireEvent.change(select(), { target: { value: 'kW' } })
    expect(onChange).toHaveBeenCalledWith('kW')
  })
})
