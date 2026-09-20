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

  it('includes bilingual measurement group headings', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('مقاسات الجسم · Body dimensions')
    expect(html).toContain('الجيوب · Pockets')
    expect(html).toContain('التفاصيل والإكسسوارات · Style &amp; finishing')
    expect(html).toContain('المقايسة · Recorded')
  })

  it('renders numeric measurements as value + label captions', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('48 inch · Front Length')
    expect(html).toContain('18 inch · Shoulder')
    expect(html).toContain('42 inch · Chest')
    expect(html).toContain('25 inch · Sleeve')
    expect(html).toContain('3 inch · Fo Width')
  })

  it('renders text/select measurements without the unit', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('12×8 · Pocket L×W')
    expect(html).toContain('Both · Side Pocket')
  })

  it('splits the diagrams into front and back thob panels', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect((html.match(/viewBox="0 0 480 500"/g) ?? []).length).toBe(2)
    expect(html).toContain('واجهة الثوب · Front of Thob')
    expect(html).toContain('خلف الثوب · Back of Thob')
    expect(html).toContain('aria-label="Front view measurement chart"')
    expect(html).toContain('aria-label="Back view measurement chart"')
  })

  it('labels the grid rows in Arabic, like the order document', () => {
    const html = generateMeasurementsHtml(customer, measurement)

    expect(html).toContain('الطول (أمام)')
    expect(html).toContain('الكتف')
    expect(html).toContain('الصدر')
    expect(html).toContain('طول الكم')
    expect(html).toContain('الجيب الجانبي')
    expect(html).toContain('عرض الفو')
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
