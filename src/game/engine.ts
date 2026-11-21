import type {
  EnergyOrb,
  GamePhase,
  LaneIndex,
  ParkourAction,
  StyleEvent,
  TrackFrame3D,
  TrackSegmentEntity,
} from '../types';
import { ParkourPatternGenerator, TrackPath3D } from './track';

export interface ParkourCallbacks {
  onDash?: () => void;
  onJump?: (isDouble: boolean) => void;
  onSlide?: () => void;
  onFastFall?: () => void;
  onWallRun?: () => void;
  onGrind?: () => void;
  onLaunch?: () => void;
  onBoost?: () => void;
  onOrb?: (isBig: boolean) => void;
  onOverdrive?: () => void;
  onSmash?: () => void;
  onHit?: () => void;
  onStyle?: (event: StyleEvent) => void;
  onGameOver?: () => void;
}

const GRAVITY = 40;
const JUMP_VY = 15.8;
const DOUBLE_JUMP_VY = 13.8;
const WALL_KICK_VY = 16.4;
const RAMP_LAUNCH_VY = 22.4;
const FAST_FALL_VY = -34;
const SLIDE_DURATION = 0.68;
const WALL_RUN_HEIGHT = 2.15;
export const MAX_SHIELDS = 4;

export class ParkourEngine {
  readonly track = new TrackPath3D();
  private generator: ParkourPatternGenerator;
  private callbacks: ParkourCallbacks;

  phase: GamePhase = 'title';
  timeSec = 0;

  // Player longitudinal & lateral kinematics
  s = 0;
  speed = 21;
  baseSpeed = 21;
  targetLane: LaneIndex = 1;
  lanePos = 1;
  laneVel = 0;

  // Vertical & Parkour Action State
  y = 0;
  vy = 0;
  grounded = true;
  action: ParkourAction = 'run';
  canDoubleJump = true;
  slideTimer = 0;
  flipProgress = 0; // 0..1 during 360 front-flip
  coyoteTimer = 0;
  jumpBufferTimer = 0;

  // Active gimmick attachment
  activeRailId: number | null = null;
  activeWallId: number | null = null;

  // Boost, Overdrive, Shields & Camera Juice Signals
  boostTimer = 0;
  overdriveGauge = 0; // 0..100
  overdriveTimer = 0;
  invincibleTimer = 0;
  hitStopTimer = 0;
  cameraShake = 0;
  landingImpact = 0; // 0..1 camera dip on landing

  // Score, Combo & Stats
  shields = MAX_SHIELDS;
  score = 0;
  bestScore = 0;
  combo = 0;
  maxCombo = 0;
  comboTimer = 0;
  tricksCount = 0;
  orbsCollected = 0;

  // Current 3D frame on spline
  currentFrame: TrackFrame3D;

  // Live world entities
  segments: TrackSegmentEntity[] = [];
  orbs: EnergyOrb[] = [];
  private spawnedUntilS = 55;

  constructor(callbacks: ParkourCallbacks = {}, rng: () => number = Math.random) {
    this.callbacks = callbacks;
    this.generator = new ParkourPatternGenerator(rng);
    this.currentFrame = this.track.sampleAt(0);
    this.loadBestScore();
  }

  get difficultyLevel(): number {
    return Math.min(8, Math.floor(this.s / 240));
  }

  get isOverdrive(): boolean {
    return this.overdriveTimer > 0;
  }

  get isWallRunning(): boolean {
    return this.action === 'wallRunLeft' || this.action === 'wallRunRight';
  }

