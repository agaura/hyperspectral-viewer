import { computeYAxisCeil, updateGlobalMaxCandidate } from './utils.js';

const d3 = window.d3;

export function createChart(elements, state) {
  const axisSvg = d3.select(elements.stripAxisContainer).append('svg');
  const axisGroup = axisSvg.append('g').attr('class', 'axis');
  const axisLabel = axisSvg
    .append('text')
    .attr('class', 'axis-label')
    .attr('text-anchor', 'middle')
    .text('Wavelength (nm)');
  const axisPointer = axisSvg.append('line').attr('class', 'strip-highlight').style('display', 'none');

  const chartSvg = d3.select(elements.chartSvgElement);
  const chartGroup = chartSvg.append('g');
  const xAxisGroup = chartGroup.append('g').attr('class', 'chart-axis chart-axis-x');
  const yAxisGroup = chartGroup.append('g').attr('class', 'chart-axis chart-axis-y');
  const selectedSpectrumPath = chartGroup.append('path').attr('class', 'spectrum-line spectrum-line--selected');
  const hoverSpectrumPath = chartGroup.append('path').attr('class', 'spectrum-line spectrum-line--hover').style('display', 'none');
  const selectedHighlightGroup = chartGroup.append('g').attr('class', 'chart-highlight chart-highlight--selected');
  const selectedHighlightLine = selectedHighlightGroup.append('line');
  const selectedHighlightDot = selectedHighlightGroup.append('circle').attr('r', 3.8);
  const hoverHighlightGroup = chartGroup.append('g').attr('class', 'chart-highlight chart-highlight--hover');
  const hoverHighlightLine = hoverHighlightGroup.append('line');
  const hoverHighlightDot = hoverHighlightGroup.append('circle').attr('r', 3.8);
  selectedHighlightGroup.style('display', 'none');
  hoverHighlightGroup.style('display', 'none');
  const xAxisLabel = chartGroup.append('text').attr('class', 'chart-axis-label').attr('text-anchor', 'middle').text('Wavelength (nm)');
  const yAxisLabel = chartGroup.append('text').attr('class', 'chart-axis-label').attr('text-anchor', 'middle').text('TOA Radiance');

  const chartMargin = { top: 16, right: 12, bottom: 48, left: 58 };
  const xScale = d3.scaleLinear();
  const yScale = d3.scaleLinear();
  const lineGenerator = d3
    .line()
    .defined((d) => Number.isFinite(d.value))
    .curve(d3.curveMonotoneX)
    .x((d) => xScale(d.wl))
    .y((d) => yScale(d.value));

  let chartWidth = 0;
  let chartHeight = 0;

  function updateStripAxis() {
    if (!state.cie) {
      return;
    }
    const width = Math.max(1, Math.round(elements.stripCanvas.clientWidth));
    const height = Math.max(28, Math.round(elements.stripAxisContainer.clientHeight || 34));

    axisSvg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    const domain = [state.cie.wavelengths[0], state.cie.wavelengths[state.cie.wavelengths.length - 1]];
    const scale = d3.scaleLinear().domain(domain).range([0, width]);
    state.stripScale = scale;

    const tickStep = width > 520 ? 25 : 50;
    let ticks = [];
    for (let value = 400; value <= 700; value += tickStep) {
      if (value >= domain[0] && value <= domain[1]) {
        ticks.push(value);
      }
    }
    if (!ticks.length) {
      ticks = [domain[0], domain[1]].filter((value) => Number.isFinite(value));
    }
    const uniqueTicks = Array.from(new Set(ticks)).sort((a, b) => a - b);

    const axis = d3.axisBottom(scale).tickValues(uniqueTicks).tickSizeInner(6).tickSizeOuter(0).tickPadding(6);
    axisGroup.attr('transform', 'translate(0, 0)').call(axis);
    axisGroup.select('.domain').style('display', 'none');

    axisLabel.attr('x', width / 2).attr('y', Math.min(height + 4, 38)).attr('text-anchor', 'middle');
    state.stripAxisBaseline = 0;
    updateStripHighlight(state.displayBandIndex);
  }

  function updateStripHighlight(index) {
    if (!state.stripScale || index == null || index < 0 || index >= state.wavelengths.length) {
      axisPointer.style('display', 'none');
      return;
    }
    const wavelength = state.wavelengths[index];
    if (!Number.isFinite(wavelength)) {
      axisPointer.style('display', 'none');
      return;
    }
    const x = state.stripScale(wavelength);
    const base = state.stripAxisBaseline;
    axisPointer.attr('x1', x).attr('x2', x).attr('y1', base - 8).attr('y2', base + 10).style('display', null);
  }

  function updateChartSize() {
    const rect = elements.chartWrapper.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    chartSvg.attr('width', width).attr('height', height).attr('viewBox', `0 0 ${width} ${height}`);

    chartWidth = Math.max(1, width - chartMargin.left - chartMargin.right);
    chartHeight = Math.max(1, height - chartMargin.top - chartMargin.bottom);

    chartGroup.attr('transform', `translate(${chartMargin.left}, ${chartMargin.top})`);
    xAxisGroup.attr('transform', `translate(0, ${chartHeight})`);

    xAxisLabel.attr('x', chartWidth / 2).attr('y', chartHeight + chartMargin.bottom - 5);
    yAxisLabel.attr('transform', `translate(${-chartMargin.left + 10}, ${chartHeight / 2}) rotate(-90)`);
  }

  function renderSpectrumChart(selectedSpectrum, hoverSpectrum, highlightIndex) {
    if (!chartWidth || !chartHeight || !state.wavelengths.length) {
      selectedSpectrumPath.attr('d', null);
      hoverSpectrumPath.attr('d', null).style('display', 'none');
      selectedHighlightGroup.style('display', 'none');
      hoverHighlightGroup.style('display', 'none');
      xAxisGroup.selectAll('*').remove();
      yAxisGroup.selectAll('*').remove();
      return;
    }

    const wavelengths = state.wavelengths;
    const hasSelected = Array.isArray(selectedSpectrum) && selectedSpectrum.length === wavelengths.length;
    const hasHover = Array.isArray(hoverSpectrum) && hoverSpectrum.length === wavelengths.length;

    if (!hasSelected && !hasHover) {
      selectedSpectrumPath.attr('d', null);
      hoverSpectrumPath.attr('d', null).style('display', 'none');
      selectedHighlightGroup.style('display', 'none');
      hoverHighlightGroup.style('display', 'none');
      xAxisGroup.selectAll('*').remove();
      yAxisGroup.selectAll('*').remove();
      return;
    }

    const selectedData = hasSelected ? wavelengths.map((wl, index) => ({ wl, value: selectedSpectrum[index] })) : null;
    const hoverData = hasHover ? wavelengths.map((wl, index) => ({ wl, value: hoverSpectrum[index] })) : null;

    const wavelengthExtent = d3.extent(wavelengths);
    xScale.domain(wavelengthExtent).range([0, chartWidth]);

    let maxValue = 0;
    if (hasSelected) {
      const mv = d3.max(selectedData, (d) => d.value);
      if (Number.isFinite(mv) && mv > maxValue) {
        maxValue = mv;
      }
    }
    if (hasHover) {
      const mv = d3.max(hoverData, (d) => d.value);
      if (Number.isFinite(mv) && mv > maxValue) {
        maxValue = mv;
      }
    }
    updateGlobalMaxCandidate(maxValue, state);
    const yMax = state.globalYAxisMax || computeYAxisCeil(maxValue || 0);
    yScale.domain([0, yMax]).range([chartHeight, 0]);

    const step = chartWidth > 520 ? 25 : 50;
    let tickValues = [];
    for (let wl = 400; wl <= 700; wl += step) {
      if (wl >= wavelengthExtent[0] && wl <= wavelengthExtent[1]) {
        tickValues.push(wl);
      }
    }
    if (!tickValues.length) {
      tickValues = [wavelengthExtent[0], wavelengthExtent[1]].filter((v) => Number.isFinite(v));
    }
    tickValues = Array.from(new Set(tickValues)).sort((a, b) => a - b);

    const xAxis = d3.axisBottom(xScale).tickValues(tickValues).tickSizeOuter(0).tickPadding(8);
    const yAxis = d3.axisLeft(yScale).ticks(5).tickSizeOuter(0).tickPadding(10);

    xAxisGroup.call(xAxis);
    yAxisGroup.call(yAxis);

    if (hasSelected) {
      selectedSpectrumPath.datum(selectedData).attr('d', lineGenerator).style('display', null);
    } else {
      selectedSpectrumPath.attr('d', null).style('display', 'none');
    }

    if (hasHover) {
      hoverSpectrumPath.datum(hoverData).attr('d', lineGenerator).style('display', null);
    } else {
      hoverSpectrumPath.attr('d', null).style('display', 'none');
    }

    if (Number.isInteger(highlightIndex) && highlightIndex >= 0 && highlightIndex < wavelengths.length) {
      const wl = wavelengths[highlightIndex];

      if (hasSelected && Number.isFinite(selectedSpectrum[highlightIndex])) {
        const value = selectedSpectrum[highlightIndex];
        const x = xScale(wl);
        const y = yScale(value);
        selectedHighlightGroup.style('display', null);
        selectedHighlightLine.attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', chartHeight);
        selectedHighlightDot.attr('cx', x).attr('cy', y);
      } else {
        selectedHighlightGroup.style('display', 'none');
      }

      if (hasHover && Number.isFinite(hoverSpectrum[highlightIndex])) {
        const value = hoverSpectrum[highlightIndex];
        const x = xScale(wl);
        const y = yScale(value);
        hoverHighlightGroup.style('display', null);
        hoverHighlightLine.attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', chartHeight);
        hoverHighlightDot.attr('cx', x).attr('cy', y);
      } else {
        hoverHighlightGroup.style('display', 'none');
      }
    } else {
      selectedHighlightGroup.style('display', 'none');
      hoverHighlightGroup.style('display', 'none');
    }
  }

  return {
    updateStripAxis,
    updateStripHighlight,
    updateChartSize,
    renderSpectrumChart,
    getChartSize: () => ({ chartWidth, chartHeight }),
  };
}
