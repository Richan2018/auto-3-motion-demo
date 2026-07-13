const SPRING = {
  duration: 440,
  factor: 0.526,
  stiffness: 320,
  damping: 0.9,
  velocity: 0,
};

const SHIFT_DELAY = 100;
const MORE_APPEAR_DELAY = 100;
const OVERFLOW_STAGGER = 50;
const ADD_OVERFLOW_LAYOUT_DELAY = 50;
const SAFE_GAP = 10;
const COLLAPSED_SCALE = 0.5;
const SVG_NS = "http://www.w3.org/2000/svg";
const AGENTBAR_CENTER_X = 800;
const AGENTBAR_AI_WIDTH = 60;
const AGENTBAR_GAP = 10;
const AGENTBAR_MORE_WIDTH = 60;
const AGENTBAR_STAGGER = 50;
const AGENTBAR_MORE_TOGGLE_DELAY = 100;
const ICON_MORE_EXPAND_SHOW_DELAY = 50;
const ICON_MORE_COLLAPSE_MOVE_DELAY = 100;
const ICON_MORE_COLLAPSE_HIDE_WINDOW = 150;
const AGENT_SIDES = ["left", "right"];
const CAPSULES = {
  A: { width: 164, height: 60 },
  B: { width: 128, height: 60 },
  C: { width: 156, height: 60 },
  D: { width: 200, height: 60 },
};
const RECORDING_MODE = new URLSearchParams(window.location.search).get("recording") === "1";
const RECORDING_FRAME_MS = 1000 / 60;