  startRun(): void {
    this.phase = 'playing';
    this.s = 0;
    this.baseSpeed = 21;
    this.speed = this.baseSpeed;
    this.targetLane = 1;
    this.lanePos = 1;
    this.laneVel = 0;

    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.action = 'run';
    this.canDoubleJump = true;
    this.slideTimer = 0;
    this.flipProgress = 0;
    this.coyoteTimer = 0;
    this.jumpBufferTimer = 0;
    this.activeRailId = null;
    this.activeWallId = null;

    this.boostTimer = 0;
    this.overdriveGauge = 25;
    this.overdriveTimer = 0;
    this.invincibleTimer = 0;
    this.hitStopTimer = 0;
    this.cameraShake = 0;
    this.landingImpact = 0;

    this.shields = MAX_SHIELDS;
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.comboTimer = 0;
    this.tricksCount = 0;
    this.orbsCollected = 0;

    this.segments = [];
    this.orbs = [];
    this.generator.reset();
    this.spawnedUntilS = 44;

    // Opening starter trail of glowing orbs straight down center lane
    for (let i = 0; i < 6; i++) {
      this.orbs.push({
        id: 900000 + i,
        lane: 1,
        s: 12 + i * 4.5,
        y: 1.15,
        collected: false,
      });
    }

    this.ensureAheadPatterns();
    this.currentFrame = this.track.sampleAt(0);
  }

  returnToTitle(): void {
    this.phase = 'title';
    this.s = 0;
    this.y = 0;
    this.lanePos = 1;
    this.targetLane = 1;
    this.action = 'run';
    this.currentFrame = this.track.sampleAt(0);
  }

  shiftLane(delta: -1 | 1): void {
    if (this.phase !== 'playing') return;
    const next = Math.max(0, Math.min(2, this.targetLane + delta)) as LaneIndex;
    if (next === this.targetLane) return;

    const wasGrinding = this.action === 'grind';
    const wasWallRunning = this.isWallRunning;

    this.targetLane = next;
    this.callbacks.onDash?.();

    // Detaching laterally from a wall-run turns into a stylish mid-air hop!
    if (wasWallRunning) {
      this.activeWallId = null;
      this.vy = Math.max(this.vy, 9.5);
      this.action = 'jump';
      this.grounded = false;
      this.canDoubleJump = true;
    }

    // Rail-hopping laterally pops upward cleanly so you can snap onto a parallel rail!
    if (wasGrinding) {
      this.activeRailId = null;
      this.vy = 9.2;
      this.action = 'jump';
      this.grounded = false;
      this.canDoubleJump = true;
    }
  }

  setLane(lane: LaneIndex): void {
    if (this.phase !== 'playing') return;
    if (lane === this.targetLane) return;
    const delta = lane > this.targetLane ? 1 : -1;
    this.targetLane = lane;
    this.callbacks.onDash?.();

    if (this.isWallRunning) {
      this.activeWallId = null;
      this.vy = Math.max(this.vy, 9.5);
      this.action = 'jump';
      this.grounded = false;
    } else if (this.action === 'grind') {
      this.activeRailId = null;
      this.vy = 9.2;
      this.action = 'jump';
      this.grounded = false;
    }
    void delta;
  }

