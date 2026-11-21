import * as THREE from 'three/webgpu';
import type { ParkourAction } from '../types';

/**
 * Stylized articulated 3D Cyber-Parkour Runner with glowing neon visor, hover-boots,
 * flowing luminous scarf ribbon, and procedural animation for every parkour move!
 */
export class ParkourRunnerRig {
  readonly root = new THREE.Group();
  readonly tiltGroup = new THREE.Group();
  readonly flipGroup = new THREE.Group();
  readonly hips = new THREE.Group();

  private torso = new THREE.Group();
  private head = new THREE.Group();
  private leftArm = new THREE.Group();
  private rightArm = new THREE.Group();
  private leftLeg = new THREE.Group();
  private rightLeg = new THREE.Group();
  private scarfSegments: THREE.Mesh[] = [];

  private neonMat: THREE.MeshStandardNodeMaterial;
  private auraMesh: THREE.Mesh;
  readonly shadowMesh: THREE.Mesh;

  private normalNeon = new THREE.Color('#00f5ff');
  private overdriveNeon = new THREE.Color('#ffd166');
  private hitNeon = new THREE.Color('#ff2e63');

  constructor() {
    this.root.add(this.tiltGroup);
    this.tiltGroup.add(this.flipGroup);
    this.flipGroup.add(this.hips);
    this.hips.position.y = 0.95;

    const suitDark = new THREE.MeshStandardNodeMaterial({
      color: '#111827',
      roughness: 0.35,
      metalness: 0.65,
    });
    const armorWhite = new THREE.MeshStandardNodeMaterial({
      color: '#e2e8f0',
      roughness: 0.25,
      metalness: 0.45,
    });
    this.neonMat = new THREE.MeshStandardNodeMaterial({
      color: '#38bdf8',
      emissive: '#38bdf8',
      emissiveIntensity: 1.05,
      roughness: 0.22,
    });
    const magentaTrim = new THREE.MeshStandardNodeMaterial({
      color: '#f472b6',
      emissive: '#ec4899',
      emissiveIntensity: 0.85,
      roughness: 0.25,
    });

    // Grounded soft contact shadow
    this.shadowMesh = new THREE.Mesh(
      new THREE.CircleGeometry(0.85, 20),
      new THREE.MeshBasicNodeMaterial({
        color: '#000000',
        transparent: true,
        opacity: 0.42,
        depthWrite: false,
      })
    );
    this.shadowMesh.rotation.x = -Math.PI / 2;
    this.shadowMesh.position.y = 0.04;
    this.root.add(this.shadowMesh);

    // Torso
    this.hips.add(this.torso);
    const chest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.62, 0.32), armorWhite);
    chest.position.y = 0.34;
    const spineCore = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.46, 0.36), this.neonMat);
    spineCore.position.y = 0.35;
    const belt = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.14, 0.34), suitDark);
    belt.position.y = 0.02;
    this.torso.add(chest, spineCore, belt);

    // Head + Glowing Cyber Visor
    this.head.position.set(0, 0.72, 0);
    this.torso.add(this.head);
    const helmet = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.42), armorWhite);
    helmet.position.y = 0.16;
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.24), this.neonMat);
    visor.position.set(0, 0.18, -0.12);
    this.head.add(helmet, visor);

    // Flowing Neon Energy Scarf trailing behind neck!
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(
        new THREE.BoxGeometry(0.24 - i * 0.03, 0.06, 0.36),
        i % 2 === 0 ? magentaTrim : this.neonMat
      );
      seg.position.set(0, 0.62 - i * 0.06, 0.24 + i * 0.28);
      this.torso.add(seg);
      this.scarfSegments.push(seg);
    }

    // Arms
    this.leftArm.position.set(-0.38, 0.56, 0);
    this.rightArm.position.set(0.38, 0.56, 0);
    this.torso.add(this.leftArm, this.rightArm);
    for (const arm of [this.leftArm, this.rightArm]) {
      const upper = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.54, 0.16), suitDark);
      upper.position.y = -0.24;
      const cuff = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.12, 0.19), this.neonMat);
      cuff.position.y = -0.44;
      arm.add(upper, cuff);
    }

    // Legs + Glowing Hover-Boots
    this.leftLeg.position.set(-0.17, -0.02, 0);
    this.rightLeg.position.set(0.17, -0.02, 0);
    this.hips.add(this.leftLeg, this.rightLeg);
    for (const leg of [this.leftLeg, this.rightLeg]) {
      const limb = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.22), suitDark);
      limb.position.y = -0.36;
      const knee = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.24), armorWhite);
      knee.position.y = -0.36;
      const boot = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.22, 0.36), this.neonMat);
      boot.position.set(0, -0.82, -0.05);
      leg.add(limb, knee, boot);
    }

    // Overdrive holographic energy aura shell
    this.auraMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.35, 1),
      new THREE.MeshBasicNodeMaterial({
        color: '#ffd166',
        wireframe: true,
        transparent: true,
        opacity: 0.45,
      })
    );
    this.auraMesh.position.y = 1.05;
    this.auraMesh.visible = false;
    this.tiltGroup.add(this.auraMesh);
  }

  animate(params: {
    action: ParkourAction;
    timeSec: number;
    speed: number;
    laneVel: number;
    flipProgress: number;
    heightAboveFloor: number;
    isOverdrive: boolean;
    isInvincible: boolean;
    isTitle: boolean;
  }): void {
    const {
      action,
      timeSec,
      speed,
      laneVel,
      flipProgress,
      heightAboveFloor,
      isOverdrive,
      isInvincible,
      isTitle,
    } = params;

    // Color state (Normal cyan -> Overdrive gold -> Invincible hit flash)
    const targetColor = isOverdrive
      ? this.overdriveNeon
      : isInvincible && Math.floor(timeSec * 16) % 2 === 0
        ? this.hitNeon
        : this.normalNeon;
    this.neonMat.color.copy(targetColor);
    this.neonMat.emissive.copy(targetColor);
    this.neonMat.emissiveIntensity = isOverdrive ? 1.55 : 1.0;

    this.auraMesh.visible = isOverdrive;
    if (isOverdrive) {
      this.auraMesh.rotation.y = timeSec * 4.5;
      this.auraMesh.rotation.x = timeSec * 2.5;
      const s = 1 + Math.sin(timeSec * 16) * 0.08;
      this.auraMesh.scale.setScalar(s);
    }

    // Blink lightly when recovering from shield hit
    this.hips.visible = !(isInvincible && !isOverdrive && Math.floor(timeSec * 18) % 2 === 0);

    // Shadow stays grounded beneath runner
    this.shadowMesh.position.y = Math.max(0.04, 0.04 - heightAboveFloor);
    const shScale = Math.max(0.35, 1 - heightAboveFloor * 0.12);
    this.shadowMesh.scale.setScalar(shScale);

    // Scarf waves heroically in the wind!
    for (let i = 0; i < this.scarfSegments.length; i++) {
      const seg = this.scarfSegments[i];
      const waveSpeed = isTitle ? 5 : 16 + speed * 0.25;
      seg.position.x = Math.sin(timeSec * waveSpeed - i * 0.9) * (0.06 + i * 0.045);
      seg.position.y = 0.62 - i * 0.04 + Math.cos(timeSec * waveSpeed * 0.8 - i) * 0.04;
    }

    // Reset default pivots
    this.flipGroup.rotation.set(0, 0, 0);
    this.hips.rotation.set(0, 0, 0);
    this.torso.rotation.set(0, 0, 0);

    // Athletic lateral lean when dodging between lanes
    let targetRoll = Math.max(-0.34, Math.min(0.34, -laneVel * 0.045));
    let targetYaw = Math.max(-0.28, Math.min(0.28, -laneVel * 0.035));

    if (isTitle) {
      // Heroic rooftop idle stance
      this.hips.position.y = 0.96 + Math.sin(timeSec * 3.2) * 0.04;
      this.torso.rotation.x = 0.12;
      this.leftLeg.rotation.set(0.15, 0, -0.06);
      this.rightLeg.rotation.set(-0.22, 0, 0.06);
      this.leftArm.rotation.set(-0.35, 0, -0.18);
      this.rightArm.rotation.set(0.28, 0, 0.18);
      this.tiltGroup.rotation.set(0, 0, 0);
      return;
    }

    if (action === 'wallRunLeft' || action === 'wallRunRight') {
      // Dramatic 42-degree wall-run body tilt + rapid pumping stride!
      const side = action === 'wallRunLeft' ? -1 : 1;
      targetRoll = -side * 0.72;
      const stride = Math.sin(timeSec * 22);
      this.hips.position.y = 0.96 + Math.abs(stride) * 0.09;
      this.torso.rotation.x = 0.34;
      this.leftLeg.rotation.set(stride * 1.15, 0, 0);
      this.rightLeg.rotation.set(-stride * 1.15, 0, 0);
      this.leftArm.rotation.set(-stride * 0.95, 0, -0.25);
      this.rightArm.rotation.set(stride * 0.95, 0, 0.25);
    } else if (action === 'grind') {
      // Stylish sideways hover-rail grind crouch with balancing outstretched arms!
      const bob = Math.sin(timeSec * 14) * 0.05;
      this.hips.position.y = 0.78 + bob;
      this.hips.rotation.y = 0.78; // Sideways board stance!
      this.torso.rotation.x = 0.25;
      this.leftLeg.rotation.set(0.32, 0, -0.25);
      this.rightLeg.rotation.set(-0.28, 0, 0.25);
      this.leftArm.rotation.set(0.15, 0, -1.05 + Math.sin(timeSec * 9) * 0.12);
      this.rightArm.rotation.set(-0.15, 0, 1.05 - Math.sin(timeSec * 9) * 0.12);
    } else if (action === 'slide') {
      // Low parkour power-slide leaning back under lasers!
      this.hips.position.y = 0.36;
      this.torso.rotation.x = -0.88;
      this.leftLeg.rotation.set(-1.35, 0, -0.1);
      this.rightLeg.rotation.set(-0.45, 0, 0.28);
      this.leftArm.rotation.set(0.75, 0, -0.45);
      this.rightArm.rotation.set(-0.45, 0, 0.45);
    } else if (action === 'flip' || action === 'doubleJump') {
      // Full 360-degree tucked aerial front-flip!
      this.hips.position.y = 1.02;
      this.flipGroup.rotation.x = -flipProgress * Math.PI * 2;
      this.torso.rotation.x = 0.45;
      this.leftLeg.rotation.set(-0.95, 0, 0);
      this.rightLeg.rotation.set(-0.75, 0, 0);
      this.leftArm.rotation.set(-0.6, 0, -0.35);
      this.rightArm.rotation.set(-0.6, 0, 0.35);
    } else if (action === 'jump' || action === 'fastFall') {
      // Athletic mid-air parkour vault / dive pose
      this.hips.position.y = 1.0;
      this.torso.rotation.x = action === 'fastFall' ? 0.55 : 0.22;
      this.leftLeg.rotation.set(-0.65, 0, -0.06);
      this.rightLeg.rotation.set(0.45, 0, 0.06);
      this.leftArm.rotation.set(-0.95, 0, -0.22);
      this.rightArm.rotation.set(0.7, 0, 0.22);
    } else {
      // High-energy sprint cycle scaled to actual speed!
      const freq = 10 + speed * 0.22;
      const stride = Math.sin(timeSec * freq);
      this.hips.position.y = 0.94 + Math.abs(stride) * 0.1;
      this.torso.rotation.x = 0.28 + Math.min(0.18, (speed - 28) * 0.008);
      this.leftLeg.rotation.set(stride * 1.1, 0, 0);
      this.rightLeg.rotation.set(-stride * 1.1, 0, 0);
      this.leftArm.rotation.set(-stride * 1.0, 0, -0.15);
      this.rightArm.rotation.set(stride * 1.0, 0, 0.15);
    }

    this.tiltGroup.rotation.z += (targetRoll - this.tiltGroup.rotation.z) * 0.25;
    this.tiltGroup.rotation.y += (targetYaw - this.tiltGroup.rotation.y) * 0.25;
  }
}
