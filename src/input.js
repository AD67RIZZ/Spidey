const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return (
    target.matches('input, select, textarea, button') ||
    target.closest('[contenteditable="true"]') !== null
  );
}

/**
 * Collects desktop and touch controls into one small, frame-friendly API.
 *
 * Movement uses x = right and y = forward. Mouse/touch camera deltas are
 * accumulated until consumeLookDelta() is called.
 */
export class InputController {
  constructor(rendererOrElement, options = {}) {
    if (typeof options === 'function') options = { onPause: options };

    const suppliedElement = rendererOrElement?.domElement ?? rendererOrElement;
    this.domElement =
      suppliedElement instanceof Element ? suppliedElement : document.body;

    this.onPause = options.onPause ?? options.pause ?? (() => {});
    this.onPointerLockChange = options.onPointerLockChange ?? (() => {});
    this.onInteract = options.onInteract ?? (() => {});

    this.enabled = options.enabled ?? true;
    this.sensitivity = Number.isFinite(options.sensitivity)
      ? options.sensitivity
      : 1;
    this.touchLookScale = Number.isFinite(options.touchLookScale)
      ? options.touchLookScale
      : 1.15;

    this.isTouch =
      options.isTouch ??
      (navigator.maxTouchPoints > 0 ||
        window.matchMedia?.('(pointer: coarse)').matches === true ||
        'ontouchstart' in window);

    this.keys = new Set();
    this.pointerLocked = document.pointerLockElement === this.domElement;

    this._touchMoveX = 0;
    this._touchMoveY = 0;
    this._lookX = 0;
    this._lookY = 0;
    this._jumpQueued = false;
    this._spaceDown = false;
    this._mouseSwing = false;
    this._touchSwingPointers = new Set();
    this._touchBoostPointers = new Set();
    this._joystickPointer = null;
    this._cameraPointer = null;
    this._cameraLastX = 0;
    this._cameraLastY = 0;
    this._ignoreNextUnlock = false;
    this._listeners = [];
    this._styleRestorers = [];

    const root = options.root ?? document;
    this.touchElements = {
      controls: root.querySelector?.('#mobile-controls') ?? null,
      joystickZone: root.querySelector?.('#joystick-zone') ?? null,
      joystickKnob: root.querySelector?.('#joystick-knob') ?? null,
      cameraZone: root.querySelector?.('#camera-zone') ?? null,
      jump: root.querySelector?.('#touch-jump') ?? null,
      swing: root.querySelector?.('#touch-swing') ?? null,
      boost: root.querySelector?.('#touch-boost') ?? null,
      pause: root.querySelector?.('#touch-pause') ?? null,
    };

    this._bindDesktopControls();
    this._bindTouchControls();
  }

