// Lightweight, always-on perf instrumentation:
//   1. mark(label, fn) wraps a function; every call's duration is logged
//      to the console if it's slow, and recorded if a debug session is
//      active (see below).
//   2. startLongTaskObserver() uses the browser's native Long Tasks API to
//      catch *any* main-thread block over 50ms, regardless of source —
//      catches things mark() isn't wrapped around too.
//   3. window.startDebug() / window.endDebug() — call from devtools to
//      record a session; endDebug() downloads a JSON report (per-label
//      timing summary + FPS-over-time + the raw event list) instead of
//      requiring someone to scroll back through console output by hand.
const SLOW_MS = 8; // ~half a 60fps frame budget

let recording = false;
let recordStart = 0;
let events = []; // { label, dt, t } — t is ms since recording started
let fpsSamples = []; // { t, fps } — smoothed, one per ~500ms display update
let frameTimes = []; // { t, ms } — RAW per-frame delta, one per rAF tick; this is what actually
                      // catches a brief stutter that a 500ms-averaged FPS number would hide

export function mark(label, fn) {
  return function (...args) {
    const t0 = performance.now();
    const result = fn.apply(this, args);
    const dt = performance.now() - t0;
    if (dt > SLOW_MS) console.warn(`[perf] ${label}: ${dt.toFixed(1)}ms`);
    if (recording) events.push({ label, dt: +dt.toFixed(2), t: +(t0 - recordStart).toFixed(1) });
    return result;
  };
}

export function startLongTaskObserver() {
  if (!('PerformanceObserver' in window)) return;
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        console.warn(`[perf] LONG TASK: ${entry.duration.toFixed(1)}ms at ${entry.startTime.toFixed(0)}ms`);
        if (recording) {
          events.push({ label: 'LONG TASK', dt: +entry.duration.toFixed(2), t: +(entry.startTime - recordStart).toFixed(1) });
        }
      }
    });
    obs.observe({ entryTypes: ['longtask'] });
  } catch (e) {
    console.warn('[perf] longtask observer unavailable', e);
  }
}

// Called by fpsMeter.js on every ~500ms display update, so a debug session
// captures smoothed FPS-over-time alongside the per-function timings.
export function recordFpsSample(fps) {
  if (recording) fpsSamples.push({ t: +(performance.now() - recordStart).toFixed(1), fps });
}

// Called by fpsMeter.js on EVERY rAF tick (not just every 500ms) — this is
// the actual high-resolution trace: a single bad frame buried inside an
// otherwise-smooth 500ms window wouldn't move the averaged FPS number
// much, but it shows up here as one entry with a big `ms`.
export function recordFrameTime(ms) {
  if (recording) frameTimes.push({ t: +(performance.now() - recordStart).toFixed(1), ms: +ms.toFixed(2) });
}

function buildReport() {
  const byLabel = {};
  for (const e of events) {
    const b = byLabel[e.label] || (byLabel[e.label] = { count: 0, totalMs: 0, maxMs: 0 });
    b.count++;
    b.totalMs += e.dt;
    b.maxMs = Math.max(b.maxMs, e.dt);
  }
  for (const label in byLabel) {
    const b = byLabel[label];
    b.totalMs = +b.totalMs.toFixed(1);
    b.avgMs = +(b.totalMs / b.count).toFixed(2);
  }
  const fpsValues = fpsSamples.map((s) => s.fps);
  const frameMs = frameTimes.map((f) => f.ms);
  const worstFrames = [...frameTimes].sort((a, b) => b.ms - a.ms).slice(0, 20);
  return {
    generatedAt: new Date().toISOString(),
    durationMs: +(performance.now() - recordStart).toFixed(1),
    userAgent: navigator.userAgent,
    minFps: fpsValues.length ? Math.min(...fpsValues) : null,
    avgFps: fpsValues.length ? +(fpsValues.reduce((a, b) => a + b, 0) / fpsValues.length).toFixed(1) : null,
    frameStats: frameMs.length
      ? {
          frameCount: frameMs.length,
          maxFrameMs: +Math.max(...frameMs).toFixed(2),
          avgFrameMs: +(frameMs.reduce((a, b) => a + b, 0) / frameMs.length).toFixed(2),
          framesOver16ms: frameMs.filter((ms) => ms > 16).length, // missed 60fps
          framesOver33ms: frameMs.filter((ms) => ms > 33).length, // missed 30fps
          framesOver100ms: frameMs.filter((ms) => ms > 100).length, // a visible stall
        }
      : null,
    worstFrames, // the 20 slowest individual frames, with their timestamp — cross-reference against `events` to see what ran at that moment
    summaryByLabel: byLabel,
    fpsSamples,
    frameTimes,
    events,
  };
}

function downloadReport(report) {
  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  a.href = url;
  a.download = `geo-puzzle-perf-${ts}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function initDebugConsole() {
  window.startDebug = () => {
    events = [];
    fpsSamples = [];
    frameTimes = [];
    recordStart = performance.now();
    recording = true;
    console.info('[perf] recording started — do the laggy thing, then call endDebug()');
  };
  window.endDebug = () => {
    if (!recording) {
      console.warn('[perf] not recording — call startDebug() first');
      return;
    }
    recording = false;
    const report = buildReport();
    downloadReport(report);
    console.info('[perf] report downloaded', report);
  };
}
