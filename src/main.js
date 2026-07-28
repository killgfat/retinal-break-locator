/**
 * 眼底球面映射系统 - 主入口
 */

import { initVisualization, updateTexture, dispose, setMarkers } from './visualize.js';
import {
  calculateRetinalParameters,
  calculateMaculaFromDisc,
  calculateBreakToMacula,
  calculateLimbusDistance,
  getClockHourPosition,
  calculateEyeGeometry,
  detectEyeSide
} from './mapper.js';

let currentImage = null;
let currentImageData = null;

const markers = {
  macula: { x: 0.5, y: 0.5, set: false },
  disc: { x: null, y: null, set: false },
  hole: { x: null, y: null, set: false }
};
let currentMarkerMode = null;

const uploadArea = document.getElementById('upload-area');
const fileInput = document.getElementById('file-input');
const processBtn = document.getElementById('process-btn');
const loading = document.getElementById('loading');
const infoPanel = document.getElementById('info-panel');
const axialLengthInput = document.getElementById('axial-length');
const corneaDiameterInput = document.getElementById('cornea-diameter');
const corneaKValueInput = document.getElementById('cornea-k-value');
const corneaDValueInput = document.getElementById('cornea-d-value');
const fovInput = document.getElementById('fov');
const eyeSideSelect = document.getElementById('eye-side-select');
const projectionSelect = document.getElementById('projection-select');
const imagePreview = document.getElementById('image-preview');
const calcFromDiscBtn = document.getElementById('calc-from-disc-btn');
const clearMarkersBtn = document.getElementById('clear-markers-btn');
const holeInfoPanel = document.getElementById('hole-info');

function init() {
  initVisualization();
  setupEventListeners();
  updateInfo();
}

function getCorneaDiameter() {
  const value = parseFloat(corneaDiameterInput.value);
  return isNaN(value) ? 11.7 : value;
}

function getCorneaKValue() {
  const kValue = parseFloat(corneaKValueInput.value);
  const dValue = parseFloat(corneaDValueInput.value);
  
  if (!isNaN(kValue) && kValue > 0) {
    return kValue;
  }
  
  if (!isNaN(dValue) && dValue > 0) {
    return 337.5 / dValue;
  }
  
  return null;
}

function setupEventListeners() {
  uploadArea.addEventListener('click', () => fileInput.click());
  
  uploadArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#667eea';
  });
  
  uploadArea.addEventListener('dragleave', () => {
    uploadArea.style.borderColor = '#444';
  });
  
  uploadArea.addEventListener('drop', (e) => {
    e.preventDefault();
    uploadArea.style.borderColor = '#444';
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });
  
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
  });
  
  processBtn.addEventListener('click', processImage);
  
  axialLengthInput.addEventListener('change', updateInfo);
  corneaDiameterInput.addEventListener('change', updateInfo);
  corneaKValueInput.addEventListener('input', () => {
    if (corneaKValueInput.value) {
      corneaDValueInput.value = '';
    }
    updateInfo();
  });
  corneaDValueInput.addEventListener('input', () => {
    if (corneaDValueInput.value) {
      corneaKValueInput.value = '';
    }
    updateInfo();
  });
  fovInput.addEventListener('change', updateInfo);
  eyeSideSelect.addEventListener('change', updateInfo);
  projectionSelect.addEventListener('change', updateInfo);

  document.querySelectorAll('.marker-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const markerType = btn.dataset.marker;
      setMarkerMode(markerType);
    });
  });
  
  imagePreview.addEventListener('click', handleImageClick);
  
  calcFromDiscBtn.addEventListener('click', calculateMaculaFromDiscPosition);
  
  clearMarkersBtn.addEventListener('click', clearAllMarkers);
}

function setMarkerMode(mode) {
  document.querySelectorAll('.marker-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.marker === mode);
  });
  currentMarkerMode = currentMarkerMode === mode ? null : mode;
}

function handleImageClick(e) {
  if (!currentImage || !currentMarkerMode) return;
  
  const rect = imagePreview.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width;
  const y = (e.clientY - rect.top) / rect.height;
  
  markers[currentMarkerMode] = { 
    x: Math.max(0, Math.min(1, x)), 
    y: Math.max(0, Math.min(1, y)), 
    set: true 
  };
  
  updateMarkerDisplay();
  updatePreviewMarkers();
  updateHoleInfo();
  
  if (currentMarkerMode === 'disc') {
    calcFromDiscBtn.disabled = false;
  }
}

