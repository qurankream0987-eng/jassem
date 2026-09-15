---
name: Expo web session storage
description: Expo SecureStore is unavailable in this project's web preview while native clients support it.
---

Use platform-specific session storage: keep bearer session tokens in Expo SecureStore on iOS/Android, but use AsyncStorage for the Expo web preview.

**Why:** The current Expo web runtime exposes an incomplete SecureStore module and fails during session bootstrap instead of returning the app UI.

**How to apply:** Any session read/write/delete path must use the same platform split. Do not weaken native device storage merely to make the web preview run.