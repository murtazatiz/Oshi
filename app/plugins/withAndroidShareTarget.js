/**
 * Expo config plugin — Android ShareTarget for Android 12+ Sharesheet API
 *
 * Android 12 (API 31) introduced a new Sharesheet that pre-computes and ranks
 * which apps appear at the top level. Without a shortcuts.xml ShareTarget entry,
 * Oshi gets buried in the "More" overflow section even if it has a valid
 * ACTION_SEND intent filter.
 *
 * This plugin does two things during `expo prebuild`:
 *
 *   1. Writes  app/src/main/res/xml/shortcuts.xml
 *      — Declares a <share-target> so Android ranks Oshi in the top share row
 *        when the user shares a URL from Chrome, YouTube, Instagram, etc.
 *
 *   2. Patches  app/src/main/AndroidManifest.xml
 *      — Adds <meta-data android:name="android.app.shortcuts"> to MainActivity
 *        so the system discovers the shortcuts.xml at install time.
 *
 * References:
 *   https://developer.android.com/training/sharing/receive#providing-direct-share-targets
 *   https://developer.android.com/guide/topics/ui/shortcuts/creating-shortcuts#static
 */

const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────────
// shortcuts.xml content
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The <share-target> element tells the Android Sharesheet that Oshi accepts
 * text/plain shares (the MIME type Chrome, YouTube, and Instagram all use when
 * sharing a URL). The category is an app-specific string that links the target
 * back to any ShortcutInfo objects we may publish at runtime via the
 * ShortcutManagerCompat API.
 */
const SHORTCUTS_XML = `<?xml version="1.0" encoding="utf-8"?>
<shortcuts xmlns:android="http://schemas.android.com/apk/res/android">

  <!--
    ShareTarget for the Android 12+ Sharesheet API.

    Registering a <share-target> moves Oshi from the "More apps" overflow into
    the primary share-sheet grid. Without this entry the system does not know
    Oshi should be surfaced for URL sharing even though MainActivity carries a
    matching ACTION_SEND / text/plain intent filter.

    android:targetClass  — the activity that receives the ACTION_SEND intent.
    <data mimeType>      — must match the mimeType in the intent filter.
    <category>           — links to runtime ShortcutInfo categories published
                           via ShortcutManagerCompat (can be empty at launch).
  -->
  <share-target android:targetClass="com.oshi.app.MainActivity">
    <data android:mimeType="text/plain" />
    <category android:name="com.oshi.app.sharingcategory" />
  </share-target>

</shortcuts>
`;

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Write res/xml/shortcuts.xml
// ─────────────────────────────────────────────────────────────────────────────

function withShortcutsXml(config) {
  return withDangerousMod(config, [
    'android',
    async (cfg) => {
      const xmlDir = path.join(
        cfg.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'res',
        'xml',
      );
      fs.mkdirSync(xmlDir, { recursive: true });
      fs.writeFileSync(path.join(xmlDir, 'shortcuts.xml'), SHORTCUTS_XML, 'utf8');
      return cfg;
    },
  ]);
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Add <meta-data android:name="android.app.shortcuts"> to MainActivity
// ─────────────────────────────────────────────────────────────────────────────

function withShortcutsMetaData(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest?.application?.[0];
    if (!app) return cfg;

    // Find MainActivity — Expo generates it as ".MainActivity"
    const activities = app.activity ?? [];
    const mainActivity = activities.find((a) => {
      const name = a.$?.['android:name'] ?? '';
      return name === '.MainActivity' || name === 'com.oshi.app.MainActivity';
    });

    if (!mainActivity) {
      console.warn('[withAndroidShareTarget] MainActivity not found in AndroidManifest — skipping meta-data injection.');
      return cfg;
    }

    if (!mainActivity['meta-data']) {
      mainActivity['meta-data'] = [];
    }

    const alreadyPresent = mainActivity['meta-data'].some(
      (m) => m.$?.['android:name'] === 'android.app.shortcuts',
    );

    if (!alreadyPresent) {
      mainActivity['meta-data'].push({
        $: {
          'android:name': 'android.app.shortcuts',
          'android:resource': '@xml/shortcuts',
        },
      });
    }

    return cfg;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Composed plugin
// ─────────────────────────────────────────────────────────────────────────────

function withAndroidShareTarget(config) {
  config = withShortcutsXml(config);
  config = withShortcutsMetaData(config);
  return config;
}

module.exports = withAndroidShareTarget;
