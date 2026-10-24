import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useDebouncedInput } from './use-debounced-input'

afterEach(() => vi.useRealTimers())

describe('useDebouncedInput', () => {
  it('preserves a new edit when the previous commit is acknowledged', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedInput(value, save),
      { initialProps: { value: ['500.125', ''] } },
    )
    act(() => result.current.change(['500.125', '5000.875']))
    act(() => vi.advanceTimersByTime(300))
    expect(save).toHaveBeenLastCalledWith(['500.125', '5000.875'])
    act(() => {
      rerender({ value: ['500.125', '5000.875'] })
      result.current.change(['0', '5000.875'])
    })
    expect(result.current.draft).toEqual(['0', '5000.875'])
    act(() => vi.advanceTimersByTime(300))
    expect(save).toHaveBeenLastCalledWith(['0', '5000.875'])
  })

  it('retains pending edits across equal array values from a rerender', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedInput(value, save),
      { initialProps: { value: ['10', '20'] } },
    )
    act(() => result.current.change(['0', '20']))
    rerender({ value: ['10', '20'] })
    act(() => result.current.flush())
    expect(save).toHaveBeenCalledWith(['0', '20'])
  })

  it('cancels pending edits when an external value changes', () => {
    vi.useFakeTimers()
    const save = vi.fn()
    const { result, rerender } = renderHook(
      ({ value }) => useDebouncedInput(value, save),
      { initialProps: { value: 'original' } },
    )
    act(() => result.current.change('unsaved'))
    rerender({ value: 'reset from URL' })
    expect(result.current.draft).toBe('reset from URL')
    act(() => vi.advanceTimersByTime(300))
    expect(save).not.toHaveBeenCalled()
  })
})
