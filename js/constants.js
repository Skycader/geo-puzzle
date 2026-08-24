// Shared layout constants that both JS scale math and style.css need to
// agree on. CSS can't read a JS export directly, so every place in
// style.css that also needs this value has its own comment pointing back
// here — keep them in sync by hand if this ever changes.
// The map is meant to be monolithic — flush against the header/toolbar and
// every screen edge, no border/frame of its own (see .zoom-viewport) — so
// this is 0, not just "small". Kept as a named constant rather than deleted
// outright in case that rule ever gets revisited.
export const SCREEN_EDGE_MARGIN_PX = 0;

// Coins awarded per correct answer, by level then by mode. Keyed by mode
// id with hyphens turned into underscores (name-state -> name_state,
// city-place -> city_place) rather than a separate id<->key translation
// table — every board file corresponds to exactly one mode, so it just
// reads its own fixed key straight out of here via REWARDS[this.levelId]?.[key].
// Scoped to 'usa' for now (that's what was asked for) — puzzle mode is
// deliberately not included, it's a different interaction entirely (each
// placed piece isn't really a discrete "correct answer" the way a quiz
// round is, and rewarding all 50 would need its own, separate tuning).
// Everything is 1 for now, per instruction — tune later once there's a
// reason to.
export const REWARDS = {
  usa: {
    quiz: 1,
    name_state: 1,
    neighbor: 1,
    identify: 1,
    city_place: 1,
    colorfill: 1,
    // "Путешествие" · "Назови штаты" only — the "Собери пазл" answer mode
    // deliberately skips rewards too, same reasoning as plain puzzle mode
    // above (it's the same drag-assembly interaction, not discrete
    // per-answer rounds).
    journey: 1,
  },
};
