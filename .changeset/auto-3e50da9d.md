---
'@circi/cypress': patch
---

A screenshot no longer hangs when the browser doesn't paint the page for a while, as can happen on a busy CI machine: the wait for animation frames before each capture gives up on a frame after 100 ms.
