---
'@circi/core': patch
'@circi/server': patch
---

Push notifications no longer stop for everyone now and then. About 1 in 256 of the server's web push keys was read back as invalid, so the server made new keys and dropped every device's subscription, and people had to turn push on again. Keys made before this release keep working.
