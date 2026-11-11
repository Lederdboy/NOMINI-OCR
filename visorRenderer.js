import * as pdfjsLib from './node_modules/pdfjs-dist/legacy/build/pdf.mjs';
import { unzipSync } from './node_modules/fflate/esm/browser.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href;

const STANDARD_FONT_DATA_URL = new URL(
  './node_modules/pdfjs-dist/standard_fonts/',
  import.meta.url,
).href;

const $ = (selector) => document.querySelector(selector);
const elements = {
  open: $('#open-document'),
  dropZone: $('#drop-zone'),
  webFilePicker: $('#web-file-picker'),
  batchSection: $('#batch-section'),
  batchList: $('#batch-list'),
  batchCount: $('#batch-count'),
  clearBatch: $('#clear-batch'),
  batchAnalyze: $('#analyze-batch'),
  classificationEmpty: $('#classification-empty'),
  classificationProgress: $('#classification-progress'),
  progressTitle: $('#progress-title'),
  progressDetail: $('#progress-detail'),
  progressCount: $('#progress-count'),
  progressPercent: $('#progress-percent'),
  progressBar: $('#progress-bar'),
  extractionDetails: $('#extraction-details'),
  documentView: $('#document-view'),
  canvasStage: $('#canvas-stage'),
  canvas: $('#document-canvas'),
  canvasLoading: $('#canvas-loading'),
  documentName: $('#document-name'),
  documentKind: $('#document-kind'),
  batchDocNav: $('#batch-doc-nav'),
  batchDocIndex: $('#batch-doc-index'),
  batchDocName: $('#batch-doc-current-name'),
  prevDoc: $('#prev-doc'),
  nextDoc: $('#next-doc'),
  prevPage: $('#prev-page'),
  nextPage: $('#next-page'),
  pageCounter: $('#page-counter'),
  zoomLabel: $('#zoom-label'),
  category: $('#category-badge'),
  analyze: $('#analyze-button'),
  analysisStatus: $('#analysis-status'),
  ocrText: $('#ocr-text'),
  form: $('#extraction-form'),
  copy: $('#copy-json'),
  save: $('#save-json'),
  insertDb: $('#insert-db'),
  saveStatus: $('#save-status'),
  themeToggle: $('#theme-toggle'),
};

const state = {
  file: null,
  files: [],
  nextFileId: 1,
  batchRunning: false,
  pdf: null,
  loadingTask: null,
  image: null,
  page: 1,
  pageCount: 0,
  zoom: 1,
  rotation: 0,
  lastResult: null,
  renderTask: null,
  renderSequence: 0,
};

function safeCleanupViewer() {
  try {
    state.renderTask?.cancel();
  } catch {
    // Ignorar cancelación previa
  }
  state.renderTask = null;

  try {
    if (state.pdf) {
      if (typeof state.pdf.cleanup === 'function') state.pdf.cleanup();
      if (typeof state.pdf.destroy === 'function') state.pdf.destroy();
    }
  } catch {
    // Ignorar errores de destrucción del pdf proxy
  }
  state.pdf = null;

  try {
    if (state.loadingTask && typeof state.loadingTask.destroy === 'function') {
      state.loadingTask.destroy();
    }
  } catch {
    // Ignorar errores del loadingTask
  }
  state.loadingTask = null;

  try {
    state.image?.close?.();
  } catch {
    // Ignorar cierre de bitmap
  }
  state.image = null;
}

const supportedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_ZIP_SIZE = 80 * 1024 * 1024;
const MAX_BATCH_FILES = 40;
const MAX_BATCH_SIZE = 200 * 1024 * 1024;
const categoryClasses = {
  CONTRATO_LABORAL: 'category-contract',
  CARNE_SUCAMEC: 'category-sucamec',
  DNI: 'category-dni',
  CERTIADULTO: 'category-certiadulto',
  AUTORIZACION: 'category-contract',
  CONSTANCIA: 'category-certiadulto',
  DECLARACION_JURADA: 'category-dj',
  EXPEDIENTE: 'category-contract',
  DOCUMENTO_GENERAL: 'category-neutral',
};

function getExtension(name) {
  const leafName = String(name).split(/[\\/]/).pop() || '';
  const dot = leafName.lastIndexOf('.');
  return dot >= 0 ? leafName.slice(dot).toLowerCase() : '';
}

function getLeafName(name) {
  return String(name).split(/[\\/]/).pop() || 'documento';
}

function setAnalysisStatus(message, stateName = '') {
  elements.analysisStatus.textContent = message;
  elements.analysisStatus.dataset.state = stateName;
}

function setCategory(category = 'DESCONOCIDO') {
  elements.category.textContent = category;
  elements.category.className = `category-badge ${categoryClasses[category] || 'category-neutral'}`;
}

