// Re-export devtools panel for use by extension and future standalone app
// panel.ts and devtools.ts use chrome.* APIs directly — they are imported
// by the extension build (vite) as entry points, not bundled here.
export {}
