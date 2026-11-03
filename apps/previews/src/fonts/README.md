# Bundled fonts

These files are loaded with `next/font/local` (`src/app/layout.tsx`), so production builds make **no network requests for fonts**. Builds used to download from Google Fonts at build time, and intermittent responses broke CI (`next/font` `TypeError: Cannot read properties of null (reading '1')`).

| File | Family | Axes / styles | Source (fetched 2026-11-03) | Licence |
|---|---|---|---|---|
| `Inter-latin-variable.woff2` | Inter | wght 100–900 | fonts.gstatic.com `inter/v20`, latin subset | SIL OFL 1.1, `OFL-inter.txt` |
| `JetBrainsMono-latin-variable.woff2` | JetBrains Mono | wght 100–800 | `jetbrainsmono/v24`, latin | SIL OFL 1.1, `OFL-jetbrainsmono.txt` |
| `CormorantGaramond-latin-variable.woff2` | Cormorant Garamond | wght 400–600, normal | `cormorantgaramond/v21`, latin | SIL OFL 1.1, `OFL-cormorantgaramond.txt` |
| `CormorantGaramond-Italic-latin-variable.woff2` | Cormorant Garamond | wght 400–600, italic | `cormorantgaramond/v21`, latin | SIL OFL 1.1, `OFL-cormorantgaramond.txt` |
| `SpaceGrotesk-latin-variable.woff2` | Space Grotesk | wght 300–700 | `spacegrotesk/v22`, latin | SIL OFL 1.1, `OFL-spacegrotesk.txt` |

These are **byte-identical** to the files `next/font/google` downloaded for the `latin` subset. They were fetched with its user agent (Chrome/104) and verified by SHA-256 against a build of the previous setup. The rendering is identical. Licence texts come from the `google/fonts` repository (`ofl/<family>/OFL.txt`). The OFL allows bundling and redistribution with software. The fonts must not be sold on their own, and the licence must travel with them.

**Coverage:** only the latin subset is bundled, as the old configuration declared (`subsets: ["latin"]`). Characters outside it render in the size-matched fallback (Arial or Times New Roman). Examples are Polish "ł", Czech "ř", Cyrillic, Greek and Vietnamese. Before, they arrived from Google's extra subset files on demand. The app's own text uses none of them.

To update a font, fetch the latin woff2 URL from `https://fonts.googleapis.com/css2?family=…&display=swap` with the user agent in `next/dist/compiled/@next/font/dist/google/fetch-resource.js`, replace the file, and keep the licence.
