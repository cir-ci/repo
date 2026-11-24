---
'@circi/web': patch
---

The dashboard's tests run about 7 minutes faster on CI. Most of that comes from running two workers there instead of one: the gate spent its last 5 minutes waiting on web's tests alone, and the memory a single worker used to protect is free now that the test databases live on a Postgres server. Two tests no longer wait out a timeout. In Shell, opening a project page recorded the workspace as last opened through a request the test hadn't faked. Its "not found" toast covered the phone-sized menu for 10 seconds, and the next click waited it out. In Accounts, a check for the "Copied" toast also matched the copy button, which reads "Copied" too, so it ran until its 5-second timeout.
