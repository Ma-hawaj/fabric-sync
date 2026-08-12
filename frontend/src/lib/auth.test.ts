import { describe, expect, it } from 'vitest'
import { hasRole } from './auth'
import type { AuthUser, Role } from './auth'

function user(roles: Role[]): AuthUser {
  return { name: 'Ahmed', email: 'ahmed@example.com', roles }
}

describe('hasRole', () => {
  it('returns false when there is no user', () => {
    expect(hasRole(null, 'viewer')).toBeFalsy()
  })

  it('returns false when the user holds no roles', () => {
    expect(hasRole(user([]), 'viewer')).toBeFalsy()
  })

  it('an admin satisfies a staff or viewer gate', () => {
    const admin = user(['admin'])
    expect(hasRole(admin, 'admin')).toBeTruthy()
    expect(hasRole(admin, 'staff')).toBeTruthy()
    expect(hasRole(admin, 'viewer')).toBeTruthy()
  })

  it('staff satisfies a viewer gate but not an admin gate', () => {
    const staff = user(['staff'])
    expect(hasRole(staff, 'staff')).toBeTruthy()
    expect(hasRole(staff, 'viewer')).toBeTruthy()
    expect(hasRole(staff, 'admin')).toBeFalsy()
  })

  it('viewer does not satisfy a staff or admin gate', () => {
    const viewer = user(['viewer'])
    expect(hasRole(viewer, 'viewer')).toBeTruthy()
    expect(hasRole(viewer, 'staff')).toBeFalsy()
    expect(hasRole(viewer, 'admin')).toBeFalsy()
  })
})
