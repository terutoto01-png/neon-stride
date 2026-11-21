import * as THREE from 'three/webgpu';
import {
  abs,
  clamp,
  color,
  float,
  fract,
  mix,
  positionLocal,
  pow,
  sin,
  smoothstep,
  time,
  uniform,
  uv,
  vec3,
} from 'three/tsl';

export interface TrackShaderUniforms {
  overdrive: THREE.UniformNode<'float'>;
  speedFactor: THREE.UniformNode<'float'>;
}

/**
 * Refined, eye-friendly WebGPU TSL Node Material for the curved 3-lane Skyway deck!
 * - Matte twilight carbon deck (no harsh black/neon glare, no rapid moire strobe!)
 * - Crisp forward-pointing (^) lane chevrons
 * - Calm glowing edge rails that warm gently into gold during Overdrive
 */
export function createTrackNodeMaterial(): {
  material: THREE.MeshStandardNodeMaterial;
  uniforms: TrackShaderUniforms;
} {
  const overdrive = uniform(0);
  const speedFactor = uniform(1);

  const uvCoord = uv();
  const u = uvCoord.x; // 0..1 across the 3 lanes
  const v = uvCoord.y; // increases forward (s / 12)

  // Calm matte slate-navy carbon deck (easy on the eyes, great silhouette contrast)
  const baseColor = color('#1e273d');

  // Subtle soft-shaded lane center variation so the 3 lanes read effortlessly
  const laneWave = abs(fract(u.mul(3.0)).sub(0.5));
  const laneTint = mix(color('#25314d'), baseColor, smoothstep(float(0.18), float(0.48), laneWave));

  // Sleek outer edge trim rails at u = 0 and u = 1
  const leftEdge = smoothstep(float(0.045), float(0.012), u);
  const rightEdge = smoothstep(float(0.955), float(0.988), u);
  const outerEdges = clamp(leftEdge.add(rightEdge), 0, 1);

  // Two clean dashed lane dividers at u = 1/3 and u = 2/3
  const distDiv1 = abs(u.sub(float(0.3333)));
  const distDiv2 = abs(u.sub(float(0.6667)));
  const divMask = clamp(
    smoothstep(float(0.016), float(0.004), distDiv1).add(
      smoothstep(float(0.016), float(0.004), distDiv2)
    ),
    0,
    1
  );
  const dashPattern = smoothstep(float(0.35), float(0.42), fract(v.mul(1.5)));
  const laneDividers = divMask.mul(dashPattern);

  // Forward-pointing (^) chevrons in each lane!
  // Because v increases forward, v + k*|localLaneU| = const places the center tip AHEAD of the wings (^)
  const localLaneU = fract(u.mul(3.0)).sub(0.5);
  const chevronPhase = fract(v.mul(0.75).add(abs(localLaneU).mul(0.85)));
  const chevronMask = smoothstep(float(0.84), float(0.9), chevronPhase)
    .mul(smoothstep(float(0.98), float(0.93), chevronPhase))
    .mul(smoothstep(float(0.32), float(0.16), abs(localLaneU)));

  // Soft calm sky-blue normally -> warm amber-gold during Overdrive
  const edgeNormal = color('#38bdf8');
  const edgeOverdrive = color('#fbbf24');
  const edgeCol = mix(edgeNormal, edgeOverdrive, overdrive);

  // Subtle slow breath tied gently to speed (no harsh strobing)
  const gentleBreath = sin(time.mul(2.0).mul(clamp(speedFactor, 0.8, 1.5))).mul(0.06).add(0.94);

  // Restrained emissive levels so WebGPU bloom stays soft and classy
  const emissiveResult = edgeCol
    .mul(outerEdges.mul(0.85).mul(gentleBreath))
    .add(color('#cbd5e1').mul(laneDividers.mul(0.45)))
    .add(edgeCol.mul(chevronMask.mul(0.32)));

  const material = new THREE.MeshStandardNodeMaterial({
    roughness: 0.55,
    metalness: 0.35,
  });
  material.colorNode = laneTint;
  material.emissiveNode = emissiveResult;

  return { material, uniforms: { overdrive, speedFactor } };
}

/**
 * Calm frosted-glass Holographic Wall-Run Energy Panel!
 * Smooth forward-flowing chevrons with zero harsh scanline flicker.
 */
