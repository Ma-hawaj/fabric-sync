import {
  THOB_CHEST_POCKET,
  THOB_COLLAR,
  THOB_CUFFS,
  THOB_MOBILE_POCKET,
  THOB_SIDE_POCKETS,
} from './thob-sketch'
import type { ThobView } from './thob-sketch'
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
  /**
   * Short caption used on read-only diagram templates, where every field of a
   * silhouette is shown at once and a full label would crowd its neighbours.
   * The entry form keeps the long `label` for its single active callout.
   */
  diagramLabel: string
  group: MeasurementGroupId
  input: MeasurementInput
  /**
   * Which thob silhouette the marker is drawn against. The garment is shown
   * from the front and the back so no single sketch carries all 18 callouts:
   * lengths, circumferences, pockets and the placket live on the front; the
   * back length, the collar, and the whole sleeve cluster on the back.
   */
  view: ThobView
  marker: DiagramMarker
}

export const MEASUREMENT_UNIT = 'inch'

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

export const MEASUREMENT_FIELDS: MeasurementField[] = [
  {
    name: 'lengthFl',
    view: 'front',
    label: 'Length (Front)',
    diagramLabel: 'Front Length',
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
    view: 'back',
    label: 'Length (Back)',
    diagramLabel: 'Back Length',
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
    view: 'front',
    label: 'Shoulder',
    diagramLabel: 'Shoulder',
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
    view: 'front',
    label: 'Chest',
    diagramLabel: 'Chest',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 190, y1: 150, x2: 290, y2: 150 }],
      label: { x: 240, y: 150 },
    },
  },
  {
    name: 'chestUp',
    view: 'front',
    label: 'Chest (Upper)',
    diagramLabel: 'Chest Up',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 186, y1: 112, x2: 294, y2: 112 }],
      label: { x: 240, y: 112 },
    },
  },
  {
    name: 'waist',
    view: 'front',
    label: 'Waist',
    diagramLabel: 'Waist',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 181, y1: 250, x2: 299, y2: 250 }],
      label: { x: 240, y: 250 },
    },
  },
  {
    name: 'hips',
    view: 'front',
    label: 'Hips',
    diagramLabel: 'Hips',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 175, y1: 320, x2: 305, y2: 320 }],
      label: { x: 240, y: 320 },
    },
  },
  {
    name: 'neck',
    view: 'back',
    label: 'Neck',
    diagramLabel: 'Neck',
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
    view: 'back',
    label: 'Neck Width',
    diagramLabel: 'Neck W',
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
    view: 'back',
    label: 'Armhole',
    diagramLabel: 'Armhole',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 182, y1: 65, x2: 190, y2: 144 }],
      label: { x: 212, y: 101 },
    },
  },
  {
    name: 'sleeveLength',
    view: 'back',
    label: 'Sleeve Length',
    diagramLabel: 'Sleeve',
    group: 'body',
    input: NUMBER,
    marker: {
      dims: [{ x1: 317, y1: 55, x2: 371, y2: 247 }],
      label: { x: 370, y: 140 },
    },
  },
  {
    name: 'openHand',
    view: 'back',
    label: 'Open Hand',
    diagramLabel: 'Open Hand',
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
    view: 'back',
    label: 'Cuff Width',
    diagramLabel: 'Cuff W',
    group: 'body',
    input: NUMBER,
    marker: {
      shapes: [THOB_CUFFS],
      label: { x: 78, y: 212 },
    },
  },

  {
    name: 'frantPocketLength',
    view: 'front',
    label: 'Front Pocket Length',
    diagramLabel: 'Front Pocket',
    group: 'pockets',
    input: NUMBER,
    marker: {
      dims: [{ x1: 180, y1: 116, x2: 180, y2: 158 }],
      guides: [
        { x1: 197, y1: 116, x2: 180, y2: 116 },
        { x1: 197, y1: 158, x2: 180, y2: 158 },
        { x1: 180, y1: 150, x2: 130, y2: 172 },
      ],
      shapes: [THOB_CHEST_POCKET],
      label: { x: 110, y: 180 },
    },
  },
  {
    name: 'farntPocketLengthByWidth',
    view: 'front',
    label: 'Front Pocket L×W',
    diagramLabel: 'Pocket L×W',
    group: 'pockets',
    input: TEXT,
    marker: {
      shapes: [THOB_CHEST_POCKET],
      guides: [{ x1: 197, y1: 120, x2: 140, y2: 96 }],
      label: { x: 108, y: 88 },
    },
  },
  {
    name: 'sidePocket',
    view: 'front',
    label: 'Side Pocket',
    diagramLabel: 'Side Pocket',
    group: 'pockets',
    input: { kind: 'select', options: ['None', 'Left', 'Right', 'Both'] },
    marker: {
      shapes: [THOB_SIDE_POCKETS],
      guides: [{ x1: 300, y1: 260, x2: 346, y2: 260 }],
      label: { x: 382, y: 260 },
    },
  },
  {
    name: 'mobilePocketLengthByWidth',
    view: 'front',
    label: 'Mobile Pocket L×W',
    diagramLabel: 'Mobile Pocket',
    group: 'pockets',
    input: TEXT,
    marker: {
      shapes: [THOB_MOBILE_POCKET],
      guides: [{ x1: 288, y1: 222, x2: 326, y2: 222 }],
      label: { x: 380, y: 222 },
    },
  },

  {
    name: 'foWidth',
    view: 'front',
    label: 'Fo Width',
    diagramLabel: 'Fo Width',
    group: 'style',
    input: NUMBER,
    marker: {
      dims: [{ x1: 234, y1: 192, x2: 246, y2: 192 }],
      guides: [{ x1: 240, y1: 196, x2: 166, y2: 224 }],
      label: { x: 130, y: 230 },
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

export function fieldsInView(view: ThobView): MeasurementField[] {
  return MEASUREMENT_FIELDS.filter((field) => field.view === view)
}

export const THOB_VIEWS: ThobView[] = ['front', 'back']
