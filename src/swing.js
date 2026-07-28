import * as THREE from 'three';

const CHEST_OFFSET = new THREE.Vector3(0, 1.52, 0);

/**
 * Camera-aimed cable targeting plus a momentum-preserving rope constraint.
 */
export class SwingSystem {
  constructor(scene, camera, targets = []) {
    this.scene = scene;
    this.camera = camera;
    this.targets = targets;
    this.maxDistance = 92;
    this.minDistance = 5.5;
    this.active = false;
    this.validTarget = false;
    this.targetDistance = 0;
    this.ropeLength = 0;
    this.targetRopeLength = 0;
    this.anchor = new THREE.Vector3();
    this.aimPoint = new THREE.Vector3();

    this._raycaster = new THREE.Raycaster();
    this._screenCenter = new THREE.Vector2(0, 0);
    this._bodyPoint = new THREE.Vector3();
    this._toAnchor = new THREE.Vector3();
    this._tangentInput = new THREE.Vector3();
    this._cableStart = new THREE.Vector3();
    this._correction = new THREE.Vector3();
    this._positions = new Float32Array(6);

    this._lineGeometry = new THREE.BufferGeometry();
    this._lineGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this._positions, 3),
    );
    this._lineMaterial = new THREE.LineBasicMaterial({
      color: 0x7ff7ff,
      transparent: true,
      opacity: 0.98,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.line = new THREE.Line(this._lineGeometry, this._lineMaterial);
    this.line.name = 'AeroEnergyCable';
    this.line.frustumCulled = false;
    this.line.renderOrder = 20;
    this.line.visible = false;
    scene.add(this.line);

    this._glowGeometry = this._lineGeometry.clone();
    this._glowMaterial = new THREE.LineBasicMaterial({
      color: 0x9d4edd,
      transparent: true,
      opacity: 0.58,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.glowLine = new THREE.Line(this._glowGeometry, this._glowMaterial);
    this.glowLine.name = 'AeroEnergyCableGlow';
    this.glowLine.frustumCulled = false;
    this.glowLine.renderOrder = 19;
    this.glowLine.visible = false;
    this.glowLine.scale.setScalar(1.002);
    scene.add(this.glowLine);

    const anchorMaterial = new THREE.MeshBasicMaterial({
      color: 0xd5fbff,
      transparent: true,
      opacity: 0.92,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.anchorMarker = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.27, 0),
      anchorMaterial,
    );
    this.anchorMarker.name = 'CableAnchorGlow';
    this.anchorMarker.visible = false;
    this.anchorMarker.renderOrder = 21;
    scene.add(this.anchorMarker);
  }

  setTargets(targets) {
    this.targets = targets ?? [];
  }

  updateAim(playerPosition) {
    if (this.active) {
      this.validTarget = true;
      this.aimPoint.copy(this.anchor);
      this.targetDistance = this.anchor.distanceTo(playerPosition);
      return true;
    }

    this._raycaster.setFromCamera(this._screenCenter, this.camera);
    this._raycaster.far = this.maxDistance + 12;
    const intersections = this._raycaster.intersectObjects(this.targets, false);
    this.validTarget = false;
    this.targetDistance = 0;

    for (let index = 0; index < intersections.length; index += 1) {
      const hit = intersections[index];
      const distanceFromPlayer = hit.point.distanceTo(playerPosition);
      if (
        distanceFromPlayer >= this.minDistance &&
        distanceFromPlayer <= this.maxDistance
      ) {
        this.validTarget = true;
        this.aimPoint.copy(hit.point);
        this.targetDistance = distanceFromPlayer;
        break;
      }
    }

    this.anchorMarker.visible = this.validTarget;
    if (this.validTarget) {
      this.anchorMarker.position.copy(this.aimPoint);
      this.anchorMarker.rotation.y += 0.035;
    }
    return this.validTarget;
  }

  attach(player) {
    if (this.active || !this.validTarget) return false;
    this.active = true;
    this.anchor.copy(this.aimPoint);
    this._bodyPoint.copy(player.position).add(CHEST_OFFSET);
    const distance = this._bodyPoint.distanceTo(this.anchor);
    // Start at the exact current distance so firing never snaps or teleports
    // Aero. The cable then reels in gently while forces build the swing.
    this.ropeLength = distance;
    this.targetRopeLength = Math.max(this.minDistance, distance * 0.88);
    this.line.visible = true;
    this.glowLine.visible = true;
    this.anchorMarker.visible = true;
    this.updateCable(player, 0);
    return true;
  }

  detach() {
    if (!this.active) return false;
    this.active = false;
    this.line.visible = false;
    this.glowLine.visible = false;
    this.anchorMarker.visible = this.validTarget;
    return true;
  }

  applyForces(player, dt, moveWorld) {
    if (!this.active) return;

    this.ropeLength = Math.max(
      this.targetRopeLength,
      this.ropeLength - 1.65 * dt,
    );
    this._bodyPoint.copy(player.position).add(CHEST_OFFSET);
    this._toAnchor.subVectors(this.anchor, this._bodyPoint);
    const distance = this._toAnchor.length();
    if (distance < 0.001) return;
    this._toAnchor.multiplyScalar(1 / distance);

    const radialSpeedToward = player.velocity.dot(this._toAnchor);
    const stretch = Math.max(distance - this.ropeLength, 0);
    const tension =
      stretch * 48 +
      Math.max(-radialSpeedToward, 0) * (stretch > 0 ? 11 : 2.5) +
      (distance > this.ropeLength * 0.82 ? 4.8 : 1.2);
    player.velocity.addScaledVector(this._toAnchor, tension * dt);

    // Pumping adds tangential energy instead of pulling straight up the rope.
    if (moveWorld.lengthSq() > 0.001) {
      this._tangentInput
        .copy(moveWorld)
        .addScaledVector(
          this._toAnchor,
          -moveWorld.dot(this._toAnchor),
        );
      if (this._tangentInput.lengthSq() > 0.001) {
        this._tangentInput.normalize();
        player.velocity.addScaledVector(this._tangentInput, 9.5 * dt);
      }
    }

    const maxSwingSpeed = 48;
    if (player.velocity.lengthSq() > maxSwingSpeed * maxSwingSpeed) {
      player.velocity.setLength(maxSwingSpeed);
    }
  }

  constrain(player) {
    if (!this.active) return;

    this._bodyPoint.copy(player.position).add(CHEST_OFFSET);
    this._toAnchor.subVectors(this.anchor, this._bodyPoint);
    const distance = this._toAnchor.length();
    if (distance <= this.ropeLength || distance < 0.001) return;

    this._toAnchor.multiplyScalar(1 / distance);
    const excess = distance - this.ropeLength;
    this._correction.copy(this._toAnchor).multiplyScalar(excess * 0.86);
    player.position.add(this._correction);

    const radialSpeedToward = player.velocity.dot(this._toAnchor);
    if (radialSpeedToward < 0) {
      player.velocity.addScaledVector(this._toAnchor, -radialSpeedToward * 0.93);
    }
  }

  updateCable(player, elapsed) {
    if (!this.active) return;
    this._cableStart.copy(player.position).add(CHEST_OFFSET);
    this._positions[0] = this._cableStart.x;
    this._positions[1] = this._cableStart.y;
    this._positions[2] = this._cableStart.z;
    this._positions[3] = this.anchor.x;
    this._positions[4] = this.anchor.y;
    this._positions[5] = this.anchor.z;
    this.line.geometry.attributes.position.needsUpdate = true;

    const glowPositions = this.glowLine.geometry.attributes.position.array;
    glowPositions.set(this._positions);
    this.glowLine.geometry.attributes.position.needsUpdate = true;
    this._lineMaterial.opacity = 0.82 + Math.sin(elapsed * 18) * 0.16;
    this._glowMaterial.opacity = 0.35 + Math.sin(elapsed * 13 + 1) * 0.17;
    this.anchorMarker.position.copy(this.anchor);
    this.anchorMarker.rotation.x += 0.025;
    this.anchorMarker.rotation.y += 0.04;
    this.anchorMarker.scale.setScalar(1 + Math.sin(elapsed * 9) * 0.16);
  }

  dispose() {
    this.detach();
    this.line.removeFromParent();
    this.glowLine.removeFromParent();
    this.anchorMarker.removeFromParent();
    this._lineGeometry.dispose();
    this._glowGeometry.dispose();
    this._lineMaterial.dispose();
    this._glowMaterial.dispose();
    this.anchorMarker.geometry.dispose();
    this.anchorMarker.material.dispose();
  }
}
