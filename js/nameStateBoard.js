import {
  shuffle,
  clamp,
  levenshtein,
  weightedSampleWithoutReplacement,
} from "./utils.js";
import { playSnap, playError, playWin } from "./audio.js";
import {
  attachZoomPan,
  createZoomControls,
  createZoomWrap,
  createScaleBar,
} from "./zoomPan.js";
import { loadSuccessStats, recordOutcome } from "./successStats.js";

const SVG_NS = "http://www.w3.org/2000/svg";
// Separate from quizBoard.js's 'quiz-states' scope — clicking a state on
// the map and recalling its name from a highlight are different skills,
// so a streak in one mode shouldn't silently suppress practice in the
// other.
const SUCCESS_SCOPE = "name-state-states";
const OPTION_COUNT = 4; // easy mode: 1 correct + this many distractors
const ADVANCE_DELAY_MS = 650; // pause after a correct answer so the green flash reads before the next round
const WRONG_FLASH_MS = 500;
// A typed name within this many single-character edits of a real state
// name counts as "recognized" — forgives a typo without accepting garbage.
// See the worked example in js/utils.js's levenshtein doc comment: a single
// missing letter (dist 1) matches; two or more edits (dist 2+) doesn't.
const FUZZY_MATCH_MAX_DIST = 1;

// "Назови штат" — the reverse of "Найди штат": the map highlights a state
// (a pulsing glow, same visual language as quizBoard.js's post-mistake
// hint) and the player has to name it instead of being told the name and
// asked to find it. Two answer methods, chosen once before starting:
//   - easy: multiple choice, 4 buttons (1 correct + 3 random distractors).
//   - hard: free-text, but typo-tolerant — the input fuzzy-matches against
//     every real state name as you type (see FUZZY_MATCH_MAX_DIST) and
//     only lets you confirm once it resolves to *some* recognizable name;
//     confirming then checks that name against the actual highlighted one.
export class NameStateBoard {
  constructor(container, level, opts = {}) {
    this.container = container;
    this.level = level;
    this.levelId = opts.levelId;
    this.scale = opts.scale || 1;
    this.difficulty = opts.difficulty === "hard" ? "hard" : "easy";
    this.onProgress = opts.onProgress || (() => {});
    this.onFinish = opts.onFinish || (() => {});

    const pool =
      opts.eligibleIds && opts.eligibleIds.size
        ? level.pieces.filter((p) => opts.eligibleIds.has(p.id))
        : level.pieces;
    const rounds = clamp(opts.rounds ?? 15, 1, pool.length);
    if (opts.adaptive && this.levelId) {
      // Same adaptive weighting as quizBoard.js — see js/successStats.js
      // and js/utils.js's weightedSampleWithoutReplacement.
      const stats = loadSuccessStats(this.levelId, SUCCESS_SCOPE);
      const picked = weightedSampleWithoutReplacement(
        pool,
        (p) => 1 / ((stats[p.id] || 0) + 1),
        rounds,
      );
      this.queue = shuffle(picked);
    } else {
      this.queue = shuffle(pool).slice(0, rounds);
    }
    this.index = 0;
    this.correct = 0;
    this.mistakes = 0;
    this.locked = false;
    this.current = null;
    this.currentPath = null;
    this.paths = new Map();
    // Wrong guesses in easy mode disable that option instead of resetting
    // every round, so a repeated wrong pick isn't possible within a round.
    this.wrongOptionIds = new Set();
    // Reset each round; set true by a wrong guess/confirm or the hint
    // button — mirrors quizBoard.js's `hinted` flag, feeding the same
    // recordOutcome() streak logic (see _answerEasy/_confirmHard/_revealHint).
    this.roundNeededHelp = false;
    // hard mode: whichever real state the current input text fuzzy-matches
    // to right now (null if nothing matches closely enough to confirm).
    this.matchedPiece = null;

    this._build();
  }

