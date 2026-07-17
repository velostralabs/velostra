# Velostra Crystal V logo kit

> Last verified against product, README, and deployed public surfaces: 2026-07-18.
> Product baseline: Phase 0-4 repository implementation complete; activation gated.

Editable source assets for the Crystal V identity used by the Velostra product.
The two faceted wings express velocity and verified execution, while their shared
settlement point represents one correlated financial outcome.

## Files

| File | Use |
|---|---|
| `velostra-mark-master.svg` | Primary editable source with named groups and hidden safe-area guides. |
| `velostra-mark-dark-tile.svg` | App icon and avatar presentation on the canonical dark tile. |
| `velostra-mark-mono-light.svg` | One-color treatment for dark surfaces. |
| `velostra-mark-mono-dark.svg` | One-color treatment for white or light surfaces. |
| `velostra-lockup-horizontal.svg` | Crystal V plus editable lowercase wordmark. |
| `velostra-tab-icon.svg` | Simplified, high-contrast Crystal V optimized for browser tabs and app launchers. |
| `exports/*.png` | Transparent and ready-to-preview raster exports. |
| `velostra-logo-kit.zip` | Portable bundle containing the complete public kit. |

## Repository integration

- `src/components/BrandMark.tsx` is the code-native product mark.
- `public/velostra-crystal-v*`, `favicon.svg`, and `site.webmanifest` serve browser and launcher surfaces.
- `docs/assets/velostra-hero.svg` uses the same centered Crystal V in the GitHub README hero.
- The README card and connector geometry remain fixed; motion is limited to internal scan, pulse, and facet layers so every captured frame stays aligned.

## Construction

- `crystal-wings` defines the recognizable V silhouette.
- `crystal-facets` creates precision, transparency, and technical depth.
- `facet-ridges` preserves definition from hero scale down to the navigation mark.
- `settlement-glow` marks the final correlated state.
- Keep the center separation visible; it is part of the identity, not a gap to close.
- Use the simplified tab icon below 32px; its wider padding and heavier ridges survive browser scaling.

## Editing notes

- Open the master SVG in Figma, Illustrator, Affinity Designer, or Inkscape.
- Toggle `safe-area-guides` only while editing; keep it hidden for export.
- The horizontal wordmark remains editable text and uses **Space Grotesk 500**.
- Canonical dark surface: `#06090B`.
- Primary green: `#C4FF63`.
- Secondary green: `#A8F44A`.
- Highlight: `#F5F6EC`.

Keep the 64 × 64 viewBox when replacing the React component, favicon, navigation,
proof animation, loading transition, or app icon so every surface stays aligned.
