// The app version — the single source of truth (there is no build step). Shown on the topbar
// button right of the language switcher; clicking it opens the changelog (js/changelogModal.js).
//
// Pre-1.0 semver: the minor number goes up for each big milestone (a new level, mode or
// layer family), the patch number for fixes/tweaks. To cut a release: bump APP_VERSION, add the
// version at the FRONT of RELEASES, write changelog/<version>.md, tag the commit `v<version>`.
export const APP_VERSION = '0.9.0';

// Versions that have a changelog/<version>.md file, newest first (one tab each in the modal).
export const RELEASES = ['0.9.0'];