  jump(): void {
    if (this.phase !== 'playing') return;

    // 1. Explosive Wall-Kick off a Wall-Run!
    if (this.isWallRunning) {
      const kickDir: -1 | 1 = this.action === 'wallRunLeft' ? 1 : -1;
      this.activeWallId = null;
      this.targetLane = Math.max(0, Math.min(2, this.targetLane + kickDir)) as LaneIndex;
      this.vy = WALL_KICK_VY;
      this.grounded = false;
      this.action = 'flip';
      this.flipProgress = 0;
      this.canDoubleJump = true;
      this.boostTimer = Math.max(this.boostTimer, 0.9);
      this.callbacks.onJump?.(true);
      this.awardStyle('WALL KICK!', 250, '#00f5d4', 'wallKick');
      return;
    }

    // 2. Ground / Catwalk / Rail / Coyote Jump
    if (this.grounded || this.coyoteTimer > 0 || this.action === 'grind') {
      this.activeRailId = null;
      this.grounded = false;
      this.coyoteTimer = 0;
      this.slideTimer = 0;
      this.vy = JUMP_VY;
      this.action = 'jump';
      this.canDoubleJump = true;
      this.callbacks.onJump?.(false);

      // Check for Stylish Vault right in front of a hurdle!
      for (const seg of this.segments) {
        if (
          seg.kind === 'hurdle' &&
          !seg.triggered &&
          !seg.smashed &&
          Math.abs(seg.lane - this.targetLane) < 0.6 &&
          seg.startS - this.s > 0.2 &&
          seg.startS - this.s < 7.5 &&
          Math.abs(this.y - seg.elevationY) < 1.2
        ) {
          seg.triggered = true;
          this.boostTimer = Math.max(this.boostTimer, 0.75);
          this.awardStyle('PERFECT VAULT!', 180, '#fde047', 'vault');
          break;
        }
      }
      return;
    }

    // 3. Double Jump / Aerial Front-Flip
    if (this.canDoubleJump) {
      this.canDoubleJump = false;
      this.vy = DOUBLE_JUMP_VY;
      this.action = 'doubleJump';
      this.flipProgress = 0;
      this.callbacks.onJump?.(true);
      return;
    }

    // 4. Jump Buffer (fires automatically if landing within 130ms!)
    this.jumpBufferTimer = 0.13;
  }

  slideOrFastFall(): void {
    if (this.phase !== 'playing') return;

    if (this.grounded && !this.isWallRunning && this.action !== 'grind') {
      this.slideTimer = SLIDE_DURATION;
      this.action = 'slide';
      this.callbacks.onSlide?.();
      return;
    }

    // Mid-air or Rail / Wall Fast-Fall Slam!
    this.activeRailId = null;
    this.activeWallId = null;
    this.grounded = false;
    this.vy = FAST_FALL_VY;
    this.action = 'fastFall';
    this.slideTimer = SLIDE_DURATION * 0.72; // transitions straight into a crisp slide on landing!
    this.callbacks.onFastFall?.();
  }

  triggerOverdrive(): boolean {
    if (this.phase !== 'playing') return false;
    if (this.overdriveGauge < 100 || this.overdriveTimer > 0) return false;

    this.overdriveGauge = 0;
    this.overdriveTimer = 6.5;
    this.cameraShake = Math.max(this.cameraShake, 0.45);
    this.callbacks.onOverdrive?.();
    this.awardStyle('⚡ OVERDRIVE!!', 500, '#ffd166', 'overdrive');
    return true;
  }

