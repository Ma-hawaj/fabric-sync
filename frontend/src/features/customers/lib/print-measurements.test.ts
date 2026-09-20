import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateMeasurementsHtml,
  printMeasurements,
} from './print-measurements'
import type { Customer, Measurement } from '../types/customers'

const customer: Customer = {
  id: 'cust-1',
  name: 'Ahmed Ali',
  mobileNo: '+973 3300 1234',
  measurements: [],
}

const measurement: Measurement = {
  id: 'm-1',
  customerId: 'cust-1',
  date: new Date('2026-08-26'),
  lengthFl: 48,
  shoulder: 18,
  chest: 42,
  sleeveLength: 25,
  foWidth: 3,
  farntPocketLengthByWidth: '12×8',
  sidePocket: 'Both',
}

describe('generateMeasurementsHtml', () => {
  it('includes the customer name and phone', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('Ahmed Ali')
    expect(html).toContain('+973 3300 1234')
  })

  it('includes the measurement date', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('26 Aug 2026')
  })

  it('includes every measurement group heading', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('Body Dimensions')
    expect(html).toContain('Pockets')
    expect(html).toContain('Style &amp; Finishing')
  })

  it('renders numeric measurements with the unit', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('48 inch')
    expect(html).toContain('42 inch')
  })

  it('renders text/select measurements without the unit', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('12×8')
    expect(html).toContain('Both')
  })

  it('contains an inline SVG with the thob sketch', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('<svg viewBox="0 0 480 500"')
    expect(html).toContain('Thob sketch with all measurements')
  })
})

function stubIframeBehaviour() {
  const print = vi.fn()
  const originalSrcdoc = Object.getOwnPropertyDescriptor(
    HTMLIFrameElement.prototype,
    'srcdoc',
  )

  Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
    configurable: true,
    set(this: HTMLIFrameElement, value: string) {
      this.setAttribute('srcdoc', value)
      setTimeout(() => this.dispatchEvent(new Event('load')), 0)
    },
    get(this: HTMLIFrameElement) {
      return this.getAttribute('srcdoc') ?? ''
    },
  })

  vi.spyOn(HTMLIFrameElement.prototype, 'contentWindow', 'get').mockReturnValue(
    {
      print,
      focus: vi.fn(),
      addEventListener: vi.fn(),
    } as unknown as Window,
  )

  return {
    print,
    restore: () => {
      if (originalSrcdoc) {
        Object.defineProperty(
          HTMLIFrameElement.prototype,
          'srcdoc',
          originalSrcdoc,
        )
      }
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('printMeasurements', () => {
  it('prints the generated HTML in a hidden iframe', async () => {
    const { print, restore } = stubIframeBehaviour()

    await printMeasurements(customer, measurement)

    const frame = document.querySelector('iframe')
    expect(frame).toBeTruthy()
    expect(frame?.getAttribute('srcdoc')).toContain('Ahmed Ali')
    expect(frame?.style.visibility).toBe('hidden')
    expect(print).toHaveBeenCalled()

    restore()
  })
})
