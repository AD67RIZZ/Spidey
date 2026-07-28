import * as THREE from 'three';
import { City } from './city.js';
import { Player } from './player.js';
import { SwingSystem } from './swing.js';
import { InputController } from './input.js';
import { AudioSystem } from './audio.js';

const RUN_DURATION = 90;
const COMBO_WINDOW = 4;
const BEST_SCORE_KEY = 'skyline-sling-best-score';
const SETTINGS_KEY = 'skyline-sling-settings';
const CAMERA_BASE_FOV = 65;

const DEFAULT_SETTINGS = {
  quality: 'medium',
  sensitivity: 0.75,
  sound: true,
  reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function damp(current, target, lambda, dt) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function getStoredJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value && typeof value === 'object' ? { ...fallback, ...value } : fallback;
  } catch {
    return fallback;
  }
}

function getStoredNumber(key) {
  try {
    return Math.max(0, Number.parseInt(localStorage.getItem(key) ?? '0', 10) || 0);
  } catch {
    return 0;
  }
}

function setStoredValue(key, value) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch {
    // The game remains fully playable if storage is unavailable.
  }
}

function formatTime(seconds) {
  const safe = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(safe / 60);
  const remainder = String(safe % 60).padStart(2, '0');
  return `${String(minutes).padStart(2, '0')}:${remainder}`;
}

export class Game {
  constructor(root, progressCallback = () => {}) {
    this.root = root;
    this.reportProgress = progressCallback;
    this.state = 'loading';
    this.settings = getStoredJSON(SETTINGS_KEY, DEFAULT_SETTINGS);
    if (!['low', 'medium', 'high'].includes(this.settings.quality)) {
      this.settings.quality = 'medium';
    }
    this.settings.sensitivity = clamp(Number(this.settings.sensitivity) || 0.75, 0.25, 1.5);
    this.settings.sound = this.settings.sound !== false;
    this.settings.reducedMotion = Boolean(this.settings.reducedMotion);

    this.score = 0;
    this.bestScore = getStoredNumber(BEST_SCORE_KEY);
    this.timeLeft = RUN_DURATION;
    this.combo = 1;
    this.comboTime = 0;
    this.orbCount = 0;
    this.gateCount = 0;
    this.topSpeed = 0;
    this.elapsed = 0;
    this.warningSecond = null;
    this.settingsReturnState = 'menu';
    this._announcementTimer = 0;
    this._scorePopTimer = 0;
    this._lastTime = performance.now();
    this._menuAngle = 0;
    this._listeners = [];
    this._disposed = false;

    this.yaw = Math.PI;
    this.pitch = 0.12;
    this._move2 = new THREE.Vector2();
    this._moveWorld = new THREE.Vector3();
    this._forward = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._cameraTarget = new THREE.Vector3();
    this._desiredCamera = new THREE.Vector3();
    this._cameraDirection = new THREE.Vector3();
    this._cameraRay = new THREE.Raycaster();
    this._worldPosition = new THREE.Vector3();

    this._animate = this._animate.bind(this);
    this._onResize = this._onResize.bind(this);
  }

  async init() {
    this.reportProgress(0.18, 'Opening the Meridian skyline…');
    this._createRenderer();
    this._createScene();
    this._cacheUI();
    this._applySettingsToUI();

    this.city = new City(this.scene, this.settings.quality);
    await this.city.build((progress, label) => {
      this.reportProgress(0.2 + progress * 0.5, label);
    });

    this.reportProgress(0.74, 'Calibrating Aero’s movement…');
    this.player = new Player(this.scene);
    this.player.reset(this.city.startPosition);

    this.swing = new SwingSystem(this.scene, this.camera, this.city.raycastTargets);
    this.audio = new AudioSystem({ enabled: this.settings.sound, volume: 0.52 });
    this.input = new InputController(this.renderer.domElement, {
      root: document,
      enabled: false,
      sensitivity: this.settings.sensitivity,
      onPause: () => {
        if (this.state === 'playing') this.pauseGame();
      },
      onInteract: () => this.audio.unlock(),
    });
    this.input.setEnabled(false);
    this.input.setTouchControlsVisible(false);

    this.reportProgress(0.84, 'Charging neon gates and energy orbs…');
    this._createParticlePool();
    this._bindUI();
    this._applyQuality(this.settings.quality);
    this._applyReducedMotion(this.settings.reducedMotion);
    this._updateBestScoreUI();
    this._onResize();
    window.addEventListener('resize', this._onResize);
    window.addEventListener('orientationchange', this._onResize);
    this._listeners.push(
      () => window.removeEventListener('resize', this._onResize),
      () => window.removeEventListener('orientationchange', this._onResize),
    );

    this.reportProgress(0.94, 'Final flight check…');
    this.renderer.setAnimationLoop(this._animate);
    this.state = 'menu';
    this.setMenuView();
  }