function renderBatchQueue() {
  const hasFiles = state.files.length > 0;
  const pendingCount = state.files.filter((file) => !file.result?.success).length;
  elements.classificationEmpty.hidden = hasFiles;
  elements.classificationProgress.hidden = !state.batchRunning;
  elements.batchSection.hidden = !hasFiles;
  elements.extractionDetails.hidden = !state.file;
  elements.batchCount.textContent = String(state.files.length);
  elements.batchAnalyze.hidden = !hasFiles || pendingCount === 0 || state.batchRunning;
  elements.batchAnalyze.disabled = state.batchRunning || pendingCount === 0;
  elements.clearBatch.disabled = state.batchRunning;
  elements.batchAnalyze.textContent = `Clasificar pendientes (${pendingCount})`;
  elements.batchList.replaceChildren();

  for (const file of state.files) {
    const isSelected = file.id === state.file?.id;
    const isAnalyzing = file.status === 'Analizando';
    const isSuccess = file.result?.success;
    const isError = file.status === 'Error' || file.status === 'Revisar';

    const row = document.createElement('button');
    row.type = 'button';
    row.className = `batch-row${isSelected ? ' is-selected' : ''}${isAnalyzing ? ' is-analyzing' : ''}`;
    row.title = file.displayName || file.name;
    row.setAttribute('aria-label', `${file.displayName || file.name}: ${file.tipoDocumento}, ${file.status}`);

    // Ícono del tipo de archivo (PDF o Imagen)
    const iconEl = document.createElement('div');
    iconEl.className = 'batch-row-icon';
    iconEl.innerHTML = file.extension === '.pdf'
      ? `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>`
      : `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/></svg>`;

    // Bloque central de texto: Nombre del documento y ruta de procedencia
    const textWrap = document.createElement('div');
    textWrap.className = 'batch-text-wrap';

    const nameEl = document.createElement('span');
    nameEl.className = 'batch-file-name';
    nameEl.textContent = file.name;

    const subEl = document.createElement('span');
    subEl.className = `batch-file-sub${isError ? ' is-error' : isSuccess ? ' is-success' : ''}`;
    const folder = file.displayName && file.displayName.includes('/')
      ? file.displayName.split('/')[0].trim()
      : '';
    const statusText = isAnalyzing ? 'Analizando con OCR…' : (file.status || 'Pendiente');
    subEl.textContent = folder ? `${folder} · ${statusText}` : statusText;

    textWrap.append(nameEl, subEl);

    // Bloque derecho: Etiqueta de documento activo y clasificación
    const badgeWrap = document.createElement('div');
    badgeWrap.className = 'batch-badge-wrap';

    if (isSelected) {
      const activeTag = document.createElement('span');
      activeTag.className = 'batch-active-tag';
      activeTag.textContent = 'EN VISOR';
      badgeWrap.append(activeTag);
    }

    const category = document.createElement('span');
    category.className = `batch-category ${categoryClasses[file.tipoDocumento] || ''}`;
    category.textContent = file.tipoDocumento || 'DESCONOCIDO';
    badgeWrap.append(category);

    row.append(iconEl, textWrap, badgeWrap);
    row.addEventListener('click', () => void selectBatchFile(file.id));
    elements.batchList.append(row);

    // Desplazamiento automático para mantener a la vista el documento que se analiza
    if (isSelected && (state.batchRunning || isAnalyzing)) {
      row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
}

function extractZipDocuments(zipName, zipBytes) {
  if (zipBytes.byteLength > MAX_ZIP_SIZE) throw new Error('El ZIP supera el límite de 80 MB.');

  let acceptedCount = 0;
  let acceptedSize = 0;
  let skippedCount = 0;
  const contents = unzipSync(zipBytes, {
    filter(entry) {
      const extension = getExtension(entry.name);
      if (!supportedExtensions.has(extension)) return false;
      const size = entry.originalSize;
      if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE
        || acceptedCount >= MAX_BATCH_FILES || acceptedSize + size > MAX_BATCH_SIZE) {
        skippedCount += 1;
        return false;
      }
      acceptedCount += 1;
      acceptedSize += size;
      return true;
    },
  });

  const files = Object.entries(contents).map(([archivePath, bytes]) => {
    const name = getLeafName(archivePath);
    return {
      name,
      displayName: `${getLeafName(zipName)} / ${archivePath}`,
      bytes: new Uint8Array(bytes),
    };
  });
  return { files, skippedCount };
}

function calculateClientSemaforo(dateStr) {
  if (!dateStr) return { status: 'UNKNOWN', label: 'Sin fecha', color: 'neutral' };
  const parts = dateStr.trim().split(/[/-]/);
  if (parts.length !== 3) return { status: 'UNKNOWN', label: 'Fecha manual', color: 'neutral' };

  let day, month, year;
  if (parts[0].length === 4) [year, month, day] = parts.map(Number);
  else [day, month, year] = parts.map(Number);

  const targetDate = new Date(year, month - 1, day);
  if (isNaN(targetDate.getTime())) return { status: 'UNKNOWN', label: 'Fecha inválida', color: 'neutral' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffDays = Math.ceil((targetDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) {
    return { status: 'EXPIRED', label: `VENCIDO (${Math.abs(diffDays)}d)`, color: 'danger' };
  } else if (diffDays <= 30) {
    return { status: 'EXPIRING_SOON', label: `POR VENCER (${diffDays}d)`, color: 'warning' };
  } else {
    return { status: 'VALID', label: `VIGENTE (${diffDays}d)`, color: 'success' };
  }
}

function updateSemaforoUI(semaforo, dateValue) {
  const badge = $('#semaforo-badge');
  const input = $('#field-vigencia-hasta');
  if (!badge || !input) return;

  input.classList.remove('input-semaforo-danger', 'input-semaforo-warning', 'input-semaforo-success');
  badge.classList.remove('semaforo-danger', 'semaforo-warning', 'semaforo-success', 'semaforo-neutral');

  if (!dateValue) {
    badge.hidden = true;
    return;
  }

  const sem = semaforo && semaforo.status !== 'UNKNOWN' ? semaforo : calculateClientSemaforo(dateValue);
  badge.hidden = false;
  badge.textContent = sem.label;

  if (sem.color === 'danger') {
    input.classList.add('input-semaforo-danger');
    badge.classList.add('semaforo-danger');
  } else if (sem.color === 'warning') {
    input.classList.add('input-semaforo-warning');
    badge.classList.add('semaforo-warning');
  } else if (sem.color === 'success') {
    input.classList.add('input-semaforo-success');
    badge.classList.add('semaforo-success');
  } else {
    badge.classList.add('semaforo-neutral');
  }
}

function setFormValues(data = {}) {
  const fields = elements.form.elements;
  fields.ruc.value = data.rucEmpresa || data.ruc || '';
  fields.razonSocial.value = data.empresaEmpleadora || data.razonSocial || '';
  fields.nombre.value = data.nombreTrabajador || data.nombresAproximados || data.nombre || '';
  fields.dni.value = data.dniTrabajador || data.dni || data.numero || '';
  fields.cargo.value = data.cargo || data.puesto || (data.modalidad ? `Modalidad: ${data.modalidad}` : '');
  fields.sueldo.value = data.sueldoBasico || data.sueldo || '';
  fields.cliente.value = data.clienteUnidad || data.cliente || data.unidad || (data.numeroCarne ? `Carné SUCAMEC: ${data.numeroCarne}` : '');
  fields.fechaEmision.value = data.fechaEmision || '';
  const vDesde = data.vigencia?.desde || data.vigenciaDesde || '';
  const vHasta = data.vigencia?.hasta || data.vigenciaHasta || data.fechaCaducidad || '';
  fields.vigenciaDesde.value = vDesde;
  fields.vigenciaHasta.value = vHasta;

  updateSemaforoUI(data.semaforo, vHasta);
}

function readFormValues() {
  const fields = elements.form.elements;
  return {
    rucEmpresa: fields.ruc.value.trim(),
    empresaEmpleadora: fields.razonSocial.value.trim(),
    nombreTrabajador: fields.nombre.value.trim(),
    dniTrabajador: fields.dni.value.trim(),
    cargo: fields.cargo.value.trim(),
    sueldoBasico: fields.sueldo.value.trim(),
    clienteUnidad: fields.cliente.value.trim(),
    fechaEmision: fields.fechaEmision.value.trim(),
    vigencia: {
      desde: fields.vigenciaDesde.value.trim(),
      hasta: fields.vigenciaHasta.value.trim(),
    },
  };
}

function getCurrentJson() {
  return {
    tipoDocumento: state.lastResult?.tipoDocumento || 'DESCONOCIDO',
    archivo: state.file?.name || '',
    datos: readFormValues(),
    textoOCR: state.lastResult?.texto || '',
  };
}

function updatePageControls() {
  const isPdf = Boolean(state.pdf);
  elements.pageCounter.textContent = isPdf ? `${state.page} / ${state.pageCount}` : (state.file ? '1 / 1' : '— / —');
  elements.prevPage.disabled = !isPdf || state.page <= 1;
  elements.nextPage.disabled = !isPdf || state.page >= state.pageCount;
  elements.zoomLabel.textContent = `${Math.round(state.zoom * 100)}%`;
}

function getDeviceScale() {
  return Math.min(window.devicePixelRatio || 1, 2);
}

async function renderPdfPage() {
  if (!state.pdf) return;
  const sequence = ++state.renderSequence;
  state.renderTask?.cancel();
  elements.canvasLoading.hidden = false;

  try {
    const page = await state.pdf.getPage(state.page);
    if (sequence !== state.renderSequence) return;

    const baseViewport = page.getViewport({ scale: 1, rotation: state.rotation });
    const availableWidth = Math.max(100, elements.canvasStage.clientWidth - 38);
    const availableHeight = Math.max(100, elements.canvasStage.clientHeight - 38);
    const fitScale = Math.min(1.75, availableWidth / baseViewport.width, availableHeight / baseViewport.height);
    const viewport = page.getViewport({ scale: Math.max(0.1, fitScale * state.zoom), rotation: state.rotation });
    const outputScale = getDeviceScale();
    const canvas = elements.canvas;
    const context = canvas.getContext('2d', { alpha: false });

    canvas.width = Math.ceil(viewport.width * outputScale);
    canvas.height = Math.ceil(viewport.height * outputScale);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);

    state.renderTask = page.render({
      canvasContext: context,
      viewport,
      transform: outputScale === 1 ? null : [outputScale, 0, 0, outputScale, 0, 0],
    });
    await state.renderTask.promise;
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') {
      setAnalysisStatus(`No se pudo renderizar esta página: ${error.message}`, 'error');
    }
  } finally {
    if (sequence === state.renderSequence) {
      state.renderTask = null;
      elements.canvasLoading.hidden = true;
      updatePageControls();
    }
  }
}

function renderImage() {
  if (!state.image) return;
  const stage = elements.canvasStage;
  const image = state.image;
  const sideways = Math.abs(state.rotation % 180) === 90;
  const rotatedWidth = sideways ? image.height : image.width;
  const rotatedHeight = sideways ? image.width : image.height;
  const availableWidth = Math.max(100, stage.clientWidth - 38);
  const availableHeight = Math.max(100, stage.clientHeight - 38);
  const fitScale = Math.min(1.75, availableWidth / rotatedWidth, availableHeight / rotatedHeight);
  const scale = Math.max(0.1, fitScale * state.zoom);
  const canvas = elements.canvas;
  const context = canvas.getContext('2d', { alpha: false });
  const outputScale = getDeviceScale();
  const displayWidth = Math.ceil(rotatedWidth * scale);
  const displayHeight = Math.ceil(rotatedHeight * scale);

  canvas.width = Math.ceil(displayWidth * outputScale);
  canvas.height = Math.ceil(displayHeight * outputScale);
  canvas.style.width = `${displayWidth}px`;
  canvas.style.height = `${displayHeight}px`;
  context.setTransform(outputScale, 0, 0, outputScale, 0, 0);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, displayWidth, displayHeight);
  context.translate(displayWidth / 2, displayHeight / 2);
  context.rotate((state.rotation * Math.PI) / 180);
  context.scale(scale, scale);
  context.drawImage(image, -image.width / 2, -image.height / 2);
  updatePageControls();
}

