/**
 * INSTRUCTION-572C T3 — the open-window inference mode in the wizard: the
 * chooser on the rooms step, the line on the review step, and the section in
 * the deploy body. Cases W1 to W13, numbered as in T3 of the instruction.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, renderHook, act, within } from '@testing-library/react'
import { StepRooms } from '../StepRooms'
import { StepReview } from '../StepReview'
import { useWizard } from '../../../hooks/useWizard'
import { WINDOW_INFERENCE } from '../../../lib/helpText'
import type { QshConfigYaml, RoomConfigYaml } from '../../../types/config'

vi.mock('../../../hooks/useSysid', () => ({
  useSysid: () => ({ data: null, error: null }),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

const ENSUITE: RoomConfigYaml = {
  area_m2: 6,
  facing: 'N',
  ceiling_m: 2.4,
  control_mode: 'indirect',
}

const config = (extra: Record<string, unknown> = {}, driver: 'ha' | 'mqtt' = 'ha') =>
  ({ driver, rooms: { ensuite: ENSUITE }, ...extra }) as Partial<QshConfigYaml>

// Each stored mode with its label, and each stored value that is not a mode,
// for each of the two drivers.
const DRIVERS = ['ha', 'mqtt'] as const
const STORED_MODES = DRIVERS.flatMap((driver) => [
  ['observe', 'Observe', driver] as const,
  ['act', 'Act', driver] as const,
  ['disabled', 'Off', driver] as const,
])
const NOT_A_MODE = DRIVERS.flatMap((driver): [string, 'ha' | 'mqtt', unknown][] => [
  ['false', driver, { inference: false }],
  ['the text off', driver, { inference: 'off' }],
  ['a section that is a string', driver, 'observe'],
  ['a section that is false', driver, false],
])

const radio = (name: 'Off' | 'Observe' | 'Act') => screen.getByRole('radio', { name }) as HTMLInputElement
const selected = () => (screen.getAllByRole('radio') as HTMLInputElement[]).filter((r) => r.checked)
const chooser = () => screen.getByRole('group', { name: WINDOW_INFERENCE.title })

/** The Rooms summary of the review step, and the value beside its line for the mode. */
const roomsSummary = () => screen.getByRole('heading', { name: /^Rooms \(\d+\)$/ }).parentElement!
const reviewValue = () => {
  const label = within(roomsSummary()).getByText('Open-window detection without a sensor')
  return within(label.parentElement!).getAllByText(/.+/)[1].textContent
}

function renderReview(cfg: Partial<QshConfigYaml>) {
  render(
    <StepReview
      config={cfg}
      validationWarnings={[]}
      acknowledgedRuleIds={[]}
      onAcknowledge={vi.fn()}
      isDeploying={false}
      deployOutcome={null}
      onForceDeploy={vi.fn().mockResolvedValue(null)}
    />,
  )
}