function updateMarkerDisplay() {
  const maculaCoords = document.getElementById('macula-coords');
  const discCoords = document.getElementById('disc-coords');
  const holeCoords = document.getElementById('hole-coords');
  
  maculaCoords.textContent = `(${markers.macula.x.toFixed(3)}, ${markers.macula.y.toFixed(3)})`;
  
  if (markers.disc.set) {
    discCoords.textContent = `(${markers.disc.x.toFixed(3)}, ${markers.disc.y.toFixed(3)})`;
  } else {
    discCoords.textContent = '未设置';
  }
  
  if (markers.hole.set) {
    holeCoords.textContent = `(${markers.hole.x.toFixed(3)}, ${markers.hole.y.toFixed(3)})`;
  } else {
    holeCoords.textContent = '未设置';
  }
}

/**
 * 解析当前眼别。手动选择优先;'auto' 时由视盘相对黄斑的位置判断。
 * @returns {{side: string, source: string}} side: 'right'|'left', source: 'manual'|'auto'|'default'
 */
function resolveEyeSide() {
  const manual = eyeSideSelect.value;
  if (manual === 'right' || manual === 'left') {
    return { side: manual, source: 'manual' };
  }

  if (markers.disc.set && markers.macula.set) {
    const detected = detectEyeSide(markers.macula, markers.disc);
    if (detected) return { side: detected, source: 'auto' };
  }

  return { side: 'right', source: 'default' };
}

function eyeSideLabel(side) {
  return side === 'right' ? '右眼 (OD)' : '左眼 (OS)';
}

/** 汇总当前所有眼球/投影参数,供 mapper 与 visualize 共用 */
function getGeometryOptions() {
  return {
    axialLength: parseFloat(axialLengthInput.value) || 24,
    corneaDiameter: getCorneaDiameter(),
    corneaKValue: getCorneaKValue(),
    fov: parseFloat(fovInput.value) || 200,
    projection: projectionSelect.value
  };
}

/** 汇总传给 visualize.updateTexture 的完整参数 */
function getTextureOptions() {
  return {
    ...getGeometryOptions(),
    maculaX: markers.macula.x,
    maculaY: markers.macula.y,
    discX: markers.disc.set ? markers.disc.x : null,
    discY: markers.disc.set ? markers.disc.y : null
  };
}

function updatePreviewMarkers() {
  const preview = document.getElementById('image-preview');
  
  document.querySelectorAll('.marker-point, .marker-label').forEach(el => el.remove());
  
  if (markers.macula.set) {
    addMarkerPoint(preview, markers.macula.x, markers.macula.y, 'macula', '黄斑');
  }
  
  if (markers.disc.set) {
    addMarkerPoint(preview, markers.disc.x, markers.disc.y, 'disc', '视盘');
  }
  
  if (markers.hole.set) {
    addMarkerPoint(preview, markers.hole.x, markers.hole.y, 'hole', '裂孔');
  }
  
  if (currentImage) {
    updateVisualizationMarkers();
  }
}

function addMarkerPoint(container, x, y, type, label) {
  const point = document.createElement('div');
  point.className = `marker-point ${type}`;
  point.style.left = `${x * 100}%`;
  point.style.top = `${y * 100}%`;
  container.appendChild(point);
  
  const labelEl = document.createElement('div');
  labelEl.className = 'marker-label';
  labelEl.textContent = label;
  labelEl.style.left = `${(x * 100) + 2}%`;
  labelEl.style.top = `${(y * 100) - 5}%`;
  container.appendChild(labelEl);
}

function updateVisualizationMarkers() {
  const markerData = {
    macula: markers.macula.set ? { x: markers.macula.x, y: markers.macula.y } : null,
    disc: markers.disc.set ? { x: markers.disc.x, y: markers.disc.y } : null,
    hole: markers.hole.set ? { x: markers.hole.x, y: markers.hole.y } : null
  };
  
  setMarkers(markerData);
}

