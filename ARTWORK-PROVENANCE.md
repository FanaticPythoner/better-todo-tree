# Better Todo Tree artwork provenance

## Primary artwork

Better Todo Tree's logo and primary icon system are original project artwork. The system was
constructed as flat vector geometry for Better Todo Tree and contains no traced paths, embedded
raster sources, gradients, shadows, filters, or font-rendered text.

| Element | Geometry |
| --- | --- |
| Tree | Broad canopy, circular foliage, split trunk, and roots |
| Upper badge | Circular ring containing a checkmark |
| Lower badge | Equal-size circular ring containing two plus signs |
| Marketplace icon | 128 x 128 RGBA PNG rendered from the vector master |
| Activity Bar icon | 24 x 24 monochrome SVG |
| Product icon | U+EA01 TrueType outline stored in WOFF |

In the 128 x 128 master, both badge circles have outer radius 18 and inner radius 14. The 24 x 24
companions preserve the equal-badge composition with outer radius 4.

## Source files

| File | Role |
| --- | --- |
| `resources/better-todo-tree.png` | Marketplace raster icon |
| `resources/better-todo-tree-logo.svg` | Full-color vector master |
| `resources/better-todo-tree-container.svg` | Activity Bar vector icon |
| `resources/product-icons/better-todo-tree.svg` | Product-icon vector source |
| `resources/product-icons/better-todo-tree.woff` | Packaged product-icon font |

## Unchanged third-party artwork

Toolbar, tree-view, tag, and reveal icons retain their existing attribution in `README.md` and
`resources/icons/license.txt`.
