# THOBX theme sources

Verified on 2026-10-31 against the rendered [official homepage](https://thobx.bh/), its inline styles, and [Salient's dynamic stylesheet](https://thobx.bh/wp-content/uploads/salient/salient-dynamic-styles.css). These are observed website colors, not a separate brand guidelines document.

| Website color              | Evidence                                                               | App use                                                                  |
| -------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Gold `#C09457`             | `--nectar-accent-color`; heading highlights and testimonial background | Brand emblem and active indicator, summary accents, dark primary actions |
| Forest green `#233029`     | `--nectar-extra-color-1`; header background setting and hero overlay   | Sidebar, light primary actions and focus rings                           |
| Supporting green `#28392F` | `--nectar-extra-color-2`                                               | Navigation hover and dark secondary surfaces                             |
| Taupe `#E2DBD5`            | `--nectar-bg-color`; computed services and footer backgrounds          | Light workspace background, dark text                                    |
| Stone `#D9D2CC`            | `--nectar-extra-color-3`                                               | Light secondary surfaces                                                 |
| Cream `#F8EADC`            | Inline testimonial text color, confirmed by computed styles            | Light selection/summary surfaces, navigation hover text                  |
| Ink `#151110`              | `--nectar-font-color`; computed body/heading text                      | Light body text                                                          |

The website also uses blue `#7A95A8` on its “Unique Details” section; it is available as a secondary chart color. Payment, readiness, repair and production badges retain their semantic colors. `StatusBadge` composes the generated shadcn `Badge` with Tailwind classes selected through CVA, following the primitive's variant pattern. The app-owned wrapper adds semantic tones without editing the generated component or adding global badge selectors.

White data surfaces keep dense tables readable. Muted text, borders and dark background shades are app contrast adaptations; they are not claimed as additional official brand colors. Gold is an accent on light surfaces because it lacks normal-text contrast against white. Light buttons use white on forest green; dark buttons use forest green on gold. Selected segmented controls use the primary border to keep their state visible.

The app uses Inter for body text and headings, and JetBrains Mono for identifiers. The official website uses display serif fonts; the app keeps a font suited to dense data screens. The Atelier labels identify the staff workspace. Existing role checks, workflows and light/dark/system appearance settings continue to apply.

Page headings, list spacing and list descriptions use standard Tailwind scale utilities on the owning page elements: `text-2xl`, `leading-tight`, `tracking-tight`, `gap-5`, `mt-1.5` and `text-sm`. They are not styled through a global workspace class or descendant overrides. The existing `list-page` and `workspace-page` data slots identify the page layouts for the app shell's width constraints.

Browser inspection used TLS-verified responses through the environment proxy. Google Fonts and analytics were skipped because those external hosts are outside this environment's allowed destinations; the page's own HTML, CSS, scripts and images were loaded. Color verification is unaffected by those font/analytics requests.

## Official logo

The homepage uses the original bilingual logo: the English wordmark, central ornamental emblem and Arabic wordmark. Its [white artwork](https://thobx.bh/wp-content/uploads/2025/08/logo-w.png) and [gold artwork](https://thobx.bh/wp-content/uploads/2025/08/logo-g.png) are bundled as lossless WebP files under `frontend/public/brand/`. Both retain the original 826 × 346 dimensions and transparency; decoded RGBA pixels match the source PNGs exactly. Opaque gold pixels are exactly `#C09457`, providing another direct source for the brand accent.

The sidebar uses the full white artwork on forest green, in both themes. The collapsed sidebar and favicon display the central emblem from the gold artwork. The favicon embeds the lossless gold WebP and uses an SVG viewport to show only the emblem, with a forest background; it does not redraw the mark. The website's WordPress metadata reports no configured site icon, so this emblem presentation is an app adaptation rather than a claimed official favicon. These assets replace the starter branding and unused starter icons.

## Document logo configuration

Invoices, orders, repairs and gift cards use the backend's `COMPANY_LOGO_DATA_URL` setting. The gold artwork is suitable for the documents' light backgrounds. From the repository root, generate a single environment entry:

```bash
python3 - <<'PY'
import base64
from pathlib import Path

logo = Path("frontend/public/brand/thobx-logo-gold.webp").read_bytes()
print("COMPANY_LOGO_DATA_URL=data:image/webp;base64," + base64.b64encode(logo).decode("ascii"))
PY
```

Set the output in the backend environment, or in the environment file used by production Compose, and restart the backend to apply it. The source image is bundled with the app; document rendering does not need to fetch it from the website.
