import './style.css';
import { ParkourAudio } from './game/audio';
import { MAX_SHIELDS, ParkourEngine } from './game/engine';
import { ParkourWebGPUScene } from './game/sceneWebGPU';

function mustEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el as T;
}

const canvas = mustEl<HTMLCanvasElement>('game-canvas');
const speedVignetteEl = mustEl<HTMLElement>('speed-vignette');
const hudEl = mustEl<HTMLElement>('hud');
const hudShieldsEl = mustEl<HTMLElement>('hud-shields');
const hudSpeedEl = mustEl<HTMLElement>('hud-speed');
const hudBackendEl = mustEl<HTMLElement>('hud-backend');
const hudComboEl = mustEl<HTMLElement>('hud-combo');
const hudComboNumEl = mustEl<HTMLElement>('hud-combo-num');
const hudScoreEl = mustEl<HTMLElement>('hud-score');
const trickFeedEl = mustEl<HTMLElement>('trick-feed');

const overdriveDockEl = mustEl<HTMLElement>('overdrive-dock');
const btnOverdrive = mustEl<HTMLButtonElement>('btn-overdrive');
const overdriveFillEl = mustEl<HTMLElement>('overdrive-bar-fill');
const overdriveLabelEl = mustEl<HTMLElement>('overdrive-label');

const touchPadsEl = mustEl<HTMLElement>('touch-pads');
const btnTogglePads = mustEl<HTMLButtonElement>('btn-toggle-pads');
const btnSound = mustEl<HTMLButtonElement>('btn-sound');
const padLeft = mustEl<HTMLButtonElement>('pad-left');
const padRight = mustEl<HTMLButtonElement>('pad-right');
const padJump = mustEl<HTMLButtonElement>('pad-jump');
const padSlide = mustEl<HTMLButtonElement>('pad-slide');

const titleScreenEl = mustEl<HTMLElement>('title-screen');
const titleBackendBadgeEl = mustEl<HTMLElement>('title-backend-badge');
const titleBestEl = mustEl<HTMLElement>('title-best');
const btnStart = mustEl<HTMLButtonElement>('btn-start');

const gameOverScreenEl = mustEl<HTMLElement>('gameover-screen');
const resultHeadlineEl = mustEl<HTMLElement>('result-headline');
const resScoreEl = mustEl<HTMLElement>('res-score');
const resBestEl = mustEl<HTMLElement>('res-best');
const resDistEl = mustEl<HTMLElement>('res-dist');
const resComboEl = mustEl<HTMLElement>('res-combo');
const resTricksEl = mustEl<HTMLElement>('res-tricks');
const resOrbsEl = mustEl<HTMLElement>('res-orbs');
const btnRetry = mustEl<HTMLButtonElement>('btn-retry');
const btnMenu = mustEl<HTMLButtonElement>('btn-menu');

const audio = new ParkourAudio();
const scene = new ParkourWebGPUScene(canvas);

// Default touch pads visible on touch devices (iPad / iPhone / Android), toggleable anytime!
let showTouchPads =
  typeof window !== 'undefined' &&
  ('ontouchstart' in window || navigator.maxTouchPoints > 0);

function pushTrickPopup(text: string, points: number, color: string): void {
  if (!text) return;
  const el = document.createElement('div');
  el.className = 'trick-pop';
  el.style.color = color;
  el.textContent = points > 0 ? `${text} +${points}` : text;
  trickFeedEl.appendChild(el);
  while (trickFeedEl.children.length > 3) {
    trickFeedEl.removeChild(trickFeedEl.firstChild!);
  }
  window.setTimeout(() => {
    el.remove();
  }, 860);
}

const engine = new ParkourEngine({
  onDash: () => audio.playDash(),
  onJump: (isDouble) => audio.playJump(isDouble),
  onSlide: () => audio.playSlide(),
  onFastFall: () => audio.playFastFall(),
  onWallRun: () => audio.playWallRun(),
  onGrind: () => audio.playGrindSnap(),
  onLaunch: () => audio.playLaunch(),
  onBoost: () => audio.playBoost(),
  onOrb: (isBig) => audio.playOrb(isBig),
  onOverdrive: () => audio.playOverdrive(),
  onSmash: () => audio.playSmash(),
  onHit: () => audio.playHit(),
  onStyle: (ev) => {
    scene.spawnStyleParticles(engine, ev);
    if (ev.text) {
      pushTrickPopup(ev.text, ev.points, ev.color);
    }
  },
  onGameOver: () => {
    openGameOver();
  },
});