function updateHoleInfo() {
  if (!markers.hole.set) {
    holeInfoPanel.classList.remove('visible');
    return;
  }
  
  const geo = getGeometryOptions();
  const { axialLength, corneaDiameter, corneaKValue } = geo;
  const imageAspect = currentImage ? currentImage.width / currentImage.height : 1;

  const { side: eyeSide } = resolveEyeSide();

  const macula = { x: markers.macula.x, y: markers.macula.y };
  const disc = markers.disc.set ? { x: markers.disc.x, y: markers.disc.y } : undefined;

  const breakResult = calculateBreakToMacula(
    markers.hole.x,
    markers.hole.y,
    macula,
    disc,
    { ...geo, imageAspect }
  );

  // angle alpha 子午线修正需要方位角与眼别
  const limbusResult = calculateLimbusDistance(
    breakResult.angleDeg,
    axialLength,
    corneaDiameter,
    corneaKValue,
    { phiDeg: breakResult.phiDeg, eyeSide }
  );

  const clockPosition = getClockHourPosition(breakResult.phi);

  const phiDeg = breakResult.phiDeg;
  // 右眼: phi=0(图像右)=鼻侧, phi=±180(图像左)=颞侧
  // 左眼: phi=0(图像右)=颞侧, phi=±180(图像左)=鼻侧
  const nasalIsRight = eyeSide === 'right';
  let direction = '';
  if (Math.abs(phiDeg - 90) < 22.5) direction = '上方';
  else if (Math.abs(phiDeg + 90) < 22.5) direction = '下方';
  else if (Math.abs(phiDeg) < 22.5) direction = nasalIsRight ? '鼻侧' : '颞侧';
  else if (Math.abs(phiDeg - 180) < 22.5 || Math.abs(phiDeg + 180) < 22.5) direction = nasalIsRight ? '颞侧' : '鼻侧';
  else if (phiDeg > 0 && phiDeg < 90) direction = nasalIsRight ? '鼻上' : '颞上';
  else if (phiDeg > 90) direction = nasalIsRight ? '颞上' : '鼻上';
  else if (phiDeg < 0 && phiDeg > -90) direction = nasalIsRight ? '鼻下' : '颞下';
  else direction = nasalIsRight ? '颞下' : '鼻下';
  
  const calibNote = breakResult.calibration.method === 'disc' ? '盘-斑标定' : '⚠ 未标定(用标称FOV)';

  const distText = breakResult.distanceMm.toFixed(2);
  const distUncertainty = breakResult.calibration.method === 'disc'
    ? ` ±${breakResult.distanceMmUncertainty.toFixed(2)}`
    : ' ⚠无锚点';
  document.getElementById('hole-distance').textContent =
    `${distText}${distUncertainty} mm (${breakResult.angleDeg.toFixed(1)}°)`;
  document.getElementById('hole-direction').textContent = `黄斑${direction}`;
  document.getElementById('hole-sphere').textContent =
    `θ=${breakResult.angleDeg.toFixed(1)}° (视角${breakResult.fieldAngleDeg.toFixed(1)}°), φ=${phiDeg.toFixed(1)}° · ${calibNote}`;
  document.getElementById('hole-limbus-distance').textContent = `${limbusResult.limbusToBreakExternalMm.toFixed(2)} mm`;
  document.getElementById('hole-limbus-distance-inner').textContent = `${limbusResult.limbusToBreakMm.toFixed(2)} mm`;
  document.getElementById('hole-clock-position').textContent = clockPosition;

  const eyeSideRow = document.getElementById('eye-side-row');
  const eyeSideEl = document.getElementById('eye-side');
  const resolved = resolveEyeSide();
  const sourceNote = { manual: '手动指定', auto: '自动判断', default: '⚠ 默认值,请指定' }[resolved.source];
  eyeSideEl.textContent = `${eyeSideLabel(resolved.side)} · ${sourceNote}`;
  eyeSideRow.style.display = 'flex';

  holeInfoPanel.classList.add('visible');
}

