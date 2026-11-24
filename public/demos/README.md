# Comparison footage

These are illustrative comparisons, not AI processing results. The clear stock reference is labelled After; Before is a deliberately downscaled and blurred version of the same frames. Both variants are silent H.264 MP4, 768 × 432, 24 fps, four seconds.

- Flowers: MDN CC0 sample, https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4
- Coast: Logan Voss, https://www.pexels.com/video/stunning-coastal-cliffs-and-ocean-views-30743316/
- City: Marc Espejo, https://www.pexels.com/video/a-view-of-a-city-street-with-cars-and-buildings-25928500/
- Pexels licence: https://www.pexels.com/license/ (permits use and modification; no endorsement is implied).

Clips were trimmed/resized with FFmpeg. Before variants use `scale=192:108,scale=768:432,gblur=sigma=1.4`; JPG posters use the first video frame. The web app does not require FFmpeg at runtime.
