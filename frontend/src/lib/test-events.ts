/**
 * Types into a combobox search input the way a real browser does.
 *
 * Base UI only treats input as a user-typed query when the event carries
 * `inputType` (e.g. `insertText`) — that flag is what stops the popup from
 * syncing the input back to the selection once results arrive. jsdom's
 * `fireEvent.change` builds an event without it, so typed text is wiped as
 * soon as the search response lands and server-side filtering never happens.
 */
export function typeSearchText(input: HTMLInputElement, text: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )
  if (!descriptor?.set) {
    throw new Error('HTMLInputElement value setter is unavailable')
  }
  descriptor.set.call(input, text)
  input.dispatchEvent(
    new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: text,
    }),
  )
}
