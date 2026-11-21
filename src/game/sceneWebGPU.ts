import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import type { StyleEvent, TrackFrame3D, TrackSegmentEntity } from '../types';
import type { ParkourEngine } from './engine';
import { ParkourRunnerRig } from './runnerRig';
import {
  createBoostPadNodeMaterial,
  createLaserNodeMaterial,
  createSkyDomeNodeMaterial,
  createTrackNodeMaterial,
  createWallRunNodeMaterial,
  type TrackShaderUniforms,
} from './shaders';
import { LANE_WIDTH, TRACK_WIDTH, TrackPath3D } from './track';

interface SparkParticle {
  mesh: THREE.Mesh;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  gravity: number;
}

const DECK_CHUNKS = 48;
const DECK_STEP_M = 4.0;
const DECK_HALF_W = TRACK_WIDTH * 0.5 + 0.35;
const CITY_TOWER_COUNT = 220;

/**
 * Full WebGPU 3D Parkour Renderer powered by Three.js WebGPURenderer + TSL Shaders + HDR Bloom!
 * Features dynamic roller-coaster track geometry, instanced cyber skyline, articulated runner,
 * dramatic action camerawork (wall-run roll, slide drop, launch sweep, boost FOV), and sparks!
 */
export class ParkourWebGPUScene {
  private renderer: THREE.WebGPURenderer;
  private postProcessing: THREE.PostProcessing | null = null;
  private bloomNode: ReturnType<typeof bloom> | null = null;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private backendLabel: 'WebGPU' | 'WebGL2' = 'WebGPU';

  private runnerRig = new ParkourRunnerRig();
  private trackUniforms: TrackShaderUniforms;
  private deckGeometry!: THREE.BufferGeometry;
  private deckMesh!: THREE.Mesh;
  private skyDome!: THREE.Mesh;
  private cityInstanced!: THREE.InstancedMesh;
  private archInstanced!: THREE.InstancedMesh;

  private entityGroup = new THREE.Group();
  private particleGroup = new THREE.Group();
  private segmentMeshes = new Map<number, THREE.Object3D>();
  private orbMeshes = new Map<number, THREE.Mesh>();
  private sparks: SparkParticle[] = [];

  // Shared TSL & PBR materials — tuned for crisp readability & zero eye strain!
  private wallRunMat = createWallRunNodeMaterial();
  private boostMat = createBoostPadNodeMaterial();
  private laserMat = createLaserNodeMaterial();
  private hurdleMat = new THREE.MeshStandardNodeMaterial({
    color: '#fb923c',
    emissive: '#ea580c',
    emissiveIntensity: 0.65,
    roughness: 0.35,
  });
  private pillarMat = new THREE.MeshStandardNodeMaterial({
    color: '#334155',
    emissive: '#e11d48',
    emissiveIntensity: 0.42,
    roughness: 0.35,
    metalness: 0.55,
  });
  private railMat = new THREE.MeshStandardNodeMaterial({
    color: '#f472b6',
    emissive: '#db2777',
    emissiveIntensity: 0.95,
    roughness: 0.25,
    metalness: 0.7,
  });
  private rampMat = new THREE.MeshStandardNodeMaterial({
    color: '#fbbf24',
    emissive: '#d97706',
    emissiveIntensity: 0.85,
    roughness: 0.3,
  });
  private catwalkMat = new THREE.MeshStandardNodeMaterial({
    color: '#38bdf8',
    emissive: '#0284c7',
    emissiveIntensity: 0.55,
    transparent: true,
    opacity: 0.76,
    roughness: 0.25,
  });
  private gapMat = new THREE.MeshBasicNodeMaterial({
    color: '#0b1020',
  });
  private orbSmallGeo = new THREE.OctahedronGeometry(0.42, 0);
  private orbBigGeo = new THREE.OctahedronGeometry(0.68, 0);
  private orbSmallMat = new THREE.MeshStandardNodeMaterial({
    color: '#5eead4',
    emissive: '#14b8a6',
    emissiveIntensity: 1.15,
    roughness: 0.2,
  });
  private orbBigMat = new THREE.MeshStandardNodeMaterial({
    color: '#fde68a',
    emissive: '#f59e0b',
    emissiveIntensity: 1.35,
    roughness: 0.2,
  });
  private sparkGeo = new THREE.BoxGeometry(0.18, 0.18, 0.55);