function renderCurrentPage() {
  if (state.pdf) void renderPdfPage();
  else if (state.image) renderImage();
}

async function previewBatchFile(file) {
  const extension = file.extension || getExtension(file.name);
  if (!supportedExtensions.has(extension) || !(file.bytes instanceof Uint8Array) || !file.bytes.byteLength) {
    setAnalysisStatus('El documento seleccionado no es válido.', 'error');
    return;
  }

  safeCleanupViewer();
  state.file = file;
  state.file.extension = extension;
  state.page = 1;
  state.pageCount = 0;
  state.zoom = 1;
  state.rotation = 0;
  state.lastResult = file.result || null;
  state.renderSequence += 1;

  elements.dropZone.hidden = true;
  elements.documentView.hidden = false;
  elements.extractionDetails.hidden = false;
  elements.analyze.disabled = false;
  elements.documentName.textContent = file.displayName || file.name;
  elements.documentKind.textContent = extension.slice(1).toUpperCase();

  if (state.files.length > 1) {
    const currentIndex = state.files.findIndex((f) => f.id === file.id);
    elements.batchDocNav.hidden = false;
    elements.batchDocIndex.textContent = `Doc ${currentIndex >= 0 ? currentIndex + 1 : 1} de ${state.files.length}`;
    if (elements.batchDocName) {
      elements.batchDocName.textContent = file.displayName || file.name;
    }
    elements.prevDoc.disabled = currentIndex <= 0;
    elements.nextDoc.disabled = currentIndex >= state.files.length - 1;
  } else {
    elements.batchDocNav.hidden = true;
  }

  setCategory(file.tipoDocumento || 'DESCONOCIDO');
  setFormValues(file.result?.datos || {});
  elements.ocrText.textContent = file.result?.texto || 'Analiza el documento para consultar el texto reconocido.';
  elements.save.disabled = !state.file;
  elements.copy.disabled = !state.file;
  elements.insertDb.disabled = !state.file;
  setAnalysisStatus(file.result?.success
    ? 'Documento clasificado. Revisa o corrige sus campos.'
    : 'Documento cargado. Pulsa “Analizar Documento”.');
  elements.saveStatus.textContent = '';

  try {
    if (extension === '.pdf') {
      state.loadingTask = pdfjsLib.getDocument({
        data: file.bytes.slice(),
        isEvalSupported: false,
        useSystemFonts: false,
        standardFontDataUrl: STANDARD_FONT_DATA_URL,
      });
      state.pdf = await state.loadingTask.promise;
      state.pageCount = state.pdf.numPages;
      await renderPdfPage();
    } else {
      const blob = new Blob([file.bytes], { type: extension === '.png' ? 'image/png' : 'image/jpeg' });
      state.image = await createImageBitmap(blob);
      state.pageCount = 1;
      renderImage();
    }
  } catch (error) {
    setAnalysisStatus(`No se pudo abrir el documento: ${error.message}`, 'error');
    elements.analyze.disabled = true;
  }

  renderBatchQueue();
  updatePageControls();
}

