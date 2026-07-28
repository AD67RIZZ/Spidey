import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
const EPSILON = 1e-5;

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function dampAngle(current, target, lambda, dt) {
  let delta = (target - current + Math.PI) % (Math.PI * 2);
  if (delta < 0) delta += Math.PI * 2;
  delta -= Math.PI;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function makeLimb(geometry, material, x, y, z) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = -0.48;
  mesh.castShadow = true;
  pivot.add(mesh);
  return pivot;
}

/**
 * Lightweight capsule-like controller and Aero's original low-poly model.
 * `group.position` is the hero's feet, which keeps rooftop collision simple.
 */
export class Player {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'Aero';
    this.group.rotation.order = 'YXZ';
    this.velocity = new THREE.Vector3();
    this.radius = 0.52;
    this.height = 2.35;
    this.grounded = false;
    this.justLanded = false;
    this.landingImpact = 0;
    this.justJumped = false;
    this.distanceTravelled = 0;
    this._visualTime = 0;
    this._lastHorizontalSpeed = 0;

    this._oldPosition = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._horizontal = new THREE.Vector3();
    this._change = new THREE.Vector3();
    this._stepDelta = new THREE.Vector3();
    this._facing = new THREE.Vector3(0, 0, -1);

    this._buildModel();
    scene.add(this.group);
  }

  get position() {
    return this.group.position;
  }

  get speed() {
    return this.velocity.length();
  }

  get horizontalSpeed() {
    return Math.hypot(this.velocity.x, this.velocity.z);
  }

  _buildModel() {
    const charcoal = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.58,
      metalness: 0.35,
    });
    const purple = new THREE.MeshStandardMaterial({
      color: 0x6f3cff,
      roughness: 0.42,
      metalness: 0.45,
    });
    const white = new THREE.MeshStandardMaterial({
      color: 0xeafcff,
      roughness: 0.32,
      metalness: 0.65,
    });
    const orange = new THREE.MeshStandardMaterial({
      color: 0xff8a34,
      emissive: 0x6b2100,
      emissiveIntensity: 0.65,
      roughness: 0.38,
    });
    const cyan = new THREE.MeshStandardMaterial({
      color: 0x8df6ff,
      emissive: 0x16d9ff,
      emissiveIntensity: 2.2,
      roughness: 0.22,
      metalness: 0.25,
    });
    this.materials = [charcoal, purple, white, orange, cyan];

    const model = new THREE.Group();
    model.name = 'AeroModel';
    this.model = model;
    this.group.add(model);

    const torso = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.32, 0.86, 7),
      purple,
    );
    torso.position.y = 1.54;
    torso.castShadow = true;
    model.add(torso);

    const chestPanel = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 0.32, 0.07),
      charcoal,
    );
    chestPanel.position.set(0, 1.62, -0.38);
    chestPanel.rotation.x = -0.08;
    chestPanel.castShadow = true;
    model.add(chestPanel);

    const core = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.1, 0),
      orange,
    );
    core.position.set(0, 1.62, -0.435);
    core.rotation.z = Math.PI * 0.25;
    model.add(core);
    this.core = core;

    const belt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.34, 0.12, 8),
      orange,
    );
    belt.position.y = 1.08;
    belt.castShadow = true;
    model.add(belt);

    const head = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.34, 0),
      white,
    );
    head.scale.set(0.92, 1.12, 0.98);
    head.position.y = 2.18;
    head.castShadow = true;
    model.add(head);

    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.13, 0.055),
      cyan,
    );
    visor.position.set(0, 2.2, -0.3);
    visor.rotation.x = -0.04;
    model.add(visor);

    const cablePack = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.46, 0.18),
      charcoal,
    );
    cablePack.position.set(0, 1.58, 0.37);
    cablePack.castShadow = true;
    model.add(cablePack);

    const packGlow = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.28, 0.035),
      cyan,
    );
    packGlow.position.set(0, 1.58, 0.47);
    model.add(packGlow);

    const armGeometry = new THREE.CylinderGeometry(0.105, 0.125, 0.92, 6);
    const legGeometry = new THREE.CylinderGeometry(0.14, 0.17, 0.94, 7);
    this.leftArm = makeLimb(armGeometry, white, -0.43, 1.86, 0);
    this.rightArm = makeLimb(armGeometry, white, 0.43, 1.86, 0);
    this.leftLeg = makeLimb(legGeometry, charcoal, -0.18, 1.04, 0);
    this.rightLeg = makeLimb(legGeometry, charcoal, 0.18, 1.04, 0);
    this.leftArm.rotation.z = -0.12;
    this.rightArm.rotation.z = 0.12;
    model.add(this.leftArm, this.rightArm, this.leftLeg, this.rightLeg);

    const bootGeometry = new THREE.BoxGeometry(0.27, 0.2, 0.43);
    const leftBoot = new THREE.Mesh(bootGeometry, orange);
    const rightBoot = new THREE.Mesh(bootGeometry, orange);
    leftBoot.position.set(-0.18, 0.13, -0.08);
    rightBoot.position.set(0.18, 0.13, -0.08);
    leftBoot.castShadow = true;
    rightBoot.castShadow = true;
    model.add(leftBoot, rightBoot);

    const shadowMaterial = new THREE.MeshBasicMaterial({
      color: 0x05070d,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.shadow = new THREE.Mesh(
      new THREE.CircleGeometry(0.7, 18),
      shadowMaterial,
    );
    this.shadow.rotation.x = -Math.PI * 0.5;
    this.shadow.position.y = 0.018;
    this.shadow.renderOrder = 1;
    this.group.add(this.shadow);
  }

  reset(position) {
    this.position.copy(position);
    this.velocity.set(0, 0, 0);
    this.grounded = false;
    this.justLanded = false;
    this.landingImpact = 0;
    this.justJumped = false;
    this.distanceTravelled = 0;
    this.model.rotation.set(0, 0, 0);
  }

  /**
   * Advances custom movement physics and returns event flags for audio/VFX.
   */
  updatePhysics(dt, options) {
    const {
      moveWorld,
      sprint,
      jump,
      colliders,
      groundLevel = 0,
      swing,
    } = options;
    const delta = Math.min(Math.max(dt, 0), 0.05);

    this.justLanded = false;
    this.justJumped = false;
    this.landingImpact = 0;

    const hasMove = moveWorld.lengthSq() > EPSILON;
    this._horizontal.set(this.velocity.x, 0, this.velocity.z);

    if (hasMove) {
      if (this.grounded && !swing?.active) {
        const targetSpeed = sprint ? 17.5 : 11.5;
        this._desired.copy(moveWorld).multiplyScalar(targetSpeed);
        this._change.subVectors(this._desired, this._horizontal);
        const maxChange = 42 * delta;
        if (this._change.lengthSq() > maxChange * maxChange) {
          this._change.setLength(maxChange);
        }
        this.velocity.x += this._change.x;
        this.velocity.z += this._change.z;
      } else {
        // Air and cable steering adds direction without erasing earned momentum.
        const speedBeforeSteering = this._horizontal.length();
        const airAcceleration = swing?.active ? 14.5 : 9.5;
        this.velocity.addScaledVector(moveWorld, airAcceleration * delta);
        this._horizontal.set(this.velocity.x, 0, this.velocity.z);
        const airCap = sprint ? 39 : 33;
        const preservedCap = Math.max(airCap, speedBeforeSteering);
        if (this._horizontal.length() > preservedCap) {
          this._horizontal.setLength(preservedCap);
          this.velocity.x = this._horizontal.x;
          this.velocity.z = this._horizontal.z;
        }
      }
    } else if (this.grounded && !swing?.active) {
      const friction = Math.exp(-10.5 * delta);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
      if (Math.abs(this.velocity.x) < 0.01) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.01) this.velocity.z = 0;
    }

    if (jump && this.grounded) {
      this.velocity.y = 13.2;
      this.grounded = false;
      this.justJumped = true;
    }

    this.velocity.y = Math.max(this.velocity.y - 30 * delta, -55);
    swing?.applyForces(this, delta, moveWorld);

    const steps = Math.min(4, Math.max(1, Math.ceil(delta / 0.0125)));
    const step = delta / steps;
    this.grounded = false;

    for (let index = 0; index < steps; index += 1) {
      this._oldPosition.copy(this.position);
      this._stepDelta.copy(this.velocity).multiplyScalar(step);
      this.position.add(this._stepDelta);
      this.distanceTravelled += this._stepDelta.length();
      swing?.constrain(this, step);
      this._resolveCollisions(this._oldPosition, colliders, groundLevel);
    }

    this._lastHorizontalSpeed = this.horizontalSpeed;
    return {
      jumped: this.justJumped,
      landed: this.justLanded,
      landingImpact: this.landingImpact,
    };
  }

  _resolveCollisions(oldPosition, colliders, groundLevel) {
    const root = this.position;
    const fallingSpeed = -this.velocity.y;

    if (root.y <= groundLevel && this.velocity.y <= 0) {
      if (oldPosition.y > groundLevel + 0.08 && fallingSpeed > 4) {
        this.justLanded = true;
        this.landingImpact = Math.max(this.landingImpact, fallingSpeed);
      }
      root.y = groundLevel;
      this.velocity.y = 0;
      this.grounded = true;
    }

    for (let index = 0; index < colliders.length; index += 1) {
      const box = colliders[index];
      const left = box.minX - this.radius;
      const right = box.maxX + this.radius;
      const near = box.minZ - this.radius;
      const far = box.maxZ + this.radius;
      const withinX = root.x > left && root.x < right;
      const withinZ = root.z > near && root.z < far;
      if (!withinX || !withinZ) continue;

      const landedOnTop =
        this.velocity.y <= 0 &&
        oldPosition.y >= box.top - 0.12 &&
        root.y <= box.top + 0.16;

      if (landedOnTop) {
        if (oldPosition.y > box.top + 0.08 && fallingSpeed > 4) {
          this.justLanded = true;
          this.landingImpact = Math.max(this.landingImpact, fallingSpeed);
        }
        root.y = box.top;
        this.velocity.y = 0;
        this.grounded = true;
        continue;
      }

      const overlapsVertically =
        root.y < box.top - 0.04 && root.y + this.height > box.bottom + 0.04;
      if (!overlapsVertically) continue;

      if (oldPosition.x <= left + 0.02) {
        root.x = left;
        if (this.velocity.x > 0) this.velocity.x = 0;
        continue;
      }
      if (oldPosition.x >= right - 0.02) {
        root.x = right;
        if (this.velocity.x < 0) this.velocity.x = 0;
        continue;
      }
      if (oldPosition.z <= near + 0.02) {
        root.z = near;
        if (this.velocity.z > 0) this.velocity.z = 0;
        continue;
      }
      if (oldPosition.z >= far - 0.02) {
        root.z = far;
        if (this.velocity.z < 0) this.velocity.z = 0;
        continue;
      }

      const penetrations = [
        { amount: root.x - left, axis: 'x', value: left, sign: 1 },
        { amount: right - root.x, axis: 'x', value: right, sign: -1 },
        { amount: root.z - near, axis: 'z', value: near, sign: 1 },
        { amount: far - root.z, axis: 'z', value: far, sign: -1 },
      ];
      let smallest = penetrations[0];
      for (let p = 1; p < penetrations.length; p += 1) {
        if (penetrations[p].amount < smallest.amount) smallest = penetrations[p];
      }
      root[smallest.axis] = smallest.value;
      if (this.velocity[smallest.axis] * smallest.sign > 0) {
        this.velocity[smallest.axis] = 0;
      }
    }
  }

  updateVisual(dt, swingActive) {
    const delta = Math.min(dt, 0.05);
    const speed = this.horizontalSpeed;
    this._visualTime += delta * (2.4 + speed * 0.38);

    if (speed > 0.3) {
      this._facing.set(this.velocity.x, 0, this.velocity.z).normalize();
      const targetYaw = Math.atan2(this._facing.x, this._facing.z);
      this.group.rotation.y = dampAngle(
        this.group.rotation.y,
        targetYaw,
        swingActive ? 4.5 : 10,
        delta,
      );
    }

    const runAmount = this.grounded ? Math.min(speed / 8, 1) : 0;
    const stride = Math.sin(this._visualTime) * 0.72 * runAmount;
    const airborneLeg = this.grounded ? 0 : 0.28;
    this.leftLeg.rotation.x = damp(
      this.leftLeg.rotation.x,
      stride + airborneLeg,
      12,
      delta,
    );
    this.rightLeg.rotation.x = damp(
      this.rightLeg.rotation.x,
      -stride - airborneLeg,
      12,
      delta,
    );

    const armTarget = swingActive ? -2.45 : -stride * 0.7;
    this.leftArm.rotation.x = damp(this.leftArm.rotation.x, armTarget, 11, delta);
    this.rightArm.rotation.x = damp(
      this.rightArm.rotation.x,
      swingActive ? -2.15 : stride * 0.7,
      11,
      delta,
    );
    this.leftArm.rotation.z = damp(
      this.leftArm.rotation.z,
      swingActive ? -0.32 : -0.12,
      9,
      delta,
    );
    this.rightArm.rotation.z = damp(
      this.rightArm.rotation.z,
      swingActive ? 0.08 : 0.12,
      9,
      delta,
    );

    const lean = THREE.MathUtils.clamp(-this.velocity.y * 0.012, -0.26, 0.32);
    this.model.rotation.x = damp(
      this.model.rotation.x,
      swingActive ? lean - 0.18 : lean * 0.35,
      7,
      delta,
    );
    this.model.rotation.z = damp(
      this.model.rotation.z,
      swingActive ? THREE.MathUtils.clamp(-this.velocity.x * 0.01, -0.22, 0.22) : 0,
      7,
      delta,
    );

    const bob = this.grounded ? Math.abs(Math.sin(this._visualTime)) * 0.025 * runAmount : 0;
    this.model.position.y = bob;
    this.core.rotation.y += delta * 3.5;
    this.core.scale.setScalar(1 + Math.sin(this._visualTime * 0.6) * 0.1);
    this.shadow.visible = this.grounded;
    this.shadow.scale.setScalar(1 + Math.min(speed / 35, 0.35));
  }

  dispose() {
    this.group.traverse((object) => {
      object.geometry?.dispose?.();
    });
    this.materials.forEach((material) => material.dispose());
    this.shadow.material.dispose();
    this.group.removeFromParent();
  }
}