  get movementX() {
    if (!this.enabled) return 0;
    const keyboard =
      (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    return this._normalisedMove(keyboard + this._touchMoveX, this._rawMovementY)
      .x;
  }

  get movementY() {
    if (!this.enabled) return 0;
    return this._normalisedMove(this._rawMovementX, this._keyboardMovementY + this._touchMoveY)
      .y;
  }

  get _rawMovementX() {
    return (
      (this.keys.has('KeyD') ? 1 : 0) -
      (this.keys.has('KeyA') ? 1 : 0) +
      this._touchMoveX
    );
  }

  get _keyboardMovementY() {
    return (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
  }

  get _rawMovementY() {
    return this._keyboardMovementY + this._touchMoveY;
  }

  get sprint() {
    return (
      this.enabled &&
      (this.keys.has('ShiftLeft') ||
        this.keys.has('ShiftRight') ||
        this._touchBoostPointers.size > 0)
    );
  }

  get swingHeld() {
    return (
      this.enabled &&
      (this.keys.has('KeyE') ||
        this._mouseSwing ||
        this._touchSwingPointers.size > 0)
    );
  }

  getMoveVector(target) {
    const move = this.enabled
      ? this._normalisedMove(this._rawMovementX, this._rawMovementY)
      : { x: 0, y: 0 };

    if (target?.set) return target.set(move.x, move.y);
    return move;
  }

  consumeJump() {
    const queued = this.enabled && this._jumpQueued;
    this._jumpQueued = false;
    return queued;
  }

  consumeLookDelta() {
    const rawX = this.enabled ? this._lookX : 0;
    const rawY = this.enabled ? this._lookY : 0;
    this._lookX = 0;
    this._lookY = 0;
    return {
      x: rawX * this.sensitivity,
      y: rawY * this.sensitivity,
      rawX,
      rawY,
    };
  }

  setSensitivity(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) this.sensitivity = clamp(parsed, 0.05, 4);
    return this.sensitivity;
  }

  setEnabled(enabled) {
    this.enabled = Boolean(enabled);
    if (!this.enabled) this.reset();
    return this.enabled;
  }

  setTouchControlsVisible(visible) {
    const show = Boolean(visible) && this.isTouch;
    this.touchElements.controls?.classList.toggle('hidden', !show);
    return show;
  }

  requestPointerLock() {
    if (!this.enabled || this.isTouch || this.pointerLocked) return;
    try {
      const request = this.domElement.requestPointerLock?.();
      if (request?.catch) request.catch(() => {});
    } catch {
      // Pointer lock can be rejected when the call was not user initiated.
    }
  }

  lockPointer() {
    this.requestPointerLock();
  }

  unlockPointer(notifyPause = false) {
    if (document.pointerLockElement !== this.domElement) return;
    this._ignoreNextUnlock = !notifyPause;
    document.exitPointerLock?.();
  }

  reset() {
    this.keys.clear();
    this._touchMoveX = 0;
    this._touchMoveY = 0;
    this._lookX = 0;
    this._lookY = 0;
    this._jumpQueued = false;
    this._spaceDown = false;
    this._mouseSwing = false;
    this._touchSwingPointers.clear();
    this._touchBoostPointers.clear();
    this._joystickPointer = null;
    this._cameraPointer = null;
    this._setPressed(this.touchElements.jump, false);
    this._setPressed(this.touchElements.swing, false);
    this._setPressed(this.touchElements.boost, false);
    if (this.touchElements.joystickKnob) {
      this.touchElements.joystickKnob.style.transform = 'translate3d(0, 0, 0)';
    }
  }

  dispose() {
    this.reset();
    for (const remove of this._listeners.splice(0)) remove();
    for (const restore of this._styleRestorers.splice(0)) restore();
  }

  _normalisedMove(x, y) {
    const length = Math.hypot(x, y);
    if (length > 1) return { x: x / length, y: y / length };
    return { x, y };
  }

  _listen(target, type, listener, options) {
    if (!target?.addEventListener) return;
    target.addEventListener(type, listener, options);
    this._listeners.push(() =>
      target.removeEventListener(type, listener, options),
    );
  }

  _preventDefault(event) {
    event.preventDefault();
  }

  _notifyInteraction(event) {
    this.onInteract(event);
  }

  _bindDesktopControls() {
    this._listen(window, 'keydown', (event) => {
      this._notifyInteraction(event);
      if (isEditableTarget(event.target)) return;

      if (event.code === 'Escape') {
        if (this.enabled && !this.pointerLocked) {
          event.preventDefault();
          this.onPause('escape');
        }
        return;
      }

      if (!this.enabled) return;
      if (
        event.code === 'Space' ||
        event.code.startsWith('Arrow') ||
        ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE'].includes(event.code)
      ) {
        event.preventDefault();
      }

      if (event.code === 'Space' && !this._spaceDown && !event.repeat) {
        this._spaceDown = true;
        this._jumpQueued = true;
      }
      this.keys.add(event.code);
    });

    this._listen(window, 'keyup', (event) => {
      this.keys.delete(event.code);
      if (event.code === 'Space') this._spaceDown = false;
    });

    this._listen(window, 'blur', () => this.reset());
    this._listen(document, 'visibilitychange', () => {
      if (document.hidden) this.reset();
    });

    this._listen(this.domElement, 'pointerdown', (event) => {
      this._notifyInteraction(event);
      if (!this.enabled || event.pointerType === 'touch') return;
      if (event.button === 0) {
        this._mouseSwing = true;
        this.requestPointerLock();
      }
    });

    this._listen(window, 'pointerup', (event) => {
      if (event.pointerType !== 'touch' && event.button === 0) {
        this._mouseSwing = false;
      }
    });

    this._listen(document, 'mousemove', (event) => {
      if (!this.enabled || document.pointerLockElement !== this.domElement) return;
      this._lookX += event.movementX ?? 0;
      this._lookY += event.movementY ?? 0;
    });

    this._listen(document, 'pointerlockchange', () => {
      const wasLocked = this.pointerLocked;
      this.pointerLocked = document.pointerLockElement === this.domElement;
      this.onPointerLockChange(this.pointerLocked);

      if (wasLocked && !this.pointerLocked) {
        this._mouseSwing = false;
        this._lookX = 0;
        this._lookY = 0;
        if (this._ignoreNextUnlock) {
          this._ignoreNextUnlock = false;
        } else if (this.enabled) {
          this.onPause('pointer-lock-lost');
        }
      }
    });

    this._listen(document, 'pointerlockerror', () => {
      this.pointerLocked = false;
      this.onPointerLockChange(false);
    });

    this._listen(this.domElement, 'contextmenu', this._preventDefault);
  }

  _bindTouchControls() {
    const elements = Object.values(this.touchElements).filter(Boolean);
    for (const element of elements) {
      const previous = element.style.touchAction;
      element.style.touchAction = 'none';
      this._styleRestorers.push(() => {
        element.style.touchAction = previous;
      });
      this._listen(element, 'contextmenu', this._preventDefault);
      this._listen(element, 'touchmove', this._preventDefault, { passive: false });
    }

    const zone = this.touchElements.joystickZone;
    this._listen(zone, 'pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') return;
      event.preventDefault();
      this._notifyInteraction(event);
      if (this._joystickPointer !== null) return;
      this._joystickPointer = event.pointerId;
      zone.setPointerCapture?.(event.pointerId);
      this._updateJoystick(event);
    });
    this._listen(zone, 'pointermove', (event) => {
      if (event.pointerId !== this._joystickPointer) return;
      event.preventDefault();
      this._updateJoystick(event);
    });
    const endJoystick = (event) => {
      if (event.pointerId !== this._joystickPointer) return;
      event.preventDefault();
      this._joystickPointer = null;
      this._touchMoveX = 0;
      this._touchMoveY = 0;
      if (this.touchElements.joystickKnob) {
        this.touchElements.joystickKnob.style.transform =
          'translate3d(0, 0, 0)';
      }
    };
    this._listen(zone, 'pointerup', endJoystick);
    this._listen(zone, 'pointercancel', endJoystick);
    this._listen(zone, 'lostpointercapture', endJoystick);

