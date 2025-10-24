export function getDomElements() {
  const imageWrapper = document.getElementById('image-wrapper');
  const imageCanvas = document.getElementById('image-canvas');
  const stripWrapper = document.getElementById('strip-wrapper');
  const stripCanvas = document.getElementById('strip-canvas');
  const stripAxisContainer = document.getElementById('strip-axis');
  const chartWrapper = document.querySelector('.chart-wrapper');
  const chartSvgElement = document.getElementById('spectrum-chart');
  const loadingOverlay = document.getElementById('loading');
  const inspectorPanel = document.querySelector('.inspector');
  const sidebarElement = document.querySelector('.sidebar');
  const sidebarNote = sidebarElement ? sidebarElement.querySelector('.sidebar-note') : null;
  const viewportSection = document.getElementById('viewport');
  const bandMinSlider = document.getElementById('band-min-slider');
  const bandMaxSlider = document.getElementById('band-max-slider');
  const bandMinValueLabel = document.getElementById('band-min-value');
  const bandMaxValueLabel = document.getElementById('band-max-value');
  const autoRangeToggle = document.getElementById('band-auto-toggle');
  const selectionIndicator = document.getElementById('selection-indicator');
  const infoWavelength = document.getElementById('info-wavelength');
  const infoPosition = document.getElementById('info-position');
  const infoReflectance = document.getElementById('info-reflectance');

  return {
    imageWrapper,
    imageCanvas,
    stripWrapper,
    stripCanvas,
    stripAxisContainer,
    chartWrapper,
    chartSvgElement,
    loadingOverlay,
    inspectorPanel,
    sidebarElement,
    sidebarNote,
    viewportSection,
    bandMinSlider,
    bandMaxSlider,
    bandMinValueLabel,
    bandMaxValueLabel,
    autoRangeToggle,
    selectionIndicator,
    infoWavelength,
    infoPosition,
    infoReflectance,
  };
}

export const pointerListenerOptions = { passive: false };

export function markPending(elements) {
  if (elements.chartWrapper) {
    elements.chartWrapper.classList.add('is-pending');
  }
  if (elements.stripAxisContainer) {
    elements.stripAxisContainer.classList.add('is-pending');
  }
  if (elements.inspectorPanel) {
    elements.inspectorPanel.classList.add('is-pending');
  }
}

export function clearPending(elements) {
  if (elements.chartWrapper) {
    elements.chartWrapper.classList.remove('is-pending');
  }
  if (elements.stripAxisContainer) {
    elements.stripAxisContainer.classList.remove('is-pending');
  }
  if (elements.inspectorPanel) {
    elements.inspectorPanel.classList.remove('is-pending');
  }
}

export function createLayoutManager(elements) {
  const smallScreenQuery = window.matchMedia('(max-width: 880px)');
  let chartInspectorRelocated = false;

  const applyResponsiveLayout = () => {
    if (!elements.chartWrapper || !elements.inspectorPanel || !elements.viewportSection) {
      return;
    }
    const shouldRelocate = smallScreenQuery.matches;
    if (shouldRelocate && !chartInspectorRelocated) {
      elements.viewportSection.insertAdjacentElement('afterend', elements.chartWrapper);
      elements.chartWrapper.insertAdjacentElement('afterend', elements.inspectorPanel);
      chartInspectorRelocated = true;
    } else if (!shouldRelocate && chartInspectorRelocated) {
      if (elements.sidebarElement) {
        const note = elements.sidebarElement.querySelector('.sidebar-note') || elements.sidebarNote;
        if (note) {
          elements.sidebarElement.insertBefore(elements.inspectorPanel, note);
          elements.sidebarElement.insertBefore(elements.chartWrapper, elements.inspectorPanel);
        } else {
          elements.sidebarElement.appendChild(elements.chartWrapper);
          elements.sidebarElement.appendChild(elements.inspectorPanel);
        }
      }
      chartInspectorRelocated = false;
    }
  };

  if (typeof smallScreenQuery.addEventListener === 'function') {
    smallScreenQuery.addEventListener('change', applyResponsiveLayout);
  } else if (typeof smallScreenQuery.addListener === 'function') {
    smallScreenQuery.addListener(applyResponsiveLayout);
  }

  applyResponsiveLayout();

  return {
    smallScreenQuery,
    applyResponsiveLayout,
  };
}