  _build() {
    const { width, height } = this.level.canvas;
    this.container.innerHTML = "";

    const baseW = Math.round(width * this.scale);
    const baseH = Math.round(height * this.scale);

    const { wrap: zoomWrap, viewport: zoomViewport } = createZoomWrap(
      baseW,
      baseH,
    );
    this.zoomWrap = zoomWrap;
    this.zoomViewport = zoomViewport;

    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    this.svg.setAttribute("width", baseW);
    this.svg.setAttribute("height", baseH);
    this.svg.classList.add("quiz-svg");

    for (const p of this.level.pieces) {
      const path = document.createElementNS(SVG_NS, "path");
      path.setAttribute("d", p.d);
      path.setAttribute("class", "quiz-path");
      path.dataset.id = p.id;
      this.svg.appendChild(path);
      this.paths.set(p.id, path);
    }

    this.zoomViewport.appendChild(this.svg);
    // The wrap must be attached to the live document BEFORE attachZoomPan()
    // runs — it measures viewport.clientWidth/Height immediately (for pan
    // clamping), which reads 0 on a detached element.
    this.container.appendChild(this.zoomWrap);

    // Nothing on the map is clickable here (answers come from the bar
    // below), but panning/zooming to get a closer look at the highlighted
    // state should still work — same panFromAnywhere reasoning as
    // quizBoard.js, just without an onTap handler since a tap isn't an
    // answer in this mode.
    this.zoomCtl = attachZoomPan(this.zoomViewport, this.svg, {
      baseWidth: baseW,
      baseHeight: baseH,
      panFromAnywhere: true,
    });
    this.zoomWrap.appendChild(createZoomControls(this.zoomCtl));
    this.zoomWrap.appendChild(
      createScaleBar(this.zoomCtl, {
        baseScale: this.scale,
        kmPerUnit: this.level.kmPerUnit,
      }),
    );

    this._buildAnswerBar();
    this._nextQuestion();
  }