function syncPadsVisibility(): void {
  const visible = showTouchPads && engine.phase === 'playing';
  touchPadsEl.classList.toggle('hidden', !visible);
  btnTogglePads.classList.toggle('active', showTouchPads);
}

function startRun(): void {
  titleScreenEl.classList.add('hidden');
  gameOverScreenEl.classList.add('hidden');
  hudEl.classList.remove('hidden');
  overdriveDockEl.classList.remove('hidden');
  trickFeedEl.innerHTML = '';

  engine.startRun();
  syncPadsVisibility();
  audio.playBoost();
}

function openTitle(): void {
  engine.returnToTitle();
  hudEl.classList.add('hidden');
  overdriveDockEl.classList.add('hidden');
  touchPadsEl.classList.add('hidden');
  gameOverScreenEl.classList.add('hidden');
  titleScreenEl.classList.remove('hidden');
  titleBestEl.textContent = engine.bestScore.toLocaleString();
}

function openGameOver(): void {
  touchPadsEl.classList.add('hidden');
  overdriveDockEl.classList.add('hidden');
  const finalScore = Math.round(engine.score);
  resultHeadlineEl.textContent =
    finalScore >= engine.bestScore && finalScore > 0 ? '🔥 NEW RECORD!!' : 'STYLISH RUN!';
  resScoreEl.textContent = finalScore.toLocaleString();
  resBestEl.textContent = engine.bestScore.toLocaleString();
  resDistEl.textContent = `${Math.round(engine.s)}m`;
  resComboEl.textContent = `x${engine.maxCombo}`;
  resTricksEl.textContent = String(engine.tricksCount);
  resOrbsEl.textContent = String(engine.orbsCollected);
  gameOverScreenEl.classList.remove('hidden');
}

function syncHud(): void {
  if (engine.phase !== 'playing') return;

  // Shields pips
  const desired = `${engine.shields}`;
  if (hudShieldsEl.dataset.val !== desired) {
    hudShieldsEl.dataset.val = desired;
    hudShieldsEl.innerHTML = '';
    for (let i = 0; i < MAX_SHIELDS; i++) {
      const pip = document.createElement('span');
      pip.className = `shield-pip${i >= engine.shields ? ' lost' : ''}`;
      hudShieldsEl.appendChild(pip);
    }
  }

  // Speedometer (m/s -> exciting km/h display)
  hudSpeedEl.textContent = String(Math.round(engine.speed * 3.6));
  hudScoreEl.textContent = Math.round(engine.score).toLocaleString();

  // Combo badge
  if (engine.combo >= 2) {
    hudComboEl.classList.remove('hidden');
    hudComboNumEl.textContent = `x${engine.combo}`;
  } else {
    hudComboEl.classList.add('hidden');
  }

  // Overdrive bar
  if (engine.isOverdrive) {
    const pct = Math.min(100, (engine.overdriveTimer / 6.5) * 100);
    overdriveFillEl.style.width = `${pct.toFixed(1)}%`;
    overdriveLabelEl.textContent = '⚡ OVERDRIVE ACTIVE!!';
    btnOverdrive.classList.remove('ready');
    btnOverdrive.classList.add('active');
  } else {
    const pct = Math.min(100, Math.round(engine.overdriveGauge));
    overdriveFillEl.style.width = `${pct}%`;
    const ready = pct >= 100;
    overdriveLabelEl.textContent = ready
      ? '⚡ TAP FOR OVERDRIVE!!'
      : `⚡ OVERDRIVE ${pct}%`;
    btnOverdrive.classList.toggle('ready', ready);
    btnOverdrive.classList.remove('active');
  }

  // Screen edge speed/overdrive vignette
  speedVignetteEl.classList.toggle('overdrive', engine.isOverdrive);
  speedVignetteEl.classList.toggle(
    'boost',
    !engine.isOverdrive && (engine.boostTimer > 0 || engine.isWallRunning)
  );
}

