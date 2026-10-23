import * as React from 'react'
import { useState } from 'react'

import { useCallbackRef } from './use-callback-ref'
import { useDebouncedCallback } from './use-debounced-callback'

function inputValuesEqual(left: unknown, right: unknown): boolean {
  return (
    Object.is(left, right) ||
    (Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => Object.is(entry, right[index])))
  )
}

/** Keep inputs responsive and save pending edits on blur or popover unmount. */
export function useDebouncedInput<T>(
  value: T,
  onValueChange: (value: T) => void,
) {
  const [draft, setDraft] = useState(value)
  const latestDraft = React.useRef(value)
  const pending = React.useRef<{ value: T } | null>(null)
  const externalValue = React.useRef(value)
  const committed = React.useRef<{ value: T } | null>(null)
  const commit = useCallbackRef((next: T) => {
    pending.current = null
    committed.current = { value: next }
    onValueChange(next)
  })
  const update = useDebouncedCallback(commit, 300)
  const flush = React.useCallback(() => {
    update.cancel()
    if (pending.current) commit(pending.current.value)
  }, [commit, update])

  React.useEffect(() => {
    // URL parsing can create equal arrays on unrelated rerenders.
    if (inputValuesEqual(value, externalValue.current)) return
    externalValue.current = value
    const acknowledgement =
      committed.current && inputValuesEqual(value, committed.current.value)
    committed.current = null
    // A previous save arriving through the URL must not cancel newer typing.
    if (acknowledgement && pending.current) return
    update.cancel()
    pending.current = null
    latestDraft.current = value
    setDraft(value)
  }, [value, update])
  React.useEffect(() => flush, [flush])

  const change = (next: React.SetStateAction<T>) => {
    const resolved =
      typeof next === 'function'
        ? (next as (previous: T) => T)(latestDraft.current)
        : next
    latestDraft.current = resolved
    pending.current = { value: resolved }
    setDraft(resolved)
    update(resolved)
  }

  return { draft, change, flush }
}
