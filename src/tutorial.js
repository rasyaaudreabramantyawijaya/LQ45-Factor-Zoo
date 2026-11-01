(function () {
  'use strict';

  const root = document.getElementById('product-tour');
  const launchButton = document.getElementById('tour-start-button');
  const backdrop = document.getElementById('tour-backdrop');
  const spotlight = document.getElementById('tour-spotlight');
  const pointer = document.getElementById('tour-pointer');
  const pointerLabel = document.getElementById('tour-pointer-label');
  const panel = document.getElementById('tour-panel');
  const title = document.getElementById('tour-title');
  const description = document.getElementById('tour-description');
  const stepCount = document.getElementById('tour-step-count');
  const progress = document.getElementById('tour-progress-fill');
  const autoToggle = document.getElementById('tour-auto-toggle');
  const countdownLabel = document.getElementById('tour-countdown');
  const backButton = document.getElementById('tour-back');
  const nextButton = document.getElementById('tour-next');
  const closeButton = document.getElementById('tour-close');
  const controls = document.querySelector('.tour-controls');
  const dataHelp = document.getElementById('data-help');
  const dataHelpButton = document.getElementById('data-help-button');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const STEP_DURATION_MS = 10000;
  const SCROLL_SETTLE_MS = 760;
  const steps = [
    {
      selector: '#data-import-button',
      title: 'Bring in your data',
      description: 'Use + to choose CSV files or a ZIP from your system file picker, or drop files onto the chart. The browser reads and recalculates the data locally. This tour will not open the picker or import data for you.',
      action: 'click',
      pointer: 'Click + to select CSV / ZIP'
    },
    {
      selector: '#data-help-button',
      title: 'Check the required inputs',
      description: 'The i panel explains the CSV and ZIP formats, price and IHSG history, valuation and financial ratios, peer groups, and the minimum coverage needed for the available indicators. The downloadable template provides the column headers.',
      action: 'click',
      pointer: 'Click i to see data requirements',
      showHelp: true
    },
    {
      selector: '.axis-controls',
      title: 'Choose a preset or customize axes',
      description: 'Choose a preset to change the X, Y, and Z measures together, or choose each axis yourself. Each selection updates the plotted issuers, point details, rankings and explanation cards. Color remains Low Volatility. Presets describe views of the supplied data, not trading signals.',
      action: 'read',
      pointer: 'Choose a preset or set X, Y and Z'
    },
    {
      selector: '#factor-zoo-canvas',
      scrollSelector: '.chart-frame',
      title: 'Explore the 3D factor map',
      description: 'Each dot is an issuer with scores available for the three selected axes. Low Volatility controls color; gray means that score is unavailable. Hover an issuer to inspect its selected measures, raw inputs, component z-scores, peer counts, and data coverage.',
      action: 'hover',
      pointer: 'Hover a point for its evidence',
      samplePoint: true
    },
    {
      selector: '#leaderboard-section',
      title: 'Compare the live rankings',
      description: 'The X, Y and Z lists follow the selected axes and rank issuers visible in the plot. Choose how many to show. Each indicator has an automatic higher- or lower-is-favored criterion, shown on its card. For a lower-favored measure the ranking score reverses the axis score; the point tooltip keeps the original values and axis scores. Low Volatility uses its existing score. Rankings are descriptive, not forecasts or recommendations.',
      action: 'read',
      pointer: 'Rankings follow the active data'
    },
    {
      selector: '.value-method',
      title: 'X axis: selected measure',
      description: 'This card explains the current X-axis measure and its inputs. Changing the preset or axis selection updates it.',
      action: 'read',
      pointer: 'Read the X-axis inputs'
    },
    {
      selector: '.momentum-method',
      title: 'Y axis: selected measure',
      description: 'This card explains the current Y-axis measure and its inputs. Changing the preset or axis selection updates it.',
      action: 'read',
      pointer: 'Read the Y-axis inputs'
    },
    {
      selector: '.quality-method',
      title: 'Z axis: selected measure',
      description: 'This card explains the current Z-axis measure and its inputs. Changing the preset or axis selection updates it.',
      action: 'read',
      pointer: 'Read the Z-axis inputs'
    },
    {
      selector: '.lowvol-method',
      title: 'Low Volatility: market and residual risk',
      description: 'Low Volatility combines direction-reversed component scores for IHSG beta and residual volatility. When calculated from prices, at least 126 date-aligned daily returns are required.',
      action: 'read',
      pointer: 'Read the risk inputs'
    },
    {
      selector: '#scoring-note',
      title: 'Understand scores and evidence',
      description: 'Components are winsorized at the 5th and 95th percentiles, converted to population z-scores, and clipped to ±3. Missing inputs stay missing. These are descriptive relative scores, not return forecasts or investment instructions.',
      action: 'read',
      pointer: 'Review scoring and provenance'
    }
  ];

  let active = false;
  let autoAdvance = true;
  let currentStep = 0;
  let stepGeneration = 0;
  let timerId = null;
  let resizeTimerId = null;
  let scrollAnimationTimerId = null;
  let scrollAnimationResolve = null;
  let focusAnimationFrameId = null;
  let focusAnimationResolve = null;
  let pointerActionTimerId = null;
  let pointerActionResolve = null;
  let deadline = 0;
  let pausedRemainder = null;
  let stepReady = false;
  let lastFocusRect = null;
  let highlighted = null;
  let helpWasOpen = false;
  let initialScrollY = 0;
  let lockedScrollY = 0;
  let maxScrollY = 0;
  let originalHtmlOverflow = '';
  let originalHtmlOverflowPriority = '';
  let originalBodyStyles = null;

  function cancelStepAnimations() {
    window.clearTimeout(scrollAnimationTimerId);
    scrollAnimationTimerId = null;
    if (scrollAnimationResolve) scrollAnimationResolve();
    scrollAnimationResolve = null;
    if (focusAnimationFrameId !== null) window.cancelAnimationFrame(focusAnimationFrameId);
    focusAnimationFrameId = null;
    if (focusAnimationResolve) focusAnimationResolve();
    focusAnimationResolve = null;
    window.clearTimeout(pointerActionTimerId);
    pointerActionTimerId = null;
    if (pointerActionResolve) pointerActionResolve();
    pointerActionResolve = null;
    pointer.classList.remove('is-clicking');
  }

  function isTourPanelTarget(target) {
    return target instanceof Node && panel.contains(target);
  }

  function preventBackgroundScroll(event) {
    if (!active || isTourPanelTarget(event.target)) return;
    if (event.cancelable) event.preventDefault();
  }

  function lockPageScroll() {
    initialScrollY = window.scrollY;
    lockedScrollY = initialScrollY;
    maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    originalHtmlOverflow = document.documentElement.style.getPropertyValue('overflow');
    originalHtmlOverflowPriority = document.documentElement.style.getPropertyPriority('overflow');
    originalBodyStyles = new Map(['position', 'top', 'left', 'right', 'width', 'overflow', 'transition']
      .map(property => [property, [document.body.style.getPropertyValue(property), document.body.style.getPropertyPriority(property)]]));
    document.documentElement.classList.add('tour-scroll-locked');
    document.body.classList.add('tour-scroll-locked');
    document.documentElement.style.setProperty('overflow', 'hidden');
    document.body.style.setProperty('position', 'fixed');
    document.body.style.setProperty('top', `${-initialScrollY}px`);
    document.body.style.setProperty('left', '0');
    document.body.style.setProperty('right', '0');
    document.body.style.setProperty('width', '100%');
    document.body.style.setProperty('overflow', 'hidden');
    document.addEventListener('wheel', preventBackgroundScroll, { capture: true, passive: false });
    document.addEventListener('touchmove', preventBackgroundScroll, { capture: true, passive: false });
  }

  function unlockPageScroll() {
    cancelStepAnimations();
    document.removeEventListener('wheel', preventBackgroundScroll, true);
    document.removeEventListener('touchmove', preventBackgroundScroll, true);
    document.documentElement.classList.remove('tour-scroll-locked');
    document.body.classList.remove('tour-scroll-locked');
    if (originalHtmlOverflow) document.documentElement.style.setProperty('overflow', originalHtmlOverflow, originalHtmlOverflowPriority);
    else document.documentElement.style.removeProperty('overflow');
    if (originalBodyStyles) {
      for (const [property, [value, priority]] of originalBodyStyles) {
        if (value) document.body.style.setProperty(property, value, priority);
        else document.body.style.removeProperty(property);
      }
    }
    originalBodyStyles = null;
    window.requestAnimationFrame(() => window.scrollTo(0, initialScrollY));
  }

  function scrollToStepTarget(target, generation) {
    cancelStepAnimations();
    // The body is fixed while the tour is open; documentElement.scrollHeight
    // then reflects the viewport. Its content can reflow after a resize, so
    // calculate the current scroll limit from the body's actual content.
    maxScrollY = Math.max(0, document.body.scrollHeight - window.innerHeight);
    const rect = target.getBoundingClientRect();
    const desired = Math.max(0, Math.min(maxScrollY,
      lockedScrollY + rect.top + rect.height / 2 - window.innerHeight * 0.44));
    if (reducedMotion) {
      lockedScrollY = desired;
      document.body.style.setProperty('top', `${-desired}px`);
      return Promise.resolve();
    }
    document.body.style.setProperty('transition', 'none');
    void document.body.offsetHeight;
    document.body.style.setProperty('transition', `top ${SCROLL_SETTLE_MS - 40}ms cubic-bezier(.18,.78,.22,1)`);
    return new Promise(resolve => {
      const finish = () => {
        if (scrollAnimationResolve === finish) scrollAnimationResolve = null;
        resolve();
      };
      scrollAnimationResolve = finish;
      window.requestAnimationFrame(() => {
        if (!active || generation !== stepGeneration) {
          finish();
          return;
        }
        lockedScrollY = desired;
        document.body.style.setProperty('top', `${-desired}px`);
        scrollAnimationTimerId = window.setTimeout(() => {
          scrollAnimationTimerId = null;
          if (active && generation === stepGeneration) document.body.style.removeProperty('transition');
          finish();
        }, SCROLL_SETTLE_MS);
      });
    });
  }

  function setHelpOpen(open) {
    dataHelp.hidden = !open;
    dataHelpButton.setAttribute('aria-expanded', String(open));
  }

  function clampRect(rect) {
    const left = Math.max(8, Math.min(window.innerWidth - 24, rect.left));
    const top = Math.max(8, Math.min(window.innerHeight - 24, rect.top));
    const rawRight = Number.isFinite(rect.right) ? rect.right : rect.left + (rect.width || 0);
    const rawBottom = Number.isFinite(rect.bottom) ? rect.bottom : rect.top + (rect.height || 0);
    const right = Math.max(left + 24, Math.min(window.innerWidth - 8, rawRight));
    const bottom = Math.max(top + 24, Math.min(window.innerHeight - 8, rawBottom));
    return { left, top, width: right - left, height: bottom - top, right, bottom };
  }

  function unionRects(rects) {
    const usable = rects.filter(rect => rect && rect.width > 0 && rect.height > 0);
    if (!usable.length) return null;
    const left = Math.min(...usable.map(rect => rect.left));
    const top = Math.min(...usable.map(rect => rect.top));
    const right = Math.max(...usable.map(rect => rect.right));
    const bottom = Math.max(...usable.map(rect => rect.bottom));
    return clampRect({ left: left - 12, top: top - 12, right: right + 12, bottom: bottom + 12 });
  }

  function setFocusRect(rect) {
    const rawRight = Number.isFinite(rect.right) ? rect.right : rect.left + (rect.width || 0);
    const rawBottom = Number.isFinite(rect.bottom) ? rect.bottom : rect.top + (rect.height || 0);
    const padded = clampRect({
      left: rect.left - 10,
      top: rect.top - 10,
      right: rawRight + 10,
      bottom: rawBottom + 10
    });
    spotlight.style.left = `${padded.left}px`;
    spotlight.style.top = `${padded.top}px`;
    spotlight.style.width = `${padded.width}px`;
    spotlight.style.height = `${padded.height}px`;
    const centerX = padded.left + padded.width / 2;
    const centerY = padded.top + padded.height / 2;
    backdrop.style.setProperty('--tour-center-x', `${centerX}px`);
    backdrop.style.setProperty('--tour-center-y', `${centerY}px`);
    backdrop.style.setProperty('--tour-radius-x', `${Math.max(48, padded.width / 2 + 22)}px`);
    backdrop.style.setProperty('--tour-radius-y', `${Math.max(42, padded.height / 2 + 22)}px`);
    lastFocusRect = padded;
  }

  function easeInOut(value) {
    return value < .5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  function animateFocus(targetRect, duration, generation) {
    const from = lastFocusRect || {
      left: 8, top: 8, width: window.innerWidth - 16, height: window.innerHeight - 16
    };
    const to = clampRect(targetRect);
    if (!duration) {
      setFocusRect(to);
      return Promise.resolve();
    }
    const started = performance.now();
    return new Promise(resolve => {
      const finish = () => {
        if (focusAnimationResolve === finish) focusAnimationResolve = null;
        resolve();
      };
      focusAnimationResolve = finish;
      function frame(now) {
        if (!active || generation !== stepGeneration) {
          focusAnimationFrameId = null;
          finish();
          return;
        }
        const amount = Math.min(1, (now - started) / duration);
        const eased = easeInOut(amount);
        setFocusRect({
          left: from.left + (to.left - from.left) * eased,
          top: from.top + (to.top - from.top) * eased,
          width: from.width + (to.width - from.width) * eased,
          height: from.height + (to.height - from.height) * eased
        });
        if (amount < 1) focusAnimationFrameId = window.requestAnimationFrame(frame);
        else {
          focusAnimationFrameId = null;
          finish();
        }
      }
      focusAnimationFrameId = window.requestAnimationFrame(frame);
    });
  }

  function placePanel(focusRect) {
    const margin = 16;
    const width = panel.offsetWidth;
    const height = panel.offsetHeight;
    const candidates = [
      { left: margin, top: margin, corner: 'top-left' },
      { left: window.innerWidth - width - margin, top: margin, corner: 'top-right' },
      { left: margin, top: window.innerHeight - height - margin, corner: 'bottom-left' },
      { left: window.innerWidth - width - margin, top: window.innerHeight - height - margin, corner: 'bottom-right' }
    ].map(item => ({ ...item, right: item.left + width, bottom: item.top + height }));
    const intersects = rect => !(rect.right < focusRect.left - 20 || rect.left > focusRect.right + 20
      || rect.bottom < focusRect.top - 20 || rect.top > focusRect.bottom + 20);
    const preferred = focusRect.left + focusRect.width / 2 > window.innerWidth / 2
      ? ['bottom-left', 'top-left', 'bottom-right', 'top-right']
      : ['bottom-right', 'top-right', 'bottom-left', 'top-left'];
    candidates.sort((a, b) => {
      const aOverlap = intersects(a) ? 1 : 0;
      const bOverlap = intersects(b) ? 1 : 0;
      return aOverlap - bOverlap || preferred.indexOf(a.corner) - preferred.indexOf(b.corner);
    });
    const choice = candidates[0];
    panel.style.left = `${Math.max(margin, choice.left)}px`;
    panel.style.top = `${Math.max(margin, choice.top)}px`;
    panel.style.right = 'auto';
    panel.style.bottom = 'auto';
  }

  function placePointer(point) {
    const labelLeft = point.x > window.innerWidth - 260;
    pointer.classList.toggle('is-label-left', labelLeft);
    const x = labelLeft
      ? Math.max(12, Math.min(window.innerWidth - 12, point.x))
      : Math.max(12, Math.min(window.innerWidth - 240, point.x));
    const y = Math.max(12, Math.min(window.innerHeight - 54, point.y));
    pointer.style.left = `${x}px`;
    pointer.style.top = `${y}px`;
  }

  function updateCountdownText() {
    if (!autoAdvance) {
      countdownLabel.textContent = 'Manual · wait for Next';
      progress.style.width = `${((currentStep + 1) / steps.length) * 100}%`;
      return;
    }
    if (!stepReady) {
      countdownLabel.textContent = 'Preparing step…';
      progress.style.width = `${(currentStep / steps.length) * 100}%`;
      return;
    }
    const remainingMs = deadline ? Math.max(0, deadline - performance.now()) : STEP_DURATION_MS;
    const remaining = Math.ceil(remainingMs / 1000);
    const action = currentStep === steps.length - 1 ? 'Finish' : 'Next';
    countdownLabel.textContent = `${action} in ${remaining}s`;
    const stepProgress = (STEP_DURATION_MS - Math.min(STEP_DURATION_MS, remainingMs)) / STEP_DURATION_MS;
    progress.style.width = `${((currentStep + stepProgress) / steps.length) * 100}%`;
  }

  function stopTimer(preserveRemainder = false) {
    if (preserveRemainder) {
      if (deadline) pausedRemainder = Math.max(0, deadline - performance.now());
    } else pausedRemainder = null;
    window.clearTimeout(timerId);
    timerId = null;
    deadline = 0;
  }

  function startTimer(reset = true) {
    window.clearTimeout(timerId);
    timerId = null;
    if (!active || !autoAdvance || !stepReady || document.hidden) {
      updateCountdownText();
      return;
    }
    const now = performance.now();
    if (reset) deadline = now + STEP_DURATION_MS;
    else if (pausedRemainder !== null) deadline = now + pausedRemainder;
    else if (!deadline) deadline = now + STEP_DURATION_MS;
    pausedRemainder = null;
    const generation = stepGeneration;

    function tick() {
      if (!active || !autoAdvance || generation !== stepGeneration) return;
      updateCountdownText();
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        timerId = null;
        deadline = 0;
        if (currentStep === steps.length - 1) closeTour();
        else goToStep(currentStep + 1);
        return;
      }
      timerId = window.setTimeout(tick, Math.min(200, remaining));
    }
    tick();
  }

  function setStepText(index, step) {
    panel.scrollTop = 0;
    title.textContent = step.title;
    description.textContent = step.description;
    stepCount.textContent = `${index + 1} / ${steps.length}`;
    backButton.disabled = index === 0;
    nextButton.textContent = index === steps.length - 1 ? 'Finish' : 'Next';
    progress.style.width = `${(index / steps.length) * 100}%`;
    pointerLabel.textContent = step.pointer;
  }

  async function goToStep(index, options = {}) {
    if (index < 0) return;
    if (index >= steps.length) { closeTour(); return; }
    const remainingBeforeRefresh = options.preserveCountdown
      ? (deadline ? Math.max(0, deadline - performance.now()) : pausedRemainder)
      : null;
    const generation = ++stepGeneration;
    cancelStepAnimations();
    stopTimer(false);
    stepReady = false;
    currentStep = index;
    const step = steps[index];
    setStepText(index, step);
    if (remainingBeforeRefresh !== null) pausedRemainder = remainingBeforeRefresh;
    updateCountdownText();
    if (highlighted) highlighted.classList.remove('tour-zoom-target');
    highlighted = null;
    if (step.samplePoint) {
      setHelpOpen(false);
    } else {
      window.FactorZooTourHooks?.clearSamplePoint();
      setHelpOpen(Boolean(step.showHelp));
    }

    const target = document.querySelector(step.selector);
    const scrollTarget = document.querySelector(step.scrollSelector || step.selector);
    if (!target || !scrollTarget) {
      description.textContent += ' This section is not available in the current page state.';
      stepReady = true;
      if (autoAdvance) startTimer(remainingBeforeRefresh === null);
      return;
    }
    if (!step.samplePoint) {
      target.classList.add('tour-zoom-target');
      highlighted = target;
    }
    await scrollToStepTarget(scrollTarget, generation);
    if (!active || generation !== stepGeneration) return;

    let extraRects = [];
    let pointerPoint;
    if (step.samplePoint) {
      const sample = window.FactorZooTourHooks?.showSamplePoint();
      if (sample) {
        extraRects = [sample.pointRect, sample.tooltipRect];
        pointerPoint = {
          x: sample.pointRect.left + sample.pointRect.width / 2,
          y: sample.pointRect.top + sample.pointRect.height / 2
        };
        const axes = window.FactorAxes?.getSelection();
        const axisText = axes ? ['x', 'y', 'z'].map(axis => {
          const option = window.FactorAxes.getOption(axes[axis]);
          return `${axis.toUpperCase()}: ${option?.short || 'unavailable'}`;
        }).join(', ') : 'the selected X, Y, and Z measures';
        description.textContent = `Each dot is an issuer. The current axes are ${axisText}; Low Volatility controls color. The helper has selected ${sample.ticker}; inspect its selected measures, raw inputs, component z-scores, peer counts, and data coverage in the tooltip.`;
      }
    }
    if (step.showHelp) extraRects = [target.getBoundingClientRect(), dataHelp.getBoundingClientRect()];
    const rect = unionRects(extraRects.length ? extraRects : [target.getBoundingClientRect()])
      || clampRect(target.getBoundingClientRect());
    await animateFocus(rect, reducedMotion ? 0 : 680, generation);
    if (!active || generation !== stepGeneration) return;
    if (!pointerPoint) {
      const targetRect = target.getBoundingClientRect();
      pointerPoint = { x: targetRect.left + targetRect.width / 2, y: targetRect.top + targetRect.height / 2 };
    }
    placePointer(pointerPoint);
    placePanel(lastFocusRect || rect);
    if (step.action === 'click' && !reducedMotion) {
      pointer.classList.remove('is-clicking');
      void pointer.offsetWidth;
      pointer.classList.add('is-clicking');
      await new Promise(resolve => {
        const finish = () => {
          if (pointerActionResolve === finish) pointerActionResolve = null;
          resolve();
        };
        pointerActionResolve = finish;
        pointerActionTimerId = window.setTimeout(() => {
          pointerActionTimerId = null;
          pointer.classList.remove('is-clicking');
          finish();
        }, 620);
      });
      if (!active || generation !== stepGeneration) return;
    }
    stepReady = true;
    if (autoAdvance) startTimer(remainingBeforeRefresh === null);
    else updateCountdownText();
  }

  function startTour() {
    if (active) return;
    active = true;
    stepReady = false;
    autoAdvance = true;
    helpWasOpen = !dataHelp.hidden;
    root.hidden = false;
    root.classList.add('is-open');
    // Keep navigation accessible when the panel itself must scroll on a short
    // screen. The descriptive text remains independently scrollable.
    if (controls) {
      controls.style.position = 'sticky';
      controls.style.bottom = '-1px';
      controls.style.background = '#0b141e';
    }
    lockPageScroll();
    autoToggle.setAttribute('aria-pressed', 'true');
    autoToggle.textContent = 'Auto advance · On';
    lastFocusRect = null;
    goToStep(0);
    panel.focus({ preventScroll: true });
  }

  function closeTour() {
    if (!active) return;
    active = false;
    stepGeneration += 1;
    stopTimer(false);
    cancelStepAnimations();
    if (highlighted) highlighted.classList.remove('tour-zoom-target');
    highlighted = null;
    pointer.classList.remove('is-clicking');
    window.FactorZooTourHooks?.clearSamplePoint();
    setHelpOpen(helpWasOpen);
    root.hidden = true;
    root.classList.remove('is-open');
    lastFocusRect = null;
    unlockPageScroll();
    stepReady = false;
    window.clearTimeout(resizeTimerId);
    resizeTimerId = null;
    launchButton.focus({ preventScroll: true });
  }

  function toggleAutoAdvance() {
    autoAdvance = !autoAdvance;
    autoToggle.setAttribute('aria-pressed', String(autoAdvance));
    autoToggle.textContent = autoAdvance ? 'Auto advance · On' : 'Auto advance · Off';
    if (autoAdvance && stepReady) startTimer(true);
    else {
      stopTimer(false);
      updateCountdownText();
    }
  }

  launchButton.addEventListener('click', startTour);
  closeButton.addEventListener('click', closeTour);
  autoToggle.addEventListener('click', toggleAutoAdvance);
  backButton.addEventListener('click', () => goToStep(currentStep - 1));
  nextButton.addEventListener('click', () => goToStep(currentStep + 1));
  document.addEventListener('keydown', event => {
    if (!active) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeTour();
    } else if (event.key === 'ArrowRight' && !event.defaultPrevented) {
      event.preventDefault();
      goToStep(currentStep + 1);
    } else if (event.key === 'ArrowLeft' && !event.defaultPrevented) {
      event.preventDefault();
      goToStep(currentStep - 1);
    } else if (!isTourPanelTarget(event.target)
      && [' ', 'Spacebar', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (!active) return;
    if (document.hidden) stopTimer(true);
    else if (autoAdvance) startTimer(false);
  });
  window.addEventListener('resize', () => {
    if (!active) return;
    window.clearTimeout(resizeTimerId);
    resizeTimerId = window.setTimeout(() => {
      if (active) goToStep(currentStep, { preserveCountdown: true });
    }, 140);
  });
})();
