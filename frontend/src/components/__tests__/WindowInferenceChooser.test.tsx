// INSTRUCTION-572B T6 — the chooser. Cases C1 to C8, numbered as in T6 of
// the instruction.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { WindowInferenceChooser } from '../WindowInferenceChooser'
import { WINDOW_INFERENCE } from '../../lib/helpText'

const MODES = [
  ['disabled', 'Off'],
  ['observe', 'Observe'],
  ['act', 'Act'],
] as const

const radio = (name: string) => screen.getByRole('radio', { name }) as HTMLInputElement

describe('WindowInferenceChooser (INSTRUCTION-572B)', () => {
  it('(C1) is one group with the title as its legend, the introduction and three radio buttons in the order Off, Observe, Act', () => {
    render(<WindowInferenceChooser name="g" value="disabled" onChange={vi.fn()} />)
    const group = screen.getByRole('group', { name: WINDOW_INFERENCE.title })
    expect(group.tagName).toBe('FIELDSET')
    expect(within(group).getByText(WINDOW_INFERENCE.intro)).toBeInTheDocument()
    const radios = within(group).getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual(['Off', 'Observe', 'Act'])
    expect(radios.every((r) => r.name === 'g')).toBe(true)
  })

  it.each(MODES)('(C2) the radio of %s has its label and its text in its own label element, and the text describes it', (mode, label) => {
    render(<WindowInferenceChooser name="g" value="disabled" onChange={vi.fn()} />)
    const input = radio(label)
    const wrapper = input.closest('label')!
    expect(within(wrapper).getByText(label)).toBeInTheDocument()
    expect(within(wrapper).getByText(WINDOW_INFERENCE[mode])).toBeInTheDocument()
    // No other mode's text is in this label.
    for (const [other] of MODES) {
      if (other !== mode) expect(within(wrapper).queryByText(WINDOW_INFERENCE[other])).toBeNull()
    }
    expect(input).toHaveAccessibleDescription(WINDOW_INFERENCE[mode])
  })

  it.each(MODES)('(C3) with the value %s, only that radio is selected', (mode, label) => {
    render(<WindowInferenceChooser name="g" value={mode} onChange={vi.fn()} />)
    expect(radio(label)).toBeChecked()
    expect((screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked)).toHaveLength(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it.each(MODES)('(C4) a click on the radio of %s gives that mode to the host', async (mode, label) => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    // The value is another mode, so that the click is a change.
    render(<WindowInferenceChooser name="g" value={mode === 'act' ? 'observe' : 'act'} onChange={onChange} />)
    await user.click(radio(label))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(mode)
  })

  it('(C5) a click on the text of a mode selects that mode', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<WindowInferenceChooser name="g" value="disabled" onChange={onChange} />)
    await user.click(screen.getByText(WINDOW_INFERENCE.act))
    expect(onChange).toHaveBeenCalledWith('act')
  })

  it('(C6) with no value, no radio is selected, the text for a stored value that is not a mode is shown, and a click on Off gives disabled', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<WindowInferenceChooser name="g" value={null} onChange={onChange} />)
    expect((screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked)).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(WINDOW_INFERENCE.invalid)
    await user.click(radio('Off'))
    expect(onChange).toHaveBeenCalledWith('disabled')
  })

  it('(C7) two choosers on one page are two groups', () => {
    render(
      <>
        <WindowInferenceChooser name="a" value="observe" onChange={vi.fn()} />
        <WindowInferenceChooser name="b" value="act" onChange={vi.fn()} />
      </>,
    )
    const radios = screen.getAllByRole('radio') as HTMLInputElement[]
    expect(radios.map((r) => r.name)).toEqual(['a', 'a', 'a', 'b', 'b', 'b'])
    expect(radios.filter((r) => r.checked).map((r) => `${r.name}:${r.getAttribute('aria-label')}`)).toEqual([
      'a:Observe',
      'b:Act',
    ])
    expect(new Set(radios.map((r) => r.getAttribute('aria-describedby'))).size).toBe(6)
  })

  it('(C8) the selection follows the value that the host gives, with no click', () => {
    const { rerender } = render(<WindowInferenceChooser name="g" value="act" onChange={vi.fn()} />)
    expect(radio('Act')).toBeChecked()
    rerender(<WindowInferenceChooser name="g" value="disabled" onChange={vi.fn()} />)
    expect(radio('Off')).toBeChecked()
    expect(radio('Act')).not.toBeChecked()
    rerender(<WindowInferenceChooser name="g" value={null} onChange={vi.fn()} />)
    expect((screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked)).toHaveLength(0)
  })
})