// ==================== Ultra-Responsive iPad & Smartphone Swipe Controls ====================
// Triggers immediately during pointermove (24px threshold) — zero latency waiting for touchend!
const activePointers = new Map<
  number,
  { startX: number; startY: number; consumed: boolean }
>();
const SWIPE_THRESHOLD_PX = 24;

canvas.addEventListener('pointerdown', (e) => {
  if (engine.phase !== 'playing') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;

  activePointers.set(e.pointerId, {
    startX: e.clientX,
    startY: e.clientY,
    consumed: false,
  });

  // Two-finger tap on iPad / smartphone fires Overdrive immediately!
  if (activePointers.size >= 2) {
    engine.triggerOverdrive();
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (engine.phase !== 'playing') return;
  const p = activePointers.get(e.pointerId);
  if (!p || p.consumed) return;

  const dx = e.clientX - p.startX;
  const dy = e.clientY - p.startY;
  if (Math.hypot(dx, dy) < SWIPE_THRESHOLD_PX) return;

  if (Math.abs(dx) > Math.abs(dy)) {
    engine.shiftLane(dx < 0 ? -1 : 1);
  } else if (dy < 0) {
    engine.jump();
  } else {
    engine.slideOrFastFall();
  }

  // Re-anchor origin so fluid combo swipes (e.g., Up -> Right) work without lifting finger!
  p.startX = e.clientX;
  p.startY = e.clientY;
  p.consumed = true;
  // Allow chaining a second perpendicular swipe after a tiny 95ms window
  window.setTimeout(() => {
    const cur = activePointers.get(e.pointerId);
    if (cur) cur.consumed = false;
  }, 95);
});

const releasePointer = (e: PointerEvent) => {
  activePointers.delete(e.pointerId);
};
canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

// Split Thumb Pads (iPad & one-handed comfort)
padLeft.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  engine.shiftLane(-1);
});
padRight.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  engine.shiftLane(1);
});
padJump.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  engine.jump();
});
padSlide.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  engine.slideOrFastFall();
});

btnOverdrive.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  e.stopPropagation();
  engine.triggerOverdrive();
});

btnTogglePads.addEventListener('click', () => {
  showTouchPads = !showTouchPads;
  audio.playDash();
  syncPadsVisibility();
});

btnSound.addEventListener('click', () => {
  const on = audio.toggle();
  btnSound.textContent = on ? '🔊' : '🔇';
});

btnStart.addEventListener('click', startRun);
btnRetry.addEventListener('click', startRun);
btnMenu.addEventListener('click', () => {
  audio.playDash();
  openTitle();
});

// Desktop Keyboard Controls
window.addEventListener('keydown', (e) => {
  if (engine.phase === 'title' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    startRun();
    return;
  }
  if (engine.phase === 'gameover' && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    startRun();
    return;
  }
  if (engine.phase !== 'playing') return;

  switch (e.key) {
    case 'ArrowLeft':
    case 'a':
    case 'A':
      e.preventDefault();
      engine.shiftLane(-1);
      break;
    case 'ArrowRight':
    case 'd':
    case 'D':
      e.preventDefault();
      engine.shiftLane(1);
      break;
    case 'ArrowUp':
    case 'w':
    case 'W':
    case ' ':
      e.preventDefault();
      engine.jump();
      break;
    case 'ArrowDown':
    case 's':
    case 'S':
      e.preventDefault();
      engine.slideOrFastFall();
      break;
    case 'Shift':
    case 'e':
    case 'E':
      e.preventDefault();
      engine.triggerOverdrive();
      break;
  }
});

// ==================== Boot WebGPU Engine ====================
window.addEventListener('resize', () => {
  scene.resize(window.innerWidth, window.innerHeight);
});

titleBestEl.textContent = engine.bestScore.toLocaleString();

async function boot(): Promise<void> {
  const backend = await scene.init();
  hudBackendEl.textContent = backend === 'WebGPU' ? '⚡ WebGPU' : 'WebGL2';
  titleBackendBadgeEl.textContent =
    backend === 'WebGPU' ? '⚡ WebGPU + TSL HDR BLOOM' : '✨ TSL HDR BLOOM (WebGL2 FALLBACK)';

  let lastTs = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.05, Math.max(0, (now - lastTs) / 1000));
    lastTs = now;

    engine.update(dt);
    scene.render(engine, dt);
    syncHud();

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

void boot();
