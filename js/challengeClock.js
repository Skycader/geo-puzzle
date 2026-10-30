import { t } from './i18n.js';
import { playWin } from './audio.js';

// Shared timed-challenge helpers for every "Раунд" mode (quiz / name-state /
// … / place-state / colorfill / city pin). Numbers mode has its own clock
// in stateNumbersBoard.js but uses the same 60 s / 3 mistakes constants.

export const CHALLENGE_TIME_LIMIT_S = 60;
export const CHALLENGE_MAX_MISTAKES = 3;

const TICK_MS = 200;

// -> stop() — call from board.destroy() / after finish.
export function startChallengeClock({ timeLimit = CHALLENGE_TIME_LIMIT_S, onTick, onTimeUp }) {
  let stopped = false;
  const deadline = performance.now() + timeLimit * 1000;
  const tick = () => {
    if (stopped) return;
    const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    onTick?.(left);
    if (left <= 0) {
      stopped = true;
      clearInterval(id);
      onTimeUp?.();
    }
  };
  const id = setInterval(tick, TICK_MS);
  onTick?.(timeLimit);
  return () => {
    stopped = true;
    clearInterval(id);
  };
}

// Timed = whole eligible pool; count = N rounds (clamped).
export function challengeRoundCount(poolLength, { timed, rounds }) {
  if (timed) return Math.max(0, poolLength);
  const n = Number(rounds);
  if (!Number.isFinite(n)) return Math.min(15, poolLength);
  return Math.max(1, Math.min(Math.floor(n), poolLength));
}

// Overlay card (reuses .sn-result styles from "Номера штатов").
export function mountChallengeResult(container, { reason, correct, total, mistakes }) {
  const titleKey =
    reason === 'time' ? 'challengeResultTime' : reason === 'mistakes' ? 'challengeResultMistakes' : 'challengeResultAll';
  const card = document.createElement('div');
  card.className = 'sn-result';
  card.innerHTML = `
    <div class="sn-result-title">${t(titleKey)}</div>
    <div class="sn-result-score"><b>${correct}</b><span>${t('numbersResultOf')} ${total}</span></div>
    <div class="sn-result-line">${t('mistakes')}: ${mistakes}</div>`;
  container.appendChild(card);
  return card;
}

// Mix into a board instance after its own fields are set. Boards call
// _beginChallengeClock() at end of _build, _challengeWrong() after bumping
// mistakes, _endChallenge(reason) instead of bare onFinish when timed (or
// always for early exits), and _stopChallengeClock() from destroy().
export function attachChallenge(board, opts = {}) {
  board.timed = !!opts.timed;
  board.timeLimit = opts.timeLimit ?? CHALLENGE_TIME_LIMIT_S;
  // null = no early exit on mistakes (count mode); timed always caps at 3.
  board.maxMistakes = board.timed ? (opts.maxMistakes ?? CHALLENGE_MAX_MISTAKES) : null;
  board.onTick = opts.onTick || (() => {});
  board.finished = false;
  board._stopClock = null;

  board._beginChallengeClock = function beginChallengeClock() {
    if (!this.timed) return;
    this._stopClock = startChallengeClock({
      timeLimit: this.timeLimit,
      onTick: (s) => this.onTick(s),
      onTimeUp: () => this._endChallenge('time'),
    });
  };

  board._stopChallengeClock = function stopChallengeClock() {
    this._stopClock?.();
    this._stopClock = null;
  };

  // After mistakes++: true if the run should stop (caller must not advance).
  board._challengeHitLimit = function challengeHitLimit() {
    return this.maxMistakes != null && this.mistakes >= this.maxMistakes;
  };

  board._endChallenge = function endChallenge(reason, extra = {}) {
    if (this.finished) return;
    this.finished = true;
    this.locked = true;
    this._stopChallengeClock();
    const correct = extra.correct ?? this.correct ?? this.roundsPassed ?? this.roundsAnswered ?? 0;
    const mistakes = extra.mistakes ?? this.mistakes ?? 0;
    const total = extra.total ?? this.queue?.length ?? 0;
    if (this.timed) {
      mountChallengeResult(this.container, { reason, correct, total, mistakes });
      setTimeout(() => playWin(), 100);
    } else if (reason === 'all') {
      setTimeout(() => playWin(), 100);
    }
    this.onFinish({ correct, mistakes, total, reason, ...extra });
  };
}