  // Cinematic Camera State
  private camPos = new THREE.Vector3(0, 5, 11);
  private camLook = new THREE.Vector3(0, 2, -18);
  private camUp = new THREE.Vector3(0, 1, 0);
  private camRoll = 0;
  private camFov = 60;
  private camHeightCur = 4.2;
  private camBackCur = 8.4;
  private lastDeckStartS = -999;
  private lastCityCursorS = -999;
  private towerSeeds: Array<{ side: number; dist: number; height: number; width: number; depth: number; yOff: number }> = [];

  private dummyObj = new THREE.Object3D();

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGPURenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene.fog = new THREE.FogExp2('#1d2748', 0.0044);
    this.camera = new THREE.PerspectiveCamera(
      60,
      window.innerWidth / Math.max(1, window.innerHeight),
      0.3,
      460
    );

    // Balanced airy twilight lighting (clear visibility, soft contrast)
    const hemi = new THREE.HemisphereLight('#bae6fd', '#312e81', 1.35);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff7ed', 1.55);
    keyLight.position.set(25, 48, 25);
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#93c5fd', 0.85);
    rimLight.position.set(-30, 20, -35);
    this.scene.add(rimLight);

    // Custom TSL Sky Dome
    this.skyDome = new THREE.Mesh(
      new THREE.SphereGeometry(340, 28, 20),
      createSkyDomeNodeMaterial()
    );
    this.scene.add(this.skyDome);

    // Dynamic curving 3D Skyway Deck
    const { material: trackMat, uniforms } = createTrackNodeMaterial();
    this.trackUniforms = uniforms;
    this.initDeckGeometry(trackMat);

    // Instanced Cyber Skyline Towers & Overhead Neon Arches
    this.initSkylineCity();

