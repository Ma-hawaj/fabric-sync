import {
  THOB_CHEST_POCKET,
  THOB_COLLAR,
  THOB_CUFFS,
  THOB_MOBILE_POCKET,
  THOB_OUTLINE,
  THOB_PLACKET,
  THOB_SIDE_POCKETS,
  THOB_BUTTONS,
  THOB_SLEEVE_BUTTONS,
} from './thob-sketch'
import type { MeasurementDraft } from '../types/measurement-form'

/** Every measurement a form can capture — the bookkeeping fields aside. */
export type MeasurementFieldName = Exclude<
  keyof MeasurementDraft,
  'loadedFromId' | 'date'
>

export interface DiagramSegment {
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface DiagramDot {
  cx: number
  cy: number
}

/**
 * How one field is called out on the thob sketch. `dims` are the
 * double-headed arrows that show what is being measured, `guides` the thin
 * leader lines that tie an arrow (or a label) back to the garment, and
 * `shapes`/`dots` re-draw a part of the sketch in the highlight colour when
 * the measurement is about a feature rather than a distance.
 */
export interface DiagramMarker {
  dims?: DiagramSegment[]
  guides?: DiagramSegment[]
  shapes?: string[]
  dots?: DiagramDot[]
  label: { x: number; y: number }
}

export type MeasurementInput =
  | { kind: 'number' }
  | { kind: 'text' }
  | { kind: 'select'; options: readonly string[] }

export type MeasurementGroupId = 'body' | 'pockets' | 'style'

export interface MeasurementField {
  name: MeasurementFieldName
  label: string
  group: MeasurementGroupId
  input: MeasurementInput
  marker: DiagramMarker
}

export const MEASUREMENT_GROUPS: {
  id: MeasurementGroupId
  title: string
}[] = [
  { id: 'body', title: 'Body Dimensions' },
  { id: 'pockets', title: 'Pockets' },
  { id: 'style', title: 'Style & Finishing' },
]

const NUMBER: MeasurementInput = { kind: 'number' }
const TEXT: MeasurementInput = { kind: 'text' }
const YES_NO: MeasurementInput = { kind: 'select', options: ['Yes', 'No'] }

export const MEASUREMENT_FIELDS: MeasurementField[] = [
  {
    name: 'lengthFl',
    label: 'Length (Front)',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 60, y1: 46, x2: 60, y2: 430 }],
      guides: [
        { x1: 64, y1: 46, x2: 220, y2: 46 },
        { x1: 64, y1: 430, x2: 168, y2: 430 },
      ],
      label: { x: 60, y: 238 },
    },
  },
  {
    name: 'lengthBl',
    label: 'Length (Back)',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 420, y1: 46, x2: 420, y2: 430 }],
      guides: [
        { x1: 416, y1: 46, x2: 260, y2: 46 },
        { x1: 416, y1: 430, x2: 312, y2: 430 },
      ],
      label: { x: 420, y: 238 },
    },
  },
  {
    name: 'shoulder',
    label: 'Shoulder',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 180, y1: 30, x2: 300, y2: 30 }],
      guides: [
        { x1: 180, y1: 58, x2: 180, y2: 26 },
        { x1: 300, y1: 58, x2: 300, y2: 26 },
      ],
      label: { x: 240, y: 14 },
    },
  },
  {
    name: 'chest',
    label: 'Chest',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 190, y1: 150, x2: 290, y2: 150 }],
      label: { x: 240, y: 150 },
    },
  },
  {
    name: 'chestUp',
    label: 'Chest (Upper)',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 186, y1: 112, x2: 294, y2: 112 }],
      label: { x: 240, y: 112 },
    },
  },
  {
    name: 'waist',
    label: 'Waist',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 181, y1: 250, x2: 299, y2: 250 }],
      label: { x: 240, y: 250 },
    },
  },
  {
    name: 'hips',
    label: 'Hips',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 175, y1: 320, x2: 305, y2: 320 }],
      label: { x: 240, y: 320 },
    },
  },
  {
    name: 'neck',
    label: 'Neck',
    group: 'body',
    input: NUMBER,
    marker: {
      shapes: [THOB_COLLAR],
      guides: [{ x1: 240, y1: 64, x2: 330, y2: 28 }],
      label: { x: 356, y: 24 },
    },
  },
  {
    name: 'neckWidth',
    label: 'Neck Width',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 222, y1: 34, x2: 258, y2: 34 }],
      guides: [
        { x1: 222, y1: 48, x2: 222, y2: 30 },
        { x1: 258, y1: 48, x2: 258, y2: 30 },
      ],
      label: { x: 240, y: 14 },
    },
  },
  {
    name: 'aramHole',
    label: 'Armhole',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 188, y1: 58, x2: 198, y2: 144 }],
      label: { x: 212, y: 101 },
    },
  },
  {
    name: 'sleeveLength',
    label: 'Sleeve Length',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 317, y1: 55, x2: 371, y2: 247 }],
      label: { x: 370, y: 140 },
    },
  },
  {
    name: 'openHand',
    label: 'Open Hand',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 119, y1: 266, x2: 149, y2: 282 }],
      guides: [{ x1: 134, y1: 275, x2: 130, y2: 296 }],
      label: { x: 128, y: 306 },
    },
  },
  {
    name: 'cuffWidth',
    label: 'Cuff Width',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 113, y1: 248, x2: 120, y2: 223 }],
      guides: [{ x1: 116, y1: 236, x2: 92, y2: 222 }],
      shapes: [THOB_CUFFS],
      label: { x: 78, y: 212 },
    },
  },

  {
    name: 'frantPocketLength',
    label: 'Front Pocket Length',
    group: 'pockets',
    input: NUMBER,
    marker: {
      dims: [{ x1: 180, y1: 116, x2: 180, y2: 158 }],
      guides: [
        { x1: 192, y1: 116, x2: 176, y2: 116 },
        { x1: 192, y1: 158, x2: 176, y2: 158 },
        { x1: 180, y1: 150, x2: 130, y2: 172 },
      ],
      shapes: [THOB_CHEST_POCKET],
      label: { x: 110, y: 180 },
    },
  },
  {
    name: 'farntPocketLengthByWidth',
    label: 'Front Pocket L×W',
    group: 'pockets',
    input: TEXT,
    marker: {
      shapes: [THOB_CHEST_POCKET],
      guides: [{ x1: 192, y1: 120, x2: 140, y2: 96 }],
      label: { x: 108, y: 88 },
    },
  },
  {
    name: 'sidePocket',
    label: 'Side Pocket',
    group: 'pockets',
    input: { kind: 'select', options: ['None', 'Left', 'Right', 'Both'] },
    marker: {
      shapes: [THOB_SIDE_POCKETS],
      guides: [{ x1: 303, y1: 300, x2: 346, y2: 300 }],
      label: { x: 382, y: 300 },
    },
  },
  {
    name: 'mobilePocketLengthByWidth',
    label: 'Mobile Pocket L×W',
    group: 'pockets',
    input: TEXT,
    marker: {
      shapes: [THOB_MOBILE_POCKET],
      guides: [{ x1: 288, y1: 222, x2: 326, y2: 222 }],
      label: { x: 380, y: 222 },
    },
  },

  {
    name: 'cuffling',
    label: 'Cuffling',
    group: 'style',
    input: { kind: 'select', options: ['Button', 'No Button', 'Cufflink'] },
    marker: {
      shapes: [THOB_CUFFS],
      guides: [{ x1: 148, y1: 235, x2: 112, y2: 258 }],
      label: { x: 100, y: 268 },
    },
  },
  {
    name: 'sleeveHaffButton',
    label: 'Sleeve Half Button',
    group: 'style',
    input: YES_NO,
    marker: {
      dots: THOB_SLEEVE_BUTTONS,
      guides: [{ x1: 154, y1: 213, x2: 112, y2: 196 }],
      label: { x: 82, y: 190 },
    },
  },
  {
    name: 'openFold',
    label: 'Open / Fold',
    group: 'style',
    input: { kind: 'select', options: ['Open', 'Fold'] },
    marker: {
      shapes: [THOB_PLACKET],
      guides: [{ x1: 234, y1: 110, x2: 186, y2: 94 }],
      label: { x: 148, y: 88 },
    },
  },
  {
    name: 'buttonFold',
    label: 'Button Fold',
    group: 'style',
    input: YES_NO,
    marker: {
      shapes: [THOB_PLACKET],
      dots: THOB_BUTTONS,
      guides: [{ x1: 246, y1: 186, x2: 296, y2: 200 }],
      label: { x: 336, y: 204 },
    },
  },
  {
    name: 'fo',
    label: 'Fo',
    group: 'style',
    input: YES_NO,
    marker: {
      shapes: [THOB_PLACKET],
      guides: [{ x1: 240, y1: 204, x2: 202, y2: 226 }],
      label: { x: 176, y: 234 },
    },
  },
  {
    name: 'foWidth',
    label: 'Fo Width',
    group: 'style',
    input: NUMBER,
    marker: {
      dims: [{ x1: 234, y1: 192, x2: 246, y2: 192 }],
      guides: [{ x1: 240, y1: 196, x2: 166, y2: 224 }],
      label: { x: 130, y: 230 },
    },
  },
  {
    name: 'fullBody',
    label: 'Full Body Measurement',
    group: 'style',
    input: YES_NO,
    marker: {
      shapes: [THOB_OUTLINE],
      label: { x: 240, y: 466 },
    },
  },
]

/**
 * Shown on the sketch when no field is hovered or focused — enough to read
 * the drawing as a measurement chart, not so many arrows that it turns into
 * a thicket.
 */
export const RESTING_MARKER_FIELDS: MeasurementFieldName[] = [
  'lengthFl',
  'shoulder',
  'chest',
  'sleeveLength',
]

const FIELDS_BY_NAME = new Map(MEASUREMENT_FIELDS.map((f) => [f.name, f]))

export function measurementField(name: string): MeasurementField | undefined {
  return FIELDS_BY_NAME.get(name as MeasurementFieldName)
}

export function fieldsInGroup(group: MeasurementGroupId): MeasurementField[] {
  return MEASUREMENT_FIELDS.filter((field) => field.group === group)
}
