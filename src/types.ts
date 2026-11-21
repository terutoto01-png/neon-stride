export type LaneIndex = 0 | 1 | 2;

export type GamePhase = 'title' | 'playing' | 'gameover';

export type ParkourAction =
  | 'run'
  | 'jump'
  | 'doubleJump'
  | 'flip'
  | 'slide'
  | 'wallRunLeft'
  | 'wallRunRight'
  | 'grind'
  | 'fastFall';

export type TrackGimmickKind =
  | 'hurdle'       // Waist-high barrier: jump or stylish vault over
  | 'laserHigh'    // Overhead laser gate: power-slide underneath
  | 'pillar'       // Full tall neon monolith: dodge around (or smash in Overdrive)
  | 'jumpRamp'     // Launch pad: high aerial flip over gaps & hazards
  | 'boostPad'     // Turbo strip: speed burst + FOV kick + overdrive charge
  | 'rail'         // Elevated neon grind rail spanning [startS, endS]
  | 'wallRun'      // Holographic wall-run billboard on left (lane 0) or right (lane 2)
  | 'gap'          // Floor chasm spanning [startS, endS] on a lane (or all lanes with rail/wall/ramp!)
  | 'catwalk';     // Elevated glass walkway at y = 3.0m

export interface TrackSegmentEntity {
  id: number;
  kind: TrackGimmickKind;
  lane: LaneIndex;
  /** Start distance along the 3D track spline in meters */
  startS: number;
  /** End distance along the 3D track spline in meters (equals startS for point objects) */
  endS: number;
  /** Elevation above track deck (used by rails, catwalks, laserHigh) */
  elevationY: number;
  /** Whether the entity has been triggered/smashed/passed */
  triggered: boolean;
  smashed: boolean;
  smashTime: number;
  smashDir: number;
  nearMissAwarded?: boolean;
}

export interface EnergyOrb {
  id: number;
  lane: LaneIndex;
  s: number;
  y: number;
  collected: boolean;
  isBig?: boolean;
}

export interface TrackFrame3D {
  /** World center position on the deck */
  x: number;
  y: number;
  z: number;
  /** Normalized forward tangent */
  fx: number;
  fy: number;
  fz: number;
  /** Normalized right vector (includes banking roll!) */
  rx: number;
  ry: number;
  rz: number;
  /** Normalized deck up vector (perpendicular to forward & right) */
  ux: number;
  uy: number;
  uz: number;
  /** Track banking roll angle in radians */
  bankRad: number;
  /** Horizontal yaw angle in radians */
  yawRad: number;
  /** Pitch angle in radians */
  pitchRad: number;
}

export interface StyleEvent {
  text: string;
  points: number;
  color: string;
  kind:
    | 'vault'
    | 'wallRun'
    | 'wallKick'
    | 'grind'
    | 'launch'
    | 'slide'
    | 'boost'
    | 'nearMiss'
    | 'overdrive'
    | 'smash'
    | 'hit'
    | 'orb';
  s: number;
  laneFloat: number;
  y: number;
}