async function addIncomingFiles(incomingFiles) {
  if (state.batchRunning) return;
  const documents = [];
  let skippedCount = 0;
  let totalSize = state.files.reduce((sum, item) => sum + item.bytes.byteLength, 0);

  for (const incoming of incomingFiles) {
    const name = getLeafName(incoming.name || '');
    const extension = getExtension(name);
    let bytes = incoming.bytes;
    if (!(bytes instanceof Uint8Array)) {
      if (!incoming.arrayBuffer || incoming.size > (extension === '.zip' ? MAX_ZIP_SIZE : MAX_FILE_SIZE)) {
        skippedCount += 1;
        continue;
      }
      bytes = new Uint8Array(await incoming.arrayBuffer());
    }

    if (extension === '.zip') {
      try {
        const extracted = extractZipDocuments(name, bytes);
        skippedCount += extracted.skippedCount;
        for (const item of extracted.files) {
          if (state.files.length + documents.length >= MAX_BATCH_FILES
            || totalSize + item.bytes.byteLength > MAX_BATCH_SIZE) {
            skippedCount += 1;
            continue;
          }
          totalSize += item.bytes.byteLength;
          documents.push(item);
        }
      } catch (error) {
        skippedCount += 1;
        setAnalysisStatus(`No se pudo abrir ${name}: ${error.message}`, 'error');
      }
      continue;
    }

    if (!supportedExtensions.has(extension) || !bytes.byteLength || bytes.byteLength > MAX_FILE_SIZE) {
      skippedCount += 1;
      continue;
    }
    if (state.files.length + documents.length >= MAX_BATCH_FILES
      || totalSize + bytes.byteLength > MAX_BATCH_SIZE) {
      skippedCount += 1;
      continue;
    }
    totalSize += bytes.byteLength;
    documents.push({ name, bytes: new Uint8Array(bytes) });
  }

  for (const item of documents) {
    state.files.push({
      ...item,
      id: state.nextFileId++,
      extension: getExtension(item.name),
      status: 'Pendiente',
      tipoDocumento: 'DESCONOCIDO',
      result: null,
    });
  }

  renderBatchQueue();
  if (!state.file && state.files.length) await selectBatchFile(state.files[0].id);
  if (!documents.length && skippedCount) {
    setAnalysisStatus('No se encontraron archivos PDF, JPG o PNG válidos en la selección.', 'error');
  } else if (skippedCount) {
    setAnalysisStatus(`Se agregaron ${documents.length} documento(s); se omitieron ${skippedCount} archivo(s) no compatibles o fuera de límite.`, '');
  } else if (documents.length) {
    setAnalysisStatus(`Se agregaron ${documents.length} documento(s). Iniciando lectura OCR…`, '');
    await analyzeBatch();
  }
}

