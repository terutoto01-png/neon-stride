import type { LaneIndex, TrackFrame3D, TrackSegmentEntity, EnergyOrb } from '../types';

export const LANE_WIDTH = 3.2;
export const TRACK_WIDTH = LANE_WIDTH * 3;

/**
 * Infinite smooth 3D curving, climbing, dropping, and banking skyway spline!
 * Evaluates exact position, tangent, banked right vector, and up vector at any arc-length s (meters).
 */
export class TrackPath3D {
  private rawCenter(s: number): { x: number; y: number; z: number } {
    const ramp = Math.min(1, Math.max(0, (s - 25) / 65));
    const smoothRamp = ramp * ramp * (3 - 2 * ramp);

    const x =
      smoothRamp *
      (Math.sin(s * 0.0075) * 32 +
        Math.sin(s * 0.016 + 1.1) * 12 +
        Math.cos(s * 0.0038) * 16 -
        16);

    const y =
      smoothRamp *
      (Math.sin(s * 0.01) * 10 +
        Math.sin(s * 0.02 + 0.7) * 4.0);

    const z = -s;
    return { x, y, z };
  }

  curvatureAt(s: number): number {
    const eps = 2.0;
    const p0 = this.rawCenter(s - eps);
    const p1 = this.rawCenter(s);
    const p2 = this.rawCenter(s + eps);
    return (p2.x - 2 * p1.x + p0.x) / (eps * eps);
  }

  sampleAt(s: number): TrackFrame3D {
    const eps = 0.6;
    const p = this.rawCenter(s);
    const ahead = this.rawCenter(s + eps);
    const behind = this.rawCenter(s - eps);

    let fx = ahead.x - behind.x;
    let fy = ahead.y - behind.y;
    let fz = ahead.z - behind.z;
    const fLen = Math.hypot(fx, fy, fz) || 1;
    fx /= fLen;
    fy /= fLen;
    fz /= fLen;

    let baseRx = -fz;
    let baseRy = 0;
    let baseRz = fx;
    const rLen = Math.hypot(baseRx, baseRz) || 1;
    baseRx /= rLen;
    baseRz /= rLen;

    const baseUx = baseRy * fz - baseRz * fy;
    const baseUy = baseRz * fx - baseRx * fz;
    const baseUz = baseRx * fy - baseRy * fx;

    const curv = this.curvatureAt(s);
    const bankRad = Math.max(-0.2, Math.min(0.2, -curv * 22));
    const cb = Math.cos(bankRad);
    const sb = Math.sin(bankRad);

    const rx = baseRx * cb + baseUx * sb;
    const ry = baseRy * cb + baseUy * sb;
    const rz = baseRz * cb + baseUz * sb;

    const ux = baseUx * cb - baseRx * sb;
    const uy = baseUy * cb - baseRy * sb;
    const uz = baseUz * cb - baseRz * sb;

    const yawRad = Math.atan2(-fx, -fz);
    const pitchRad = Math.asin(Math.max(-0.95, Math.min(0.95, fy)));

    return {
      x: p.x,
      y: p.y,
      z: p.z,
      fx,
      fy,
      fz,
      rx,
      ry,
      rz,
      ux,
      uy,
      uz,
      bankRad,
      yawRad,
      pitchRad,
    };
  }

  trackToWorld(
    s: number,
    laneFloat: number,
    heightY: number
  ): { x: number; y: number; z: number; frame: TrackFrame3D } {
    const frame = this.sampleAt(s);
    const lat = (laneFloat - 1) * LANE_WIDTH;
    return {
      x: frame.x + frame.rx * lat + frame.ux * heightY,
      y: frame.y + frame.ry * lat + frame.uy * heightY,
      z: frame.z + frame.rz * lat + frame.uz * heightY,
      frame,
    };
  }
}

export interface GeneratedPattern {
  segments: TrackSegmentEntity[];
  orbs: EnergyOrb[];
  nextS: number;
}

/**
 * Fair, rhythmic, flow-focused Parkour Choreography Generator!
 * Design rules:
 * - Always leaves generous breathing space between set-pieces (56m–74m) so you enjoy the 3D skyline & flow.
 * - NEVER blocks all 3 lanes at the same longitudinal position; always leaves 1–2 wide-open safe lanes.
 * - Highlights ONE clear parkour toy per section (Launch Ramp, Wall-Run, Grind Rail, Slide/Vault, Catwalk, Turbo Slalom)
 *   so pulling off stylish tricks feels natural, readable, and rewarding rather than chaotic!
 */
