import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EntityField } from '../EntityField'

describe('EntityField', () => {
  it('strips trailing whitespace on change', () => {
    const onChange = vi.fn()
    render(
      <EntityField
        label="Active Control"
        value=""
        placeholder="input_boolean.dfan_control"
        onChange={onChange}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('input_boolean.dfan_control'), {
      target: { value: 'input_boolean.dfan_control ' },
    })
    expect(onChange).toHaveBeenCalledWith('input_boolean.dfan_control')
  })

  it('strips leading whitespace on change', () => {
    const onChange = vi.fn()
    render(
      <EntityField
        label="Active Control"
        value=""
        placeholder="input_boolean.dfan_control"
        onChange={onChange}
      />
    )
    fireEvent.change(screen.getByPlaceholderText('input_boolean.dfan_control'), {
      target: { value: ' input_boolean.dfan_control' },
    })
    expect(onChange).toHaveBeenCalledWith('input_boolean.dfan_control')
  })
})