async function selectBatchFile(fileId) {
  const file = state.files.find((item) => item.id === fileId);
  if (!file) return;
  await previewBatchFile(file);
}

function clearBatch() {
  safeCleanupViewer();
  state.files = [];
  state.file = null;
  state.lastResult = null;
  state.page = 1;
  state.pageCount = 0;
  elements.dropZone.hidden = false;
  elements.documentView.hidden = true;
  elements.batchDocNav.hidden = true;
  elements.extractionDetails.hidden = true;
  elements.analyze.disabled = true;
  elements.batchAnalyze.disabled = true;
  elements.save.disabled = true;
  elements.copy.disabled = true;
  elements.insertDb.disabled = true;
  elements.ocrText.textContent = 'El texto detectado aparecerá aquí después del análisis.';
  elements.saveStatus.textContent = '';
  setFormValues({});
  setCategory('DESCONOCIDO');
  setAnalysisStatus('Selecciona uno o varios documentos para comenzar.');
  elements.progressBar.style.width = '0%';
  elements.progressCount.textContent = '0 de 0';
  elements.progressPercent.textContent = '0%';
  renderBatchQueue();
  updatePageControls();
}

function fillResult(result, file = state.file) {
  if (file) {
    file.result = result;
    file.tipoDocumento = result.tipoDocumento || 'DESCONOCIDO';
    file.status = result.success ? 'Clasificado' : 'Error';
  }
  renderBatchQueue();
  if (file && state.file?.id !== file.id) return;

  state.lastResult = result;
  setCategory(result.tipoDocumento || 'DESCONOCIDO');
  setFormValues(result.datos || {});
  elements.ocrText.textContent = result.texto || 'No se detectó texto legible.';
  elements.copy.disabled = !result.success;
  elements.save.disabled = !result.success;
  elements.insertDb.disabled = !result.success;
}

