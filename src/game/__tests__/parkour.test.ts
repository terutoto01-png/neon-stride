import { describe, expect, it } from 'vitest';
import { ParkourEngine } from '../engine';
import { ParkourPatternGenerator, TrackPath3D } from '../track';

describe('TrackPath3D curved & banked 3D skyway spline', () => {
  it('produces an orthonormal right-handed 3D basis at every point along the track', () => {
    const track = new TrackPath3D();
    for (const s of [0, 30, 85, 160, 290, 480]) {
      const f = track.sampleAt(s);
      expect(Math.hypot(f.fx, f.fy, f.fz)).toBeCloseTo(1, 3);
      expect(Math.hypot(f.rx, f.ry, f.rz)).toBeCloseTo(1, 3);
      expect(Math.hypot(f.ux, f.uy, f.uz)).toBeCloseTo(1, 3);
      expect(f.fx * f.rx + f.fy * f.ry + f.fz * f.rz).toBeCloseTo(0, 3);
      expect(f.fx * f.ux + f.fy * f.uy + f.fz * f.uz).toBeCloseTo(0, 3);
      expect(f.rx * f.ux + f.ry * f.uy + f.rz * f.uz).toBeCloseTo(0, 3);
    }
  });

  it('curves and changes elevation dynamically beyond the opening stretch', () => {
    const track = new TrackPath3D();
    const xs = [0, 80, 160, 260, 380].map((s) => track.sampleAt(s).x);
    const ys = [0, 80, 160, 260, 380].map((s) => track.sampleAt(s).y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(20);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(8);
  });

  it('never blocks all 3 lanes simultaneously with hazards in generated patterns', () => {
    let seed = 777;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const gen = new ParkourPatternGenerator(rng);
    let cursor = 44;
    const hazardKinds = new Set(['hurdle', 'laserHigh', 'pillar', 'gap']);

    for (let p = 0; p < 40; p++) {
      const pat = gen.spawnPatternAt(cursor, Math.floor(p / 6));
      for (let probeS = cursor; probeS <= pat.nextS; probeS += 2) {
        const blockedLanes = new Set<number>();
        for (const seg of pat.segments) {
          if (hazardKinds.has(seg.kind) && probeS >= seg.startS - 1 && probeS <= seg.endS + 1) {
            blockedLanes.add(seg.lane);
          }
        }
        expect(blockedLanes.size).toBeLessThanOrEqual(2);
      }
      cursor = pat.nextS;
    }
  });
});

describe('ParkourEngine actions, gimmicks, and combo mechanics', () => {
  function makeDeterministicEngine() {
    let seed = 1337;
    const rng = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    return new ParkourEngine({}, rng);
  }

  it('supports 3-lane switching, jump, double-jump, and mid-air fast-fall slam', () => {
    const engine = makeDeterministicEngine();
    engine.startRun();
    expect(engine.targetLane).toBe(1);

    engine.shiftLane(-1);
    expect(engine.targetLane).toBe(0);
    engine.shiftLane(-1);
    expect(engine.targetLane).toBe(0);

    engine.jump();
    expect(engine.action).toBe('jump');
    expect(engine.grounded).toBe(false);

    engine.jump();
    expect(engine.action).toBe('doubleJump');

    engine.slideOrFastFall();
    expect(engine.action).toBe('fastFall');
    expect(engine.vy).toBeLessThan(-20);
  });

  it('engages wall-run on outer neon billboard and executes wall-kick inward', () => {
    const engine = makeDeterministicEngine();
    engine.startRun();
    engine.segments = [
      {
        id: 500,
        kind: 'wallRun',
        lane: 0,
        startS: 5,
        endS: 35,
        elevationY: 0,
        triggered: false,
        smashed: false,
        smashTime: 0,
        smashDir: -1,
      },
    ];
    engine.targetLane = 0;
    engine.lanePos = 0;
    engine.s = 8;

    engine.update(0.03);
    expect(engine.action).toBe('wallRunLeft');
    expect(engine.y).toBeGreaterThan(0.5);

    engine.jump();
    expect(engine.targetLane).toBe(1);
    expect(engine.action).toBe('flip');
    expect(engine.combo).toBeGreaterThanOrEqual(2);
  });

  it('snaps onto elevated grind rail and slides cleanly under high laser gates', () => {
    const engine = makeDeterministicEngine();
    engine.startRun();
    engine.segments = [
      {
        id: 600,
        kind: 'rail',
        lane: 1,
        startS: 10,
        endS: 34,
        elevationY: 2.3,
        triggered: false,
        smashed: false,
        smashTime: 0,
        smashDir: -1,
      },
    ];
    engine.s = 12;
    engine.y = 2.6;
    engine.vy = -1;
    engine.grounded = false;

    engine.update(0.03);
    expect(engine.action).toBe('grind');
    expect(engine.y).toBeCloseTo(2.3, 2);

    engine.startRun();
    engine.segments = [
      {
        id: 601,
        kind: 'laserHigh',
        lane: 1,
        startS: 2,
        endS: 3.5,
        elevationY: 1.55,
        triggered: false,
        smashed: false,
        smashTime: 0,
        smashDir: -1,
      },
    ];
    const startShields = engine.shields;
    engine.slideOrFastFall();
    expect(engine.action).toBe('slide');
    for (let i = 0; i < 8; i++) {
      engine.update(0.02);
    }
    expect(engine.shields).toBe(startShields);
    expect(engine.segments[0]?.triggered).toBe(true);
  });

  it('launches sky-high off jump ramps and smashes pillars during Overdrive', () => {
    const engine = makeDeterministicEngine();
    engine.startRun();
    engine.segments = [
      {
        id: 700,
        kind: 'jumpRamp',
        lane: 1,
        startS: 0.5,
        endS: 4.5,
        elevationY: 0,
        triggered: false,
        smashed: false,
        smashTime: 0,
        smashDir: -1,
      },
    ];
    engine.update(0.04);
    expect(engine.action).toBe('flip');
    expect(engine.vy).toBeGreaterThan(18);

    engine.startRun();
    engine.overdriveGauge = 100;
    expect(engine.triggerOverdrive()).toBe(true);
    expect(engine.isOverdrive).toBe(true);
    engine.segments = [
      {
        id: 701,
        kind: 'pillar',
        lane: 1,
        startS: 0.4,
        endS: 2.0,
        elevationY: 0,
        triggered: false,
        smashed: false,
        smashTime: 0,
        smashDir: -1,
      },
    ];
    const shieldsBefore = engine.shields;
    engine.update(0.03);
    expect(engine.shields).toBe(shieldsBefore);
    expect(engine.segments[0]?.smashed).toBe(true);
  });
});