  update(dtRaw: number): void {
    const dt = Math.min(0.05, Math.max(0, dtRaw));
    this.timeSec += dt;

    if (this.phase !== 'playing') {
      this.currentFrame = this.track.sampleAt(0);
      return;
    }

    // Micro hit-stop punch on shield impact or massive smash
    if (this.hitStopTimer > 0) {
      this.hitStopTimer = Math.max(0, this.hitStopTimer - dt);
      this.cameraShake = Math.max(0, this.cameraShake - dt * 2.5);
      return;
    }

    // Decay timers
    if (this.boostTimer > 0) this.boostTimer = Math.max(0, this.boostTimer - dt);
    if (this.overdriveTimer > 0) this.overdriveTimer = Math.max(0, this.overdriveTimer - dt);
    if (this.invincibleTimer > 0) this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    if (this.coyoteTimer > 0) this.coyoteTimer = Math.max(0, this.coyoteTimer - dt);
    if (this.jumpBufferTimer > 0) this.jumpBufferTimer = Math.max(0, this.jumpBufferTimer - dt);
    if (this.cameraShake > 0) this.cameraShake = Math.max(0, this.cameraShake - dt * 2.8);
    if (this.landingImpact > 0) this.landingImpact = Math.max(0, this.landingImpact - dt * 4.5);

    if (this.comboTimer > 0) {
      this.comboTimer = Math.max(0, this.comboTimer - dt);
      if (this.comboTimer === 0) this.combo = 0;
    }

    // Smooth, enjoyable speed ramp (starts comfortable at 21 m/s -> builds gradually to 35 m/s)
    this.baseSpeed = Math.min(35, 21 + this.s * 0.0055);
    let speedMul = 1.0;
    if (this.boostTimer > 0) speedMul *= 1.24;
    if (this.overdriveTimer > 0) speedMul *= 1.3;
    if (this.isWallRunning || this.action === 'grind') speedMul *= 1.08;
    const targetSpeed = this.baseSpeed * speedMul;
    this.speed += (targetSpeed - this.speed) * Math.min(1, dt * 6);

    const prevS = this.s;
    this.s += this.speed * dt;
    this.score += this.speed * dt * (1 + Math.min(4, this.combo * 0.15));
    this.currentFrame = this.track.sampleAt(this.s);

    // Snappy spring-like lateral lane transition
    const prevLane = this.lanePos;
    const laneLerp = Math.min(1, dt * 18);
    this.lanePos += (this.targetLane - this.lanePos) * laneLerp;
    if (Math.abs(this.targetLane - this.lanePos) < 0.003) {
      this.lanePos = this.targetLane;
    }
    this.laneVel = (this.lanePos - prevLane) / Math.max(0.001, dt);

    // Flip animation timer
    if (this.action === 'flip' || this.action === 'doubleJump') {
      this.flipProgress = Math.min(1, this.flipProgress + dt * 2.1);
    }

    // Slide duration timer
    if (this.action === 'slide') {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0) {
        this.slideTimer = 0;
        if (this.grounded) this.action = 'run';
      }
    }

    // === CHECK WALL-RUN ENGAGEMENT ===
    this.updateWallRun(dt);

    // === CHECK GRIND RAIL ENGAGEMENT ===
    if (!this.isWallRunning) {
      this.updateGrindRail();
    }

    // === VERTICAL PHYSICS (when not attached to wall or rail) ===
    if (!this.isWallRunning && this.action !== 'grind') {
      const floorY = this.computeFloorHeightAt(this.s, this.lanePos);
      const prevY = this.y;

      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;

      if (floorY !== null && this.y <= floorY && prevY >= floorY - 0.85) {
        const wasAir = !this.grounded;
        const impactVel = -this.vy;
        this.y = floorY;
        this.vy = 0;
        this.grounded = true;
        this.canDoubleJump = true;
        this.coyoteTimer = 0.11;

        if (wasAir) {
          this.landingImpact = Math.min(1, impactVel / 28);
          if (this.action === 'fastFall') {
            this.cameraShake = Math.max(this.cameraShake, 0.24);
            this.action = this.slideTimer > 0 ? 'slide' : 'run';
          } else {
            this.action = 'run';
          }
          if (this.jumpBufferTimer > 0) {
            this.jumpBufferTimer = 0;
            this.jump();
          }
        }
      } else {
        if (this.grounded) {
          // Just stepped off a catwalk or gap edge
          this.grounded = false;
          this.coyoteTimer = 0.11;
          if (this.action === 'run' || this.action === 'slide') {
            this.action = 'jump';
          }
        }
      }

      // Fell into a chasm gap!
      if (this.y < -5.5) {
        this.takeHit(null, true);
        this.y = 3.5;
        this.vy = 9.0;
        this.grounded = false;
        this.action = 'jump';
        this.targetLane = 1;
      }
    }

    // === INTERACT WITH GIMMICKS & OBSTACLES ===
    this.handleGimmicksAndCollisions(prevS, dt);

    // === COLLECT ENERGY ORBS ===
    this.handleOrbs();

    // Update smashed debris timers & cleanup behind camera
    for (const seg of this.segments) {
      if (seg.smashed) seg.smashTime += dt;
    }
    this.segments = this.segments.filter((seg) => seg.endS > this.s - 25);
    this.orbs = this.orbs.filter((o) => !o.collected && o.s > this.s - 18);

