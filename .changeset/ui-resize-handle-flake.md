---
'@circi/ui': patch
---

The resize handle's hover test waits for the highlight's fade-in instead of reading the color at once; it failed now and then on slower machines.
