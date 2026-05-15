import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BlendEvolutionChart } from '../forecast/BlendEvolutionChart'

const LEGACY_TOKEN = 'doub' + 'ly_robust'

describe('BlendEvolutionChart', () => {
  it('renders chart when data present', () => {
    render(
      <BlendEvolutionChart
        historianData={{
          points: [
            { time: 1000, blend_factor: 0.5, step_c: 0.01 },
            { time: 2000, blend_factor: 0.6, step_c: 0.02 },
          ],
        }}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText(/Blend-Factor Evolution/)).toBeInTheDocument()
  })

  it('renders loading state', () => {
    render(
      <BlendEvolutionChart historianData={null} loading={true} error={null} />,
    )
    expect(screen.getByText(/Loading blend-factor evolution/)).toBeInTheDocument()
  })

  it('renders error state', () => {
    render(
      <BlendEvolutionChart historianData={null} loading={false} error="oops" />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('oops')
  })

  it('renders no-data message when points empty', () => {
    render(
      <BlendEvolutionChart
        historianData={{ points: [] }}
        loading={false}
        error={null}
      />,
    )
    expect(screen.getByText(/Forecast is still learning/)).toBeInTheDocument()
  })

  it('empty-state does not reference INSTRUCTION numbers or internal jargon', () => {
    const { container } = render(
      <BlendEvolutionChart historianData={{ points: [] }} loading={false} error={null} />,
    )
    // Match against textContent (not queryByText) so the regex can span adjacent
    // text nodes — same robustness rationale as the page-level tripwire. V2.
    const text = container.textContent ?? ''
    expect(text).not.toMatch(/INSTRUCTION-\d/)
    expect(text).not.toMatch(/apply_step/)
    expect(text).not.toMatch(/paired-comparison/)
  })

  it('legacy estimator term absent from rendered DOM', () => {
    render(
      <BlendEvolutionChart
        historianData={{ points: [{ time: 1000, blend_factor: 0.5 }] }}
        loading={false}
        error={null}
      />,
    )
    expect(screen.queryByText(new RegExp(LEGACY_TOKEN))).toBeNull()
  })
})
