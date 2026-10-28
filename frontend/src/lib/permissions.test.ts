import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import policy from './access-policy.json'
import {
  canAccess,
  canVisit,
  hasRole,
  homePath,
  rolesFromProfile,
} from './permissions'
import type { Role } from './permissions'

const principal = (...roles: Role[]) => ({ roles })

describe('Zitadel roles', () => {
  it('accepts only explicit project and organization grants', () => {
    const profile = {
      groups: ['admin'],
      'urn:zitadel:iam:org:project:roles': { admin: { org: 'domain' } },
      'urn:zitadel:iam:org:project:other:roles': { admin: { org: 'domain' } },
      'urn:zitadel:iam:org:project:app:roles': {
        sales: { org: 'domain' },
        admin: { other: 'domain' },
        production: ['org'],
      },
    }
    expect(rolesFromProfile(profile, 'app', 'org')).toEqual(['sales'])
    expect(rolesFromProfile(profile, 'missing', 'org')).toEqual([])
    expect(rolesFromProfile(profile, 'app', 'wrong-org')).toEqual([])
    expect(rolesFromProfile(undefined, 'app', 'org')).toEqual([])
  })
})

describe('role policy', () => {
  it('keeps operational roles independent and overrides explicit', () => {
    expect(hasRole(principal('sales'), 'production')).toBe(false)
    expect(hasRole(principal('inventory', 'production'), 'production')).toBe(
      true,
    )
    expect(hasRole(principal('manager'), 'admin')).toBe(false)
    expect(hasRole(principal('admin'), 'inventory')).toBe(true)
    expect(canAccess(principal('manager'), 'POST', '/locations')).toBe(false)
    expect(canAccess(principal('admin'), 'POST', '/unknown')).toBe(false)
    expect(canAccess(null, 'GET', '/me/preferences')).toBe(false)
    expect(canAccess(principal(), 'PUT', '/me/preferences')).toBe(true)
    expect(
      canAccess(principal('sales'), 'HEAD', '/api/customers?search=test'),
    ).toBe(true)
    expect(canAccess(principal('sales'), 'POST', '/orders/1/stages/2')).toBe(
      false,
    )
  })
  it('covers every protected backend method and route', () => {
    const features = resolve(process.cwd(), '../backend/src/features')
    const endpoints: string[] = []
    for (const feature of readdirSync(features, { withFileTypes: true })) {
      if (!feature.isDirectory()) continue
      let source: string
      try {
        source = readFileSync(`${features}/${feature.name}/routes.rs`, 'utf8')
      } catch {
        continue
      }
      for (const match of source.matchAll(
        /\.route\(\s*"([^"]+)"\s*,([\s\S]*?)(?=\.route\(|$)/g,
      )) {
        const [, path, body] = match
        if (
          path === '/design-options/:id/image' ||
          path === '/webhooks/whatsapp'
        )
          continue
        for (const method of body.matchAll(/\b(get|post|put|patch|delete)\(/g))
          endpoints.push(`${method[1].toUpperCase()} ${path}`)
      }
    }
    const rules = policy.map(({ method, path }) => `${method} ${path}`)
    expect(new Set(rules).size).toBe(rules.length)
    expect(endpoints.sort()).toEqual(rules.sort())
  })
  it.each([
    [
      'sales',
      'GET',
      [
        '/customers',
        '/customers/1',
        '/materials',
        '/materials/1',
        '/products',
        '/products/1',
        '/locations',
        '/design-options',
        '/pricing',
        '/gift-cards/by-code/CODE',
        '/me/preferences',
        '/invoices/1/edit',
        '/invoices/1/document',
        '/users',
      ],
    ],
    [
      'sales',
      'POST',
      [
        '/invoices',
        '/customers',
        '/invoices/1/payments',
        '/invoices/1/collect',
        '/orders/1/repairs',
        '/gift-cards',
        '/gift-cards/1/send',
        '/invoices/1/notifications',
      ],
    ],
    [
      'production',
      'GET',
      [
        '/orders',
        '/orders/1',
        '/materials',
        '/locations',
        '/design-options',
        '/order-stages',
        '/customers/1',
        '/users',
        '/me/preferences',
        '/repairs',
      ],
    ],
    ['production', 'POST', ['/orders/1/stages/2', '/orders/1/ready']],
    [
      'inventory',
      'GET',
      [
        '/materials',
        '/materials/1',
        '/products',
        '/products/1',
        '/locations',
        '/me/preferences',
      ],
    ],
    [
      'inventory',
      'POST',
      [
        '/materials',
        '/materials/1/stock',
        '/materials/1/stock/remove',
        '/materials/1/stock/transfer',
        '/products',
        '/products/1/stock',
      ],
    ],
    [
      'manager',
      'GET',
      [
        '/invoices/1',
        '/orders/1',
        '/invoices/1/returns',
        '/orders/1/cancel',
        '/locations',
        '/users',
      ],
    ],
    [
      'manager',
      'POST',
      [
        '/invoices/1/returns',
        '/invoices/1/refunds',
        '/orders/1/cancel',
        '/orders/1/reopen',
      ],
    ],
    ['admin', 'POST', ['/locations', '/design-options', '/order-stages']],
  ] as const)('allows %s form dependencies for %s', (role, method, paths) => {
    for (const path of paths)
      expect(canAccess(principal(role), method, path), path).toBe(true)
  })
  it('guards direct form navigation and chooses an accessible home', () => {
    expect(canVisit(principal('sales'), '/locations/new')).toBe(false)
    expect(canVisit(principal('sales'), '/products/1/edit')).toBe(false)
    expect(canVisit(principal('production'), '/invoices/new')).toBe(false)
    expect(canVisit(principal('inventory'), '/products/new')).toBe(true)
    expect(canVisit(principal('manager'), '/design-options/new')).toBe(false)
    expect(canVisit(principal('sales'), '/users')).toBe(false)
    expect(homePath(principal('production'))).toBe('/orders')
    expect(homePath(principal('inventory'))).toBe('/inventory')
  })
})
