# THOBX gift card artwork

`artwork.png` is the complete designer PNG supplied as `thobx - gift - lower.png`
in the uploaded RAR archive. The extracted bytes are preserved unchanged:

- Original size: 1082 × 1922 px, RGB PNG.
- SHA-256: `72bb920bddb45f7726b013911e415ac40942bbdcbe774e783a8a5a88e253c573`.

The image includes the logo, fade, Arabic and English wording, labels, seal, and
footer. It is embedded in the backend binary and used by default in every
working directory. There is one artwork rendering path: the PNG plus variable
overlays in `backend/templates/gift-card.svg`.

Only balance/currency, an optional recipient, the full card code, expiry, QR,
and unusable-card status are rendered on top. The complete source image is
fitted to a 1080 × 1920 output with no crop, mask, additional fade, or fixed-text
replacement. The gift card's static company branding comes from the PNG;
`COMPANY_*` settings still govern invoices and notification messages.

`GIFT_CARD_ARTWORK_PATH` may select a different local PNG, with a read-only
volume mount when needed in a container. A configured missing or invalid file
reports an error. Blank uses the bundled artwork. Updating the bundled PNG
requires a rebuild; changing a mounted replacement affects new previews and
downloads. Approved deliveries retain their immutable attachment bytes.

Codes wrap at a hyphen into two lines inside the narrow Gift # field, retaining
every code character. The QR sits beside the wax seal. Thmanyah Serif Display
Bold (supplied with the design), Space Grotesk Medium, and the existing DejaVu
fonts are bundled for variable text and Arabic names. Space Grotesk's source
details and SIL Open Font License are alongside its font.