export function createWallRunNodeMaterial(): THREE.MeshBasicNodeMaterial {
  const uvCoord = uv();
  const scrollU = fract(uvCoord.x.mul(4.5).sub(time.mul(1.8)));
  const diag = fract(scrollU.add(abs(uvCoord.y.sub(0.5)).mul(0.9)));
  const chevron = smoothstep(float(0.6), float(0.72), diag).mul(
    smoothstep(float(0.92), float(0.8), diag)
  );

  const border = clamp(
    smoothstep(float(0.1), float(0.02), uvCoord.y).add(
      smoothstep(float(0.9), float(0.98), uvCoord.y)
    ),
    0,
    1
  );

  const col = mix(color('#0284c7'), color('#5eead4'), chevron);
  const hdr = col.mul(float(0.65).add(chevron.mul(0.55)).add(border.mul(0.75)));

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  mat.colorNode = hdr;
  mat.opacityNode = clamp(float(0.3).add(chevron.mul(0.32)).add(border.mul(0.45)), 0, 0.82);
  return mat;
}

/**
 * Boost Pad Material with crisp FORWARD-POINTING (^) scrolling emerald chevrons!
 */
export function createBoostPadNodeMaterial(): THREE.MeshBasicNodeMaterial {
  const uvCoord = uv();
  const centerDist = abs(uvCoord.x.sub(0.5));
  // Adding centerDist makes the center tip sit further ahead (higher uv.y) -> points forward (^)
  const wave = fract(uvCoord.y.mul(2.5).sub(time.mul(3.2)).add(centerDist.mul(1.2)));
  const arrow = smoothstep(float(0.48), float(0.62), wave).mul(
    smoothstep(float(0.9), float(0.76), wave)
  );

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
  });
  mat.colorNode = mix(color('#0d9488'), color('#5eead4'), arrow).mul(float(0.75).add(arrow.mul(0.85)));
  mat.opacityNode = clamp(float(0.35).add(arrow.mul(0.52)), 0, 0.9);
  return mat;
}

/**
 * Smooth breathing Laser Gate Beam (soft coral glow, no harsh strobe!).
 */
export function createLaserNodeMaterial(): THREE.MeshBasicNodeMaterial {
  const uvCoord = uv();
  const pulse = sin(time.mul(5.5).add(uvCoord.x.mul(4.0))).mul(0.08).add(0.92);
  const core = smoothstep(float(0.5), float(0.12), abs(uvCoord.y.sub(0.5)));
  const col = mix(color('#f43f5e'), color('#fda4af'), core).mul(pulse.mul(1.25));

  const mat = new THREE.MeshBasicNodeMaterial();
  mat.colorNode = col;
  return mat;
}

/**
 * Airy, eye-friendly Dusk-Twilight Sky Dome Shader with soft warm horizon glow!
 */
export function createSkyDomeNodeMaterial(): THREE.MeshBasicNodeMaterial {
  const pos = positionLocal.normalize();
  const h = clamp(pos.y, 0, 1);

  const horizonGlow = pow(float(1.0).sub(h), float(3.4));
  const upperTwilight = color('#111834');
  const midBlue = color('#25325c');
  const horizonCoral = color('#d98695');
  const horizonSky = color('#60a5fa');

  const shimmer = sin(pos.x.mul(3.0).add(time.mul(0.18))).mul(0.5).add(0.5);
  const horizonCol = mix(horizonCoral, horizonSky, shimmer.mul(0.5));

  const skyGrad = mix(midBlue, upperTwilight, smoothstep(float(0.08), float(0.6), h));
  const finalCol = mix(skyGrad, horizonCol, horizonGlow.mul(0.62));

  // Soft warm dusk sun disc ahead in the distance
  const sunDir = vec3(0.0, 0.16, -0.987).normalize();
  const sunDot = clamp(pos.dot(sunDir), 0, 1);
  const sunDisc = smoothstep(float(0.992), float(0.996), sunDot);
  const sunGlow = pow(sunDot, float(32.0)).mul(0.4);
  const sunCol = mix(color('#fb923c'), color('#fde68a'), smoothstep(float(0.08), float(0.24), pos.y));

  const mat = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  mat.colorNode = finalCol.add(sunCol.mul(sunDisc.mul(1.15).add(sunGlow)));
  return mat;
}
