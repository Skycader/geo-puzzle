// Shared layout constants that both JS scale math and style.css need to
// agree on. CSS can't read a JS export directly, so every place in
// style.css that also needs this value has its own comment pointing back
// here — keep them in sync by hand if this ever changes.
// The map is meant to be monolithic — flush against the header/toolbar and
// every screen edge, no border/frame of its own (see .zoom-viewport) — so
// this is 0, not just "small". Kept as a named constant rather than deleted
// outright in case that rule ever gets revisited.
export const SCREEN_EDGE_MARGIN_PX = 0;