  _buildAnswerBar() {
    const bar = document.createElement("div");
    bar.className = "name-answer-bar";
    if (this.difficulty === "easy") {
      bar.innerHTML = `<div class="name-options"></div><span class="name-feedback"></span>`;
      this.optionsEl = bar.querySelector(".name-options");
    } else {
      bar.innerHTML = `
        <div class="name-input-row">
          <button type="button" class="name-hint-btn" data-action="hint" title="Не могу вспомнить — показать название">?</button>
          <div class="name-input-wrap">
            <input type="text" class="name-input" placeholder="Впиши название штата..." autocomplete="off" />
            <span class="name-match-icon"></span>
          </div>
          <button type="button" class="name-confirm-btn" data-action="confirm" title="Подтвердить" disabled>✓</button>
        </div>
        <span class="name-feedback"></span>
      `;
      this.inputEl = bar.querySelector(".name-input");
      this.matchIconEl = bar.querySelector(".name-match-icon");
      this.confirmBtn = bar.querySelector(".name-confirm-btn");
      this.hintBtn = bar.querySelector(".name-hint-btn");
      this.inputEl.addEventListener("input", () => this._onInput());
      this.inputEl.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") this._confirmHard();
      });
      this.confirmBtn.addEventListener("click", () => this._confirmHard());
      this.hintBtn.addEventListener("click", () => this._revealHint());
    }
    this.feedbackEl = bar.querySelector(".name-feedback");
    // Lives INSIDE the map (a child of .zoom-wrap, itself position:relative
    // and sized to the map's own rendered pixels) rather than a sibling row
    // that reserves its own flow height — same "don't push the map around"
    // rule as game.js's win-bar/quiz-prompt overlays. Reserving that height
    // (see the old answerBarH in game.js, now removed) skewed the fit
    // calculation toward being height-constrained on wide maps, producing
    // more left/right letterboxing than necessary.
    this.zoomWrap.appendChild(bar);
    this.answerBar = bar;
  }

  _nextQuestion() {
    this.currentPath?.classList.remove("quiz-hint");
    if (this.index >= this.queue.length) {
      setTimeout(() => playWin(), 100);
      this.onFinish({
        correct: this.correct,
        mistakes: this.mistakes,
        total: this.queue.length,
      });
      return;
    }
    this.locked = false;
    this.current = this.queue[this.index];
    this.currentPath = this.paths.get(this.current.id);
    this.currentPath.classList.add("quiz-hint");
    this.feedbackEl.textContent = "";
    this.wrongOptionIds.clear();
    this.roundNeededHelp = false;

    if (this.difficulty === "easy") this._renderOptions();
    else this._resetHardInput();

    this._reportProgress();
  }

  _renderOptions() {
    const distractors = shuffle(
      this.level.pieces.filter((p) => p.id !== this.current.id),
    ).slice(0, OPTION_COUNT - 1);
    const options = shuffle([this.current, ...distractors]);
    this.optionsEl.innerHTML = "";
    for (const opt of options) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "name-option-btn";
      btn.textContent = opt.ru;
      btn.dataset.id = opt.id;
      btn.addEventListener("click", () => this._answerEasy(opt.id, btn));
      this.optionsEl.appendChild(btn);
    }
  }

  _answerEasy(id, btn) {
    if (this.locked || this.wrongOptionIds.has(id)) return;
    if (id === this.current.id) {
      this.locked = true;
      btn.classList.add("name-option-correct");
      for (const b of this.optionsEl.querySelectorAll(".name-option-btn"))
        b.disabled = true;
      playSnap();
      this.correct++;
      if (this.levelId)
        recordOutcome(
          this.levelId,
          SUCCESS_SCOPE,
          this.current.id,
          this.roundNeededHelp,
        );
      this.feedbackEl.textContent = "Верно!";
      this.feedbackEl.classList.remove("name-feedback-wrong");
      this.feedbackEl.classList.add("name-feedback-correct");
      setTimeout(() => {
        this.index++;
        this._nextQuestion();
      }, ADVANCE_DELAY_MS);
    } else {
      this.wrongOptionIds.add(id);
      this.roundNeededHelp = true;
      btn.classList.add("name-option-wrong");
      btn.disabled = true;
      playError();
      this.mistakes++;
      this.feedbackEl.textContent = "Не тот штат — попробуй ещё";
      this.feedbackEl.classList.remove("name-feedback-correct");
      this.feedbackEl.classList.add("name-feedback-wrong");
      this._reportProgress();
    }
  }

  // Closest real state name (by edit distance) to the current input, and
  // how far off it is — the single source of truth for both the live
  // ✓/✗ indicator and what a confirm actually checks against. Checked
  // against both the Russian and the English name, so "Орегон" and
  // "Oregon" both resolve to the same state.
  _closestPiece(text) {
    const q = text.trim().toLowerCase();
    if (!q) return { piece: null, dist: Infinity };
    let best = null;
    let bestDist = Infinity;
    for (const p of this.level.pieces) {
      const d = Math.min(
        levenshtein(q, p.ru.toLowerCase()),
        levenshtein(q, p.name.toLowerCase()),
      );
      if (d < bestDist) {
        bestDist = d;
        best = p;
      }
    }
    return { piece: best, dist: bestDist };
  }

  _onInput() {
    if (this.locked) return;
    const { piece, dist } = this._closestPiece(this.inputEl.value);
    const matched = dist <= FUZZY_MATCH_MAX_DIST ? piece : null;
    this.matchedPiece = matched;
    this.matchIconEl.textContent = matched
      ? "✓"
      : this.inputEl.value.trim()
        ? "✗"
        : "";
    this.matchIconEl.classList.toggle("name-match-yes", !!matched);
    this.matchIconEl.classList.toggle(
      "name-match-no",
      !matched && !!this.inputEl.value.trim(),
    );
    this.confirmBtn.disabled = !matched;
  }

  // "I can't remember it" button — just shows the name, doesn't fill the
  // input or auto-confirm, so it stays a peek rather than an auto-solve.
  // Counts the same as a wrong guess for the adaptive streak, though —
  // seeing the answer means this state still needs practice.
  _revealHint() {
    if (this.locked || !this.current) return;
    this.roundNeededHelp = true;
    this.feedbackEl.textContent = `Ответ: ${this.current.ru} (${this.current.name})`;
    this.feedbackEl.classList.remove(
      "name-feedback-correct",
      "name-feedback-wrong",
    );
  }

  _resetHardInput() {
    this.inputEl.value = "";
    this.matchedPiece = null;
    this.matchIconEl.textContent = "";
    this.matchIconEl.classList.remove("name-match-yes", "name-match-no");
    this.confirmBtn.disabled = true;
    this.inputEl.focus();
  }

  _confirmHard() {
    if (this.inputEl.value === "?") this._revealHint(); //Allow manual asking for help;
    if (this.locked || !this.matchedPiece) return;
    if (this.matchedPiece.id === this.current.id) {
      this.locked = true;
      this.inputEl.disabled = true;
      this.confirmBtn.disabled = true;
      playSnap();
      this.correct++;
      if (this.levelId)
        recordOutcome(
          this.levelId,
          SUCCESS_SCOPE,
          this.current.id,
          this.roundNeededHelp,
        );
      this.feedbackEl.textContent = "Верно!";
      this.feedbackEl.classList.remove("name-feedback-wrong");
      this.feedbackEl.classList.add("name-feedback-correct");
      setTimeout(() => {
        this.inputEl.disabled = false;
        this.index++;
        this._nextQuestion();
      }, ADVANCE_DELAY_MS);
    } else {
      this.roundNeededHelp = true;
      playError();
      this.mistakes++;
      this.feedbackEl.textContent = `«${this.matchedPiece.ru}» — не тот штат, попробуй ещё`;
      this.feedbackEl.classList.remove("name-feedback-correct");
      this.feedbackEl.classList.add("name-feedback-wrong");
      this.answerBar.classList.add("name-shake");
      setTimeout(
        () => this.answerBar.classList.remove("name-shake"),
        WRONG_FLASH_MS,
      );
      this._reportProgress();
    }
  }

  _reportProgress() {
    this.onProgress({
      index: this.index + 1,
      total: this.queue.length,
      mistakes: this.mistakes,
    });
  }

  destroy() {
    this.zoomCtl?.destroy();
    this.container.innerHTML = "";
  }
}