function createMotionClock() {
  if (!RECORDING_MODE) {
    return {
      now: () => performance.now(),
      setTimeout: (callback, delay) => window.setTimeout(callback, delay),
      clearTimeout: (id) => window.clearTimeout(id),
      requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
      cancelAnimationFrame: (id) => window.cancelAnimationFrame(id),
    };
  }

  let virtualNow = 0;
  let nextId = 1;
  const timers = new Map();
  const rafs = new Map();

  const runDueTimers = () => {
    const dueTimers = [...timers.entries()]
      .filter(([, timer]) => timer.time <= virtualNow + 0.001)
      .sort((a, b) => a[1].time - b[1].time);

    dueTimers.forEach(([id, timer]) => {
      if (!timers.has(id)) return;
      timers.delete(id);
      timer.callback();
    });
  };

  const runAnimationFrame = () => {
    if (rafs.size === 0) return;

    const callbacks = [...rafs.entries()];
    rafs.clear();
    callbacks.forEach(([, callback]) => callback(virtualNow));
  };

  const getNextTimerTime = () =>
    [...timers.values()].reduce(
      (nextTime, timer) => Math.min(nextTime, timer.time),
      Number.POSITIVE_INFINITY,
    );

  const advance = (ms) => {
    const targetTime = virtualNow + Math.max(0, ms);
    let guard = 0;

    while (virtualNow < targetTime - 0.001 && guard < 10000) {
      const nextFrameTime = Math.min(targetTime, virtualNow + RECORDING_FRAME_MS);
      const nextTimerTime = getNextTimerTime();

      virtualNow = Math.min(nextFrameTime, nextTimerTime);
      runDueTimers();
      runAnimationFrame();
      guard += 1;
    }

    if (guard >= 10000) {
      throw new Error("Recording clock exceeded its safety limit.");
    }

    return virtualNow;
  };

  const flush = () => {
    runDueTimers();
    runAnimationFrame();
    return virtualNow;
  };

  const clock = {
    now: () => virtualNow,
    setTimeout(callback, delay = 0) {
      const id = nextId;
      nextId += 1;
      timers.set(id, {
        time: virtualNow + Math.max(0, delay),
        callback,
      });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(callback) {
      const id = nextId;
      nextId += 1;
      rafs.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => rafs.delete(id),
    advance,
    flush,
  };

  window.__motionRecorder = {
    advance: clock.advance,
    flush: clock.flush,
    now: clock.now,
  };

  return clock;
}

const motionClock = createMotionClock();

const statusProgressEl = document.getElementById("status-progress");
const agentLeftSlotEl = document.getElementById("agent-left-capsule-slot");
const agentRightSlotEl = document.getElementById("agent-right-capsule-slot");
const agentMoreSlotEl = document.getElementById("agent-more-slot");
const agentMoreEl = document.getElementById("agent-more");
const agentLeftControlsEl = document.getElementById("agent-left-controls");
const agentLeftControls = Array.from(document.querySelectorAll("#agent-left-controls [data-agent-left-target]"));
const agentRightControlsEl = document.getElementById("agent-right-controls");
const agentRightControls = Array.from(document.querySelectorAll("#agent-right-controls [data-agent-right-target]"));
const agentMoreToggleControl = document.getElementById("agent-more-toggle-control");
const simulationTargets = Array.from(document.querySelectorAll("#icon-list-simulation [data-target-index]"));
const moreSlotEl = document.getElementById("icon-list-more");
const moreButtonEl = moreSlotEl?.querySelector(".more-button");
const moreDividerEl = moreSlotEl?.querySelector(".more-divider");

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function springProgress(progress) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;

  const dampingRatio = SPRING.damping;
  const angularFrequency = Math.sqrt(SPRING.stiffness) * SPRING.factor;
  const dampedFrequency = angularFrequency * Math.sqrt(Math.max(0.0001, 1 - dampingRatio * dampingRatio));
  const time = progress / SPRING.factor;
  const envelope = Math.exp(-dampingRatio * angularFrequency * time);
  const oscillation =
    Math.cos(dampedFrequency * time) +
    ((dampingRatio * angularFrequency - SPRING.velocity) / dampedFrequency) *
      Math.sin(dampedFrequency * time);

  return 1 - envelope * oscillation;
}

function interpolate(from, to, progress) {
  return from + (to - from) * progress;
}

function getGraphicCenter(frameEl, fallbackWidth, fallbackHeight) {
  try {
    const box = frameEl.getBBox();

    if (box.width > 0 && box.height > 0) {
      return {
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      };
    }
  } catch {
    // Fall back to the slot center if the SVG browser API cannot read this node.
  }

  return {
    x: fallbackWidth / 2,
    y: fallbackHeight / 2,
  };
}

function makeScaleMatrix(scale, centerX, centerY) {
  return [
    `matrix(${scale.toFixed(4)}`,
    "0",
    "0",
    `${scale.toFixed(4)}`,
    `${(centerX * (1 - scale)).toFixed(3)}`,
    `${(centerY * (1 - scale)).toFixed(3)})`,
  ].join(" ");
}

function makeTranslate(x, y) {
  return `translate(${x.toFixed(3)}, ${y.toFixed(3)})`;
}

function createAnimationState() {
  return {
    tokens: {},
    timers: {},
    rafs: {},
  };
}

function cancelEntityKeys(entity, keys) {
  keys.forEach((key) => {
    motionClock.clearTimeout(entity.animations.timers[key]);
    motionClock.cancelAnimationFrame(entity.animations.rafs[key]);
    entity.animations.tokens[key] = Symbol(key);
  });
}

function animateEntity(entity, target, delay = 0) {
  const keys = Object.keys(target);
  if (keys.length === 0) return;

  cancelEntityKeys(entity, keys);
  const token = Symbol("animation");
  keys.forEach((key) => {
    entity.animations.tokens[key] = token;
  });

  const start = () => {
    const from = {};
    keys.forEach((key) => {
      from[key] = entity.current[key];
    });

    const startedAt = motionClock.now();

    const tick = (now) => {
      if (keys.some((key) => entity.animations.tokens[key] !== token)) return;

      const linearProgress = clamp((now - startedAt) / SPRING.duration, 0, 1);
      const easedProgress = springProgress(linearProgress);

      keys.forEach((key) => {
        entity.current[key] = interpolate(from[key], target[key], easedProgress);
      });

      entity.render();

      if (linearProgress < 1) {
        const raf = motionClock.requestAnimationFrame(tick);
        keys.forEach((key) => {
          entity.animations.rafs[key] = raf;
        });
        return;
      }

      keys.forEach((key) => {
        entity.current[key] = target[key];
      });
      entity.render();
    };

    const raf = motionClock.requestAnimationFrame(tick);
    keys.forEach((key) => {
      entity.animations.rafs[key] = raf;
    });
  };

  if (delay > 0) {
    const timer = motionClock.setTimeout(start, delay);
    keys.forEach((key) => {
      entity.animations.timers[key] = timer;
    });
    return;
  }

  start();
}

function setEntity(entity, target) {
  cancelEntityKeys(entity, Object.keys(target));
  Object.assign(entity.current, target);
  entity.render();
}

function getAgentbarGapForVisibility(leftVisible, rightVisible) {
  return leftVisible && rightVisible ? AGENTBAR_GAP : 0;
}

function getAgentbarWidth(leftWidth, rightWidth, moreWidth, gapWidth = 0) {
  return AGENTBAR_AI_WIDTH + leftWidth + gapWidth + rightWidth + moreWidth;
}

function getAgentbarLeftForState(leftWidth, rightWidth, moreWidth, gapWidth = 0) {
  return AGENTBAR_CENTER_X - getAgentbarWidth(leftWidth, rightWidth, moreWidth, gapWidth) / 2;
}

function getCapsuleWidth(capsuleId) {
  return CAPSULES[capsuleId]?.width ?? 0;
}

function getCapsuleHeight(capsuleId) {
  return CAPSULES[capsuleId]?.height ?? 60;
}

function createNumberLabel(x, y, value, className) {
  const text = document.createElementNS(SVG_NS, "text");
  text.classList.add("number-label", className);
  text.setAttribute("x", String(x));
  text.setAttribute("y", String(y));
  text.textContent = String(value);
  return text;
}

function getSimulationFrameCenter(target) {
  const frame = target.querySelector(".simulation-frame");
  if (!frame) return null;

  if (frame.tagName.toLowerCase() === "circle") {
    return {
      x: Number(frame.getAttribute("cx")),
      y: Number(frame.getAttribute("cy")),
    };
  }

  return {
    x: Number(frame.getAttribute("x")) + Number(frame.getAttribute("width")) / 2,
    y: Number(frame.getAttribute("y")) + Number(frame.getAttribute("height")) / 2,
  };
}

const iconItems = Array.from(document.querySelectorAll("#icon-list [data-icon-index]"))
  .map((el) => {
    const frameEl = el.querySelector(".icon-frame");
    const x = Number(el.dataset.x);
    const y = Number(el.dataset.y);
    const width = Number(el.dataset.width);
    const height = Number(el.dataset.height);
    const initiallyCollapsed = el.dataset.initialCollapsed === "true";
    const center = getGraphicCenter(frameEl, width, height);

    const item = {
      slotEl: el,
      frameEl,
      index: Number(el.dataset.iconIndex),
      originalX: x,
      y,
      width,
      height,
      centerX: center.x,
      centerY: center.y,
      desiredVisible: !initiallyCollapsed,
      current: {
        x,
        scale: initiallyCollapsed ? COLLAPSED_SCALE : 1,
        opacity: initiallyCollapsed ? 0 : 1,
      },
      animations: createAnimationState(),
      render() {
        this.slotEl.setAttribute("transform", makeTranslate(this.current.x, this.y));
        this.frameEl.setAttribute(
          "transform",
          makeScaleMatrix(this.current.scale, this.centerX, this.centerY),
        );
        this.frameEl.style.opacity = String(clamp(this.current.opacity, 0, 1));
      },
    };

    return item;
  })
  .sort((a, b) => a.index - b.index);

const byIndex = new Map(iconItems.map((item) => [item.index, item]));
const firstSlotX = iconItems[0]?.originalX ?? 20;
const slotWidth = iconItems[0]?.width ?? 60;
const slotStep = inferSlotStep();
const agentCapsules = {
  left: new Map(),
  right: new Map(),
};
const agentbarState = {
  currentCapsules: {
    left: "D",
    right: "D",
  },
  capsuleVisible: {
    left: true,
    right: true,
  },
  userWantsMoreVisible: true,
  busy: false,
};
let agentbarItem = null;
let agentMoreItem = null;

addNumberLabels();

agentbarItem = createAgentbarItem();
agentMoreItem = createAgentMoreItem();
initializeAgentbar();

const moreItem = createMoreItem();
let currentLayout = null;
let iconListExpanded = false;
let iconListBusy = false;
let iconListExpandOffset = 0;

function addNumberLabels() {
  iconItems.forEach((item) => {
    if (item.index < 2 || item.frameEl.querySelector(".icon-number-label")) return;

    item.frameEl.append(
      createNumberLabel(item.centerX, item.centerY, item.index - 1, "icon-number-label"),
    );
  });

  simulationTargets.forEach((target) => {
    const index = Number(target.dataset.targetIndex);
    if (index < 2 || target.querySelector(".simulation-number-label")) return;

    const center = getSimulationFrameCenter(target);
    if (!center) return;

    target.append(
      createNumberLabel(center.x, center.y, index - 1, "simulation-number-label"),
    );
  });
}

function cloneAgentbarState() {
  return {
    currentCapsules: { ...agentbarState.currentCapsules },
    capsuleVisible: { ...agentbarState.capsuleVisible },
    userWantsMoreVisible: agentbarState.userWantsMoreVisible,
  };
}

function getEffectiveAgentMoreVisible(state) {
  return (
    state.userWantsMoreVisible &&
    state.capsuleVisible.left &&
    state.capsuleVisible.right
  );
}

function getAgentMoreToggleAvailable(state) {
  return state.capsuleVisible.left && state.capsuleVisible.right;
}

function getAgentbarTargetFromState(state) {
  const leftWidth = state.capsuleVisible.left
    ? getCapsuleWidth(state.currentCapsules.left)
    : 0;
  const rightWidth = state.capsuleVisible.right
    ? getCapsuleWidth(state.currentCapsules.right)
    : 0;
  const moreVisible = getEffectiveAgentMoreVisible(state);
  const moreWidth = moreVisible ? AGENTBAR_MORE_WIDTH : 0;
  const gapWidth = getAgentbarGapForVisibility(
    state.capsuleVisible.left,
    state.capsuleVisible.right,
  );

  return {
    leftWidth,
    rightWidth,
    gapWidth,
    moreWidth,
    moreVisible,
    left: getAgentbarLeftForState(leftWidth, rightWidth, moreWidth, gapWidth),
  };
}

function createAgentCapsuleEntity(el) {
  const side = el.dataset.agentSide;
  const capsuleId = el.dataset.capsuleId;
  const width = Number(el.dataset.width || getCapsuleWidth(capsuleId));
  const height = Number(el.dataset.height || getCapsuleHeight(capsuleId));
  const isVisible =
    side &&
    capsuleId === agentbarState.currentCapsules[side] &&
    agentbarState.capsuleVisible[side];

  return {
    el,
    side,
    id: capsuleId,
    width,
    height,
    centerX: width / 2,
    centerY: height / 2,
    current: {
      scale: isVisible ? 1 : COLLAPSED_SCALE,
      opacity: isVisible ? 1 : 0,
    },
    animations: createAnimationState(),
    render() {
      this.el.setAttribute(
        "transform",
        makeScaleMatrix(this.current.scale, this.centerX, this.centerY),
      );
      this.el.style.opacity = String(clamp(this.current.opacity, 0, 1));
      this.el.setAttribute("aria-hidden", this.current.opacity > 0.01 ? "false" : "true");
    },
  };
}

function createAgentbarItem() {
  if (!statusProgressEl || !agentLeftSlotEl || !agentRightSlotEl || !agentMoreSlotEl) return null;

  Array.from(statusProgressEl.querySelectorAll(".agent-capsule")).forEach((el) => {
    const entity = createAgentCapsuleEntity(el);
    if (entity.side && agentCapsules[entity.side]) {
      agentCapsules[entity.side].set(entity.id, entity);
    }
  });

  const initial = getAgentbarTargetFromState(agentbarState);

  return {
    el: statusProgressEl,
    leftSlotEl: agentLeftSlotEl,
    rightSlotEl: agentRightSlotEl,
    moreSlotEl: agentMoreSlotEl,
    targetLeft: initial.left,
    current: {
      left: initial.left,
      leftWidth: initial.leftWidth,
      rightWidth: initial.rightWidth,
      gapWidth: initial.gapWidth,
      moreWidth: initial.moreWidth,
      opacity: 1,
    },
    animations: createAnimationState(),
    render() {
      const rightX = AGENTBAR_AI_WIDTH + this.current.leftWidth + this.current.gapWidth;
      const moreX = rightX + this.current.rightWidth;

      this.el.setAttribute("transform", makeTranslate(this.current.left, 0));
      this.el.style.opacity = String(clamp(this.current.opacity, 0, 1));
      this.leftSlotEl.setAttribute("transform", makeTranslate(AGENTBAR_AI_WIDTH, 0));
      this.rightSlotEl.setAttribute("transform", makeTranslate(rightX, 0));
      this.moreSlotEl.setAttribute("transform", makeTranslate(moreX, 0));
    },
  };
}

function createAgentMoreItem() {
  if (!agentMoreEl) return null;

  const width = Number(agentMoreEl.dataset.width || AGENTBAR_MORE_WIDTH);
  const height = Number(agentMoreEl.dataset.height || 60);
  const center = getGraphicCenter(agentMoreEl, width, height);
  const initial = getAgentbarTargetFromState(agentbarState);

  return {
    el: agentMoreEl,
    width,
    height,
    centerX: center.x,
    centerY: center.y,
    current: {
      scale: initial.moreVisible ? 1 : COLLAPSED_SCALE,
      opacity: initial.moreVisible ? 1 : 0,
    },
    animations: createAnimationState(),
    render() {
      this.el.setAttribute(
        "transform",
        makeScaleMatrix(this.current.scale, this.centerX, this.centerY),
      );
      this.el.style.opacity = String(clamp(this.current.opacity, 0, 1));
      this.el.setAttribute("aria-hidden", this.current.opacity > 0.01 ? "false" : "true");
    },
  };
}

function initializeAgentbar() {
  if (!agentbarItem) return;
  const initial = getAgentbarTargetFromState(agentbarState);

  setEntity(agentbarItem, {
    left: initial.left,
    leftWidth: initial.leftWidth,
    rightWidth: initial.rightWidth,
    gapWidth: initial.gapWidth,
    moreWidth: initial.moreWidth,
    opacity: 1,
  });

  AGENT_SIDES.forEach((side) => {
    agentCapsules[side].forEach((capsule, capsuleId) => {
      const isVisible =
        capsuleId === agentbarState.currentCapsules[side] &&
        agentbarState.capsuleVisible[side];

      setEntity(capsule, {
        scale: isVisible ? 1 : COLLAPSED_SCALE,
        opacity: isVisible ? 1 : 0,
      });
    });
  });

  if (agentMoreItem) {
    setEntity(agentMoreItem, {
      scale: initial.moreVisible ? 1 : COLLAPSED_SCALE,
      opacity: initial.moreVisible ? 1 : 0,
    });
  }
}

function inferSlotStep() {
  if (iconItems.length < 2) return slotWidth + 10;

  const first = iconItems[0];
  const second = iconItems[1];
  return second.originalX - first.originalX;
}

function slotX(position) {
  return firstSlotX + position * slotStep;
}

function getAgentbarLeft() {
  if (agentbarItem) return agentbarItem.targetLeft ?? agentbarItem.current.left;

  try {
    return statusProgressEl.getBBox().x;
  } catch {
    return 535;
  }
}

function createMoreItem() {
  if (!moreSlotEl || !moreButtonEl || !moreDividerEl) return null;

  const x = Number(moreSlotEl.dataset.x);
  const y = Number(moreSlotEl.dataset.y);
  const width = Number(moreSlotEl.dataset.width);
  const height = Number(moreSlotEl.dataset.height);
  const buttonCenter = getGraphicCenter(moreButtonEl, width, height);

  return {
    slotEl: moreSlotEl,
    buttonEl: moreButtonEl,
    dividerEl: moreDividerEl,
    y,
    width,
    height,
    centerX: buttonCenter.x,
    centerY: buttonCenter.y,
    current: {
      x,
      scale: COLLAPSED_SCALE,
      opacity: 0,
    },
    animations: createAnimationState(),
    render() {
      this.slotEl.setAttribute("transform", makeTranslate(this.current.x, this.y));
      this.buttonEl.setAttribute(
        "transform",
        makeScaleMatrix(this.current.scale, this.centerX, this.centerY),
      );
      const opacity = String(clamp(this.current.opacity, 0, 1));
      this.buttonEl.style.opacity = opacity;
      this.dividerEl.style.opacity = opacity;
      this.slotEl.setAttribute("aria-hidden", this.current.opacity > 0.01 ? "false" : "true");
    },
  };
}

function makeLayout(renderedItems, overflowItems, morePosition = null, forceMoreVisible = false) {
  return {
    renderedItems,
    overflowItems,
    moreVisible: forceMoreVisible || overflowItems.length > 0,
    morePosition,
    moreX: morePosition == null ? moreItem?.current.x ?? slotX(0) : slotX(morePosition),
    renderedSet: new Set(renderedItems.map((item) => item.index)),
    overflowSet: new Set(overflowItems.map((item) => item.index)),
  };
}

function computeLayout(agentbarLeft = getAgentbarLeft()) {
  const desiredItems = iconItems.filter((item) => item.desiredVisible);
  if (desiredItems.length === 0) return makeLayout([], []);

  const safeRight = agentbarLeft - SAFE_GAP;
  const lastIconRight = slotX(desiredItems.length - 1) + slotWidth;

  if (lastIconRight <= safeRight) {
    return makeLayout(desiredItems, []);
  }

  const moreWidth = moreItem?.width ?? slotWidth;
  let morePosition = desiredItems.length - 1;

  while (morePosition > 0 && slotX(morePosition) + moreWidth > safeRight) {
    morePosition -= 1;
  }

  const renderedItems = desiredItems.slice(0, morePosition);
  const overflowItems = desiredItems.slice(morePosition);

  return makeLayout(renderedItems, overflowItems, morePosition);
}

function getRenderedOrder(layout) {
  return new Map(layout.renderedItems.map((item, position) => [item.index, position]));
}

function getOverflowOrder(layout) {
  return new Map(layout.overflowItems.map((item, position) => [item.index, position]));
}

function getLayoutDelay(prevLayout, nextLayout, toggledVisible) {
  if (toggledVisible === false && prevLayout?.moreVisible && !nextLayout.moreVisible) return 0;
  if (toggledVisible === false) return SHIFT_DELAY;
  if (toggledVisible === true && nextLayout.moreVisible) return ADD_OVERFLOW_LAYOUT_DELAY;
  return 0;
}

function getShowDelay(item, prevLayout, layoutDelay) {
  if (prevLayout?.overflowSet.has(item.index)) {
    const prevOverflowOrder = getOverflowOrder(prevLayout).get(item.index) ?? 0;
    return layoutDelay + OVERFLOW_STAGGER * (prevOverflowOrder + 1);
  }

  if (!prevLayout?.renderedSet.has(item.index)) {
    return layoutDelay + SHIFT_DELAY;
  }

  return layoutDelay;
}

function getDesiredItems() {
  return iconItems.filter((item) => item.desiredVisible);
}

function makeExpandedLayout() {
  const desiredItems = getDesiredItems();
  return makeLayout(desiredItems, [], desiredItems.length, desiredItems.length > 0);
}

function getCollapseHideStagger(count) {
  if (count <= 1) return 0;
  return Math.min(OVERFLOW_STAGGER, ICON_MORE_COLLAPSE_HIDE_WINDOW / (count - 1));
}

function setIconListBusy(delay) {
  iconListBusy = true;
  motionClock.setTimeout(() => {
    iconListBusy = false;
  }, delay + SPRING.duration + 80);
}

function getCurrentAgentbarTarget() {
  return getAgentbarTargetFromState(agentbarState);
}

function updateSimulationHighlights() {
  simulationTargets.forEach((target) => {
    const index = Number(target.dataset.targetIndex);
    const item = byIndex.get(index);
    const isInList = item?.desiredVisible === true;

    target.classList.toggle("is-visible", isInList);
    target.setAttribute("aria-pressed", String(isInList));
  });
}

function applyInitialLayout() {
  const layout = computeLayout();
  const renderedOrder = getRenderedOrder(layout);

  iconItems.forEach((item) => {
    if (layout.renderedSet.has(item.index)) {
      setEntity(item, {
        x: slotX(renderedOrder.get(item.index)),
        scale: 1,
        opacity: 1,
      });
      return;
    }

    if (layout.overflowSet.has(item.index)) {
      setEntity(item, {
        x: layout.moreX,
        scale: COLLAPSED_SCALE,
        opacity: 0,
      });
      return;
    }

    setEntity(item, {
      x: item.current.x,
      scale: COLLAPSED_SCALE,
      opacity: 0,
    });
  });

  if (moreItem) {
    setEntity(moreItem, {
      x: layout.moreVisible ? layout.moreX : slotX(Math.max(0, layout.renderedItems.length - 1)),
      scale: layout.moreVisible ? 1 : COLLAPSED_SCALE,
      opacity: layout.moreVisible ? 1 : 0,
    });
  }

  updateSimulationHighlights();
  updateAgentControlState();
  currentLayout = layout;
}

function applyLayout(toggledVisible = null, options = {}) {
  const prevLayout = currentLayout ?? makeLayout([], []);
  const nextLayout = options.nextLayout ?? computeLayout(options.agentbarLeft ?? getAgentbarLeft());
  const renderedOrder = getRenderedOrder(nextLayout);
  const layoutDelay = options.layoutDelay ?? getLayoutDelay(prevLayout, nextLayout, toggledVisible);
  const moreAppearDelay = options.moreAppearDelay ?? MORE_APPEAR_DELAY;
  const moreDisappearDelay = options.moreDisappearDelay ?? 0;
  const moreAppearing = !prevLayout.moreVisible && nextLayout.moreVisible;
  const moreDisappearing = prevLayout.moreVisible && !nextLayout.moreVisible;

  iconItems.forEach((item) => {
    const wasRendered = prevLayout.renderedSet.has(item.index);
    const isRendered = nextLayout.renderedSet.has(item.index);
    const isOverflow = nextLayout.overflowSet.has(item.index);

    if (isRendered) {
      animateEntity(item, { x: slotX(renderedOrder.get(item.index)) }, layoutDelay);

      if (!wasRendered || item.current.opacity < 0.999 || item.current.scale < 0.999) {
        animateEntity(item, { scale: 1, opacity: 1 }, getShowDelay(item, prevLayout, layoutDelay));
      }
      return;
    }

    if (isOverflow) {
      animateEntity(item, { x: nextLayout.moreX }, layoutDelay);

      if (wasRendered || item.current.opacity > 0.001 || item.current.scale > COLLAPSED_SCALE + 0.001) {
        animateEntity(item, { scale: COLLAPSED_SCALE, opacity: 0 }, 0);
      }
      return;
    }

    if (wasRendered || item.current.opacity > 0.001 || item.current.scale > COLLAPSED_SCALE + 0.001) {
      animateEntity(item, { scale: COLLAPSED_SCALE, opacity: 0 }, 0);
    }
  });

  if (moreItem) {
    if (nextLayout.moreVisible) {
      animateEntity(moreItem, { x: nextLayout.moreX }, layoutDelay);
      animateEntity(
        moreItem,
        { scale: 1, opacity: 1 },
        moreAppearing ? moreAppearDelay : 0,
      );
    } else if (moreDisappearing) {
      animateEntity(moreItem, { scale: COLLAPSED_SCALE, opacity: 0 }, moreDisappearDelay);
    }
  }

  updateSimulationHighlights();
  currentLayout = nextLayout;
}

function applyExpandedLayout(options = {}) {
  const prevLayout = currentLayout ?? makeLayout([], []);
  const nextLayout = makeExpandedLayout();
  const renderedOrder = getRenderedOrder(nextLayout);
  const moreDelay = options.moreDelay ?? 0;
  const agentbarDelay = options.agentbarDelay ?? moreDelay;
  const targetMoreX = nextLayout.moreX;
  const moreDelta = moreItem ? targetMoreX - moreItem.current.x : 0;
  const appearingItems = nextLayout.renderedItems.filter(
    (item) =>
      !prevLayout.renderedSet.has(item.index) ||
      item.current.opacity < 0.999 ||
      item.current.scale < 0.999,
  );

  iconListExpandOffset += moreDelta;

  iconItems.forEach((item) => {
    const isRendered = nextLayout.renderedSet.has(item.index);

    if (isRendered) {
      animateEntity(item, { x: slotX(renderedOrder.get(item.index)) }, moreDelay);

      const appearIndex = appearingItems.findIndex((appearingItem) => appearingItem.index === item.index);
      if (appearIndex >= 0) {
        animateEntity(
          item,
          { scale: 1, opacity: 1 },
          moreDelay + ICON_MORE_EXPAND_SHOW_DELAY + appearIndex * OVERFLOW_STAGGER,
        );
      }
      return;
    }

    if (item.current.opacity > 0.001 || item.current.scale > COLLAPSED_SCALE + 0.001) {
      animateEntity(item, { scale: COLLAPSED_SCALE, opacity: 0 }, 0);
    }
  });

  if (moreItem) {
    animateEntity(moreItem, { x: targetMoreX }, moreDelay);
    animateEntity(moreItem, { scale: 1, opacity: 1 }, moreDelay);
  }

  if (agentbarItem) {
    animateAgentbarTo(getCurrentAgentbarTarget(), agentbarDelay, {
      offset: iconListExpandOffset,
      opacity: 0,
    });
  }

  updateSimulationHighlights();
  currentLayout = nextLayout;

  return Math.max(
    moreDelay,
    agentbarDelay,
    appearingItems.length > 0
      ? moreDelay + ICON_MORE_EXPAND_SHOW_DELAY + (appearingItems.length - 1) * OVERFLOW_STAGGER
      : 0,
  );
}

function collapseExpandedWithoutMore(nextLayout, options = {}) {
  const delay = options.delay ?? 0;
  const agentTarget = options.agentTarget ?? getCurrentAgentbarTarget();

  iconListExpanded = false;
  iconListExpandOffset = 0;
  applyLayout(null, {
    nextLayout,
    layoutDelay: delay,
    moreDisappearDelay: delay,
  });

  if (agentbarItem) {
    animateAgentbarTo(agentTarget, delay, {
      offset: 0,
      opacity: 1,
    });
  }

  return delay;
}

function collapseExpandedToFolded(nextLayout = computeLayout(getAgentbarLeft()), options = {}) {
  if (!nextLayout.moreVisible) {
    return collapseExpandedWithoutMore(nextLayout, options);
  }

  const moveDelay = options.moveDelay ?? ICON_MORE_COLLAPSE_MOVE_DELAY;
  const agentTarget = options.agentTarget ?? getCurrentAgentbarTarget();
  const renderedOrder = getRenderedOrder(nextLayout);
  const overflowOrder = getOverflowOrder(nextLayout);
  const overflowCount = nextLayout.overflowItems.length;
  const hideStagger = getCollapseHideStagger(overflowCount);
  let latestHideDelay = 0;

  iconItems.forEach((item) => {
    const isRendered = nextLayout.renderedSet.has(item.index);
    const isOverflow = nextLayout.overflowSet.has(item.index);

    if (isRendered) {
      animateEntity(item, { x: slotX(renderedOrder.get(item.index)) }, moveDelay);

      if (item.current.opacity < 0.999 || item.current.scale < 0.999) {
        animateEntity(item, { scale: 1, opacity: 1 }, moveDelay);
      }
      return;
    }

    if (isOverflow) {
      const order = overflowOrder.get(item.index) ?? 0;
      const hideDelay = (overflowCount - 1 - order) * hideStagger;
      latestHideDelay = Math.max(latestHideDelay, hideDelay);

      animateEntity(item, { scale: COLLAPSED_SCALE, opacity: 0 }, hideDelay);
      animateEntity(item, { x: nextLayout.moreX }, moveDelay);
      return;
    }

    if (item.current.opacity > 0.001 || item.current.scale > COLLAPSED_SCALE + 0.001) {
      animateEntity(item, { scale: COLLAPSED_SCALE, opacity: 0 }, 0);
    }
  });

  if (moreItem) {
    animateEntity(moreItem, { x: nextLayout.moreX }, moveDelay);
    animateEntity(moreItem, { scale: 1, opacity: 1 }, moveDelay);
  }

  iconListExpanded = false;
  iconListExpandOffset = 0;

  if (agentbarItem) {
    animateAgentbarTo(agentTarget, moveDelay, {
      offset: 0,
      opacity: 1,
    });
  }

  updateSimulationHighlights();
  currentLayout = nextLayout;

  return Math.max(moveDelay, latestHideDelay);
}

function refreshExpandedLayout() {
  const foldedLayout = computeLayout(getAgentbarLeft());

  if (!foldedLayout.moreVisible) {
    return collapseExpandedWithoutMore(foldedLayout);
  }

  return applyExpandedLayout();
}

function handleIconMoreToggle() {
  if (!moreItem || iconListBusy || agentbarState.busy) return;

  if (iconListExpanded) {
    const delay = collapseExpandedToFolded();
    setIconListBusy(delay);
    return;
  }

  const foldedLayout = currentLayout ?? computeLayout(getAgentbarLeft());
  if (!foldedLayout.moreVisible) return;

  iconListExpanded = true;
  const delay = applyExpandedLayout();
  setIconListBusy(delay);
}

function layoutAddsOverflow(prevLayout, nextLayout) {
  if (!nextLayout.moreVisible) return false;
  if (!prevLayout?.moreVisible) return true;

  return nextLayout.overflowItems.some((item) => !prevLayout.overflowSet.has(item.index));
}

function updateAgentControlState() {
  agentLeftControls.forEach((control) => {
    const target = control.dataset.agentLeftTarget;
    const isSelected =
      agentbarState.capsuleVisible.left && target === agentbarState.currentCapsules.left;

    control.classList.toggle("is-selected", isSelected);
    control.setAttribute("aria-pressed", String(isSelected));
  });

  agentRightControls.forEach((control) => {
    const target = control.dataset.agentRightTarget;
    const isSelected =
      agentbarState.capsuleVisible.right && target === agentbarState.currentCapsules.right;

    control.classList.toggle("is-selected", isSelected);
    control.setAttribute("aria-pressed", String(isSelected));
  });

  if (agentMoreToggleControl) {
    const isAvailable = getAgentMoreToggleAvailable(agentbarState);
    const isMoreVisible = getEffectiveAgentMoreVisible(agentbarState);

    agentMoreToggleControl.classList.toggle("is-selected", isMoreVisible);
    agentMoreToggleControl.classList.toggle("is-more-visible", isAvailable && isMoreVisible);
    agentMoreToggleControl.classList.toggle("is-more-hidden", isAvailable && !isMoreVisible);
    agentMoreToggleControl.classList.toggle("is-unavailable", !isAvailable);
    agentMoreToggleControl.setAttribute("aria-pressed", String(isMoreVisible));
    agentMoreToggleControl.setAttribute("aria-hidden", String(!isAvailable));
    agentMoreToggleControl.setAttribute("tabindex", isAvailable ? "0" : "-1");
  }
}

function animateAgentCapsule(side, capsuleId, target, delay = 0) {
  const capsule = agentCapsules[side]?.get(capsuleId);
  if (!capsule) return;

  animateEntity(capsule, target, delay);
}

function animateAgentMore(target, delay = 0) {
  if (!agentMoreItem) return;

  animateEntity(agentMoreItem, target, delay);
}

function getCurrentAgentbarWidth() {
  if (!agentbarItem) return 0;

  return getAgentbarWidth(
    agentbarItem.current.leftWidth,
    agentbarItem.current.rightWidth,
    agentbarItem.current.moreWidth,
    agentbarItem.current.gapWidth,
  );
}

function animateAgentbarTo(target, delay, options = {}) {
  const offset = options.offset ?? iconListExpandOffset;
  const animationTarget = {
    left: target.left + offset,
    leftWidth: target.leftWidth,
    rightWidth: target.rightWidth,
    gapWidth: target.gapWidth,
    moreWidth: target.moreWidth,
  };

  if (options.opacity != null) {
    animationTarget.opacity = options.opacity;
  }

  agentbarItem.targetLeft = target.left;
  animateEntity(agentbarItem, animationTarget, delay);
}

function commitAgentbarState(nextState) {
  agentbarState.currentCapsules = { ...nextState.currentCapsules };
  agentbarState.capsuleVisible = { ...nextState.capsuleVisible };
  agentbarState.userWantsMoreVisible = nextState.userWantsMoreVisible;
}

function releaseAgentbarBusyAfter(delay) {
  motionClock.setTimeout(() => {
    agentbarState.busy = false;
    updateAgentControlState();
  }, delay + SPRING.duration + 80);
}

function handleAgentCapsuleTarget(side, targetId) {
  if (
    !AGENT_SIDES.includes(side) ||
    !CAPSULES[targetId] ||
    !agentbarItem ||
    agentbarState.busy ||
    iconListBusy
  ) {
    return;
  }

  const prevState = cloneAgentbarState();
  const wasVisible = prevState.capsuleVisible[side];
  const currentId = prevState.currentCapsules[side];
  const isSameTarget = wasVisible && currentId === targetId;
  const nextState = {
    currentCapsules: { ...prevState.currentCapsules },
    capsuleVisible: { ...prevState.capsuleVisible },
    userWantsMoreVisible: prevState.userWantsMoreVisible,
  };

  if (isSameTarget) {
    nextState.capsuleVisible[side] = false;
  } else {
    nextState.currentCapsules[side] = targetId;
    nextState.capsuleVisible[side] = true;
  }

  const prevAgent = getAgentbarTargetFromState(prevState);
  const nextAgent = getAgentbarTargetFromState(nextState);
  const prevLayout = currentLayout ?? computeLayout(agentbarItem.targetLeft);
  const nextLayout = computeLayout(nextAgent.left);
  const isExpanding = getAgentbarWidth(
    nextAgent.leftWidth,
    nextAgent.rightWidth,
    nextAgent.moreWidth,
    nextAgent.gapWidth,
  ) > getCurrentAgentbarWidth() + 0.001;
  const needsIconPreHide =
    !iconListExpanded && isExpanding && layoutAddsOverflow(prevLayout, nextLayout);
  const isSwitchingVisibleCapsule = wasVisible && !isSameTarget;
  const isHidingVisibleCapsule = isSameTarget;
  const isShowingFromHidden = !wasVisible;
  const agentbarDelay =
    isSwitchingVisibleCapsule || isHidingVisibleCapsule || needsIconPreHide
      ? AGENTBAR_STAGGER
      : 0;
  const outgoingId = wasVisible ? currentId : null;
  const incomingId = isSameTarget ? null : targetId;
  const incomingDelay =
    incomingId == null
      ? null
      : isShowingFromHidden
        ? agentbarDelay + AGENTBAR_STAGGER
        : agentbarDelay;
  let agentMoreDelay = null;

  agentbarState.busy = true;

  if (outgoingId) {
    animateAgentCapsule(side, outgoingId, { scale: COLLAPSED_SCALE, opacity: 0 }, 0);
  }

  if (prevAgent.moreVisible && !nextAgent.moreVisible) {
    agentMoreDelay = agentbarDelay;
    animateAgentMore({ scale: COLLAPSED_SCALE, opacity: 0 }, agentMoreDelay);
  } else if (!prevAgent.moreVisible && nextAgent.moreVisible) {
    agentMoreDelay = agentbarDelay;
    animateAgentMore({ scale: 1, opacity: 1 }, agentMoreDelay);
  }

  let iconListDelay = 0;

  if (iconListExpanded) {
    if (nextLayout.moreVisible) {
      animateAgentbarTo(nextAgent, agentbarDelay, { opacity: 0 });
    } else {
      iconListDelay = collapseExpandedWithoutMore(nextLayout, {
        delay: agentbarDelay,
        agentTarget: nextAgent,
      });
    }
  } else {
    animateAgentbarTo(nextAgent, agentbarDelay);
    applyLayout(null, {
      nextLayout,
      layoutDelay: agentbarDelay,
      moreAppearDelay: agentbarDelay,
      moreDisappearDelay: agentbarDelay,
    });
  }

  if (incomingId) {
    animateAgentCapsule(side, incomingId, { scale: 1, opacity: 1 }, incomingDelay);
  }

  commitAgentbarState(nextState);
  updateAgentControlState();
  releaseAgentbarBusyAfter(
    Math.max(agentbarDelay, incomingDelay ?? 0, agentMoreDelay ?? 0, iconListDelay),
  );
}

function handleAgentMoreToggle() {
  if (
    !agentbarItem ||
    agentbarState.busy ||
    iconListBusy ||
    !getAgentMoreToggleAvailable(agentbarState)
  ) {
    return;
  }

  const prevState = cloneAgentbarState();
  const nextState = {
    currentCapsules: { ...prevState.currentCapsules },
    capsuleVisible: { ...prevState.capsuleVisible },
    userWantsMoreVisible: !prevState.userWantsMoreVisible,
  };
  const prevAgent = getAgentbarTargetFromState(prevState);
  const nextAgent = getAgentbarTargetFromState(nextState);

  commitAgentbarState(nextState);

  if (prevAgent.moreVisible === nextAgent.moreVisible) {
    updateAgentControlState();
    return;
  }

  const prevLayout = currentLayout ?? computeLayout(agentbarItem.targetLeft);
  const nextLayout = computeLayout(nextAgent.left);
  const isExpanding = getAgentbarWidth(
    nextAgent.leftWidth,
    nextAgent.rightWidth,
    nextAgent.moreWidth,
    nextAgent.gapWidth,
  ) > getCurrentAgentbarWidth() + 0.001;
  const needsIconPreHide =
    !iconListExpanded && isExpanding && layoutAddsOverflow(prevLayout, nextLayout);
  const agentbarDelay = nextAgent.moreVisible
    ? needsIconPreHide
      ? ADD_OVERFLOW_LAYOUT_DELAY
      : 0
    : AGENTBAR_MORE_TOGGLE_DELAY;
  const agentMoreDelay = nextAgent.moreVisible ? agentbarDelay + AGENTBAR_MORE_TOGGLE_DELAY : 0;

  agentbarState.busy = true;

  animateAgentMore(
    {
      scale: nextAgent.moreVisible ? 1 : COLLAPSED_SCALE,
      opacity: nextAgent.moreVisible ? 1 : 0,
    },
    agentMoreDelay,
  );
  let iconListDelay = 0;

  if (iconListExpanded) {
    if (nextLayout.moreVisible) {
      animateAgentbarTo(nextAgent, agentbarDelay, { opacity: 0 });
    } else {
      iconListDelay = collapseExpandedWithoutMore(nextLayout, {
        delay: agentbarDelay,
        agentTarget: nextAgent,
      });
    }
  } else {
    animateAgentbarTo(nextAgent, agentbarDelay);
    applyLayout(null, {
      nextLayout,
      layoutDelay: agentbarDelay,
      moreAppearDelay: agentbarDelay,
      moreDisappearDelay: agentbarDelay,
    });
  }

  updateAgentControlState();
  releaseAgentbarBusyAfter(Math.max(agentbarDelay, agentMoreDelay, iconListDelay));
}

window.__debugAgentbarState = () => ({
  currentCapsules: { ...agentbarState.currentCapsules },
  capsuleVisible: { ...agentbarState.capsuleVisible },
  userWantsMoreVisible: agentbarState.userWantsMoreVisible,
  effectiveMoreVisible: getEffectiveAgentMoreVisible(agentbarState),
  busy: agentbarState.busy,
  iconListExpanded,
  iconListBusy,
  iconListExpandOffset,
  left: agentbarItem?.current.left ?? null,
  targetLeft: agentbarItem?.targetLeft ?? null,
  leftWidth: agentbarItem?.current.leftWidth ?? null,
  rightWidth: agentbarItem?.current.rightWidth ?? null,
  gapWidth: agentbarItem?.current.gapWidth ?? null,
  moreWidth: agentbarItem?.current.moreWidth ?? null,
  width: agentbarItem ? getCurrentAgentbarWidth() : null,
});

function toggleIcon(index) {
  if (iconListBusy) return;

  const item = byIndex.get(index);
  if (!item) return;

  item.desiredVisible = !item.desiredVisible;

  if (iconListExpanded) {
    const delay = refreshExpandedLayout();
    setIconListBusy(delay);
    return;
  }

  applyLayout(item.desiredVisible);
}

moreButtonEl?.addEventListener("pointerup", (event) => {
  event.preventDefault();
  handleIconMoreToggle();
});

moreButtonEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  handleIconMoreToggle();
});