describe('the wizard — open-window detection without a sensor (INSTRUCTION-572C)', () => {
  it.each(['ha', 'mqtt'] as const)('(W1) the rooms step shows the chooser on the %s driver, after the room list, with Off selected and no write', (driver) => {
    const onUpdate = vi.fn()
    render(<StepRooms config={config({}, driver)} onUpdate={onUpdate} />)
    expect(within(chooser()).getAllByRole('radio')).toHaveLength(3)
    expect(radio('Off')).toBeChecked()
    expect(selected()).toHaveLength(1)
    const roomCard = screen.getByText('ensuite')
    expect(roomCard.compareDocumentPosition(chooser()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(onUpdate).not.toHaveBeenCalled()
    // Off is the mode shown, so a click on it is no change and writes nothing.
    fireEvent.click(radio('Off'))
    expect(onUpdate).not.toHaveBeenCalled()
  })

  it('(W2) the chooser is shown when there is no room, after the text for no room', () => {
    render(<StepRooms config={{ driver: 'ha', rooms: {} }} onUpdate={vi.fn()} />)
    const noRooms = screen.getByText('No rooms defined yet. Add your first room above.')
    expect(noRooms.compareDocumentPosition(chooser()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(radio('Off')).toBeChecked()
  })

  it.each([
    ['observe', 'Observe', 'ha'],
    ['act', 'Act', 'ha'],
    ['observe', 'Observe', 'mqtt'],
    ['act', 'Act', 'mqtt'],
  ] as const)('(W3) a selection of %s (%s) on the %s driver calls onUpdate("window_detection", …) with the mode', (mode, label, driver) => {
    const onUpdate = vi.fn()
    render(<StepRooms config={config({}, driver)} onUpdate={onUpdate} />)
    fireEvent.click(radio(label))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith('window_detection', { inference: mode })
  })

  it.each(['ha', 'mqtt'] as const)('(W4) on the %s driver a stored mode is selected, and a selection of Off writes the name disabled with the stored keys', (driver) => {
    const onUpdate = vi.fn()
    render(
      <StepRooms
        config={config({ window_detection: { inference: 'act', note: 'x' } }, driver)}
        onUpdate={onUpdate}
      />,
    )
    expect(radio('Act')).toBeChecked()
    fireEvent.click(radio('Off'))
    expect(onUpdate).toHaveBeenCalledWith('window_detection', { inference: 'disabled', note: 'x' })
  })

  it.each(NOT_A_MODE)('(W5) a stored value that is not a mode (%s) shows no selection on the %s driver, and a selection of Off corrects it', (_label, driver, section) => {
    const onUpdate = vi.fn()
    render(<StepRooms config={config({ window_detection: section }, driver)} onUpdate={onUpdate} />)
    expect(selected()).toHaveLength(0)
    expect(screen.getByRole('status')).toHaveTextContent(WINDOW_INFERENCE.invalid)
    fireEvent.click(radio('Off'))
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith('window_detection', { inference: 'disabled' })
  })

  it.each([
    ['the ha driver, one room', config()],
    ['the mqtt driver, one room', config({}, 'mqtt')],
    ['the ha driver, two rooms', { driver: 'ha', rooms: { ensuite: ENSUITE, study: ENSUITE } } as Partial<QshConfigYaml>],
    ['no room', { driver: 'ha', rooms: {} } as Partial<QshConfigYaml>],
  ])('(W6) the review step shows Off for a config with no section (%s), as the last line of the Rooms summary', (_label, cfg) => {
    renderReview(cfg)
    expect(reviewValue()).toBe('Off')
    const lines = roomsSummary().lastElementChild!
    expect(lines.lastElementChild).toHaveTextContent(/^Open-window detection without a sensor/)
  })

  it.each(STORED_MODES)('(W7) the review step shows the mode %s as %s on the %s driver', (mode, label, driver) => {
    renderReview(config({ window_detection: { inference: mode } }, driver))
    expect(reviewValue()).toBe(label)
  })

  it.each(
    DRIVERS.flatMap((driver): [string, 'ha' | 'mqtt', unknown][] => [
      ['the text off', driver, { inference: 'off' }],
      ['false', driver, { inference: false }],
      ['true', driver, { inference: true }],
      ['a section that is a string', driver, 'observe'],
      ['a section that is false', driver, false],
    ]),
  )('(W8) the review step shows Off for a stored value that QSH reads as disabled (%s) on the %s driver', (_label, driver, section) => {
    renderReview(config({ window_detection: section }, driver))
    expect(reviewValue()).toBe('Off')
  })

  it('(W9) the deploy body holds a section that updateConfig stored, and no section when none was stored', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ deployed: true }),
    } as Response)

    const { result } = renderHook(() => useWizard())
    act(() => result.current.setConfig(config()))
    await act(async () => {
      await result.current.deploy()
    })
    const first = JSON.parse(fetchSpy.mock.calls[0][1]!.body as string)
    expect(first.config).not.toHaveProperty('window_detection')

    act(() => result.current.updateConfig('window_detection', { inference: 'observe' }))
    await act(async () => {
      await result.current.deploy()
    })
    const second = JSON.parse(fetchSpy.mock.calls[1][1]!.body as string)
    expect(second.config.window_detection).toEqual({ inference: 'observe' })
  })

  it('(W10) the group of the wizard is not the group of Settings', () => {
    render(<StepRooms config={config()} onUpdate={vi.fn()} />)
    expect((screen.getAllByRole('radio') as HTMLInputElement[]).map((r) => r.name)).toEqual([
      'wizard-window-inference',
      'wizard-window-inference',
      'wizard-window-inference',
    ])
  })

  it('(W11) an act on the step that is not a selection writes no section', () => {
    const onUpdate = vi.fn()
    render(<StepRooms config={config()} onUpdate={onUpdate} />)
    fireEvent.change(screen.getByPlaceholderText('Room name (e.g. living_room)'), { target: { value: 'study' } })
    fireEvent.click(screen.getByText('Add Room'))
    fireEvent.change(screen.getByPlaceholderText('e.g. 189'), { target: { value: '120' } })
    const written = onUpdate.mock.calls.map((call) => call[0])
    expect(written).toEqual(expect.arrayContaining(['rooms', 'property']))
    expect(written).not.toContain('window_detection')
  })

  it.each(STORED_MODES)('(W12) the rooms step shows a stored %s as %s on the %s driver', (mode, label, driver) => {
    render(<StepRooms config={config({ window_detection: { inference: mode } }, driver)} onUpdate={vi.fn()} />)
    expect(radio(label)).toBeChecked()
    expect(selected()).toHaveLength(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('(W13) the rooms step holds no state for the mode: it shows the configuration that its host gives', () => {
    const { rerender } = render(
      <StepRooms config={config({ window_detection: { inference: 'act' } })} onUpdate={vi.fn()} />,
    )
    expect(radio('Act')).toBeChecked()
    rerender(<StepRooms config={config({ window_detection: { inference: 'observe' } })} onUpdate={vi.fn()} />)
    expect(radio('Observe')).toBeChecked()
    expect(selected()).toHaveLength(1)
  })
})
