# Fixed-image renderer sample

`gift-card-sample.png` is an illustrative output from the real Rust fixed-image
renderer. Its input, `artwork-from-earlier-svg.png`, was flattened from the
earlier SVG, supplied background, and font files. The SVG source is included for
reproducibility. This sample is **not the final designer PNG**: the latest image
attachment was visible in chat but unavailable as downloadable file bytes.
Its fade, spacing, and lettering therefore should not be treated as approval of
the final design. The demo code is not an issued gift card.

The sample is kept under `docs/`, so it does not activate the new artwork mode.
The production asset still needs to be added at
`backend/assets/gift-card/artwork.png` (or configured with
`GIFT_CARD_ARTWORK_PATH`).

To regenerate the sample from `backend/`, with the normal Rust environment set:

```bash
GIFT_CARD_SAMPLE_ARTWORK=../docs/gift-card-design/samples/artwork-from-earlier-svg.png \
GIFT_CARD_SAMPLE_OUTPUT=../docs/gift-card-design/samples/gift-card-sample.png \
cargo test --all-targets features::gift_cards::image::tests::fixed_png_preserves_artwork_and_fits_variable_fields
```

The renderer preserves the supplied base image and adds the available balance,
BHD label, recipient name, full code across two lines, expiry, and QR. Voided,
expired, and fully redeemed states additionally receive a status banner.