document.getElementById("icon-list-simulation")?.addEventListener("click", (event) => {
  const target = event.target.closest("[data-target-index]");
  if (!target) return;

  toggleIcon(Number(target.dataset.targetIndex));
});

document.getElementById("icon-list-simulation")?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const target = event.target.closest("[data-target-index]");
  if (!target) return;

  event.preventDefault();
  toggleIcon(Number(target.dataset.targetIndex));
});

agentLeftControlsEl?.addEventListener("click", (event) => {
  const target = event.target.closest("[data-agent-left-target]");
  if (!target || !agentLeftControlsEl.contains(target)) return;

  handleAgentCapsuleTarget("left", target.dataset.agentLeftTarget);
});

agentLeftControlsEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const target = event.target.closest("[data-agent-left-target]");
  if (!target || !agentLeftControlsEl.contains(target)) return;

  event.preventDefault();
  handleAgentCapsuleTarget("left", target.dataset.agentLeftTarget);
});

agentRightControlsEl?.addEventListener("click", (event) => {
  const target = event.target.closest("[data-agent-right-target]");
  if (!target || !agentRightControlsEl.contains(target)) return;

  handleAgentCapsuleTarget("right", target.dataset.agentRightTarget);
});

agentRightControlsEl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const target = event.target.closest("[data-agent-right-target]");
  if (!target || !agentRightControlsEl.contains(target)) return;

  event.preventDefault();
  handleAgentCapsuleTarget("right", target.dataset.agentRightTarget);
});

agentMoreToggleControl?.addEventListener("click", () => {
  handleAgentMoreToggle();
});

agentMoreToggleControl?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;

  event.preventDefault();
  handleAgentMoreToggle();
});

applyInitialLayout();
