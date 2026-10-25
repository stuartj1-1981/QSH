import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LocationLevelChooser } from '../LocationLevelChooser'
import {
  LOCATION_CANNOT_USE_HEADING,
  LOCATION_CAN_USE_HEADING,
  LOCATION_INPUT_HELP,
  LOCATION_INTERNATIONAL_NOTE,
  LOCATION_LEVELS,
  LOCATION_LOWERING_NOTE,
  LOCATION_STATUS_NOTE,
} from '../../lib/locationLevels'

const DISTRICT = LOCATION_LEVELS[1]
const SECTOR = LOCATION_LEVELS[2]

function follows(a: HTMLElement, b: HTMLElement): boolean {
  return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
}

describe('LocationLevelChooser', () => {
  it('shows three levels, the status note and the lowering note, and no text box at the region level', () => {
    render(<LocationLevelChooser regionMode="uk" level="region" code="" onChange={vi.fn()} />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: 'Region only' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'Postcode district' })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: 'Postcode sector' })).not.toBeChecked()
    expect(screen.getByText(LOCATION_STATUS_NOTE)).toBeInTheDocument()
    expect(screen.getByText(LOCATION_LOWERING_NOTE)).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).toBeNull()
  })

  it('shows the three texts of each level', () => {
    render(<LocationLevelChooser regionMode="uk" level="region" code="" onChange={vi.fn()} />)
    for (const entry of LOCATION_LEVELS) {
      expect(screen.getByText(entry.shares)).toBeInTheDocument()
      for (const t of entry.canUse) expect(screen.getByText(t)).toBeInTheDocument()
      for (const t of entry.cannotUse) expect(screen.getByText(t)).toBeInTheDocument()
    }
    expect(screen.getAllByText(LOCATION_CAN_USE_HEADING)).toHaveLength(3)
    expect(screen.getAllByText(LOCATION_CANNOT_USE_HEADING)).toHaveLength(3)
  })

  it('selecting Postcode district gives the district level and an empty fragment', () => {
    const onChange = vi.fn()
    render(<LocationLevelChooser regionMode="uk" level="region" code="" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Postcode district' }))
    expect(onChange.mock.calls).toEqual([['district', '']])
  })

  it('at the district level shows one text box, then the input help and the district privacy note', () => {
    render(<LocationLevelChooser regionMode="uk" level="district" code="zz99" onChange={vi.fn()} />)
    expect(screen.getAllByRole('textbox')).toHaveLength(1)
    const box = screen.getByLabelText('First part of your postcode') as HTMLInputElement
    expect(box.placeholder).toBe('SW1A')
    expect(box.value).toBe('zz99')
    const help = screen.getByText(LOCATION_INPUT_HELP)
    const note = screen.getByText(DISTRICT.privacyNote as string)
    expect(follows(box, help)).toBe(true)
    expect(follows(help, note)).toBe(true)
  })

  it('typing gives the text as typed, spaces included', () => {
    const onChange = vi.fn()
    render(<LocationLevelChooser regionMode="uk" level="district" code="" onChange={onChange} />)
    fireEvent.change(screen.getByLabelText('First part of your postcode'), { target: { value: ' zz99 ' } })
    expect(onChange.mock.calls).toEqual([['district', ' zz99 ']])
  })

  it('at the sector level shows the sector label, placeholder, input help and privacy note', () => {
    render(<LocationLevelChooser regionMode="uk" level="sector" code="ZZ99 9" onChange={vi.fn()} />)
    const box = screen.getByLabelText('First part of your postcode and the next digit') as HTMLInputElement
    expect(box.placeholder).toBe('SW1A 1')
    expect(box.value).toBe('ZZ99 9')
    expect(screen.getByText(LOCATION_INPUT_HELP)).toBeInTheDocument()
    expect(screen.getByText(SECTOR.privacyNote as string)).toBeInTheDocument()
  })

  it('from the sector level, selecting another level clears the fragment', () => {
    const onChange = vi.fn()
    render(<LocationLevelChooser regionMode="uk" level="sector" code="ZZ99 9" onChange={onChange} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Region only' }))
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]).toEqual(['region', ''])
    fireEvent.click(screen.getByRole('radio', { name: 'Postcode district' }))
    expect(onChange.mock.calls[onChange.mock.calls.length - 1]).toEqual(['district', ''])
  })

  it('in International mode shows the international note and the lowering note, and no level control', () => {
    render(<LocationLevelChooser regionMode="international" level="region" code="" onChange={vi.fn()} />)
    expect(screen.getByText(LOCATION_INTERNATIONAL_NOTE)).toBeInTheDocument()
    expect(screen.getByText(LOCATION_LOWERING_NOTE)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
