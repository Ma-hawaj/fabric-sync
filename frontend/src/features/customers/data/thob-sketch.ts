// Geometry for the thob technical sketch drawn by `components/thob-diagram`.
//
// Everything lives in one flat coordinate space (`THOB_VIEW_BOX`) so the
// garment outline and the measurement markers in `measurement-fields.ts`
// stay in sync: move a seam here and the arrow that points at it is a few
// numbers away, in the same units.
//
//   x = 240 is the centre front. The silhouette is symmetric about it.
//
//   y =  46  neck / top of shoulder      y = 146  armpit
//   y =  60  shoulder point             y = 252  cuff
//   y = 430  hem

export const THOB_WIDTH = 480
export const THOB_HEIGHT = 500

export const THOB_VIEW_BOX = `0 0 ${THOB_WIDTH} ${THOB_HEIGHT}`

export const THOB_CENTER_X = 240

/** Outline: neck -> right shoulder -> right sleeve -> hem -> left sleeve -> neck. */
export const THOB_OUTLINE =
  'M 258 46 C 272 47 286 50 300 60 L 354 252 L 324 268 L 290 146 L 314 430 ' +
  'Q 240 446 166 430 L 190 146 L 156 268 L 126 252 L 180 60 ' +
  'C 194 50 208 47 222 46 Q 240 78 258 46 Z'

/** Stand collar sitting just above the neckline. */
export const THOB_COLLAR = 'M 216 40 Q 240 76 264 40'

/** The two stitch lines of the front placket. */
export const THOB_PLACKET = 'M 234 68 L 234 200 M 246 68 L 246 200'

export const THOB_BUTTONS: { cx: number; cy: number }[] = [
  { cx: 240, cy: 96 },
  { cx: 240, cy: 126 },
  { cx: 240, cy: 156 },
  { cx: 240, cy: 186 },
]

/** Chest pocket, on the wearer's right as the sketch is drawn. */
export const THOB_CHEST_POCKET = 'M 192 116 L 230 116 L 230 158 L 192 158 Z'

/** Inner mobile pocket — dashed, since it sits behind the panel. */
export const THOB_MOBILE_POCKET = 'M 254 200 L 288 200 L 288 246 L 254 246 Z'

/** Slash openings on both side seams. */
export const THOB_SIDE_POCKETS = 'M 179 280 L 175 318 M 301 280 L 305 318'

/** Cuff bands, one per sleeve. */
export const THOB_CUFFS = 'M 133 227 L 163 243 M 347 227 L 317 243'

/** Half-button positions midway down each sleeve. */
export const THOB_SLEEVE_BUTTONS: { cx: number; cy: number }[] = [
  { cx: 154, cy: 213 },
  { cx: 326, cy: 213 },
]