  _createRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: this.settings.quality !== 'low',
      powerPreference: 'high-performance',
      alpha: false,
    });
    this.renderer.domElement.id = 'game-canvas';
    this.renderer.domElement.setAttribute(
      'aria-label',
      'Skyline Sling 3D game view. Press Start Run to play.',
    );
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x070b15, 1);
    this.root.prepend(this.renderer.domElement);
  }

  _createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070b15);
    this.scene.fog = new THREE.Fog(0x111328, 105, 285);

    this.camera = new THREE.PerspectiveCamera(CAMERA_BASE_FOV, 1, 0.1, 520);
    this.camera.position.set(12, 45, 20);

    const hemisphere = new THREE.HemisphereLight(0x88dfff, 0x25133f, 1.8);
    this.scene.add(hemisphere);

    this.keyLight = new THREE.DirectionalLight(0xffd5ba, 2.4);
    this.keyLight.position.set(-70, 110, 55);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.keyLight.shadow.camera.left = -85;
    this.keyLight.shadow.camera.right = 85;
    this.keyLight.shadow.camera.top = 85;
    this.keyLight.shadow.camera.bottom = -85;
    this.keyLight.shadow.camera.near = 12;
    this.keyLight.shadow.camera.far = 230;
    this.keyLight.shadow.bias = -0.0007;
    this.scene.add(this.keyLight);

    const cyanRim = new THREE.PointLight(0x20e3ff, 95, 105, 1.8);
    cyanRim.position.set(18, 42, -28);
    this.scene.add(cyanRim);

    const orangeRim = new THREE.PointLight(0xff7b32, 72, 95, 2);
    orangeRim.position.set(-38, 28, 26);
    this.scene.add(orangeRim);

    const skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x06152c) },
        midColor: { value: new THREE.Color(0x341b55) },
        horizonColor: { value: new THREE.Color(0xd14b62) },
        lowColor: { value: new THREE.Color(0x080b17) },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        varying vec3 vDirection;
        uniform vec3 topColor;
        uniform vec3 midColor;
        uniform vec3 horizonColor;
        uniform vec3 lowColor;
        void main() {
          float y = vDirection.y;
          vec3 upper = mix(midColor, topColor, smoothstep(0.02, 0.78, y));
          vec3 lower = mix(lowColor, horizonColor, smoothstep(-0.5, 0.02, y));
          vec3 color = y >= 0.0 ? upper : lower;
          float glow = 1.0 - smoothstep(0.0, 0.28, abs(y));
          color += horizonColor * glow * 0.13;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(430, 28, 18), skyMaterial);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    const moonMaterial = new THREE.MeshBasicMaterial({
      color: 0xffbd83,
      fog: false,
      toneMapped: false,
    });
    this.moon = new THREE.Mesh(new THREE.SphereGeometry(8.5, 18, 14), moonMaterial);
    this.moon.position.set(-135, 94, -225);
    this.scene.add(this.moon);

    this._createStars();
  }

  _createStars() {
    const count = 320;
    const positions = new Float32Array(count * 3);
    let seed = 92417;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < count; index += 1) {
      const theta = random() * Math.PI * 2;
      const y = 0.08 + random() * 0.85;
      const radius = Math.sqrt(1 - y * y);
      const distance = 350 + random() * 25;
      positions[index * 3] = Math.cos(theta) * radius * distance;
      positions[index * 3 + 1] = y * distance;
      positions[index * 3 + 2] = Math.sin(theta) * radius * distance;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: 0xc8f7ff,
      size: 1.05,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.72,
      fog: false,
      depthWrite: false,
    });
    this.stars = new THREE.Points(geometry, material);
    this.scene.add(this.stars);
  }

  _createParticlePool() {
    const count = 72;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const cyan = new THREE.Color(0x52edff);
    const orange = new THREE.Color(0xff8b3d);
    this.particleLife = new Float32Array(count);
    this.particleVelocity = Array.from({ length: count }, () => new THREE.Vector3());

    for (let index = 0; index < count; index += 1) {
      positions[index * 3 + 1] = -999;
      const color = index % 3 === 0 ? orange : cyan;
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage),
    );
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.26,
      vertexColors: true,
      transparent: true,
      opacity: 0.92,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(geometry, material);
    this.particles.frustumCulled = false;
    this.scene.add(this.particles);
  }

  _cacheUI() {
    const byId = (id) => document.getElementById(id);
    this.ui = {
      start: byId('start-screen'),
      play: byId('play-button'),
      menuBest: byId('menu-best'),
      menuSettings: byId('menu-settings-button'),
      hud: byId('hud'),
      score: byId('score-value'),
      scorePop: byId('score-pop'),
      timer: byId('timer-value'),
      timerFill: byId('timer-fill'),
      speed: byId('speed-value'),
      combo: byId('combo-value'),
      comboFill: byId('combo-fill'),
      comboDisplay: byId('combo-display'),
      crosshair: byId('crosshair'),
      targetDistance: byId('target-distance'),
      swingStatus: byId('swing-status'),
      swingLabel: byId('swing-label'),
      objectiveToast: byId('objective-toast'),
      hudPause: byId('hud-pause-button'),
      speedLines: byId('speed-lines'),
      vignette: byId('vignette'),
      pause: byId('pause-screen'),
      resume: byId('resume-button'),
      pauseRestart: byId('pause-restart-button'),
      pauseSettings: byId('pause-settings-button'),
      quit: byId('quit-button'),
      results: byId('results-screen'),
      resultTitle: byId('result-title'),
      finalScore: byId('final-score'),
      newBest: byId('new-best'),
      orbs: byId('orbs-collected'),
      gates: byId('gates-cleared'),
      topSpeed: byId('top-speed'),
      resultsRestart: byId('results-restart-button'),
      resultsMenu: byId('results-menu-button'),
      settings: byId('settings-screen'),
      closeSettings: byId('close-settings-button'),
      quality: byId('quality-select'),
      sensitivity: byId('sensitivity-slider'),
      sensitivityOutput: byId('sensitivity-output'),
      sound: byId('sound-toggle'),
      motion: byId('motion-toggle'),
      fullscreen: byId('fullscreen-button'),
      announcement: byId('announcement'),
    };
  }

  _bindUI() {
    const listen = (element, type, handler) => {
      element?.addEventListener(type, handler);
      this._listeners.push(() => element?.removeEventListener(type, handler));
    };

    listen(this.ui.play, 'click', () => this.startGame());
    listen(this.ui.menuSettings, 'click', () => this.openSettings('menu'));
    listen(this.ui.hudPause, 'click', () => this.pauseGame());
    listen(this.ui.resume, 'click', () => this.resumeGame());
    listen(this.ui.pauseRestart, 'click', () => this.restartGame());
    listen(this.ui.pauseSettings, 'click', () => this.openSettings('paused'));
    listen(this.ui.quit, 'click', () => this.quitToMenu());
    listen(this.ui.resultsRestart, 'click', () => this.restartGame());
    listen(this.ui.resultsMenu, 'click', () => this.quitToMenu());
    listen(this.ui.closeSettings, 'click', () => this.closeSettings());

    listen(this.ui.quality, 'change', () => {
      this.settings.quality = this._applyQuality(this.ui.quality.value);
      this._saveSettings();
    });
    listen(this.ui.sensitivity, 'input', () => {
      const value = clamp(Number(this.ui.sensitivity.value), 0.25, 1.5);
      this.settings.sensitivity = value;
      this.ui.sensitivityOutput.textContent = value.toFixed(2);
      this.input?.setSensitivity(value);
      this._saveSettings();
    });
    listen(this.ui.sound, 'change', () => {
      this.settings.sound = this.ui.sound.checked;
      this.audio?.setEnabled(this.settings.sound);
      if (this.settings.sound) this.audio?.unlock();
      this._saveSettings();
    });
    listen(this.ui.motion, 'change', () => {
      this.settings.reducedMotion = this.ui.motion.checked;
      this._applyReducedMotion(this.settings.reducedMotion);
      this._saveSettings();
    });
    listen(this.ui.fullscreen, 'click', () => this._toggleFullscreen());
    listen(document, 'fullscreenchange', () => this._updateFullscreenLabel());

    const onKeyDown = (event) => {
      if (event.repeat || event.target?.matches?.('input, select, textarea, button')) return;
      if (event.defaultPrevented) return;
      if (event.code === 'Enter' && this.state === 'menu' && this.ui.settings.classList.contains('hidden')) {
        this.startGame();
      } else if (event.code === 'KeyR' && this.state === 'results') {
        this.restartGame();
      } else if (event.code === 'Escape' && this.state === 'paused') {
        if (this.ui.settings.classList.contains('hidden')) {
          this.resumeGame();
        } else {
          this.closeSettings();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this._listeners.push(() => window.removeEventListener('keydown', onKeyDown));
  }

  _applySettingsToUI() {
    this.ui.quality.value = this.settings.quality;
    this.ui.sensitivity.value = String(this.settings.sensitivity);
    this.ui.sensitivityOutput.textContent = this.settings.sensitivity.toFixed(2);
    this.ui.sound.checked = this.settings.sound;
    this.ui.motion.checked = this.settings.reducedMotion;
    this._updateFullscreenLabel();
  }

  _saveSettings() {
    setStoredValue(SETTINGS_KEY, this.settings);
  }

  _applyQuality(quality) {
    const normalized = ['low', 'medium', 'high'].includes(quality) ? quality : 'medium';
    const maxDpr = normalized === 'low' ? 1 : normalized === 'medium' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.shadowMap.enabled = normalized === 'high';
    this.keyLight.castShadow = normalized === 'high';
    this.city?.setQuality(normalized);
    if (this.stars) this.stars.visible = normalized !== 'low';
    this.settings.quality = normalized;
    this._onResize();
    return normalized;
  }

  _applyReducedMotion(enabled) {
    const reduced = Boolean(enabled);
    this.root.classList.toggle('reduced-motion', reduced);
    this.root.dataset.reducedMotion = String(reduced);
    if (reduced) this.ui.speedLines.classList.remove('active');
  }

  async _toggleFullscreen() {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else if (this.root.requestFullscreen) {
        await this.root.requestFullscreen({ navigationUI: 'hide' });
      }
    } catch {
      this._announce('FULLSCREEN ISN’T AVAILABLE HERE', 1.8);
    }
  }

  _updateFullscreenLabel() {
    if (!this.ui?.fullscreen) return;
    const supported = Boolean(document.fullscreenEnabled && this.root.requestFullscreen);
    this.ui.fullscreen.hidden = !supported;
    this.ui.fullscreen.textContent = document.fullscreenElement
      ? 'EXIT FULLSCREEN'
      : 'ENTER FULLSCREEN';
  }

  startGame() {
    if (!['menu', 'results'].includes(this.state)) return;
    this.audio.unlock();
    this._resetRun();
    this.state = 'playing';
    this.ui.start.classList.add('hidden');
    this.ui.results.classList.add('hidden');
    this.ui.pause.classList.add('hidden');
    this.ui.settings.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.input.setEnabled(true);
    this.input.setTouchControlsVisible(true);
    this.input.requestPointerLock();
    this._announce('GO // FIND THE FLOW', 2.1);
  }

  restartGame() {
    if (this.state === 'loading') return;
    this.audio.unlock();
    this.input?.unlockPointer(false);
    this._resetRun();
    this.state = 'playing';
    this.ui.results.classList.add('hidden');
    this.ui.pause.classList.add('hidden');
    this.ui.settings.classList.add('hidden');
    this.ui.start.classList.add('hidden');
    this.ui.hud.classList.remove('hidden');
    this.input.setEnabled(true);
    this.input.setTouchControlsVisible(true);
    this.input.requestPointerLock();
    this._announce('RUN RESTARTED', 1.4);
  }

  _resetRun() {
    this.swing?.detach();
    this.player.reset(this.city.startPosition);
    this.city.resetCollectibles();
    this.score = 0;
    this.timeLeft = RUN_DURATION;
    this.combo = 1;
    this.comboTime = 0;
    this.orbCount = 0;
    this.gateCount = 0;
    this.topSpeed = 0;
    this.warningSecond = null;
    this.elapsed = 0;
    this.yaw = Math.PI;
    this.pitch = 0.12;
    this.input?.reset();
    this._clearParticles();
    this.ui.newBest.classList.add('hidden');
    this.ui.hud.classList.remove('timer-warning', 'timer-danger', 'valid-target', 'attached', 'high-speed');
    this._updateHUD();
    this._snapCameraToPlayer();
  }

  pauseGame() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.swing.detach();
    this.audio.release(0.55);
    this.input.setEnabled(false);
    this.input.setTouchControlsVisible(false);
    this.input.unlockPointer(false);
    this.ui.pause.classList.remove('hidden');
  }

  resumeGame() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.ui.pause.classList.add('hidden');
    this.input.setEnabled(true);
    this.input.setTouchControlsVisible(true);
    this.input.requestPointerLock();
    this._lastTime = performance.now();
  }

  endGame() {
    if (this.state !== 'playing') return;
    this.state = 'results';
    if (this.swing.detach()) this.audio.release(0.5);
    this.input.setEnabled(false);
    this.input.setTouchControlsVisible(false);
    this.input.unlockPointer(false);
    this.ui.hud.classList.add('hidden');

    const isNewBest = this.score > this.bestScore;
    if (isNewBest) {
      this.bestScore = this.score;
      setStoredValue(BEST_SCORE_KEY, String(this.bestScore));
      this.ui.newBest.classList.remove('hidden');
    } else {
      this.ui.newBest.classList.add('hidden');
    }
    this._updateBestScoreUI();
    this.ui.resultTitle.textContent =
      this.score >= 9000 ? 'SKYLINE MASTERED' : this.score >= 4000 ? 'CITY LIT' : 'RUN LOGGED';
    this.ui.finalScore.textContent = this.score.toLocaleString('en-IN');
    this.ui.orbs.textContent = String(this.orbCount);
    this.ui.gates.textContent = String(this.gateCount);
    this.ui.topSpeed.textContent = String(Math.round(this.topSpeed));
    this.ui.results.classList.remove('hidden');
  }

  quitToMenu() {
    this.swing?.detach();
    this.input?.setEnabled(false);
    this.input?.setTouchControlsVisible(false);
    this.input?.unlockPointer(false);
    this.player.reset(this.city.startPosition);
    this.city.resetCollectibles();
    this.state = 'menu';
    this.ui.pause.classList.add('hidden');
    this.ui.results.classList.add('hidden');
    this.ui.settings.classList.add('hidden');
    this.ui.hud.classList.add('hidden');
    this.ui.start.classList.remove('hidden');
    this.setMenuView();
  }

  openSettings(returnState = this.state) {
    this.settingsReturnState = returnState === 'paused' ? 'paused' : 'menu';
    if (this.settingsReturnState === 'paused') this.ui.pause.classList.add('hidden');
    if (this.settingsReturnState === 'menu') this.ui.start.classList.add('hidden');
    this.ui.settings.classList.remove('hidden');
  }

  closeSettings() {
    this.ui.settings.classList.add('hidden');
    if (this.settingsReturnState === 'paused') {
      this.ui.pause.classList.remove('hidden');
    } else {
      this.ui.start.classList.remove('hidden');
    }
  }

  setMenuView() {
    if (!this.city || !this.camera) return;
    this._menuAngle = 0.55;
    this.player.reset(this.city.startPosition);
    this.camera.position
      .copy(this.city.startPosition)
      .add(new THREE.Vector3(18, 11, 22));
    this._cameraTarget.copy(this.city.startPosition).add(new THREE.Vector3(0, 3.5, 0));
    this.camera.lookAt(this._cameraTarget);
  }

  respawn(reason = 'FALL RECOVERY') {
    if (this.state !== 'playing') return;
    if (this.swing.detach()) this.audio.release(0.4);
    this.player.reset(this.city.startPosition);
    this._snapCameraToPlayer();
    this.combo = 1;
    this.comboTime = 0;
    this.score = Math.max(0, this.score - 150);
    this._announce(`${reason} // −150`, 1.8);
  }

  _snapCameraToPlayer() {
    this._cameraTarget.copy(this.player.position);
    this._cameraTarget.y += 1.6;
    const distance = 8.2;
    this._desiredCamera.set(
      this._cameraTarget.x + Math.sin(this.yaw) * distance,
      this._cameraTarget.y + 3.1,
      this._cameraTarget.z + Math.cos(this.yaw) * distance,
    );
    this.camera.position.copy(this._desiredCamera);
    this.camera.lookAt(this._cameraTarget);
  }

  _animate(timeMs) {
    if (this._disposed) return;
    const rawDt = Math.max(0, (timeMs - this._lastTime) / 1000);
    const dt = Math.min(rawDt || 0, 0.05);
    this._lastTime = timeMs;
    this.elapsed += dt;

    if (this.state === 'playing') {
      this._updatePlaying(dt);
    } else if (this.state === 'menu') {
      this._updateMenu(dt);
    } else {
      this.city?.update(dt, this.elapsed);
      this.player?.updateVisual(dt, false);
    }

    this._updateParticles(dt);
    this.renderer.render(this.scene, this.camera);
  }

  _updatePlaying(dt) {
    const look = this.input.consumeLookDelta();
    this.yaw -= look.x * 0.00235;
    this.pitch = clamp(this.pitch - look.y * 0.0019, -0.48, 0.62);

    this.input.getMoveVector(this._move2);
    this._forward.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this._right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this._moveWorld
      .copy(this._forward)
      .multiplyScalar(this._move2.y)
      .addScaledVector(this._right, this._move2.x);
    if (this._moveWorld.lengthSq() > 1) this._moveWorld.normalize();

    this.swing.updateAim(this.player.position);
    if (this.input.swingHeld) {
      if (!this.swing.active && this.swing.attach(this.player)) {
        this.audio.attach(clamp(this.swing.targetDistance / 55, 0.5, 1.2));
        this._announce('CABLE LINKED', 0.75);
      }
    } else if (this.swing.detach()) {
      this.audio.release(clamp(this.player.speed / 26, 0.5, 1.25));
    }

    const events = this.player.updatePhysics(dt, {
      moveWorld: this._moveWorld,
      sprint: this.input.sprint,
      jump: this.input.consumeJump(),
      colliders: this.city.colliders,
      groundLevel: this.city.groundLevel,
      swing: this.swing,
    });

    if (events.jumped) this.audio.jump();
    if (events.landed) {
      this.audio.land(clamp(events.landingImpact / 18, 0.35, 1.25));
      this._spawnParticles(this.player.position, clamp(Math.round(events.landingImpact * 0.55), 5, 14), 1);
    }

    this.player.updateVisual(dt, this.swing.active);
    this.swing.updateCable(this.player, this.elapsed);
    this.city.update(dt, this.elapsed);
    this._checkCollectibles();
    this._updateCombo(dt);
    this._updateCamera(dt);

    const speedKmh = this.player.speed * 3.6;
    this.topSpeed = Math.max(this.topSpeed, speedKmh);
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    this._updateWarnings();
    this._updateHUD(speedKmh);

    const tooFar =
      Math.abs(this.player.position.x) > this.city.cityRadius * 1.45 ||
      Math.abs(this.player.position.z) > this.city.cityRadius * 1.45;
    const invalidPosition =
      !Number.isFinite(this.player.position.x) ||
      !Number.isFinite(this.player.position.y) ||
      !Number.isFinite(this.player.position.z);
    if (this.player.position.y < -28 || tooFar || invalidPosition) {
      this.respawn(invalidPosition ? 'SYSTEM RECOVERY' : 'FALL RECOVERY');
    }

    if (this.timeLeft <= 0) this.endGame();
  }

  _updateMenu(dt) {
    this.city.update(dt, this.elapsed);
    this.player.updateVisual(dt, false);
    this._menuAngle += dt * 0.08;
    const focus = this.city.startPosition;
    const radius = 27;
    this.camera.position.set(
      focus.x + Math.sin(this._menuAngle) * radius,
      focus.y + 13 + Math.sin(this.elapsed * 0.18) * 1.4,
      focus.z + Math.cos(this._menuAngle) * radius,
    );
    this._cameraTarget.copy(focus);
    this._cameraTarget.y += 3.4;
    this.camera.lookAt(this._cameraTarget);
  }

  _updateCamera(dt) {
    const speed = this.player.speed;
    const extraDistance = clamp((speed - 12) * 0.075, 0, 2.6);
    const distance = 7.8 + extraDistance;
    const pitchLift = Math.sin(this.pitch) * distance;
    const horizontalDistance = Math.cos(this.pitch) * distance;

    this._cameraTarget
      .copy(this.player.position)
      .addScaledVector(this.player.velocity, this.settings.reducedMotion ? 0.012 : 0.028);
    this._cameraTarget.y += 1.55;

    this._desiredCamera.set(
      this._cameraTarget.x + Math.sin(this.yaw) * horizontalDistance,
      this._cameraTarget.y + 2.5 + pitchLift,
      this._cameraTarget.z + Math.cos(this.yaw) * horizontalDistance,
    );

    this._cameraDirection.subVectors(this._desiredCamera, this._cameraTarget);
    const desiredLength = this._cameraDirection.length();
    if (desiredLength > 0.01) {
      this._cameraDirection.multiplyScalar(1 / desiredLength);
      this._cameraRay.set(this._cameraTarget, this._cameraDirection);
      this._cameraRay.far = desiredLength;
      const hits = this._cameraRay.intersectObjects(this.city.raycastTargets, false);
      if (hits.length > 0 && hits[0].distance < desiredLength) {
        this._desiredCamera
          .copy(this._cameraTarget)
          .addScaledVector(this._cameraDirection, Math.max(1.25, hits[0].distance - 0.55));
      }
    }

    const cameraSmooth = 1 - Math.exp(-(speed > 24 ? 7.5 : 10.5) * dt);
    this.camera.position.lerp(this._desiredCamera, cameraSmooth);
    this.camera.lookAt(this._cameraTarget);

    const fovBoost = this.settings.reducedMotion ? 0 : clamp((speed - 11) * 0.42, 0, 11);
    const targetFov = CAMERA_BASE_FOV + fovBoost;
    const nextFov = damp(this.camera.fov, targetFov, 5.5, dt);
    if (Math.abs(nextFov - this.camera.fov) > 0.01) {
      this.camera.fov = nextFov;
      this.camera.updateProjectionMatrix();
    }
  }

  _checkCollectibles() {
    const playerPosition = this.player.position;

    for (let index = 0; index < this.city.orbs.length; index += 1) {
      const orb = this.city.orbs[index];
      if (!orb.active) continue;
      orb.mesh.getWorldPosition(this._worldPosition);
      if (this._worldPosition.distanceToSquared(playerPosition) < 3.1) {
        orb.active = false;
        orb.mesh.visible = false;
        this.orbCount += 1;
        this._collectPoints(100, 'ENERGY +');
        this._spawnParticles(this._worldPosition, 11, 1.25);
        this.audio.collect(this.combo);
      }
    }

    for (let index = 0; index < this.city.gates.length; index += 1) {
      const gate = this.city.gates[index];
      if (!gate.active) continue;
      gate.group.getWorldPosition(this._worldPosition);
      const collectRadius = Math.max(2.8, gate.radius * 0.72);
      if (this._worldPosition.distanceToSquared(playerPosition) < collectRadius * collectRadius) {
        gate.active = false;
        gate.group.visible = false;
        this.gateCount += 1;
        this._collectPoints(450, 'GATE CLEARED +');
        this._spawnParticles(this._worldPosition, 18, 1.6);
        this.audio.collect(this.combo + 1);
      }
    }
  }

  _collectPoints(basePoints, label) {
    const previousCombo = this.combo;
    if (this.comboTime > 0) {
      this.combo = Math.min(8, this.combo + 1);
    } else {
      this.combo = 1;
    }
    this.comboTime = COMBO_WINDOW;
    const points = basePoints * this.combo;
    this.score += points;

    this.ui.scorePop.textContent = `+${points}`;
    this.ui.scorePop.classList.remove('show');
    void this.ui.scorePop.offsetWidth;
    this.ui.scorePop.classList.add('show');
    this._scorePopTimer = 0.75;

    if (this.combo > previousCombo && this.combo >= 2) {
      this.audio.combo(this.combo);
      this._announce(`${label}${points} // FLOW ×${this.combo}`, 1.15);
    } else {
      this._announce(`${label}${points}`, 0.9);
    }
  }

  _updateCombo(dt) {
    if (this.comboTime > 0) {
      this.comboTime = Math.max(0, this.comboTime - dt);
      if (this.comboTime === 0) this.combo = 1;
    }
    if (this._scorePopTimer > 0) {
      this._scorePopTimer -= dt;
      if (this._scorePopTimer <= 0) this.ui.scorePop.classList.remove('show');
    }
    if (this._announcementTimer > 0) {
      this._announcementTimer -= dt;
      if (this._announcementTimer <= 0) {
        this.ui.announcement.classList.remove('show');
      }
    }
  }

  _updateWarnings() {
    const shownSecond = Math.ceil(this.timeLeft);
    this.ui.hud.classList.toggle('timer-warning', this.timeLeft <= 15 && this.timeLeft > 5);
    this.ui.hud.classList.toggle('timer-danger', this.timeLeft <= 5);
    if (
      this.timeLeft <= 10 &&
      shownSecond !== this.warningSecond &&
      (shownSecond === 10 || shownSecond <= 5)
    ) {
      this.warningSecond = shownSecond;
      this.audio.warning(shownSecond <= 5);
      if (shownSecond > 0) this._announce(`${shownSecond} SECONDS`, 0.72);
    }
  }

  _updateHUD(speedKmh = this.player?.speed * 3.6 || 0) {
    this.ui.score.textContent = String(this.score).padStart(5, '0');
    this.ui.timer.textContent = formatTime(this.timeLeft);
    this.ui.timerFill.style.width = `${clamp((this.timeLeft / RUN_DURATION) * 100, 0, 100)}%`;
    this.ui.speed.textContent = String(Math.round(speedKmh)).padStart(3, '0');
    this.ui.combo.textContent = `×${this.combo}`;
    this.ui.comboFill.style.width = `${clamp((this.comboTime / COMBO_WINDOW) * 100, 0, 100)}%`;
    this.ui.comboDisplay.classList.toggle('active', this.combo > 1);

    const valid = this.swing?.validTarget ?? false;
    const attached = this.swing?.active ?? false;
    this.ui.crosshair.classList.toggle('valid-target', valid && !attached);
    this.ui.crosshair.classList.toggle('attached', attached);
    this.ui.swingStatus.classList.toggle('valid-target', valid && !attached);
    this.ui.swingStatus.classList.toggle('attached', attached);
    this.ui.hud.classList.toggle('valid-target', valid && !attached);
    this.ui.hud.classList.toggle('attached', attached);
    this.ui.targetDistance.textContent = valid
      ? `${Math.round(this.swing.targetDistance)}m`
      : '';
    this.ui.swingLabel.textContent = attached
      ? 'ENERGY CABLE ENGAGED'
      : valid
        ? 'ANCHOR READY // HOLD LMB OR E'
        : 'SEARCHING FOR ANCHOR';

    const highSpeed = speedKmh > 82;
    this.ui.hud.classList.toggle('high-speed', highSpeed);
    this.ui.speedLines.classList.toggle(
      'active',
      highSpeed && !this.settings.reducedMotion,
    );
    this.ui.vignette.style.opacity = String(
      this.settings.reducedMotion ? 0.12 : clamp(0.12 + speedKmh / 520, 0.12, 0.42),
    );
  }

  _announce(message, duration = 1.5) {
    if (!this.ui?.announcement) return;
    this.ui.announcement.textContent = message;
    this.ui.announcement.classList.remove('show');
    void this.ui.announcement.offsetWidth;
    this.ui.announcement.classList.add('show');
    this._announcementTimer = duration;
  }

  _spawnParticles(origin, amount, strength = 1) {
    if (!this.particles) return;
    const positions = this.particles.geometry.attributes.position.array;
    let spawned = 0;
    for (let index = 0; index < this.particleLife.length && spawned < amount; index += 1) {
      if (this.particleLife[index] > 0) continue;
      const angle = ((index * 2.39996 + this.elapsed * 4.7) % (Math.PI * 2));
      const radius = 0.15 + (index % 5) * 0.08;
      positions[index * 3] = origin.x + Math.cos(angle) * radius;
      positions[index * 3 + 1] = origin.y + 0.15 + (index % 3) * 0.08;
      positions[index * 3 + 2] = origin.z + Math.sin(angle) * radius;
      this.particleVelocity[index].set(
        Math.cos(angle) * (1.5 + (index % 4) * 0.45) * strength,
        (2.2 + (index % 5) * 0.7) * strength,
        Math.sin(angle) * (1.5 + ((index + 2) % 4) * 0.45) * strength,
      );
      this.particleLife[index] = 0.42 + (index % 6) * 0.055;
      spawned += 1;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  _updateParticles(dt) {
    if (!this.particles) return;
    const positions = this.particles.geometry.attributes.position.array;
    let changed = false;
    for (let index = 0; index < this.particleLife.length; index += 1) {
      if (this.particleLife[index] <= 0) continue;
      this.particleLife[index] -= dt;
      if (this.particleLife[index] <= 0) {
        positions[index * 3 + 1] = -999;
      } else {
        const velocity = this.particleVelocity[index];
        velocity.y -= 8.5 * dt;
        positions[index * 3] += velocity.x * dt;
        positions[index * 3 + 1] += velocity.y * dt;
        positions[index * 3 + 2] += velocity.z * dt;
        velocity.multiplyScalar(Math.exp(-2.3 * dt));
      }
      changed = true;
    }
    if (changed) this.particles.geometry.attributes.position.needsUpdate = true;
  }

  _clearParticles() {
    if (!this.particles) return;
    const positions = this.particles.geometry.attributes.position.array;
    this.particleLife.fill(0);
    for (let index = 0; index < this.particleLife.length; index += 1) {
      positions[index * 3 + 1] = -999;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }

  _updateBestScoreUI() {
    this.ui.menuBest.textContent = this.bestScore.toLocaleString('en-IN');
  }

  _onResize() {
    if (!this.renderer || !this.camera) return;
    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this._disposed = true;
    this.renderer?.setAnimationLoop(null);
    this.input?.dispose();
    this.audio?.dispose();
    this.swing?.dispose();
    this.player?.dispose();
    this.city?.dispose();
    this.particles?.geometry.dispose();
    this.particles?.material.dispose();
    this.stars?.geometry.dispose();
    this.stars?.material.dispose();
    this.sky?.geometry.dispose();
    this.sky?.material.dispose();
    this.moon?.geometry.dispose();
    this.moon?.material.dispose();
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this._listeners.splice(0).forEach((remove) => remove());
  }
}
