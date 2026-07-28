import * as THREE from 'three';

const QUALITY_RANK = Object.freeze({
  low: 0,
  medium: 1,
  high: 2,
});

const GRID_RADIUS = 3;
const BLOCK_SPACING = 40;
const BLOCK_SIZE = 28;
const GROUND_LEVEL = 0;
const BUILDING_BASE = 0.2;
const ROOF_CAP_HEIGHT = 0.24;
const CITY_SEED = 0x51a7e1;

const BODY_COLOURS = [
  0x121b29,
  0x172238,
  0x1d1a33,
  0x202631,
  0x122b35,
];

const WINDOW_COLOURS = [
  new THREE.Color(0x54efff),
  new THREE.Color(0xffa94d),
  new THREE.Color(0xb06cff),
  new THREE.Color(0xe8fbff),
];

function normaliseQuality(quality) {
  const value = String(quality || 'medium').toLowerCase();
  return Object.prototype.hasOwnProperty.call(QUALITY_RANK, value)
    ? value
    : 'medium';
}

function createRandom(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function range(random, minimum, maximum) {
  return minimum + (maximum - minimum) * random();
}

function yieldToBrowser() {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Deterministic, code-generated neon city used by Skyline Sling.
 *
 * The gameplay layout never changes with the graphics preset. Quality settings
 * only toggle decoration and shadows, keeping collision and challenge routes
 * identical on every device.
 */
export class City {
  constructor(scene, quality = 'medium') {
    if (!scene || typeof scene.add !== 'function') {
      throw new TypeError('City requires a valid Three.js scene.');
    }

    this.scene = scene;
    this.quality = normaliseQuality(quality);
    this.cityRadius = 150;
    this.groundLevel = GROUND_LEVEL;

    this.colliders = [];
    this.raycastTargets = [];
    this.orbs = [];
    this.gates = [];
    this.startPosition = new THREE.Vector3(0, 34, 0);

    this.root = new THREE.Group();
    this.root.name = 'MeridianCity';

    this._built = false;
    this._geometries = new Set();
    this._materials = new Set();
    this._buildingMeshes = [];
    this._shadowMeshes = [];
    this._detailLow = new THREE.Group();
    this._detailMedium = new THREE.Group();
    this._detailHigh = new THREE.Group();
    this._detailLow.name = 'CityDetailLow';
    this._detailMedium.name = 'CityDetailMedium';
    this._detailHigh.name = 'CityDetailHigh';
  }

  async build(progressCallback) {
    if (this._built) {
      this._reportProgress(progressCallback, 1, 'City ready');
      return this;
    }

    this._reportProgress(progressCallback, 0.03, 'Laying out Meridian City');
    this.scene.add(this.root);
    this.root.add(this._detailLow, this._detailMedium, this._detailHigh);

    const unitBox = this._trackGeometry(new THREE.BoxGeometry(1, 1, 1));
    const unitPlane = this._trackGeometry(new THREE.PlaneGeometry(1, 1));
    const unitPole = this._trackGeometry(
      new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
    );
    const unitLight = this._trackGeometry(new THREE.OctahedronGeometry(0.5, 0));

    const materials = this._createMaterials();
    this._buildGroundAndRoads(
      unitBox,
      unitPlane,
      unitPole,
      unitLight,
      materials,
    );

    await yieldToBrowser();
    this._reportProgress(progressCallback, 0.23, 'Raising the skyline');

    const buildings = this._createBuildingLayout();
    this._buildBuildings(buildings, unitBox, unitPlane, materials);

    await yieldToBrowser();
    this._reportProgress(progressCallback, 0.62, 'Adding rooftop routes');

    this._buildRooftops(buildings, unitBox, unitPole, unitLight, materials);

    await yieldToBrowser();
    this._reportProgress(progressCallback, 0.79, 'Charging energy orbs');

    this._buildCollectibles(buildings, materials);

    await yieldToBrowser();
    this._reportProgress(progressCallback, 0.94, 'Lighting swing gates');

    this._buildGates(buildings, materials);
    this._applyQuality();

    this.root.updateMatrixWorld(true);
    this._built = true;
    this._reportProgress(progressCallback, 1, 'Meridian City online');
    return this;
  }

  resetCollectibles() {
    for (let index = 0; index < this.orbs.length; index += 1) {
      const orb = this.orbs[index];
      orb.active = true;
      orb.mesh.visible = true;
      orb.mesh.position.y = orb.baseY;
      orb.mesh.scale.setScalar(1);
    }

    for (let index = 0; index < this.gates.length; index += 1) {
      const gate = this.gates[index];
      gate.active = true;
      gate.group.visible = true;
      gate.group.scale.setScalar(1);
    }
  }

  update(dt, elapsed) {
    const delta = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
    const time = Number(elapsed) || 0;

    for (let index = 0; index < this.orbs.length; index += 1) {
      const orb = this.orbs[index];
      orb.mesh.visible = Boolean(orb.active);
      if (!orb.active) continue;

      orb.mesh.position.y =
        orb.baseY + Math.sin(time * 2.15 + index * 0.83) * 0.34;
      orb.mesh.rotation.x += delta * 0.55;
      orb.mesh.rotation.y += delta * 1.35;
      const pulse = 1 + Math.sin(time * 3.4 + index) * 0.06;
      orb.mesh.scale.setScalar(pulse);
    }

    for (let index = 0; index < this.gates.length; index += 1) {
      const gate = this.gates[index];
      gate.group.visible = Boolean(gate.active);
      if (!gate.active) continue;

      const pulse = 1 + Math.sin(time * 2.25 + gate.phase) * 0.025;
      gate.group.scale.setScalar(pulse);
      gate.group.rotation.z =
        gate.baseRotationZ + Math.sin(time * 0.8 + gate.phase) * 0.045;

      const innerRing = gate.group.userData.innerRing;
      if (innerRing) innerRing.rotation.z += delta * 0.45;
    }
  }

  setQuality(quality) {
    this.quality = normaliseQuality(quality);
    this._applyQuality();
    return this.quality;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);

    this._geometries.forEach((geometry) => geometry.dispose());
    this._materials.forEach((material) => material.dispose());
    this._geometries.clear();
    this._materials.clear();

    this.colliders.length = 0;
    this.raycastTargets.length = 0;
    this.orbs.length = 0;
    this.gates.length = 0;
    this._buildingMeshes.length = 0;
    this._shadowMeshes.length = 0;

    this.root.clear();
    this.root = new THREE.Group();
    this.root.name = 'MeridianCity';
    this._detailLow = new THREE.Group();
    this._detailMedium = new THREE.Group();
    this._detailHigh = new THREE.Group();
    this._detailLow.name = 'CityDetailLow';
    this._detailMedium.name = 'CityDetailMedium';
    this._detailHigh.name = 'CityDetailHigh';
    this._built = false;
  }

  _createMaterials() {
    const body = BODY_COLOURS.map((colour, index) =>
      this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: colour,
          emissive: index % 2 === 0 ? 0x06131c : 0x10091a,
          emissiveIntensity: 0.28,
          metalness: 0.18,
          roughness: 0.78,
          flatShading: true,
        }),
      ),
    );

    return {
      body,
      ground: this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x050913,
          roughness: 0.96,
          metalness: 0.04,
        }),
      ),
      road: this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x080d17,
          roughness: 0.91,
          metalness: 0.08,
        }),
      ),
      sidewalk: this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x202938,
          roughness: 0.9,
          metalness: 0.08,
        }),
      ),
      roof: this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x293346,
          roughness: 0.74,
          metalness: 0.22,
        }),
      ),
      obstacle: this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x35445a,
          emissive: 0x07131d,
          emissiveIntensity: 0.35,
          roughness: 0.63,
          metalness: 0.35,
        }),
      ),
      pole: this._trackMaterial(
        new THREE.MeshStandardMaterial({
          color: 0x526176,
          roughness: 0.46,
          metalness: 0.65,
        }),
      ),
      lane: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x5d6e87,
          transparent: true,
          opacity: 0.42,
          toneMapped: false,
        }),
      ),
      window: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          vertexColors: true,
          transparent: true,
          opacity: 0.82,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      cyanGlow: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x55efff,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      purpleGlow: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0xa66bff,
          transparent: true,
          opacity: 0.78,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      orangeGlow: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0xffa64a,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
      softGlow: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x6cecff,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
      gate: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0x5ff5ff,
          transparent: true,
          opacity: 0.84,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
      gateInner: this._trackMaterial(
        new THREE.MeshBasicMaterial({
          color: 0xb568ff,
          transparent: true,
          opacity: 0.52,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      ),
    };
  }

  _buildGroundAndRoads(
    unitBox,
    unitPlane,
    unitPole,
    unitLight,
    materials,
  ) {
    const groundSize = this.cityRadius * 2.65;
    const ground = new THREE.Mesh(
      this._trackGeometry(new THREE.PlaneGeometry(groundSize, groundSize)),
      materials.ground,
    );
    ground.name = 'FogFriendlyGround';
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    this.root.add(ground);

    const roadCentres = [];
    for (let index = -GRID_RADIUS; index < GRID_RADIUS; index += 1) {
      roadCentres.push((index + 0.5) * BLOCK_SPACING);
    }

    const roadLength = this.cityRadius * 1.92;
    const roadWidth = BLOCK_SPACING - BLOCK_SIZE + 1.5;
    const roadTransforms = [];
    for (let index = 0; index < roadCentres.length; index += 1) {
      const centre = roadCentres[index];
      roadTransforms.push({
        x: centre,
        y: 0.015,
        z: 0,
        sx: roadWidth,
        sy: 0.07,
        sz: roadLength,
      });
      roadTransforms.push({
        x: 0,
        y: 0.02,
        z: centre,
        sx: roadLength,
        sy: 0.075,
        sz: roadWidth,
      });
    }

    const roads = this._makeBoxInstances(
      'RoadGrid',
      unitBox,
      materials.road,
      roadTransforms,
    );
    roads.receiveShadow = true;
    this.root.add(roads);

    const pads = [];
    const lamps = [];
    for (let gridX = -GRID_RADIUS; gridX <= GRID_RADIUS; gridX += 1) {
      for (let gridZ = -GRID_RADIUS; gridZ <= GRID_RADIUS; gridZ += 1) {
        const centreX = gridX * BLOCK_SPACING;
        const centreZ = gridZ * BLOCK_SPACING;
        pads.push({
          x: centreX,
          y: 0.09,
          z: centreZ,
          sx: BLOCK_SIZE + 1,
          sy: 0.18,
          sz: BLOCK_SIZE + 1,
        });

        const corner = BLOCK_SIZE * 0.5 + 0.9;
        const parity = (gridX + gridZ) & 1;
        lamps.push(
          {
            x: centreX + (parity ? corner : -corner),
            z: centreZ - corner,
          },
          {
            x: centreX + (parity ? -corner : corner),
            z: centreZ + corner,
          },
        );
      }
    }

    const sidewalks = this._makeBoxInstances(
      'SidewalkBlocks',
      unitBox,
      materials.sidewalk,
      pads,
    );
    sidewalks.receiveShadow = true;
    this.root.add(sidewalks);

    const laneMarks = [];
    const dashStep = 11;
    const dashLimit = this.cityRadius - 9;
    for (let roadIndex = 0; roadIndex < roadCentres.length; roadIndex += 1) {
      const centre = roadCentres[roadIndex];
      for (let along = -dashLimit; along <= dashLimit; along += dashStep) {
        laneMarks.push({
          x: centre,
          y: 0.075,
          z: along,
          sx: 0.18,
          sy: 3.8,
          rotationX: -Math.PI / 2,
        });
        laneMarks.push({
          x: along,
          y: 0.078,
          z: centre,
          sx: 3.8,
          sy: 0.18,
          rotationX: -Math.PI / 2,
        });
      }
    }

    const markings = this._makePlaneInstances(
      'RoadLaneMarkers',
      unitPlane,
      materials.lane,
      laneMarks,
    );
    this._detailLow.add(markings);

    const poleTransforms = [];
    const lightTransforms = [];
    for (let index = 0; index < lamps.length; index += 1) {
      const lamp = lamps[index];
      poleTransforms.push({
        x: lamp.x,
        y: 2.65,
        z: lamp.z,
        sx: 0.12,
        sy: 5.1,
        sz: 0.12,
      });
      lightTransforms.push({
        x: lamp.x,
        y: 5.32,
        z: lamp.z,
        sx: 0.58,
        sy: 0.58,
        sz: 0.58,
      });
    }

    const streetPoles = this._makeBoxInstances(
      'StreetlightPoles',
      unitPole,
      materials.pole,
      poleTransforms,
    );
    const streetLights = this._makeBoxInstances(
      'StreetlightGlow',
      unitLight,
      materials.orangeGlow,
      lightTransforms,
    );
    this._detailMedium.add(streetPoles, streetLights);
  }

  _createBuildingLayout() {
    const random = createRandom(CITY_SEED);
    const buildings = [];
    let id = 0;

    const addBuilding = (
      cellX,
      cellZ,
      localX,
      localZ,
      width,
      depth,
      height,
      isStart = false,
    ) => {
      const building = {
        id,
        cellX,
        cellZ,
        x: cellX * BLOCK_SPACING + localX,
        z: cellZ * BLOCK_SPACING + localZ,
        width,
        depth,
        height,
        isStart,
        materialIndex:
          Math.abs(cellX * 11 + cellZ * 7 + id * 3) % BODY_COLOURS.length,
      };
      buildings.push(building);
      id += 1;
    };

    for (let cellX = -GRID_RADIUS; cellX <= GRID_RADIUS; cellX += 1) {
      for (let cellZ = -GRID_RADIUS; cellZ <= GRID_RADIUS; cellZ += 1) {
        const manhattan = Math.abs(cellX) + Math.abs(cellZ);
        const centreDistance = Math.hypot(cellX, cellZ);
        const heightBoost = Math.max(0, 3.8 - centreDistance) * 9;

        if (cellX === 0 && cellZ === 0) {
          addBuilding(0, 0, 0, 0, 24, 24, 31.5, true);
          continue;
        }

        // Four guaranteed close, tall anchors surround Aero's starting roof.
        if (manhattan === 1) {
          addBuilding(
            cellX,
            cellZ,
            range(random, -1.1, 1.1),
            range(random, -1.1, 1.1),
            range(random, 20.5, 23.5),
            range(random, 20.5, 23.5),
            range(random, 68, 88),
          );
          continue;
        }

        const layout = random();
        if (layout < 0.4) {
          addBuilding(
            cellX,
            cellZ,
            range(random, -2.2, 2.2),
            range(random, -2.2, 2.2),
            range(random, 16, 24),
            range(random, 16, 24),
            range(random, 19, 48) + heightBoost,
          );
          continue;
        }

        if (layout < 0.82) {
          const splitAlongX = random() > 0.5;
          const firstSize = range(random, 9.5, 11.5);
          const secondSize = range(random, 9.5, 11.5);
          const separation = (firstSize + secondSize) * 0.5 + 2.5;
          const firstOffset = -separation * 0.5;
          const secondOffset = separation * 0.5;

          if (splitAlongX) {
            addBuilding(
              cellX,
              cellZ,
              firstOffset,
              range(random, -1.4, 1.4),
              firstSize,
              range(random, 18, 24),
              range(random, 17, 43) + heightBoost,
            );
            addBuilding(
              cellX,
              cellZ,
              secondOffset,
              range(random, -1.4, 1.4),
              secondSize,
              range(random, 18, 24),
              range(random, 20, 51) + heightBoost,
            );
          } else {
            addBuilding(
              cellX,
              cellZ,
              range(random, -1.4, 1.4),
              firstOffset,
              range(random, 18, 24),
              firstSize,
              range(random, 17, 43) + heightBoost,
            );
            addBuilding(
              cellX,
              cellZ,
              range(random, -1.4, 1.4),
              secondOffset,
              range(random, 18, 24),
              secondSize,
              range(random, 20, 51) + heightBoost,
            );
          }
          continue;
        }

        const offset = 6.2;
        for (let subX = -1; subX <= 1; subX += 2) {
          for (let subZ = -1; subZ <= 1; subZ += 2) {
            addBuilding(
              cellX,
              cellZ,
              subX * offset,
              subZ * offset,
              range(random, 8.8, 10.6),
              range(random, 8.8, 10.6),
              range(random, 16, 38) + heightBoost * range(random, 0.55, 0.9),
            );
          }
        }
      }
    }

    return buildings;
  }

  _buildBuildings(buildings, unitBox, unitPlane, materials) {
    const buckets = Array.from(
      { length: materials.body.length },
      () => [],
    );
    const caps = [];
    const windowTiers = [[], [], []];

    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      const bodyTop = BUILDING_BASE + building.height;
      building.roofTop = bodyTop + ROOF_CAP_HEIGHT;

      buckets[building.materialIndex].push({
        x: building.x,
        y: BUILDING_BASE + building.height * 0.5,
        z: building.z,
        sx: building.width,
        sy: building.height,
        sz: building.depth,
      });
      caps.push({
        x: building.x,
        y: bodyTop + ROOF_CAP_HEIGHT * 0.5,
        z: building.z,
        sx: building.width * 1.012,
        sy: ROOF_CAP_HEIGHT,
        sz: building.depth * 1.012,
      });

      this.colliders.push({
        minX: building.x - building.width * 0.5,
        maxX: building.x + building.width * 0.5,
        minZ: building.z - building.depth * 0.5,
        maxZ: building.z + building.depth * 0.5,
        top: building.roofTop,
        bottom: BUILDING_BASE,
      });

      this._addWindowBands(building, windowTiers);

      if (building.isStart) {
        this.startPosition.set(
          building.x,
          building.roofTop + 1.75,
          building.z,
        );
      }
    }

    for (let materialIndex = 0; materialIndex < buckets.length; materialIndex += 1) {
      const bucket = buckets[materialIndex];
      if (bucket.length === 0) continue;

      const mesh = this._makeBoxInstances(
        `BuildingBodies${materialIndex + 1}`,
        unitBox,
        materials.body[materialIndex],
        bucket,
      );
      mesh.receiveShadow = true;
      this.root.add(mesh);
      this._buildingMeshes.push(mesh);
      this._shadowMeshes.push(mesh);
      this.raycastTargets.push(mesh);
    }

    const roofCaps = this._makeBoxInstances(
      'BuildingRoofCaps',
      unitBox,
      materials.roof,
      caps,
    );
    roofCaps.receiveShadow = true;
    this.root.add(roofCaps);
    this._shadowMeshes.push(roofCaps);
    this.raycastTargets.push(roofCaps);

    for (let tier = 0; tier < windowTiers.length; tier += 1) {
      const placements = windowTiers[tier];
      if (placements.length === 0) continue;

      const windows = this._makeColouredPlaneInstances(
        `WindowTier${tier}`,
        unitPlane,
        materials.window,
        placements,
      );
      windows.renderOrder = 1;
      if (tier === 0) this._detailLow.add(windows);
      if (tier === 1) this._detailMedium.add(windows);
      if (tier === 2) this._detailHigh.add(windows);
    }
  }

  _addWindowBands(building, tiers) {
    const floors = Math.max(2, Math.floor((building.height - 3) / 5.2));
    const horizontalInset = 0.66;
    const windowHeight = 0.46;
    const frontWidth = Math.max(2.2, building.width * horizontalInset);
    const sideWidth = Math.max(2.2, building.depth * horizontalInset);

    for (let floor = 0; floor < floors; floor += 1) {
      const y = BUILDING_BASE + 3.1 + floor * 5.2;
      if (y > BUILDING_BASE + building.height - 1.6) break;

      for (let face = 0; face < 4; face += 1) {
        const pattern =
          Math.abs(building.id * 13 + floor * 7 + face * 5) % 11;
        if (pattern === 0 || pattern === 7) continue;

        const tier = (floor + face + building.id) % 3;
        const colourIndex =
          Math.abs(building.id + floor * 2 + face) % WINDOW_COLOURS.length;
        const placement = {
          x: building.x,
          y,
          z: building.z,
          sx: face < 2 ? frontWidth : sideWidth,
          sy: windowHeight,
          rotationY: 0,
          colour: WINDOW_COLOURS[colourIndex],
        };

        if (face === 0) {
          placement.z += building.depth * 0.5 + 0.012;
        } else if (face === 1) {
          placement.z -= building.depth * 0.5 + 0.012;
          placement.rotationY = Math.PI;
        } else if (face === 2) {
          placement.x += building.width * 0.5 + 0.012;
          placement.rotationY = Math.PI / 2;
        } else {
          placement.x -= building.width * 0.5 + 0.012;
          placement.rotationY = -Math.PI / 2;
        }

        tiers[tier].push(placement);
      }
    }
  }

  _buildRooftops(
    buildings,
    unitBox,
    unitPole,
    unitLight,
    materials,
  ) {
    const random = createRandom(CITY_SEED ^ 0x9e3779b9);
    const obstacles = [];
    const antennas = [];
    const beacons = [];

    const addObstacle = (building, width, depth, height, offsetX, offsetZ) => {
      const bottom = building.roofTop;
      const x = building.x + offsetX;
      const z = building.z + offsetZ;
      obstacles.push({
        x,
        y: bottom + height * 0.5,
        z,
        sx: width,
        sy: height,
        sz: depth,
      });
      this.colliders.push({
        minX: x - width * 0.5,
        maxX: x + width * 0.5,
        minZ: z - depth * 0.5,
        maxZ: z + depth * 0.5,
        top: bottom + height,
        bottom,
      });
      return bottom + height;
    };

    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      if (building.isStart) continue;

      let antennaBaseX = building.x;
      let antennaBaseY = building.roofTop;
      let antennaBaseZ = building.z;
      if (random() < 0.38 && building.width > 10 && building.depth > 10) {
        const width = Math.min(
          building.width * range(random, 0.24, 0.38),
          6.2,
        );
        const depth = Math.min(
          building.depth * range(random, 0.24, 0.38),
          6.2,
        );
        const height = range(random, 2.2, 4.6);
        const offsetX = range(
          random,
          -building.width * 0.18,
          building.width * 0.18,
        );
        const offsetZ = range(
          random,
          -building.depth * 0.18,
          building.depth * 0.18,
        );
        antennaBaseX = building.x + offsetX;
        antennaBaseZ = building.z + offsetZ;
        antennaBaseY = addObstacle(
          building,
          width,
          depth,
          height,
          offsetX,
          offsetZ,
        );
      } else if (random() < 0.7) {
        const width = range(random, 1.4, 2.4);
        const depth = range(random, 1.4, 2.4);
        const height = range(random, 1.2, 2.2);
        const xLimit = Math.max(0, building.width * 0.5 - width * 0.8);
        const zLimit = Math.max(0, building.depth * 0.5 - depth * 0.8);
        addObstacle(
          building,
          width,
          depth,
          height,
          range(random, -xLimit, xLimit),
          range(random, -zLimit, zLimit),
        );
      }

      if (building.height > 48 && random() < 0.5) {
        const poleHeight = range(random, 4.5, 10);
        const placementSpread =
          antennaBaseY > building.roofTop ? 0.35 : 1.2;
        const x =
          antennaBaseX + range(random, -placementSpread, placementSpread);
        const z =
          antennaBaseZ + range(random, -placementSpread, placementSpread);
        antennas.push({
          x,
          y: antennaBaseY + poleHeight * 0.5,
          z,
          sx: 0.18,
          sy: poleHeight,
          sz: 0.18,
        });
        beacons.push({
          x,
          y: antennaBaseY + poleHeight + 0.12,
          z,
          sx: 0.44,
          sy: 0.44,
          sz: 0.44,
        });
      }
    }

    if (obstacles.length > 0) {
      const obstacleMesh = this._makeBoxInstances(
        'RooftopObstacles',
        unitBox,
        materials.obstacle,
        obstacles,
      );
      obstacleMesh.receiveShadow = true;
      this.root.add(obstacleMesh);
      this._shadowMeshes.push(obstacleMesh);
      this.raycastTargets.push(obstacleMesh);
    }

    if (antennas.length > 0) {
      const antennaMesh = this._makeBoxInstances(
        'RooftopAntennas',
        unitPole,
        materials.pole,
        antennas,
      );
      // Antennas remain visible at every preset because they are valid cable
      // targets. Hiding a raycastable object would create an "attach to air"
      // surprise on the low preset.
      this._detailLow.add(antennaMesh);
      this.raycastTargets.push(antennaMesh);
    }

    if (beacons.length > 0) {
      const beaconMesh = this._makeBoxInstances(
        'AntennaBeacons',
        unitLight,
        materials.orangeGlow,
        beacons,
      );
      this._detailHigh.add(beaconMesh);
    }
  }

  _buildCollectibles(buildings, materials) {
    const orbGeometry = this._trackGeometry(
      new THREE.IcosahedronGeometry(0.58, 1),
    );
    const auraGeometry = this._trackGeometry(
      new THREE.SphereGeometry(0.92, 10, 7),
    );
    const route = [
      [0, 0],
      [0, -1],
      [1, -1],
      [1, -2],
      [2, -2],
      [2, -1],
      [2, 0],
      [2, 1],
      [1, 1],
      [1, 2],
      [0, 2],
      [-1, 2],
      [-2, 2],
      [-2, 1],
      [-2, 0],
      [-2, -1],
      [-1, -1],
      [-1, 0],
    ];

    const routeBuildings = route
      .map(([cellX, cellZ]) =>
        this._tallestBuildingInCell(buildings, cellX, cellZ),
      )
      .filter(Boolean);

    const positions = [];
    for (let index = 0; index < routeBuildings.length; index += 1) {
      const building = routeBuildings[index];
      const angle = index * 2.399963;
      const offsetRadius = building.isStart
        ? 0
        : Math.min(building.width, building.depth) * 0.19;
      positions.push({
        x: building.x + Math.cos(angle) * offsetRadius,
        y: building.roofTop + 2.6,
        z: building.z + Math.sin(angle) * offsetRadius,
      });

      const next = routeBuildings[(index + 1) % routeBuildings.length];
      if (index % 2 === 0 && next) {
        positions.push({
          x: THREE.MathUtils.lerp(building.x, next.x, 0.52),
          y:
            Math.max(building.roofTop, next.roofTop) +
            7.5 +
            (index % 3) * 1.6,
          z: THREE.MathUtils.lerp(building.z, next.z, 0.52),
        });
      }
    }

    for (let index = 0; index < positions.length; index += 1) {
      const position = positions[index];
      const orbMesh = new THREE.Mesh(orbGeometry, materials.cyanGlow);
      orbMesh.name = `EnergyOrb${index + 1}`;
      orbMesh.position.set(position.x, position.y, position.z);
      orbMesh.renderOrder = 3;

      const aura = new THREE.Mesh(auraGeometry, materials.softGlow);
      aura.name = 'OrbAura';
      orbMesh.add(aura);
      this.root.add(orbMesh);

      this.orbs.push({
        mesh: orbMesh,
        active: true,
        baseY: position.y,
      });
    }
  }

  _buildGates(buildings, materials) {
    const outerGeometry = this._trackGeometry(
      new THREE.TorusGeometry(1, 0.045, 7, 28),
    );
    const innerGeometry = this._trackGeometry(
      new THREE.TorusGeometry(1, 0.022, 6, 24),
    );
    const routeCells = [
      [0, -1],
      [1, -2],
      [2, 0],
      [1, 2],
      [-1, 2],
      [-2, 0],
      [-1, -1],
      [0, 0],
    ];

    const anchors = routeCells
      .map(([cellX, cellZ]) =>
        this._tallestBuildingInCell(buildings, cellX, cellZ),
      )
      .filter(Boolean);

    for (let index = 0; index < anchors.length; index += 1) {
      const current = anchors[index];
      const next = anchors[(index + 1) % anchors.length];
      const radius = 5.2 + (index % 3) * 0.45;
      const group = new THREE.Group();
      group.name = `SwingGate${index + 1}`;

      group.position.set(
        THREE.MathUtils.lerp(current.x, next.x, 0.5),
        Math.max(current.roofTop, next.roofTop) + 8 + (index % 2) * 2.5,
        THREE.MathUtils.lerp(current.z, next.z, 0.5),
      );
      group.rotation.y = Math.atan2(next.x - current.x, next.z - current.z);

      const outerRing = new THREE.Mesh(outerGeometry, materials.gate);
      outerRing.name = 'GateOuterRing';
      outerRing.scale.setScalar(radius);
      outerRing.renderOrder = 2;

      const innerRing = new THREE.Mesh(innerGeometry, materials.gateInner);
      innerRing.name = 'GateInnerRing';
      innerRing.scale.setScalar(radius * 0.82);
      innerRing.renderOrder = 2;

      group.add(outerRing, innerRing);
      group.userData.innerRing = innerRing;
      this.root.add(group);

      this.gates.push({
        group,
        active: true,
        radius,
        phase: index * 0.91,
        baseRotationZ: group.rotation.z,
      });
    }
  }

  _tallestBuildingInCell(buildings, cellX, cellZ) {
    let tallest = null;
    for (let index = 0; index < buildings.length; index += 1) {
      const building = buildings[index];
      if (building.cellX !== cellX || building.cellZ !== cellZ) continue;
      if (!tallest || building.roofTop > tallest.roofTop) tallest = building;
    }
    return tallest;
  }

  _makeBoxInstances(name, geometry, material, transforms) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      Math.max(1, transforms.length),
    );
    mesh.name = name;
    mesh.count = transforms.length;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const dummy = new THREE.Object3D();
    for (let index = 0; index < transforms.length; index += 1) {
      const transform = transforms[index];
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.rotation.set(
        transform.rotationX || 0,
        transform.rotationY || 0,
        transform.rotationZ || 0,
      );
      dummy.scale.set(transform.sx, transform.sy, transform.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (typeof mesh.computeBoundingBox === 'function') mesh.computeBoundingBox();
    if (typeof mesh.computeBoundingSphere === 'function') {
      mesh.computeBoundingSphere();
    }
    return mesh;
  }

  _makePlaneInstances(name, geometry, material, transforms) {
    const mesh = new THREE.InstancedMesh(
      geometry,
      material,
      Math.max(1, transforms.length),
    );
    mesh.name = name;
    mesh.count = transforms.length;
    mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);

    const dummy = new THREE.Object3D();
    for (let index = 0; index < transforms.length; index += 1) {
      const transform = transforms[index];
      dummy.position.set(transform.x, transform.y, transform.z);
      dummy.rotation.set(
        transform.rotationX || 0,
        transform.rotationY || 0,
        transform.rotationZ || 0,
      );
      dummy.scale.set(transform.sx, transform.sy, 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (typeof mesh.computeBoundingSphere === 'function') {
      mesh.computeBoundingSphere();
    }
    return mesh;
  }

  _makeColouredPlaneInstances(name, geometry, material, transforms) {
    const mesh = this._makePlaneInstances(
      name,
      geometry,
      material,
      transforms,
    );
    for (let index = 0; index < transforms.length; index += 1) {
      mesh.setColorAt(index, transforms[index].colour);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    return mesh;
  }

  _applyQuality() {
    const rank = QUALITY_RANK[this.quality];
    this._detailLow.visible = true;
    this._detailMedium.visible = rank >= QUALITY_RANK.medium;
    this._detailHigh.visible = rank >= QUALITY_RANK.high;

    for (let index = 0; index < this._shadowMeshes.length; index += 1) {
      this._shadowMeshes[index].castShadow = rank >= QUALITY_RANK.high;
    }
  }

  _trackGeometry(geometry) {
    this._geometries.add(geometry);
    return geometry;
  }

  _trackMaterial(material) {
    this._materials.add(material);
    return material;
  }

  _reportProgress(callback, progress, label) {
    if (typeof callback !== 'function') return;
    try {
      callback(progress, label);
    } catch {
      // A loading-label error should never prevent the playable city loading.
    }
  }
}

export default City;
