# THOBX gift card artwork

`artwork.png` is the complete designer PNG supplied as `thobx - gift - no lines.png`
in the uploaded RAR archive. The extracted bytes are preserved unchanged:

- Original size: 1082 × 1922 px, RGB PNG.
- SHA-256: `aa5e6b06c0e95d6e0e94153bd925620f448611e4e19811010934275ee8660434`.

The image includes the logo, fade, Arabic and English wording, labels, seal, and
footer. It is embedded in the backend binary and used by default in every
working directory. There is one artwork rendering path: the PNG plus variable
overlays in `backend/templates/gift-card.svg`.

Only balance/currency or a denomination name, the full card code, expiry,
and unusable-card status are rendered on top. Cards originally issued for 20
show Bronze, 30 show Silver, and 40 or more show Premium in place of the
numeric amount. The tier follows the original amount after redemption. Other
amounts continue to show the remaining numeric balance. The complete source image is
fitted to a 1080 × 1920 output with no crop, mask, additional fade, or fixed-text
replacement. The gift card's static company branding comes from the PNG;
`COMPANY_*` settings still govern invoices and notification messages.

`GIFT_CARD_ARTWORK_PATH` may select a different local PNG, with a read-only
volume mount when needed in a container. A configured missing or invalid file
reports an error. Blank uses the bundled artwork. Updating the bundled PNG
requires a rebuild; changing a mounted replacement affects new previews and
downloads. Approved deliveries retain their immutable attachment bytes.

The code and expiry use Space Grotesk Medium in larger text below their labels,
without guide lines. The complete code stays on one line and scales down to fit
when its measured text width exceeds the field. Customer and recipient names
do not appear on the image.
Thmanyah Serif Display Bold (supplied with the design),
Space Grotesk Medium, and the existing DejaVu fonts are bundled for variable
text. Space Grotesk's source details and SIL Open Font License are alongside
its font.
