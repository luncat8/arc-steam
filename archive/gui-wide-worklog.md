# Full-width workspace with a bounded chamber

## Previous-task review

The existing chamber fit already matches the rendered scene and publishes its
transform for input. The wasted space comes from the page's 1920 px cap and the
fixed 260 px cargo track, not from the renderer. Preserve the fit and drawer
layout; change only the workspace sizing.

## Changes

- Remove the `main` max-width and auto margins.
- Cap the desktop canvas at 1280 × 748.5 CSS px, preserving its 1.71 aspect ratio.
  Short desktop windows reduce both dimensions together to fit 74vh. Include
  the mine panel's two border pixels in the grid track, not in the canvas.
- Allocate remaining desktop width to cargo; retain its internal table scroll
  when the viewport really is too narrow. Controls retain their 250 px track.
- Prevent sibling panel content from stretching the canvas. Keep tablet and
  phone stacking, including the 320 px phone canvas.
- Allow time controls to wrap on narrow phones: the longer paused label
  otherwise overflowed a 320 px viewport.
- Add a standalone browser layout regression, using the existing optional
  Playwright/Chromium environment variables and `file://` startup.

## Validation

- `experiments/browser-layout.cjs`: passed at 11 viewports from 320 × 640 to
  5120 × 1440, with no page errors or page-level horizontal scrolling.
- At 1920 × 1080 the canvas is 1280 × 748.5 and cargo is 348 px wide; the table
  fits. At 2560 / 3440 / 5120 × 1440 the canvas stays unchanged and cargo grows
  to 988 / 1868 / 3548 px, all without horizontal table scrolling.
- At 2560 × 800 the canvas scales to 1012.3 × 592, maintaining the scene ratio.
  Narrow layouts retain internal table scrolling only where needed.
- `node --check experiments/browser-layout.cjs` and `git diff --check`: clean.
- Browser tooling was installed outside the repository; no runtime dependency
  or generated artifact was added.

## Next step

Make the existing automatic ramps optional free shop equipment and provide
momentum-based platform pushing when any player removes its ramps.
