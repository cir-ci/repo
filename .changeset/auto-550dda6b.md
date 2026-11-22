---
'@circi/server': patch
---

WorkspaceGeneralPage test: wait for the avatar stack's spread to stop before hovering the +N chip; on CI's slower machine the chip was still moving and the tooltip never opened