function calculateMaculaFromDiscPosition() {
  if (!markers.disc.set || !currentImage) return;
  
  // 由视盘推算黄斑时,眼别决定颞侧在图像的哪一边,而此时还没有黄斑可供自动判断,
  // 所以必须由用户显式指定。
  if (eyeSideSelect.value === 'auto') {
    showError('请先在「眼球参数」中指定眼别(左眼/右眼),再由视盘推算黄斑位置。\n\n黄斑位于视盘颞侧,而颞侧在图像的哪一边取决于眼别。');
    return;
  }

  const geo = getGeometryOptions();
  const result = calculateMaculaFromDisc(
    markers.disc.x,
    markers.disc.y,
    geo.fov,
    currentImage.width,
    currentImage.height,
    eyeSideSelect.value,
    { projection: geo.projection, axialLength: geo.axialLength,
      corneaDiameter: geo.corneaDiameter, corneaKValue: geo.corneaKValue }
  );

  markers.macula = { x: result.maculaX, y: result.maculaY, set: true };

  updateMarkerDisplay();
  updatePreviewMarkers();
  updateHoleInfo();
}

function clearAllMarkers() {
  markers.macula = { x: 0.5, y: 0.5, set: false };
  markers.disc = { x: null, y: null, set: false };
  markers.hole = { x: null, y: null, set: false };
  
  calcFromDiscBtn.disabled = true;
  currentMarkerMode = null;
  
  document.querySelectorAll('.marker-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  
  updateMarkerDisplay();
  updatePreviewMarkers();
  updateHoleInfo();
}

function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    showError('请上传图片文件');
    return;
  }
  
  loading.classList.add('active');
  document.querySelector('.loading p').textContent = '加载图像...';
  
  const reader = new FileReader();
  reader.onload = (e) => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      currentImageData = e.target.result;
      finishImageLoad();
    };
    img.onerror = () => {
      loading.classList.remove('active');
      showError('图像加载失败');
    };
    img.src = e.target.result;
  };
  reader.onerror = () => {
    loading.classList.remove('active');
    showError('文件读取失败');
  };
  reader.readAsDataURL(file);
}

function finishImageLoad() {
  document.getElementById('img-size').textContent = `${currentImage.width} × ${currentImage.height}`;
  infoPanel.style.display = 'block';
  
  updateInfo();
  processBtn.disabled = false;
  
  imagePreview.innerHTML = `<img src="${currentImageData}" alt="预览图像">`;
  updatePreviewMarkers();

  updateTexture(currentImage, getTextureOptions());
  updateVisualizationMarkers();

  loading.classList.remove('active');
  document.querySelector('.loading p').textContent = '处理中...';
}

function updateInfo() {
  const geo = getGeometryOptions();
  const imageWidth = currentImage ? currentImage.width : 2000;

  const params = calculateRetinalParameters(geo.axialLength, geo.fov, imageWidth, {
    corneaDiameter: geo.corneaDiameter,
    corneaKValue: geo.corneaKValue,
    projection: geo.projection
  });
  const eyeGeometry = calculateEyeGeometry(geo.axialLength, geo.corneaDiameter, geo.corneaKValue);

  document.getElementById('retina-radius').textContent = `${eyeGeometry.retinalRadius.toFixed(2)} mm`;
  // 中心处局部尺度比全场平均值更有意义(周边被显著压缩)
  document.getElementById('pixel-scale').textContent =
    `${params.mmPerPixelCenter.toFixed(4)} mm/px (中心) · 覆盖 ${(params.retinalCoverage * 100).toFixed(0)}%`;

  if (currentImage) {
    updateTexture(currentImage, getTextureOptions());
  }

  if (markers.hole.set) {
    updateHoleInfo();
  }
}

function processImage() {
  if (!currentImage) return;
  
  loading.classList.add('active');
  processBtn.disabled = true;
  
  requestAnimationFrame(() => {
    try {
      updateTexture(currentImage, getTextureOptions());
      updateVisualizationMarkers();

    } catch (error) {
      console.error('处理失败:', error);
      showError('图像处理失败: ' + error.message);
    } finally {
      loading.classList.remove('active');
      processBtn.disabled = false;
    }
  });
}

function showError(message) {
  alert(message);
}

window.addEventListener('beforeunload', dispose);

document.addEventListener('DOMContentLoaded', init);