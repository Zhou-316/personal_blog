# Upstream source

- Project: https://github.com/rdev/liquid-glass-react
- Commit: ac48eab18d1f7f444ae30002d240cae29c863a21
- License: MIT, reproduced in LICENSE.
- Files: src/index.tsx, src/utils.ts, src/shader-utils.ts.
- Retrieved: 2026-10-23.

The upstream source declares React >=18, while the published npm packages declare
React >=19. This project retains React 18 and vendors the MIT-licensed source,
instead of bypassing peer dependency checks or upgrading React for a visual change.
Integration and scoped CSS live outside this directory. Any local source changes
are documented below.

- Add ResizeObserver cleanup so asynchronous content and responsive layout changes
  keep the decorative layers aligned.
- Make the displacement image id unique per instance.
- Export the optical filter independently, avoiding the demo container's positioning
  and duplicated bevel layers in application controls.
- Use an explicit rounded edge mask with a configurable width; keep the center
  undisplaced instead of deriving mask alpha from an opaque displacement image.
- Bound the filter region to the glass surface; its wrapper already clips overflow,
  so an expanded offscreen filter surface would only add rendering work.