export class ParkourPatternGenerator {
  private nextId = 1;
  private rng: () => number;
  private patternCount = 0;

  constructor(rng: () => number = Math.random) {
    this.rng = rng;
  }

  reset(): void {
    this.nextId = 1;
    this.patternCount = 0;
  }

  spawnPatternAt(startS: number, difficultyLevel: number): GeneratedPattern {
    this.patternCount++;
    const segments: TrackSegmentEntity[] = [];
    const orbs: EnergyOrb[] = [];

    // Cycle all signature parkour set-pieces early so every run showcases them cleanly!
    let archetype: number;
    if (this.patternCount === 1) archetype = 0; // Launch Ramp Aerial Flip
    else if (this.patternCount === 2) archetype = 1; // Neon Wall-Run Showcase
    else if (this.patternCount === 3) archetype = 2; // Elevated Grind Rail
    else if (this.patternCount === 4) archetype = 3; // Clean Slide -> Vault Rhythm
    else archetype = Math.floor(this.rng() * 6);

    const spacingScale = Math.max(0.86, 1 - difficultyLevel * 0.025);

    if (archetype === 0) {
      // === ARCHETYPE 0: LAUNCH RAMP AERIAL VAULT ===
      // One lane has a launch ramp + soaring orb arc; the other two lanes are wide open (one has a boost pad!)
      const rampLane = this.pickLane();
      const others = this.otherLanes(rampLane);
      segments.push(this.seg('jumpRamp', rampLane, startS, startS + 4.8, 0));
      // Decorative hurdle far behind the ramp only on the ramp lane (easily cleared by the launch!)
      segments.push(this.seg('hurdle', rampLane, startS + 14, startS + 15.5, 0));
      segments.push(this.seg('boostPad', others[0], startS + 16, startS + 23, 0));

      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const arcY = 2.4 + Math.sin(t * Math.PI) * 5.2;
        orbs.push(this.orb(rampLane, startS + 6.5 + i * 3.8, arcY, i === 2 || i === 3));
      }
      return { segments, orbs, nextS: startS + 58 * spacingScale };
    }

    if (archetype === 1) {
      // === ARCHETYPE 1: NEON WALL-RUN SHOWCASE ===
      // Outer lane has a huge glowing holographic wall-run panel; center & far lane stay clear and readable!
      const wallLane: LaneIndex = this.rng() < 0.5 ? 0 : 2;
      const farLane: LaneIndex = wallLane === 0 ? 2 : 0;
      const wallLen = 30;

      segments.push(this.seg('wallRun', wallLane, startS + 2, startS + 2 + wallLen, 0));
      // Only add a floor chasm underneath the wall once past warmup (center & far lane remain safe!)
      if (difficultyLevel >= 1) {
        segments.push(this.seg('gap', wallLane, startS + 6, startS + wallLen - 2, 0));
      }
      // Single optional hurdle on the far lane only (center lane completely open!)
      segments.push(this.seg('hurdle', farLane, startS + 18, startS + 19.5, 0));

      for (let i = 0; i < 6; i++) {
        orbs.push(this.orb(wallLane, startS + 5 + i * 4.4, 2.3, i === 5));
      }
      segments.push(this.seg('boostPad', wallLane, startS + wallLen + 5, startS + wallLen + 12, 0));
      return { segments, orbs, nextS: startS + (wallLen + 36) * spacingScale };
    }

    if (archetype === 2) {
      // === ARCHETYPE 2: ELEVATED GRIND RAIL + OPTIONAL RAIL-HOP ===
      const laneA = this.pickLane();
      const laneB: LaneIndex = laneA === 1 ? (this.rng() < 0.5 ? 0 : 2) : 1;
      const railLen = 24;

      segments.push(this.seg('rail', laneA, startS + 4, startS + 4 + railLen, 2.2));
      // Single obstacle underneath the rail so grinding over it feels awesome, while other lanes stay open!
      segments.push(this.seg('hurdle', laneA, startS + 16, startS + 17.5, 0));

      // Second overlapping rail to hop onto for style bonus
      segments.push(this.seg('rail', laneB, startS + 24, startS + 24 + railLen, 2.2));

      for (let i = 0; i < 5; i++) {
        orbs.push(this.orb(laneA, startS + 6 + i * 4.2, 3.2, false));
      }
      for (let i = 0; i < 5; i++) {
        orbs.push(this.orb(laneB, startS + 26 + i * 4.2, 3.2, i === 4));
      }
      return { segments, orbs, nextS: startS + 72 * spacingScale };
    }

