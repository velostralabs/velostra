# Velostra logo kit

Editable source assets for polishing the Velostra identity. The geometry matches
the `BrandMark` component and favicon currently used by the product.

## Files

| File | Use |
|---|---|
| `velostra-mark-master.svg` | Primary editable source with named groups and hidden safe-area guides. |
| `velostra-mark-dark-tile.svg` | App icon and avatar presentation on the canonical dark tile. |
| `velostra-mark-mono-light.svg` | One-color treatment for dark surfaces. |
| `velostra-mark-mono-dark.svg` | One-color treatment for white or light surfaces. |
| `velostra-lockup-horizontal.svg` | Mark plus editable lowercase wordmark. |
| `exports/*.png` | Transparent and ready-to-preview raster exports. |

## Editing notes

- Open the master SVG in Figma, Illustrator, Affinity Designer, or Inkscape.
- The major construction pieces are named `facet-shell`, `v-monogram`,
  `center-cut`, `edge-highlight`, and `settlement-node`.
- Toggle `safe-area-guides` only while editing; keep it hidden for export.
- The horizontal wordmark remains editable text and uses **Space Grotesk 600**.
- Canonical dark surface: `#070A0E`.
- Signal green: `#C9FF5F`.
- Gradient: `#F5F7EE` → `#DCEBAA` → `#9EDB42`.

For replacements, keep the 64 × 64 mark viewBox so the React component,
favicon, navigation, proof animation, and loading transition can consume the
same geometry without per-surface alignment fixes.
