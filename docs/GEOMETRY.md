# Reference coordinate map

The 1536 × 1024 hardware canvas uses uniform scaling. All values are canvas pixels; chassis border adds 5 pixels to inner positions.

| Group             |    x |   y |    width | height |
| ----------------- | ---: | --: | -------: | -----: |
| Chassis           |    0 |   0 |     1536 |   1024 |
| LCD bezel         |   95 |  21 |      598 |    278 |
| Branding          |  720 |  19 |      660 |    115 |
| Vents             | 1394 |  39 |      100 |     80 |
| Utility           |  122 | 320 |      537 |     65 |
| Edit controls     |   80 | 417 |      203 |    112 |
| Data wheel        |  312 | 391 |      183 |    210 |
| Cursor            |  532 | 422 |      146 |    148 |
| Fader             |   43 | 549 |      120 |    382 |
| Sample edit       |  183 | 599 |      508 |    110 |
| Degradation       |  181 | 719 |      514 |    106 |
| FX                |  184 | 824 |      507 |     77 |
| Transport         |  191 | 904 |      497 |     80 |
| Pad bed           |  717 | 150 |      790 |    775 |
| Pads 07 / 08 / 09 |  737 | 202 | 245 each |    218 |
| Pads 04 / 05 / 06 |  737 | 435 | 245 each |    218 |
| Pads 01 / 02 / 03 |  737 | 668 | 245 each |    218 |

The supplied image is the visual authority. No docs/DEVELOPMENT_BRIEF.md existed in the initial checkout. CSS materials use procedural noise, bevels and directional highlights. Controls are visible DOM elements, not screenshot hit areas.
