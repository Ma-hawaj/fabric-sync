import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { UserAvatar } from './user-avatar'

describe('UserAvatar', () => {
  it('shows initials until the image loads', () => {
    // jsdom never fires image load events, so the fallback is what renders
    // here — which is exactly the graceful-degradation path this asserts.
    render(
      <UserAvatar
        user={{
          name: 'Ahmed Al-Sayed',
          avatarUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        }}
      />,
    )

    expect(screen.getByText('AA')).toBeTruthy()
  })

  it('falls back to initials when there is no avatar', () => {
    render(<UserAvatar user={{ name: 'Ahmed Al-Sayed', avatarUrl: null }} />)

    expect(screen.getByText('AA')).toBeTruthy()
  })
})
