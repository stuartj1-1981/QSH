import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { BackupRestore } from '../BackupRestore'

describe('BackupRestore restore_config checkbox', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('restore_config checkbox adds query param when checked', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'OK', restored: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<BackupRestore driver="ha" />)

    // Upload a file
    const file = new File(['zip-data'], 'backup.zip', { type: 'application/zip' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })

    // Check the restore_config checkbox
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)

    // Click restore
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('restore_config=true'),
        expect.anything()
      )
    })
  })

  it('restore_config unchecked by default does not add query param', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ message: 'OK', restored: [] }),
    })
    vi.stubGlobal('fetch', mockFetch)

    render(<BackupRestore driver="ha" />)

    // Upload a file
    const file = new File(['zip-data'], 'backup.zip', { type: 'application/zip' })
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { value: [file] })

    // Click restore without checking the box
    fireEvent.click(screen.getByRole('button', { name: /Restore/ }))

    await waitFor(() => {
      const fetchUrl = mockFetch.mock.calls[0]?.[0] as string
      expect(fetchUrl).not.toContain('restore_config')
    })
  })
})