    this.scene.add(this.runnerRig.root);
    this.scene.add(this.entityGroup);
    this.scene.add(this.particleGroup);
  }

  async init(): Promise<'WebGPU' | 'WebGL2'> {
    await this.renderer.init();
    const backend = this.renderer.backend as { isWebGPUBackend?: boolean } | undefined;
    this.backendLabel = backend?.isWebGPUBackend ? 'WebGPU' : 'WebGL2';

    // Tasteful HDR Bloom Pipeline (high threshold so only crisp accents softly glow!)
    try {
      const pp = new THREE.PostProcessing(this.renderer);
      const scenePass = pass(this.scene, this.camera);
      const scenePassColor = scenePass.getTextureNode('output');
      const bloomPass = bloom(scenePassColor, 0.22, 0.36, 1.15);
      pp.outputNode = scenePassColor.add(bloomPass);
      this.postProcessing = pp;
      this.bloomNode = bloomPass;
    } catch {
      this.postProcessing = null;
    }

    return this.backendLabel;
  }

  getBackendLabel(): 'WebGPU' | 'WebGL2' {
    return this.backendLabel;
  }

  resize(width: number, height: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  spawnStyleParticles(engine: ParkourEngine, event: StyleEvent): void {
    const pos = engine.track.trackToWorld(event.s, event.laneFloat, event.y);
    const count =
      event.kind === 'overdrive'
        ? 36
        : event.kind === 'smash' || event.kind === 'launch' || event.kind === 'wallKick'
          ? 20
          : event.kind === 'orb'
            ? 5
            : 12;

    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicNodeMaterial({
        color: event.color,
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(this.sparkGeo, mat);
      mesh.position.set(pos.x, pos.y, pos.z);
      const ang = (Math.PI * 2 * i) / count + Math.random() * 0.5;
      const spd = 4 + Math.random() * 9;
      this.particleGroup.add(mesh);
      this.sparks.push({
        mesh,
        vx: Math.cos(ang) * spd,
        vy: 3 + Math.random() * 8,
        vz: Math.sin(ang) * spd - engine.speed * 0.25,
        life: 0,
        maxLife: 0.35 + Math.random() * 0.3,
        gravity: 18,
      });
    }
  }

  render(engine: ParkourEngine, dt: number): void {
    // Update TSL Shader Uniforms dynamically!
    this.trackUniforms.overdrive.value +=
      ((engine.isOverdrive ? 1 : 0) - this.trackUniforms.overdrive.value) * Math.min(1, dt * 7);
    this.trackUniforms.speedFactor.value = engine.speed / 28;

    // Gentle WebGPU Bloom boost on Overdrive / Boost (stays comfortable on the eyes!)
    if (this.bloomNode) {
      const targetBloom = engine.isOverdrive
        ? 0.42
        : engine.boostTimer > 0 || engine.isWallRunning
          ? 0.3
          : 0.22;
      this.bloomNode.strength.value +=
        (targetBloom - this.bloomNode.strength.value) * Math.min(1, dt * 6);
    }

    // Stream the curving 3D deck mesh & instanced skyline along engine.s
    this.updateDynamicDeck(engine.track, engine.s);
    this.updateSkylineCity(engine.track, engine.s);

    // Keep sky dome centered on player
    const f = engine.currentFrame;
    this.skyDome.position.set(f.x, f.y, f.z);

    // Position & orient articulated runner on the banked 3D track!
    const playerWorld = engine.track.trackToWorld(engine.s, engine.lanePos, engine.y);
    this.runnerRig.root.position.set(playerWorld.x, playerWorld.y, playerWorld.z);
    this.orientObjectToFrame(this.runnerRig.root, playerWorld.frame);

    const floorY = engine.computeFloorHeightAt(engine.s, engine.lanePos) ?? 0;
    this.runnerRig.animate({
      action: engine.action,
      timeSec: engine.timeSec,
      speed: engine.speed,
      laneVel: engine.laneVel,
      flipProgress: engine.flipProgress,
      heightAboveFloor: Math.max(0, engine.y - floorY),
      isOverdrive: engine.isOverdrive,
      isInvincible: engine.invincibleTimer > 0,
      isTitle: engine.phase === 'title',
    });

    // Continuous kinetic sparks during Rail Grind, Wall-Run, and Power Slide!
    if (
      engine.phase === 'playing' &&
      (engine.action === 'grind' || engine.isWallRunning || engine.action === 'slide' || engine.isOverdrive)
    ) {
      if (Math.random() < dt * 42) {
        const sparkCol =
          engine.action === 'grind'
            ? '#ffd166'
            : engine.isWallRunning
              ? '#00f5ff'
              : engine.isOverdrive
                ? '#ffd166'
                : '#ff2e97';
        const mat = new THREE.MeshBasicNodeMaterial({
          color: sparkCol,
          transparent: true,
          opacity: 0.95,
        });
        const mesh = new THREE.Mesh(this.sparkGeo, mat);
        mesh.position.set(
          playerWorld.x + (Math.random() - 0.5) * 0.6,
          playerWorld.y + (engine.isWallRunning ? 0.9 : 0.2),
          playerWorld.z + (Math.random() - 0.5) * 0.6
        );
        this.particleGroup.add(mesh);
        this.sparks.push({
          mesh,
          vx: (Math.random() - 0.5) * 5 - f.fx * 6,
          vy: 2 + Math.random() * 4.5,
          vz: (Math.random() - 0.5) * 5 - f.fz * 6,
          life: 0,
          maxLife: 0.28,
          gravity: 14,
        });
      }
    }

    // Sync Gimmick Meshes & Orbs
    this.syncSegments(engine);
    this.syncOrbs(engine);
    this.updateSparks(dt);

    // Update Signature Cinematic Camerawork!
    this.updateCinematicCamera(engine, dt);

    if (this.postProcessing) {
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  /**
   * Signature Dynamic Camerawork:
   * - Title screen: Heroic sweeping skyline orbit around the runner!
   * - Wall-Run: Dramatic ±17° Dutch Roll + inward offset + wide FOV!
   * - Slide: Low ground-hugging action cam!
   * - Launch Ramp / Air Flip: Wide soaring aerial framing!
   * - Grind Rail: Stylish heroic close-up offset!
   * - Boost / Overdrive: Dynamic FOV stretch (60° → 78°) + micro impact shake!
   */
  private updateCinematicCamera(engine: ParkourEngine, dt: number): void {
    const f = engine.currentFrame;

    if (engine.phase === 'title') {
      const orbit = engine.timeSec * 0.42;
      const desiredPos = new THREE.Vector3(
        f.x + Math.sin(orbit) * 6.8,
        f.y + 3.2 + Math.sin(engine.timeSec * 0.9) * 0.45,
        f.z + Math.cos(orbit) * 6.8
      );
      const desiredLook = new THREE.Vector3(f.x, f.y + 1.5, f.z - 2.5);
      this.camPos.lerp(desiredPos, Math.min(1, dt * 4));
      this.camLook.lerp(desiredLook, Math.min(1, dt * 4));
      this.camUp.lerp(new THREE.Vector3(0, 1, 0), Math.min(1, dt * 5));
      this.camera.position.copy(this.camPos);
      this.camera.up.copy(this.camUp);
      this.camera.lookAt(this.camLook);
      return;
    }

    // Target camera offsets & dramatic roll per Parkour Action!
    let targetHeight = 4.35;
    let targetBack = 8.4;
    let targetFov = 62;
    let extraRoll = -engine.laneVel * 0.015;
    let extraLatOffset = (engine.lanePos - 1) * LANE_WIDTH * 0.56;
    let lookAheadM = 18;

    if (engine.action === 'wallRunLeft') {
      extraRoll = 0.28; // Dramatic Dutch tilt!
      targetHeight = 4.0;
      targetBack = 7.6;
      targetFov = 72;
      extraLatOffset += 1.35;
    } else if (engine.action === 'wallRunRight') {
      extraRoll = -0.28;
      targetHeight = 4.0;
      targetBack = 7.6;
      targetFov = 72;
      extraLatOffset -= 1.35;
    } else if (engine.action === 'slide') {
      targetHeight = 2.35; // Low speed-hugging slide camera!
      targetBack = 7.1;
      targetFov = 68;
    } else if (engine.action === 'grind') {
      targetHeight = 3.5;
      targetBack = 7.2;
      targetFov = 70;
      extraRoll += (engine.lanePos - 1) * 0.06;
    } else if (engine.action === 'flip' || engine.y > 4.2) {
      targetHeight = 5.4;
      targetBack = 10.6;
      targetFov = 74;
      lookAheadM = 24;
    }

    if (engine.boostTimer > 0) targetFov += 8;
    if (engine.isOverdrive) targetFov += 12;
    targetFov = Math.min(82, targetFov);

    // Smooth camera response
    const k = Math.min(1, dt * 9);
    this.camHeightCur += (targetHeight - this.camHeightCur) * k;
    this.camBackCur += (targetBack - this.camBackCur) * k;
    this.camFov += (targetFov - this.camFov) * Math.min(1, dt * 6);
    this.camRoll += (f.bankRad * 0.65 + extraRoll - this.camRoll) * Math.min(1, dt * 8);

    if (Math.abs(this.camera.fov - this.camFov) > 0.05) {
      this.camera.fov = this.camFov;
      this.camera.updateProjectionMatrix();
    }

    // Landing micro-dip & impact shake
    const dipY = -engine.landingImpact * 0.65;
    const shakeX = (Math.random() - 0.5) * engine.cameraShake * 0.9;
    const shakeY = (Math.random() - 0.5) * engine.cameraShake * 0.9;

    const trackedY = engine.y * 0.68;
    const desiredPos = new THREE.Vector3(
      f.x + f.rx * extraLatOffset - f.fx * this.camBackCur + f.ux * (this.camHeightCur + trackedY + dipY) + shakeX,
      f.y + f.ry * extraLatOffset - f.fy * this.camBackCur + f.uy * (this.camHeightCur + trackedY + dipY) + shakeY,
      f.z + f.rz * extraLatOffset - f.fz * this.camBackCur + f.uz * (this.camHeightCur + trackedY + dipY)
    );

    const aheadFrame = engine.track.sampleAt(engine.s + lookAheadM);
    const desiredLook = new THREE.Vector3(
      aheadFrame.x + aheadFrame.rx * (extraLatOffset * 0.4) + aheadFrame.ux * (1.8 + trackedY * 0.55),
      aheadFrame.y + aheadFrame.ry * (extraLatOffset * 0.4) + aheadFrame.uy * (1.8 + trackedY * 0.55),
      aheadFrame.z + aheadFrame.rz * (extraLatOffset * 0.4) + aheadFrame.uz * (1.8 + trackedY * 0.55)
    );

    this.camPos.lerp(desiredPos, Math.min(1, dt * 13));
    this.camLook.lerp(desiredLook, Math.min(1, dt * 13));

    // Apply banked + parkour Dutch-tilt camera UP vector!
    const cr = Math.cos(this.camRoll);
    const sr = Math.sin(this.camRoll);
    const worldUp = new THREE.Vector3(0, 1, 0);
    const camRight = new THREE.Vector3(f.rx, f.ry, f.rz).normalize();
    const tiltedUp = worldUp.multiplyScalar(cr).addScaledVector(camRight, -sr).normalize();
    this.camUp.lerp(tiltedUp, Math.min(1, dt * 10));

    this.camera.position.copy(this.camPos);
    this.camera.up.copy(this.camUp);
    this.camera.lookAt(this.camLook);
  }

  private initDeckGeometry(material: THREE.Material): void {
    const vertCount = (DECK_CHUNKS + 1) * 2;
    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);
    const uvs = new Float32Array(vertCount * 2);
    const indices: number[] = [];

    for (let i = 0; i < DECK_CHUNKS; i++) {
      const b = i * 2;
      indices.push(b, b + 1, b + 2);
      indices.push(b + 1, b + 3, b + 2);
    }

    this.deckGeometry = new THREE.BufferGeometry();
    this.deckGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.deckGeometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    this.deckGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.deckGeometry.setIndex(indices);

    this.deckMesh = new THREE.Mesh(this.deckGeometry, material);
    this.deckMesh.frustumCulled = false;
    this.scene.add(this.deckMesh);
  }

  /** Streams the curving, climbing, banking 3D skyway deck ahead of the runner! */
  private updateDynamicDeck(track: TrackPath3D, playerS: number): void {
    const startS = Math.floor((playerS - 18) / DECK_STEP_M) * DECK_STEP_M;
    if (startS === this.lastDeckStartS) return;
    this.lastDeckStartS = startS;

    const posAttr = this.deckGeometry.getAttribute('position') as THREE.BufferAttribute;
    const normAttr = this.deckGeometry.getAttribute('normal') as THREE.BufferAttribute;
    const uvAttr = this.deckGeometry.getAttribute('uv') as THREE.BufferAttribute;

    for (let i = 0; i <= DECK_CHUNKS; i++) {
      const s = startS + i * DECK_STEP_M;
      const f = track.sampleAt(s);
      const v0 = i * 2;
      const v1 = v0 + 1;

      posAttr.setXYZ(v0, f.x - f.rx * DECK_HALF_W, f.y - f.ry * DECK_HALF_W, f.z - f.rz * DECK_HALF_W);
      posAttr.setXYZ(v1, f.x + f.rx * DECK_HALF_W, f.y + f.ry * DECK_HALF_W, f.z + f.rz * DECK_HALF_W);

      normAttr.setXYZ(v0, f.ux, f.uy, f.uz);
      normAttr.setXYZ(v1, f.ux, f.uy, f.uz);

      const vCoord = s / 12;
      uvAttr.setXY(v0, 0, vCoord);
      uvAttr.setXY(v1, 1, vCoord);
    }

    posAttr.needsUpdate = true;
    normAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
  }

  /** Instanced cyber-skyline towers & neon skyway arches rushing past in WebGPU! */
  private initSkylineCity(): void {
    // Calm atmospheric twilight skyscrapers flanking the highway
    const towerGeo = new THREE.BoxGeometry(1, 1, 1);
    const towerMat = new THREE.MeshStandardNodeMaterial({
      color: '#1e2948',
      emissive: '#1e293b',
      emissiveIntensity: 0.25,
      roughness: 0.6,
      metalness: 0.35,
    });
    this.cityInstanced = new THREE.InstancedMesh(towerGeo, towerMat, CITY_TOWER_COUNT);
    this.cityInstanced.frustumCulled = false;

    const palette = [
      new THREE.Color('#334155'),
      new THREE.Color('#3b4c73'),
      new THREE.Color('#475569'),
      new THREE.Color('#313e63'),
    ];
    for (let i = 0; i < CITY_TOWER_COUNT; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const seed = (i * 16807) % 2147483647;
      const r1 = (seed % 1000) / 1000;
      const r2 = ((seed >> 5) % 1000) / 1000;
      this.towerSeeds.push({
        side,
        dist: 17 + r1 * 56,
        height: 22 + r2 * 80,
        width: 5 + r1 * 12,
        depth: 5 + r2 * 12,
        yOff: -35 + r1 * 14,
      });
      this.cityInstanced.setColorAt(i, palette[i % palette.length]);
    }
    this.scene.add(this.cityInstanced);

    // Sleek architectural skyway arches (calm subtle trim, well-spaced so no flashing!)
    const archGeo = new THREE.TorusGeometry(DECK_HALF_W + 1.6, 0.2, 8, 28, Math.PI);
    const archMat = new THREE.MeshStandardNodeMaterial({
      color: '#475569',
      emissive: '#38bdf8',
      emissiveIntensity: 0.42,
      roughness: 0.4,
    });
    this.archInstanced = new THREE.InstancedMesh(archGeo, archMat, 10);
    this.archInstanced.frustumCulled = false;
    this.scene.add(this.archInstanced);
  }

  private updateSkylineCity(track: TrackPath3D, playerS: number): void {
    const stepM = 12;
    const cursorS = Math.floor(playerS / stepM) * stepM;
    if (cursorS === this.lastCityCursorS) return;
    this.lastCityCursorS = cursorS;

    // Place instanced skyscrapers flanking the spline
    for (let i = 0; i < CITY_TOWER_COUNT; i++) {
      const s = cursorS - 30 + Math.floor(i / 2) * 3.0;
      const f = track.sampleAt(s);
      const t = this.towerSeeds[i];
      this.dummyObj.position.set(
        f.x + f.rx * t.side * t.dist,
        f.y + t.yOff + t.height * 0.5,
        f.z + f.rz * t.side * t.dist
      );
      this.dummyObj.rotation.set(0, f.yawRad, 0);
      this.dummyObj.scale.set(t.width, t.height, t.depth);
      this.dummyObj.updateMatrix();
      this.cityInstanced.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.cityInstanced.instanceMatrix.needsUpdate = true;

    // Place calm architectural arches every 48 meters
    const archStep = 48;
    const archBase = Math.floor(playerS / archStep) * archStep;
    for (let i = 0; i < 10; i++) {
      const s = archBase + (i - 1) * archStep;
      const f = track.sampleAt(s);
      this.dummyObj.position.set(f.x, f.y, f.z);
      this.orientObjectToFrame(this.dummyObj, f);
      this.dummyObj.scale.setScalar(1);
      this.dummyObj.updateMatrix();
      this.archInstanced.setMatrixAt(i, this.dummyObj.matrix);
    }
    this.archInstanced.instanceMatrix.needsUpdate = true;
  }

  private syncSegments(engine: ParkourEngine): void {
    const alive = new Set<number>();

    for (const seg of engine.segments) {
      alive.add(seg.id);
      let obj = this.segmentMeshes.get(seg.id);
      if (!obj) {
        obj = this.createSegmentObject(seg, engine.track);
        this.entityGroup.add(obj);
        this.segmentMeshes.set(seg.id, obj);
      }

      if (seg.smashed) {
        const t = seg.smashTime;
        const pos = engine.track.trackToWorld(seg.startS, seg.lane, seg.elevationY);
        obj.position.set(
          pos.x + pos.frame.rx * seg.smashDir * t * 18,
          pos.y + Math.max(0, t * 16 - 18 * t * t),
          pos.z + pos.frame.fz * t * 24
        );
        obj.rotation.x += 0.22;
        obj.rotation.z += 0.25;
      }
    }

    for (const [id, obj] of this.segmentMeshes) {
      if (!alive.has(id)) {
        this.entityGroup.remove(obj);
        this.segmentMeshes.delete(id);
      }
    }
  }

  private createSegmentObject(seg: TrackSegmentEntity, track: TrackPath3D): THREE.Object3D {
    const length = Math.max(1.5, seg.endS - seg.startS);

    // Long spline-following gimmicks: Wall-Run Billboard, Grind Rail, Catwalk, Floor Chasm!
    if (seg.kind === 'wallRun' || seg.kind === 'rail' || seg.kind === 'catwalk' || seg.kind === 'gap') {
      const group = new THREE.Group();
      const steps = Math.max(4, Math.ceil(length / 3.2));
      for (let i = 0; i < steps; i++) {
        const s0 = seg.startS + (length * i) / steps;
        const s1 = seg.startS + (length * (i + 1)) / steps;
        const sMid = (s0 + s1) * 0.5;
        const segLen = Math.max(0.5, s1 - s0) + 0.12;

        if (seg.kind === 'wallRun') {
          // Vertical glowing holographic billboard on the outer side of Lane 0 or Lane 2!
          const sideSign = seg.lane === 0 ? -1 : 1;
          const wallLane = seg.lane + sideSign * 0.54;
          const pos = track.trackToWorld(sMid, wallLane, 2.35);
          const panel = new THREE.Mesh(new THREE.PlaneGeometry(segLen, 3.6), this.wallRunMat);
          panel.position.set(pos.x, pos.y, pos.z);
          this.orientObjectToFrame(panel, pos.frame);
          panel.rotateY(sideSign < 0 ? Math.PI / 2 : -Math.PI / 2);
          group.add(panel);
        } else if (seg.kind === 'rail') {
          const pos = track.trackToWorld(sMid, seg.lane, seg.elevationY);
          const bar = new THREE.Mesh(
            new THREE.CylinderGeometry(0.14, 0.14, segLen, 8).rotateX(Math.PI / 2),
            this.railMat
          );
          bar.position.set(pos.x, pos.y, pos.z);
          this.orientObjectToFrame(bar, pos.frame);
          group.add(bar);

          if (i === 0 || i === steps - 1 || i % 3 === 0) {
            const postPos = track.trackToWorld(sMid, seg.lane, seg.elevationY * 0.5);
            const post = new THREE.Mesh(
              new THREE.BoxGeometry(0.16, seg.elevationY, 0.16),
              this.pillarMat
            );
            post.position.set(postPos.x, postPos.y, postPos.z);
            this.orientObjectToFrame(post, postPos.frame);
            group.add(post);
          }
        } else if (seg.kind === 'catwalk') {
          const pos = track.trackToWorld(sMid, seg.lane, seg.elevationY - 0.12);
          const deck = new THREE.Mesh(
            new THREE.BoxGeometry(LANE_WIDTH * 0.88, 0.24, segLen),
            this.catwalkMat
          );
          deck.position.set(pos.x, pos.y, pos.z);
          this.orientObjectToFrame(deck, pos.frame);
          group.add(deck);
        } else {
          // Chasm gap dark energy void overlay
          const pos = track.trackToWorld(sMid, seg.lane, 0.05);
          const pit = new THREE.Mesh(
            new THREE.BoxGeometry(LANE_WIDTH * 0.94, 0.14, segLen),
            this.gapMat
          );
          pit.position.set(pos.x, pos.y, pos.z);
          this.orientObjectToFrame(pit, pos.frame);
          group.add(pit);
        }
      }
      return group;
    }

    // Point / compact gimmicks oriented cleanly onto the banked 3D deck!
    const midS = (seg.startS + seg.endS) * 0.5;
    const pos = track.trackToWorld(midS, seg.lane, seg.elevationY);
    const holder = new THREE.Group();
    holder.position.set(pos.x, pos.y, pos.z);
    this.orientObjectToFrame(holder, pos.frame);

    if (seg.kind === 'hurdle') {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.82, 0.42, 0.35), this.hurdleMat);
      bar.position.y = 0.95;
      const legL = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.15, 0.32), this.pillarMat);
      legL.position.set(-LANE_WIDTH * 0.36, 0.58, 0);
      const legR = legL.clone();
      legR.position.x = LANE_WIDTH * 0.36;
      holder.add(bar, legL, legR);
    } else if (seg.kind === 'laserHigh') {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.86, 0.36, 0.26), this.laserMat);
      beam.position.y = 0.55; // relative to seg.elevationY (1.55m), leaving bottom wide open to slide!
      const beam2 = beam.clone();
      beam2.position.y = 1.15;
      const postL = new THREE.Mesh(new THREE.BoxGeometry(0.24, 3.0, 0.24), this.pillarMat);
      postL.position.set(-LANE_WIDTH * 0.44, -0.05, 0);
      const postR = postL.clone();
      postR.position.x = LANE_WIDTH * 0.44;
      holder.add(beam, beam2, postL, postR);
    } else if (seg.kind === 'pillar') {
      const mono = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.72, 3.6, 1.35), this.pillarMat);
      mono.position.y = 1.8;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.78, 0.26, 1.45), this.laserMat);
      cap.position.y = 3.55;
      holder.add(mono, cap);
    } else if (seg.kind === 'jumpRamp') {
      const ramp = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH * 0.84, 0.32, 4.4), this.rampMat);
      ramp.rotation.x = 0.28;
      ramp.position.set(0, 0.65, 0);
      holder.add(ramp);
    } else if (seg.kind === 'boostPad') {
      const pad = new THREE.Mesh(new THREE.PlaneGeometry(LANE_WIDTH * 0.84, length), this.boostMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.y = 0.08;
      holder.add(pad);
    }

    return holder;
  }

  private syncOrbs(engine: ParkourEngine): void {
    const alive = new Set<number>();
    for (const orb of engine.orbs) {
      if (orb.collected) continue;
      alive.add(orb.id);
      let mesh = this.orbMeshes.get(orb.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          orb.isBig ? this.orbBigGeo : this.orbSmallGeo,
          orb.isBig ? this.orbBigMat : this.orbSmallMat
        );
        const pos = engine.track.trackToWorld(orb.s, orb.lane, orb.y);
        mesh.position.set(pos.x, pos.y, pos.z);
        this.entityGroup.add(mesh);
        this.orbMeshes.set(orb.id, mesh);
      }
      mesh.rotation.y = engine.timeSec * 3.2 + orb.id * 0.4;
      mesh.rotation.x = Math.sin(engine.timeSec * 2.5 + orb.id) * 0.35;
    }

    for (const [id, mesh] of this.orbMeshes) {
      if (!alive.has(id)) {
        this.entityGroup.remove(mesh);
        this.orbMeshes.delete(id);
      }
    }
  }

  private updateSparks(dt: number): void {
    for (const s of this.sparks) {
      s.life += dt;
      s.vy -= s.gravity * dt;
      s.mesh.position.x += s.vx * dt;
      s.mesh.position.y += s.vy * dt;
      s.mesh.position.z += s.vz * dt;
      s.mesh.rotation.x += 8 * dt;
      s.mesh.rotation.y += 6 * dt;
      const mat = s.mesh.material as THREE.MeshBasicNodeMaterial;
      mat.opacity = Math.max(0, 1 - s.life / s.maxLife);
    }
    this.sparks = this.sparks.filter((s) => {
      if (s.life >= s.maxLife) {
        this.particleGroup.remove(s.mesh);
        (s.mesh.material as THREE.Material).dispose();
        return false;
      }
      return true;
    });
  }

  /** Align an object's local (+X=right, +Y=up, -Z=forward) basis exactly with a banked TrackFrame3D */
  private orientObjectToFrame(obj: THREE.Object3D, f: TrackFrame3D): void {
    const m = new THREE.Matrix4().makeBasis(
      new THREE.Vector3(f.rx, f.ry, f.rz),
      new THREE.Vector3(f.ux, f.uy, f.uz),
      new THREE.Vector3(-f.fx, -f.fy, -f.fz)
    );
    obj.quaternion.setFromRotationMatrix(m);
  }
}