    if (archetype === 3) {
      // === ARCHETYPE 3: RHYTHMIC SLIDE → VAULT PARKOUR LINE ===
      // Wide spacing (28m between moves) + open escape lanes on the sides!
      const lane = this.pickLane();

      segments.push(this.seg('laserHigh', lane, startS + 4, startS + 5.5, 1.55));
      segments.push(this.seg('hurdle', lane, startS + 30, startS + 31.5, 0));
      segments.push(this.seg('boostPad', lane, startS + 44, startS + 51, 0));

      for (let i = 0; i < 3; i++) {
        orbs.push(this.orb(lane, startS + 2 + i * 3.4, 0.72, false));
      }
      for (let i = 0; i < 3; i++) {
        orbs.push(this.orb(lane, startS + 28 + i * 3.4, 2.2, i === 1));
      }
      return { segments, orbs, nextS: startS + 68 * spacingScale };
    }

    if (archetype === 4) {
      // === ARCHETYPE 4: ELEVATED SKYLINE CATWALK ===
      const catLane = this.pickLane();
      const others = this.otherLanes(catLane);
      const catLen = 28;

      segments.push(this.seg('jumpRamp', catLane, startS, startS + 4.8, 0));
      segments.push(this.seg('catwalk', catLane, startS + 9, startS + 9 + catLen, 3.1));
      // Only 1 obstacle on one lower lane; the other lower lane is totally clear
      segments.push(this.seg('pillar', others[0], startS + 20, startS + 22, 0));

      for (let i = 0; i < 6; i++) {
        orbs.push(this.orb(catLane, startS + 11 + i * 4.2, 4.2, i === 5));
      }
      return { segments, orbs, nextS: startS + (catLen + 34) * spacingScale };
    }

    // === ARCHETYPE 5: CLEAN HIGH-SPEED SLALOM & BOOST ===
    // Always leaves 2 lanes open early, or 1–2 lanes open at higher difficulty, with generous 26m gap!
    const safe1 = this.pickLane();
    const safe2 = this.otherLanes(safe1)[0];
    const block1 = this.otherLanes(safe1);

    segments.push(this.seg('pillar', block1[0], startS + 4, startS + 6, 0));
    if (difficultyLevel >= 2) {
      segments.push(this.seg('hurdle', block1[1], startS + 4, startS + 5.5, 0));
    }
    segments.push(this.seg('boostPad', safe1, startS + 5, startS + 12, 0));

    const block2 = this.otherLanes(safe2);
    segments.push(this.seg('laserHigh', block2[0], startS + 30, startS + 31.5, 1.55));
    if (difficultyLevel >= 3) {
      segments.push(this.seg('pillar', block2[1], startS + 30, startS + 32, 0));
    }

    for (let i = 0; i < 4; i++) {
      orbs.push(this.orb(safe1, startS + 2 + i * 3.6, 1.1, false));
      orbs.push(this.orb(safe2, startS + 26 + i * 3.6, 1.1, i === 3));
    }
    return { segments, orbs, nextS: startS + 60 * spacingScale };
  }

  private seg(
    kind: TrackSegmentEntity['kind'],
    lane: LaneIndex,
    startS: number,
    endS: number,
    elevationY: number
  ): TrackSegmentEntity {
    return {
      id: this.nextId++,
      kind,
      lane,
      startS,
      endS,
      elevationY,
      triggered: false,
      smashed: false,
      smashTime: 0,
      smashDir: lane <= 1 ? -1 : 1,
    };
  }

  private orb(lane: LaneIndex, s: number, y: number, isBig: boolean): EnergyOrb {
    return {
      id: this.nextId++,
      lane,
      s,
      y,
      collected: false,
      isBig,
    };
  }

  private pickLane(): LaneIndex {
    return Math.floor(this.rng() * 3) as LaneIndex;
  }

  private otherLanes(lane: LaneIndex): [LaneIndex, LaneIndex] {
    return ([0, 1, 2] as LaneIndex[]).filter((l) => l !== lane) as [LaneIndex, LaneIndex];
  }
}
