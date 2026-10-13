/**
 * INSTRUCTION-577C — the band editor (OB-04): it shows the end of a band as
 * the start of the next, every edit gives a whole day, the focus follows a
 * moved boundary, and a rate that is not above 0 is flagged.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TouBandEditor } from '../TouBandEditor'
import type { TouBand } from '../../types/config'

const TWO: TouBand[] = [
  { start: '06:00', rate: 0.3 },
  { start: '23:00', rate: 0.08 },
]

describe('TouBandEditor', () => {
  it('shows each band with its end, its length and a total of 24 h', () => {
    render(<TouBandEditor bands={TWO} onChange={() => {}} />)
    const first = screen.getByTestId('tou-band-0')
    expect((within(first).getByLabelText('Band 1 start') as HTMLSelectElement).value).toBe('06:00')
    expect((within(first).getByLabelText('Band 1 end') as HTMLSelectElement).value).toBe('23:00')
    expect(within(first).getByText('17 h')).toBeDefined()
    const second = screen.getByTestId('tou-band-1')
    expect((within(second).getByLabelText('Band 2 end') as HTMLSelectElement).value).toBe('06:00')
    expect(within(second).getByText('7 h')).toBeDefined()
    expect(screen.getByTestId('tou-total').textContent).toBe('Total 24 h in 2 bands')
  })

  it('offers each select only the starts strictly between the neighbours', () => {
    render(<TouBandEditor bands={TWO} onChange={() => {}} />)
    const values = (label: string) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value)
    const start = values('Band 1 start')
    expect(start).toHaveLength(47)
    expect([start[0], start[46]]).toEqual(['23:30', '22:30'])
    expect(start).not.toContain('23:00')
    const end = values('Band 1 end')
    expect(end).toHaveLength(47)
    expect([end[0], end[46]]).toEqual(['06:30', '05:30'])
    expect(end).not.toContain('06:00')
  })

  it('moves the start of the next band when the end of a band changes', () => {
    const onChange = vi.fn()
    render(<TouBandEditor bands={TWO} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Band 1 end'), { target: { value: '22:30' } })
    expect(onChange).toHaveBeenCalledWith([
      { start: '06:00', rate: 0.3 },
      { start: '22:30', rate: 0.08 },
    ])
  })

  it('moves the start of the first band when the end of the last band changes', () => {
    const onChange = vi.fn()
    render(<TouBandEditor bands={TWO} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Band 2 end'), { target: { value: '05:00' } })
    expect(onChange).toHaveBeenCalledWith([
      { start: '05:00', rate: 0.3 },
      { start: '23:00', rate: 0.08 },
    ])
  })

  it('keeps the focused start select when its start changes', () => {
    const { rerender } = render(<TouBandEditor bands={TWO} onChange={() => {}} />)
    const select = screen.getByLabelText('Band 2 start')
    select.focus()
    rerender(
      <TouBandEditor
        bands={[TWO[0], { start: '22:30', rate: 0.08 }]}
        onChange={() => {}}
      />,
    )
    expect(screen.getByLabelText('Band 2 start')).toBe(select)
    expect(document.activeElement).toBe(select)
  })

  it('moves the focus with the boundary when a start change re-sorts the rows', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TouBandEditor bands={TWO} onChange={onChange} />)
    const select = screen.getByLabelText('Band 1 start')
    select.focus()
    fireEvent.change(select, { target: { value: '23:30' } })
    const moved = onChange.mock.calls[0][0] as TouBand[]
    expect(moved).toEqual([
      { start: '23:00', rate: 0.08 },
      { start: '23:30', rate: 0.3 },
    ])
    rerender(<TouBandEditor bands={moved} onChange={onChange} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Band 2 start'))
  })

  it('moves the focus with the boundary when an end change re-sorts the rows', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TouBandEditor bands={TWO} onChange={onChange} />)
    const select = screen.getByLabelText('Band 2 end')
    select.focus()
    fireEvent.change(select, { target: { value: '23:30' } })
    const moved = onChange.mock.calls[0][0] as TouBand[]
    expect(moved).toEqual([
      { start: '23:00', rate: 0.08 },
      { start: '23:30', rate: 0.3 },
    ])
    rerender(<TouBandEditor bands={moved} onChange={onChange} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Band 1 end'))
  })

  it('moves the focus to the row of the moved boundary in both directions with three bands', () => {
    const THREE: TouBand[] = [
      { start: '01:00', rate: 0.1 },
      { start: '08:00', rate: 0.2 },
      { start: '16:00', rate: 0.3 },
    ]
    const MOVED: TouBand[] = [
      { start: '00:30', rate: 0.3 },
      { start: '01:00', rate: 0.1 },
      { start: '08:00', rate: 0.2 },
    ]
    const onChange = vi.fn()
    const { rerender } = render(<TouBandEditor bands={THREE} onChange={onChange} />)
    // The start of the last band moves past midnight, so that band is now the first row.
    fireEvent.change(screen.getByLabelText('Band 3 start'), { target: { value: '00:30' } })
    expect(onChange).toHaveBeenLastCalledWith(MOVED)
    rerender(<TouBandEditor bands={onChange.mock.calls[0][0]} onChange={onChange} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Band 1 start'))
    // The end of the second row, the start of the third band, moves past
    // midnight, so the moved boundary is now the end of the last row.
    rerender(<TouBandEditor bands={THREE} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Band 2 end'), { target: { value: '00:30' } })
    expect(onChange).toHaveBeenLastCalledWith(MOVED)
    rerender(<TouBandEditor bands={onChange.mock.calls[1][0]} onChange={onChange} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Band 3 end'))
  })

  it('does not move the focus when the parent does not show the moved list', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TouBandEditor bands={TWO} onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('Band 1 start'), { target: { value: '23:30' } })
    const rate = screen.getByLabelText('Band 1 rate')
    rate.focus()
    rerender(<TouBandEditor bands={[...TWO]} onChange={onChange} />)
    expect(document.activeElement).toBe(rate)
  })

  it('splits and removes bands, and does not remove the last band', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TouBandEditor bands={TWO} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText('Split band 2'))
    expect(onChange).toHaveBeenLastCalledWith([
      { start: '02:30', rate: 0.08 },
      { start: '06:00', rate: 0.3 },
      { start: '23:00', rate: 0.08 },
    ])
    fireEvent.click(screen.getByLabelText('Remove band 1'))
    expect(onChange).toHaveBeenLastCalledWith([{ start: '23:00', rate: 0.08 }])
    rerender(<TouBandEditor bands={[{ start: '00:00', rate: 0.245 }]} onChange={onChange} />)
    expect((screen.getByLabelText('Remove band 1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Band 1 end') as HTMLSelectElement).disabled).toBe(true)
    expect(screen.getByTestId('tou-total').textContent).toBe('Total 24 h in 1 band')
  })

  it('does not split a band of 30 minutes', () => {
    render(
      <TouBandEditor
        bands={[
          { start: '00:00', rate: 0.1 },
          { start: '00:30', rate: 0.2 },
        ]}
        onChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('Split band 1') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByLabelText('Split band 2') as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByLabelText('Split band 1').getAttribute('title')).toBe('Split this band in two')
  })

  it('changes a rate, holds an empty input as 0 and flags a rate that is not above 0', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TouBandEditor bands={TWO} onChange={onChange} />)
    expect(screen.queryByRole('alert')).toBeNull()
    fireEvent.change(screen.getByLabelText('Band 2 rate'), { target: { value: '7.5' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { start: '06:00', rate: 0.3 },
      { start: '23:00', rate: 0.075 },
    ])
    fireEvent.change(screen.getByLabelText('Band 2 rate'), { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { start: '06:00', rate: 0.3 },
      { start: '23:00', rate: 0 },
    ])
    rerender(<TouBandEditor bands={[TWO[0], { start: '23:00', rate: 0 }]} onChange={onChange} />)
    const alert = screen.getByRole('alert')
    expect(alert.textContent).toBe('The rate must be above 0.')
    const input = screen.getByLabelText('Band 2 rate')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(input.getAttribute('aria-describedby')).toBe(alert.id)
    rerender(
      <TouBandEditor
        bands={[TWO[0], { start: '23:00', rate: Number.POSITIVE_INFINITY }]}
        onChange={onChange}
      />,
    )
    expect(screen.getByRole('alert').textContent).toBe('The rate must be above 0.')
  })
})

describe('TouBandEditor — the rate in pence (577F)', () => {
  it('shows each rate in p/kWh and gives the rate in £/kWh', () => {
    const onChange = vi.fn()
    render(<TouBandEditor bands={TWO} onChange={onChange} />)
    const first = screen.getByLabelText('Band 1 rate') as HTMLInputElement
    expect(first.value).toBe('30')
    expect((screen.getByLabelText('Band 2 rate') as HTMLInputElement).value).toBe('8')
    expect(first.min).toBe('0.1')
    expect(first.max).toBe('200')
    expect(first.step).toBe('0.01')
    fireEvent.change(first, { target: { value: '24.5' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { start: '06:00', rate: 0.245 },
      { start: '23:00', rate: 0.08 },
    ])
    fireEvent.change(first, { target: { value: '24.4965' } })
    expect(onChange).toHaveBeenLastCalledWith([
      { start: '06:00', rate: 0.244965 },
      { start: '23:00', rate: 0.08 },
    ])
  })

  it('shows a rate whose pence value is not exact in binary without a float residue', () => {
    render(
      <TouBandEditor
        bands={[
          { start: '00:00', rate: 0.29 },
          { start: '12:00', rate: 0.07 },
        ]}
        onChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('Band 1 rate') as HTMLInputElement).value).toBe('29')
    expect((screen.getByLabelText('Band 2 rate') as HTMLInputElement).value).toBe('7')
  })

  it('shows an empty rate, with no React error, for a rate that is not a number', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <TouBandEditor
        bands={[
          { start: '00:00', rate: Number.NaN },
          { start: '12:00', rate: 0.3 },
        ]}
        onChange={() => {}}
      />,
    )
    expect((screen.getByLabelText('Band 1 rate') as HTMLInputElement).value).toBe('')
    expect(error).not.toHaveBeenCalled()
    error.mockRestore()
  })

  it('shows a hint under a rate below 1p/kWh, and no hint at 1p or above or at 0', () => {
    const onChange = vi.fn()
    render(
      <TouBandEditor
        bands={[
          { start: '00:00', rate: 0.00245 },
          { start: '06:00', rate: 0.01 },
          { start: '12:00', rate: 0 },
          { start: '16:00', rate: 0.245 },
          { start: '20:00', rate: 0.0099 },
        ]}
        onChange={onChange}
      />,
    )
    const described = (n: number) => {
      const id = screen.getByLabelText(`Band ${n} rate`).getAttribute('aria-describedby')
      return id === null ? null : (document.getElementById(id)?.textContent ?? '')
    }
    expect(described(1)).toContain('Below 1p/kWh')
    expect(described(2)).toBeNull()
    expect(described(3)).toBe('The rate must be above 0.')
    expect(described(4)).toBeNull()
    expect(described(5)).toContain('Below 1p/kWh')
    expect(screen.getAllByText(/Below 1p\/kWh/)).toHaveLength(2)
    expect(screen.getAllByRole('alert')).toHaveLength(1)
    // The hint changes no rate: the editor calls onChange on an edit only.
    expect(onChange).not.toHaveBeenCalled()
  })

  it('states the unit in the column header and in its tooltip', () => {
    render(<TouBandEditor bands={TWO} onChange={() => {}} />)
    const header = screen.getByRole('columnheader', { name: /Rate \(p\/kWh\)/ })
    fireEvent.click(within(header).getByLabelText('Help'))
    expect(screen.getByRole('tooltip').textContent).toContain('must be in pence per kWh')
  })
})
