import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { StepDisclaimer } from '../StepDisclaimer'

describe('StepDisclaimer', () => {
  it('renders disclaimer text', () => {
    const onUpdate = vi.fn()
    render(<StepDisclaimer config={{}} onUpdate={onUpdate} />)
    expect(screen.getByText('Before You Begin')).toBeDefined()
    expect(screen.getByText(/QSH is beta software/)).toBeDefined()
  })

  it('checkbox defaults to unchecked', () => {
    const onUpdate = vi.fn()
    render(<StepDisclaimer config={{}} onUpdate={onUpdate} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).not.toBeChecked()
  })

  it('checking checkbox calls onUpdate with true', () => {
    const onUpdate = vi.fn()
    render(<StepDisclaimer config={{}} onUpdate={onUpdate} />)
    fireEvent.click(screen.getByRole('checkbox'))
    expect(onUpdate).toHaveBeenCalledWith('disclaimer_accepted', true)
  })

  it('unchecking checkbox calls onUpdate with false', () => {
    const onUpdate = vi.fn()
    render(<StepDisclaimer config={{}} onUpdate={onUpdate} />)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox) // check
    fireEvent.click(checkbox) // uncheck
    expect(onUpdate).toHaveBeenCalledWith('disclaimer_accepted', false)
  })

  it('pre-fills accepted state from config', () => {
    const onUpdate = vi.fn()
    render(<StepDisclaimer config={{ disclaimer_accepted: true }} onUpdate={onUpdate} />)
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toBeChecked()
  })
})
