import { describe, expect, it } from 'vitest'
import { hasRole, rolesFromProfile } from './auth'
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

describe('rolesFromProfile', () => {
  it('reads Authentik group names from the groups claim', () => {
    expect(rolesFromProfile({ groups: ['staff'] })).toEqual(['staff'])
  })

  it('matches group names case-insensitively', () => {
    expect(rolesFromProfile({ groups: ['Admin'] })).toEqual(['admin'])
    expect(rolesFromProfile({ groups: ['STAFF'] })).toEqual(['staff'])
  })

  it('ignores non-role groups such as branch names', () => {
    expect(rolesFromProfile({ groups: ['Branch A'] })).toEqual([])
    expect(rolesFromProfile({ groups: ['Branch A', 'viewer'] })).toEqual([
      'viewer',
    ])
  })

  it('also reads the roles and entitlements claims', () => {
    expect(rolesFromProfile({ roles: ['admin'] })).toEqual(['admin'])
    expect(rolesFromProfile({ entitlements: ['staff'] })).toEqual(['staff'])
  })

  it('merges every claim source low-to-high with no duplicates', () => {
    expect(
      rolesFromProfile({
        groups: ['admin', 'Branch A'],
        roles: ['staff', 'staff'],
        entitlements: ['viewer'],
      }),
    ).toEqual(['viewer', 'staff', 'admin'])
  })

  it('returns no roles when the profile carries none', () => {
    expect(rolesFromProfile(undefined)).toEqual([])
    expect(rolesFromProfile({})).toEqual([])
    expect(rolesFromProfile({ groups: 'staff' })).toEqual([])
  })
})