async function requestAnalysis(file) {
  if (window.electronAPI?.analyzeDocument) {
    return window.electronAPI.analyzeDocument(file.name, file.bytes);
  }
  try {
    const payload = file.bytes instanceof Uint8Array ? file.bytes.slice() : file.bytes;
    const response = await fetch(`/api/analyze?name=${encodeURIComponent(file.name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: payload,
    });
    if (!response.ok) {
      let errMsg = `Error del servidor local (HTTP ${response.status})`;
      try {
        const errorJson = await response.json();
        if (errorJson.error) errMsg = errorJson.error;
      } catch {
        // Fallback a texto estándar
      }
      return {
        success: false,
        error: errMsg,
        tipoDocumento: 'DESCONOCIDO',
        datos: {},
      };
    }
    return await response.json();
  } catch (netErr) {
    return {
      success: false,
      error: netErr.message || 'Error de conexión con el OCR local.',
      tipoDocumento: 'DESCONOCIDO',
      datos: {},
    };
  }
}

async function analyzeDocument() {
  if (!state.file || state.batchRunning) return;
  const file = state.file;
  file.status = 'Analizando';
  elements.analyze.disabled = true;
  renderBatchQueue();
  setAnalysisStatus(`Analizando ${file.displayName || file.name} localmente…`);
  elements.ocrText.textContent = 'OCR en curso…';

  try {
    const result = await requestAnalysis(file);
    fillResult(result, file);
    setAnalysisStatus(result.success ? 'Análisis finalizado. Revisa los campos detectados.' : (result.error || 'No se pudo analizar el documento.'), result.success ? 'success' : 'error');
  } catch (error) {
    file.status = 'Error';
    file.error = error.message;
    renderBatchQueue();
    setAnalysisStatus(`Error de análisis: ${error.message}`, 'error');
    elements.ocrText.textContent = 'El OCR no pudo completar el análisis.';
  } finally {
    elements.analyze.disabled = !state.file;
    renderBatchQueue();
  }
}

async function analyzeBatch() {
  const pendingFiles = state.files.filter((file) => !file.result?.success);
  if (!pendingFiles.length || state.batchRunning) return;

  state.batchRunning = true;
  renderBatchQueue();
  elements.analyze.disabled = true;
  let classified = 0;
  let failed = 0;
  const total = pendingFiles.length;
  elements.progressBar.style.width = '0%';
  elements.progressCount.textContent = `0 de ${total}`;
  elements.progressPercent.textContent = '0%';

  for (let index = 0; index < total; index += 1) {
    const file = pendingFiles[index];
    file.status = 'Analizando';
    renderBatchQueue();
    elements.progressTitle.textContent = `Leyendo documento ${index + 1} de ${total}`;
    elements.progressDetail.textContent = file.displayName || file.name;
    elements.progressCount.textContent = `${index + 1} de ${total}`;
    elements.progressPercent.textContent = `${Math.round(((index + 1) / total) * 100)}%`;
    elements.progressBar.style.width = `${Math.round(((index + 1) / total) * 100)}%`;
    setAnalysisStatus(`El OCR está leyendo ${file.displayName || file.name}…`);

    // Mostrar el documento en vivo en el visor de la izquierda
    try {
      await previewBatchFile(file);
    } catch (previewErr) {
      console.warn('No se pudo renderizar la vista previa en el visor:', previewErr);
    }
    elements.ocrText.textContent = 'OCR en curso…';

    try {
      const result = await requestAnalysis(file);
      fillResult(result, file);
      if (result.success) classified += 1;
      else failed += 1;
    } catch (error) {
      file.status = 'Revisar';
      file.error = error.message;
      failed += 1;
      renderBatchQueue();
      if (state.file?.id === file.id) {
        elements.ocrText.textContent = error.message;
      }
    }

    const completed = index + 1;
    const percent = Math.round((completed / total) * 100);
    elements.progressCount.textContent = `${completed} de ${total}`;
    elements.progressPercent.textContent = `${percent}%`;
    elements.progressBar.style.width = `${percent}%`;
  }

  // Al finalizar el lote, seleccionar preferentemente el primer contrato laboral o documento clasificado
  const bestDoc = state.files.find((f) => f.tipoDocumento === 'CONTRATO_LABORAL')
    || state.files.find((f) => f.tipoDocumento === 'CARNE_SUCAMEC')
    || state.files.find((f) => f.result?.success)
    || state.files[0];
  if (bestDoc) {
    try {
      await previewBatchFile(bestDoc);
    } catch (err) {
      console.warn('Error al activar el documento principal:', err);
    }
  }

  elements.progressTitle.textContent = 'Clasificación terminada';
  elements.progressDetail.textContent = `${classified} clasificado(s)${failed ? ` · ${failed} con error` : ''}`;
  state.batchRunning = false;
  renderBatchQueue();
  elements.analyze.disabled = !state.file;
  setAnalysisStatus(`Lote terminado: ${classified} clasificado(s)${failed ? `, ${failed} con error.` : '.'}`, failed ? 'error' : 'success');
}

async function openDocument() {
  if (!window.electronAPI?.selectDocuments) {
    elements.webFilePicker.click();
    return;
  }

  try {
    const selected = await window.electronAPI.selectDocuments();
    if (selected?.success) await addIncomingFiles(selected.files || []);
    else if (!selected?.cancelled) setAnalysisStatus(selected?.error || 'No se pudo abrir el documento.', 'error');
  } catch (error) {
    setAnalysisStatus(`No se pudo abrir el documento: ${error.message}`, 'error');
  }
}

function bindViewerControls() {
  elements.open.addEventListener('click', () => void openDocument());
  elements.dropZone.addEventListener('click', () => void openDocument());
  elements.webFilePicker.addEventListener('change', () => {
    const files = Array.from(elements.webFilePicker.files || []);
    if (!files.length) return;
    void addIncomingFiles(files)
      .catch((error) => setAnalysisStatus(`No se pudieron cargar los archivos: ${error.message}`, 'error'));
    elements.webFilePicker.value = '';
  });
  elements.dropZone.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      void openDocument();
    }
  });
  elements.dropZone.addEventListener('dragover', (event) => {
    event.preventDefault();
    elements.dropZone.classList.add('is-over');
  });
  elements.dropZone.addEventListener('dragleave', (event) => {
    if (!elements.dropZone.contains(event.relatedTarget)) elements.dropZone.classList.remove('is-over');
  });
  elements.dropZone.addEventListener('drop', (event) => {
    event.preventDefault();
    elements.dropZone.classList.remove('is-over');
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    void addIncomingFiles(files)
      .catch((error) => setAnalysisStatus(`No se pudieron cargar los archivos: ${error.message}`, 'error'));
  });

  elements.prevPage.addEventListener('click', () => {
    if (state.pdf && state.page > 1) {
      state.page -= 1;
      renderCurrentPage();
    }
  });
  elements.nextPage.addEventListener('click', () => {
    if (state.pdf && state.page < state.pageCount) {
      state.page += 1;
      renderCurrentPage();
    }
  });
  $('#zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(3, Math.round((state.zoom + 0.15) * 100) / 100);
    renderCurrentPage();
  });
  $('#zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(0.3, Math.round((state.zoom - 0.15) * 100) / 100);
    renderCurrentPage();
  });
  $('#zoom-reset').addEventListener('click', () => {
    state.zoom = 1;
    state.rotation = 0;
    renderCurrentPage();
  });
  $('#rotate-90').addEventListener('click', () => {
    state.rotation = (state.rotation + 90) % 360;
    renderCurrentPage();
  });
  $('#rotate-180').addEventListener('click', () => {
    state.rotation = (state.rotation + 180) % 360;
    renderCurrentPage();
  });
  elements.analyze.addEventListener('click', () => void analyzeDocument());
  elements.batchAnalyze.addEventListener('click', () => void analyzeBatch());
  elements.clearBatch.addEventListener('click', clearBatch);
}

async function copyJson() {
  const payload = JSON.stringify(getCurrentJson(), null, 2);
  if (window.electronAPI?.copyJson) {
    const result = await window.electronAPI.copyJson(payload);
    elements.saveStatus.textContent = result.success ? 'JSON copiado.' : (result.error || 'No se pudo copiar.');
    return;
  }
  await navigator.clipboard.writeText(payload);
  elements.saveStatus.textContent = 'JSON copiado.';
}

async function saveJson() {
  if (!window.electronAPI?.saveExtraction) {
    const blob = new Blob([JSON.stringify(getCurrentJson(), null, 2)], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = 'extraccion-documento.json';
    anchor.click();
    URL.revokeObjectURL(downloadUrl);
    elements.saveStatus.textContent = 'JSON descargado localmente.';
    return;
  }

  const result = await window.electronAPI.saveExtraction(getCurrentJson());
  elements.saveStatus.textContent = result.success
    ? `Guardado: ${result.fileName}`
    : (result.cancelled ? '' : (result.error || 'No se pudo guardar.'));
}

async function insertToDatabase() {
  const current = getCurrentJson();
  const dni = current.datos.dniTrabajador || '00000000';
  const nombre = current.datos.nombreTrabajador || 'Trabajador';
  const tipo = current.tipoDocumento;

  elements.saveStatus.textContent = 'Procesando confirmación en base de datos…';

  try {
    // 1. Intentar registrar en backend si está activo (puerto 3004)
    let apiSuccess = false;
    try {
      const response = await fetch('http://127.0.0.1:3004/api/legajos/subir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          dni,
          nombre,
          tipoDocumento: tipo,
          archivo: current.archivo,
          metadatos: current.datos,
        }),
      });
      if (response.ok) apiSuccess = true;
    } catch {
      // Backend en otro endpoint o modo standalone
    }

    // 2. Generar script SQL estructurado para inserción directa en BD
    const sqlScript = `-- NOMINI ERP / LEGAJO DIGITAL
-- Generado automáticamente por Visor OCR Local
INSERT INTO LegajoDocumentos (
    DniTrabajador,
    NombreTrabajador,
    TipoDocumento,
    RucEmpresa,
    EmpresaEmpleadora,
    Cargo,
    SueldoBasico,
    ClienteUnidad,
    FechaEmision,
    FechaVigenciaDesde,
    FechaVigenciaHasta,
    NombreArchivo,
    FechaRegistro,
    EstadoSemaforo
) VALUES (
    '${dni}',
    '${(nombre || '').replace(/'/g, "''")}',
    '${tipo}',
    '${current.datos.rucEmpresa || ''}',
    '${(current.datos.empresaEmpleadora || '').replace(/'/g, "''")}',
    '${(current.datos.cargo || '').replace(/'/g, "''")}',
    ${Number(current.datos.sueldoBasico) || 0},
    '${(current.datos.clienteUnidad || '').replace(/'/g, "''")}',
    '${current.datos.fechaEmision || ''}',
    '${current.datos.vigencia?.desde || ''}',
    '${current.datos.vigencia?.hasta || ''}',
    '${(current.archivo || '').replace(/'/g, "''")}',
    GETDATE(),
    '${current.datos.semaforo?.status || 'VALID'}'
);
`;

    const blob = new Blob([sqlScript], { type: 'text/sql; charset=utf-8' });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `INSERT_LEGAJO_${dni}_${tipo}.sql`;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);

    elements.saveStatus.textContent = apiSuccess
      ? `Insertado en BD Nomini y script guardado para DNI ${dni}`
      : `SQL generado e insertado para DNI ${dni} (${nombre})`;
  } catch (error) {
    elements.saveStatus.textContent = `Error: ${error.message}`;
  }
}

function syncThemeLogo(theme) {
  const brandLogo = $('#brand-logo');
  if (brandLogo) {
    brandLogo.src = theme === 'dark' ? './Logo/nomini_white.png' : './Logo/nomini.png';
  }
  const appFavicon = $('#app-favicon');
  if (appFavicon) {
    appFavicon.href = theme === 'dark' ? './Logo/nomini_white.png' : './Logo/nomini.png';
  }
}

function bindActions() {
  elements.prevDoc.addEventListener('click', () => {
    if (!state.file || !state.files.length) return;
    const currentIndex = state.files.findIndex((f) => f.id === state.file.id);
    if (currentIndex > 0) void selectBatchFile(state.files[currentIndex - 1].id);
  });
  elements.nextDoc.addEventListener('click', () => {
    if (!state.file || !state.files.length) return;
    const currentIndex = state.files.findIndex((f) => f.id === state.file.id);
    if (currentIndex < state.files.length - 1) void selectBatchFile(state.files[currentIndex + 1].id);
  });
  elements.copy.addEventListener('click', () => void copyJson());
  elements.save.addEventListener('click', () => void saveJson());
  elements.insertDb.addEventListener('click', () => void insertToDatabase());
  elements.form.addEventListener('input', (e) => {
    elements.saveStatus.textContent = 'Cambios sin guardar.';
    if (e.target.name === 'vigenciaHasta') {
      updateSemaforoUI(null, e.target.value);
    }
  });

  function applyGlobalTheme(theme) {
    const finalTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.nominiTheme = finalTheme;
    syncThemeLogo(finalTheme);
  }

  elements.themeToggle.addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.nominiTheme === 'dark' ? 'light' : 'dark';
    applyGlobalTheme(nextTheme);
    try {
      localStorage.setItem('nomini_theme', nextTheme);
      localStorage.setItem('nomini-theme', nextTheme);
    } catch {
      /* Almacenamiento opcional. */
    }
  });

  // Sincronización en tiempo real entre vistas abiertas
  window.addEventListener('storage', (e) => {
    if (e.key === 'nomini_theme' || e.key === 'nomini-theme') {
      applyGlobalTheme(e.newValue);
    }
  });

  window.addEventListener('resize', () => renderCurrentPage());
}

try {
  const savedTheme = localStorage.getItem('nomini_theme') || localStorage.getItem('nomini-theme');
  if (savedTheme === 'dark' || savedTheme === 'light') {
    document.documentElement.dataset.nominiTheme = savedTheme;
  }
} catch { /* El visor funciona aunque el almacenamiento local no esté disponible. */ }

syncThemeLogo(document.documentElement.dataset.nominiTheme || 'light');

bindViewerControls();
bindActions();
updatePageControls();
