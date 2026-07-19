import { fireEvent } from '@testing-library/react'

/**
 * Base UI's Select.Item only commits a selection on `click` if a real
 * `pointerdown` preceded it (or the item was already keyboard-highlighted) —
 * see SelectItem's `isInvalidMouseClick` guard. `fireEvent.click` alone
 * looks like a stray click and is ignored, so tests must fire pointerdown
 * first to select a non-default-highlighted option.
 */
export function selectOption(option: Element) {
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 })
  fireEvent.click(option)
}