    const camera = this.touchElements.cameraZone;
    this._listen(camera, 'pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') return;
      event.preventDefault();
      this._notifyInteraction(event);
      if (this._cameraPointer !== null) return;
      this._cameraPointer = event.pointerId;
      this._cameraLastX = event.clientX;
      this._cameraLastY = event.clientY;
      camera.setPointerCapture?.(event.pointerId);
    });
    this._listen(camera, 'pointermove', (event) => {
      if (event.pointerId !== this._cameraPointer) return;
      event.preventDefault();
      this._lookX += (event.clientX - this._cameraLastX) * this.touchLookScale;
      this._lookY += (event.clientY - this._cameraLastY) * this.touchLookScale;
      this._cameraLastX = event.clientX;
      this._cameraLastY = event.clientY;
    });
    const endCamera = (event) => {
      if (event.pointerId !== this._cameraPointer) return;
      event.preventDefault();
      this._cameraPointer = null;
    };
    this._listen(camera, 'pointerup', endCamera);
    this._listen(camera, 'pointercancel', endCamera);
    this._listen(camera, 'lostpointercapture', endCamera);

    this._bindTouchButton(this.touchElements.jump, {
      down: () => {
        if (!this._spaceDown) this._jumpQueued = true;
        this._spaceDown = true;
      },
      up: () => {
        this._spaceDown = false;
      },
    });

    this._bindTouchButton(this.touchElements.swing, {
      down: (pointerId) => this._touchSwingPointers.add(pointerId),
      up: (pointerId) => this._touchSwingPointers.delete(pointerId),
    });

    this._bindTouchButton(this.touchElements.boost, {
      down: (pointerId) => this._touchBoostPointers.add(pointerId),
      up: (pointerId) => this._touchBoostPointers.delete(pointerId),
    });

    this._listen(this.touchElements.pause, 'pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') return;
      event.preventDefault();
      this._notifyInteraction(event);
      this.onPause('touch');
    });
  }

  _bindTouchButton(element, handlers) {
    if (!element) return;
    const pointers = new Set();

    this._listen(element, 'pointerdown', (event) => {
      if (!this.enabled || event.pointerType === 'mouse') return;
      event.preventDefault();
      this._notifyInteraction(event);
      pointers.add(event.pointerId);
      element.setPointerCapture?.(event.pointerId);
      handlers.down?.(event.pointerId);
      this._setPressed(element, true);
    });

    const release = (event) => {
      if (!pointers.has(event.pointerId)) return;
      event.preventDefault();
      pointers.delete(event.pointerId);
      handlers.up?.(event.pointerId);
      this._setPressed(element, pointers.size > 0);
    };
    this._listen(element, 'pointerup', release);
    this._listen(element, 'pointercancel', release);
    this._listen(element, 'lostpointercapture', release);
  }

  _updateJoystick(event) {
    const zone = this.touchElements.joystickZone;
    if (!zone) return;
    const rect = zone.getBoundingClientRect();
    const radius = Math.max(24, Math.min(rect.width, rect.height) * 0.34);
    let x = event.clientX - (rect.left + rect.width * 0.5);
    let y = event.clientY - (rect.top + rect.height * 0.5);
    const length = Math.hypot(x, y);
    if (length > radius) {
      x = (x / length) * radius;
      y = (y / length) * radius;
    }

    this._touchMoveX = clamp(x / radius, -1, 1);
    this._touchMoveY = clamp(-y / radius, -1, 1);
    if (this.touchElements.joystickKnob) {
      this.touchElements.joystickKnob.style.transform =
        `translate3d(${x}px, ${y}px, 0)`;
    }
  }

  _setPressed(element, pressed) {
    if (!element) return;
    element.classList.toggle('is-active', pressed);
    element.setAttribute('aria-pressed', String(pressed));
  }
}
