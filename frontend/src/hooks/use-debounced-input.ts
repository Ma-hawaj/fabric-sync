import * as React from 'react'
import { useState } from 'react'

import { useCallbackRef } from './use-callback-ref'
import { useDebouncedCallback } from './use-debounced-callback'

/** Keep inputs responsive and save pending edits on blur or popover unmount. */
export function useDebouncedInput<T>(
  value: T,
  onValueChange: (value: T) => void,
) {
  const [draft, setDraft] = useState(value)
  const latestDraft = React.useRef(value)
  const pending = React.useRef<{ value: T } | null>(null)
  const commit = useCallbackRef((next: T) => {
    pending.current = null
    onValueChange(next)
  })
  const update = useDebouncedCallback(commit, 300)
  const flush = React.useCallback(() => {
    update.cancel()
    if (pending.current) commit(pending.current.value)
  }, [commit, update])

  React.useEffect(() => {
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