    // Stream new parkour set-pieces ahead
    this.ensureAheadPatterns();
  }

  private updateWallRun(_dt: number): void {
    // Check if an active wall-run panel exists on our outer lane (0 or 2)
    let matchedWall: TrackSegmentEntity | null = null;
    for (const seg of this.segments) {
      if (seg.kind !== 'wallRun') continue;
      if (
        this.s >= seg.startS - 1.0 &&
        this.s <= seg.endS + 0.5 &&
        Math.abs(this.lanePos - seg.lane) < 0.42
      ) {
        matchedWall = seg;
        break;
      }
    }

    if (matchedWall) {
      const entering = this.activeWallId !== matchedWall.id;
      this.activeWallId = matchedWall.id;
      this.activeRailId = null;
      this.grounded = false;
      this.canDoubleJump = true;
      this.vy = 0;
      this.y += (WALL_RUN_HEIGHT - this.y) * 0.28;
      this.action = matchedWall.lane === 0 ? 'wallRunLeft' : 'wallRunRight';

      if (entering) {
        this.callbacks.onWallRun?.();
        if (!matchedWall.triggered) {
          matchedWall.triggered = true;
          this.awardStyle('WALL RUN!', 220, '#38bdf8', 'wallRun');
        }
      }
    } else if (this.activeWallId !== null) {
      // Smoothly exit wall-run with a small athletic hop
      this.activeWallId = null;
      this.vy = 7.5;
      this.action = 'jump';
      this.grounded = false;
      this.canDoubleJump = true;
    }
  }

  private updateGrindRail(): void {
    let matchedRail: TrackSegmentEntity | null = null;
    for (const seg of this.segments) {
      if (seg.kind !== 'rail') continue;
      if (
        this.s >= seg.startS - 0.8 &&
        this.s <= seg.endS + 0.5 &&
        Math.abs(this.lanePos - seg.lane) < 0.45
      ) {
        // Snap if already grinding this rail, OR descending near rail elevation, OR jumping up right onto rail start!
        const railY = seg.elevationY;
        const alreadyOn = this.activeRailId === seg.id;
        const canSnap =
          alreadyOn ||
          (this.vy <= 4 && this.y >= railY - 0.9 && this.y <= railY + 1.5);
        if (canSnap) {
          matchedRail = seg;
          break;
        }
      }
    }

    if (matchedRail) {
      const entering = this.activeRailId !== matchedRail.id;
      this.activeRailId = matchedRail.id;
      this.y = matchedRail.elevationY;
      this.vy = 0;
      this.grounded = true;
      this.canDoubleJump = true;
      this.action = 'grind';
      if (entering) {
        this.callbacks.onGrind?.();
        if (!matchedRail.triggered) {
          matchedRail.triggered = true;
          this.awardStyle('RAIL GRIND!', 220, '#f472b6', 'grind');
        }
      }
    } else if (this.activeRailId !== null) {
      // Clean dismount hop at rail end
      this.activeRailId = null;
      this.vy = 8.2;
      this.grounded = false;
      this.action = 'jump';
      this.canDoubleJump = true;
    }
  }

  /** Returns deck/catwalk floor height at (s, lane), or null if over an open floor chasm! */
  computeFloorHeightAt(s: number, laneFloat: number): number | null {
    // Check elevated catwalks first
    for (const seg of this.segments) {
      if (
        seg.kind === 'catwalk' &&
        s >= seg.startS - 0.6 &&
        s <= seg.endS + 0.6 &&
        Math.abs(laneFloat - seg.lane) < 0.52 &&
        this.y >= seg.elevationY - 0.75
      ) {
        return seg.elevationY;
      }
    }

    // Check floor gap chasms
    for (const seg of this.segments) {
      if (
        seg.kind === 'gap' &&
        s >= seg.startS + 0.6 &&
        s <= seg.endS - 0.6 &&
        Math.abs(laneFloat - seg.lane) < 0.45
      ) {
        return null;
      }
    }
    return 0;
  }

  private handleGimmicksAndCollisions(prevS: number, _dt: number): void {
    const playerHeight = this.action === 'slide' ? 0.85 : 1.85;
    const playerBottom = this.y;
    const playerTop = this.y + playerHeight;

    for (const seg of this.segments) {
      if (seg.smashed) continue;

      const sOverlap = this.s >= seg.startS - 0.9 && this.s <= seg.endS + 0.9;
      const laneDiff = Math.abs(this.lanePos - seg.lane);

      // Launch Ramp!
      if (seg.kind === 'jumpRamp' && sOverlap && laneDiff < 0.55 && playerBottom < 1.6 && !seg.triggered) {
        seg.triggered = true;
        this.activeRailId = null;
        this.activeWallId = null;
        this.grounded = false;
        this.vy = RAMP_LAUNCH_VY;
        this.action = 'flip';
        this.flipProgress = 0;
        this.canDoubleJump = true;
        this.boostTimer = Math.max(this.boostTimer, 1.3);
        this.cameraShake = Math.max(this.cameraShake, 0.22);
        this.callbacks.onLaunch?.();
        this.awardStyle('SKY LAUNCH!', 240, '#ff9f1c', 'launch');
        continue;
      }

      // Turbo Boost Pad!
      if (seg.kind === 'boostPad' && sOverlap && laneDiff < 0.55 && playerBottom < 1.2 && !seg.triggered) {
        seg.triggered = true;
        this.boostTimer = Math.max(this.boostTimer, 2.2);
        this.addOverdrive(16);
        this.callbacks.onBoost?.();
        this.awardStyle('TURBO BOOST!', 150, '#2ec4b6', 'boost');
        continue;
      }

      // Hazards: hurdle, laserHigh, pillar
      if (seg.kind !== 'hurdle' && seg.kind !== 'laserHigh' && seg.kind !== 'pillar') {
        continue;
      }

      // Near-miss detection when zooming cleanly right beside a solid obstacle
      if (
        !seg.nearMissAwarded &&
        prevS <= seg.startS &&
        this.s >= seg.startS &&
        laneDiff >= 0.55 &&
        laneDiff <= 1.25 &&
        playerBottom < seg.elevationY + 2.5
      ) {
        seg.nearMissAwarded = true;
        this.awardStyle('NEAR MISS!', 100, '#38bdf8', 'nearMiss');
      }

      if (!sOverlap || laneDiff > 0.38) continue;

      // Forgiving vertical clearance check per hazard type so stylish dodges feel awesome!
      if (seg.kind === 'hurdle') {
        const hurdleTop = seg.elevationY + 1.15;
        if (playerBottom >= hurdleTop - 0.28 || playerTop <= seg.elevationY) {
          continue; // Cleanly jumped over!
        }
      } else if (seg.kind === 'laserHigh') {
        const beamBottom = seg.elevationY; // 1.55m above deck
        const beamTop = seg.elevationY + 1.45;
        if (playerTop <= beamBottom + 0.32 || this.action === 'slide') {
          // Cleanly slid underneath!!
          if (!seg.triggered) {
            seg.triggered = true;
            this.awardStyle('CYBER SLIDE!', 150, '#a855f7', 'slide');
          }
          continue;
        }
        if (playerBottom >= beamTop) continue; // Soared high above it!
      } else if (seg.kind === 'pillar') {
        if (playerBottom >= seg.elevationY + 3.2) continue; // Launched high over pillar!
      }

      // Collision occurred!
      if (this.isOverdrive) {
        seg.smashed = true;
        this.cameraShake = Math.max(this.cameraShake, 0.32);
        this.callbacks.onSmash?.();
        this.awardStyle('SMASH! +200', 200, '#ffd166', 'smash');
        continue;
      }

      if (this.invincibleTimer > 0) continue;

      seg.smashed = true;
      this.takeHit(seg, false);
    }
  }

  private handleOrbs(): void {
    const magnetRangeLane = this.isOverdrive ? 1.85 : 0.62;
    const magnetRangeS = this.isOverdrive ? 4.2 : 2.4;
    const magnetRangeY = this.isOverdrive ? 3.5 : 1.8;

    for (const orb of this.orbs) {
      if (orb.collected) continue;
      if (
        Math.abs(orb.s - this.s) < magnetRangeS &&
        Math.abs(orb.lane - this.lanePos) < magnetRangeLane &&
        Math.abs(orb.y - (this.y + 0.9)) < magnetRangeY
      ) {
        orb.collected = true;
        this.orbsCollected++;
        const pts = orb.isBig ? 120 : 35;
        this.score += pts * (1 + Math.min(4, this.combo * 0.15));
        this.addOverdrive(orb.isBig ? 12 : 4.5);
        this.callbacks.onOrb?.(Boolean(orb.isBig));
        this.callbacks.onStyle?.({
          text: '',
          points: pts,
          color: orb.isBig ? '#ffd166' : '#00f5d4',
          kind: 'orb',
          s: orb.s,
          laneFloat: orb.lane,
          y: orb.y,
        });
      }
    }
  }

  private takeHit(_seg: TrackSegmentEntity | null, fromFall: boolean): void {
    this.shields = Math.max(0, this.shields - 1);
    this.combo = 0;
    this.comboTimer = 0;
    this.invincibleTimer = 2.25;
    this.hitStopTimer = fromFall ? 0.04 : 0.075;
    this.cameraShake = 0.6;
    this.callbacks.onHit?.();
    this.callbacks.onStyle?.({
      text: fromFall ? 'SKY RECOVERY!' : 'SHIELD HIT!',
      points: 0,
      color: '#ff4d6d',
      kind: 'hit',
      s: this.s,
      laneFloat: this.lanePos,
      y: Math.max(0.5, this.y + 1),
    });

    if (this.shields <= 0) {
      this.phase = 'gameover';
      if (Math.round(this.score) > this.bestScore) {
        this.bestScore = Math.round(this.score);
        this.saveBestScore();
      }
      this.callbacks.onGameOver?.();
    }
  }

  private awardStyle(
    text: string,
    points: number,
    color: string,
    kind: StyleEvent['kind']
  ): void {
    this.combo++;
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.comboTimer = 4.2;
    this.tricksCount++;
    const mult = 1 + Math.min(4, (this.combo - 1) * 0.25);
    const totalPts = Math.round(points * mult);
    this.score += totalPts;
    this.addOverdrive(10);

    this.callbacks.onStyle?.({
      text,
      points: totalPts,
      color,
      kind,
      s: this.s,
      laneFloat: this.lanePos,
      y: this.y + 1.4,
    });
  }

  private addOverdrive(amount: number): void {
    if (this.overdriveTimer > 0) return;
    this.overdriveGauge = Math.min(100, this.overdriveGauge + amount);
  }

  private ensureAheadPatterns(): void {
    while (this.spawnedUntilS < this.s + 220) {
      const generated = this.generator.spawnPatternAt(this.spawnedUntilS, this.difficultyLevel);
      this.segments.push(...generated.segments);
      this.orbs.push(...generated.orbs);
      this.spawnedUntilS = generated.nextS;
    }
  }

  private loadBestScore(): void {
    try {
      const saved = window.localStorage.getItem('neonstride_best_score');
      if (saved) this.bestScore = Math.max(0, parseInt(saved, 10) || 0);
    } catch {
      // Ignore storage errors in sandboxed/test envs
    }
  }

  private saveBestScore(): void {
    try {
      window.localStorage.setItem('neonstride_best_score', String(this.bestScore));
    } catch {
      // Ignore storage errors
    }
  }
}
