# THOBX gift card artwork

## Complete PNG with variable overlays

Place the designer's complete PNG at `backend/assets/gift-card/artwork.png`.
The file should include the logo, background, fixed wording, labels, and footer,
with blank value/code/expiry fields. It is not currently included: the latest
chat attachment has not been available as a downloadable file in the workspace.

When the server runs from `backend/`, this file is discovered automatically.
The Docker image copies this directory to `/app/assets/gift-card/`, which also
matches the default path. Set `GIFT_CARD_ARTWORK_PATH` to use a different file;
in a container that requires a corresponding read-only mount. An explicitly
configured missing or invalid PNG reports an error. With no configured file
and no default PNG, the existing vector design remains active.

`gift-card-overlay.svg` draws only the available balance/currency, an optional
recipient, the full card code, expiry, QR, and unusable-card status. The original
PNG bytes are embedded as one image; no crop, mask, fade, fixed-text replacement,
or company-branding override is applied. `COMPANY_*` settings still govern
invoices and notification messages. The generated card remains 1080 × 1920,
with the source PNG fitted in full. Higher-resolution 9:16 sources are supported.

Overlay positions match the latest supplied blank card. Codes wrap at a hyphen
into two lines inside the narrow Gift # field, retaining every code character.
The QR sits beside the wax seal. The overlay font assets remain bundled so
recipient names can be shaped in Arabic without system fonts.

## Existing vector design

`background.jpg` is the envelope and wax-seal image supplied with the designer's
gift card on 2026-11-15. Its original bytes are preserved. The SVG template uses
the designer's two image placements and white gradients in a 1080 × 1920 card.
The original thirteen radial gradients provide the designer's background fade;
no additional opacity mask hides any region of the artwork. The Instagram and
WhatsApp footer icons use the original vector paths from the SVG.
The background is embedded by `features/gift_cards/image.rs`; rendering requires
no external files or image service.

`backend/templates/gift-card.svg` uses the exact Arabic copy supplied by the user:
“لأنك غالي”, “تستاهل فخامة ثوبكس!”, and “هدية خاصة لك من ثوبكس!”, followed by
“a special gift just for you!”. The recipient is a separate line below the
message, so it does not replace the greeting. The template fills
the balance, recipient, redemption code, expiry, status, and QR from the live card.
Company branding uses the existing invoice settings, with a company-name fallback
when no logo is configured. The footer website belongs to the supplied THOBX
design. Amounts retain the application's three-decimal BHD formatting.

The three `thmanyahserifdisplay-*.otf` files in `../fonts/` were supplied by the
user with the design. Space Grotesk Medium comes from the creator's official
repository; its source details and SIL Open Font License are alongside the font.
DejaVu remains available for identifiers and fallback glyphs under its existing
license.
