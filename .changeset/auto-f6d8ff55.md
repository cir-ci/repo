---
'@circi/diff': patch
'@circi/server': patch
'@circi/testing': patch
---

The image library is loaded when the server first reads, diffs or resizes an image, not when it starts, which makes startup and the test suite faster. Image handling is unchanged.
