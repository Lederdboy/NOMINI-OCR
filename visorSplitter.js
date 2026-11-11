'use strict';

import * as pdfjsLib from './node_modules/pdfjs-dist/legacy/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  './node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',
  import.meta.url,
).href;

const STANDARD_FONT_DATA_URL = new URL(
  './node_modules/pdfjs-dist/standard_fonts/',
  import.meta.url,
).href;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const elements = {
  themeToggle: $('#theme-toggle'),
  btnSelectPdf: $('#btn-select-pdf'),
  hiddenFileInput: $('#hidden-file-input'),
  metaFilename: $('#meta-filename'),
  metaOutdirPill: $('#meta-outdir-pill'),
  metaOutdir: $('#meta-outdir'),
  btnResetSplitter: $('#btn-reset-splitter'),
  badgeTotalPages: $('#badge-total-pages'),
  badgeTotalCuts: $('#badge-total-cuts'),
  badgeUnidentifiedCount: $('#badge-unidentified-count'),
  stripCounterBadge: $('#strip-counter-badge'),
  thumbnailsContainer: $('#thumbnails-container'),
  activePageBadge: $('#active-page-classification-badge'),
  prevPageBtn: $('#prev-page-btn'),
  nextPageBtn: $('#next-page-btn'),
  pageIndicator: $('#page-indicator'),
  zoomOutBtn: $('#zoom-out-btn'),
  zoomValue: $('#zoom-value'),
  zoomInBtn: $('#zoom-in-btn'),
  zoomFitBtn: $('#zoom-fit-btn'),
  rotate90Btn: $('#rotate-90-btn'),
  canvasStage: $('#splitter-canvas-stage'),
  dropZone: $('#splitter-drop-zone'),
  canvas: $('#splitter-canvas'),
  canvasLoading: $('#splitter-loading-overlay'),
  canvasLoadingTitle: $('#canvas-loading-title'),
  canvasLoadingText: $('#canvas-loading-text'),
  loadingPageBadge: $('#loading-page-badge'),
  loadingPercentBadge: $('#loading-percent-badge'),
  progressBar: $('#splitter-progress-bar'),
  activePageSnippet: $('#active-page-text-snippet'),
  activePageOcrType: $('#active-page-ocr-type'),
  btnReSegment: $('#btn-re-segment'),
  inputDniPrincipal: $('#input-dni-principal'),
  btnApplyDni: $('#btn-apply-dni'),
  reviewAlertBox: $('#review-alert-box'),
  cutsList: $('#cuts-list'),
  filterAllCuts: $('#filter-all-cuts'),
  filterUnidentifiedCuts: $('#filter-unidentified-cuts'),
  filterBadgeAll: $('#filter-badge-all'),
  filterBadgeUnidentified: $('#filter-badge-unidentified'),
  btnConfirmSaveFolder: $('#btn-confirm-save-folder'),
  saveStatusMsg: $('#save-status-msg'),
  modalSuccessConfirm: $('#modal-success-confirm'),
  modalSuccessFolder: $('#modal-success-folder'),
  modalSuccessCount: $('#modal-success-count'),
  modalSuccessDni: $('#modal-success-dni'),
  modalSuccessOpenBtn: $('#modal-success-open-btn'),
  modalSuccessCloseBtn: $('#modal-success-close-btn'),
  modalSuccessCloseIcon: $('#modal-success-close-icon'),
  modalAlertNotice: $('#modal-alert-notice'),
  modalAlertTitle: $('#modal-alert-title'),
  modalAlertDesc: $('#modal-alert-desc'),
  modalAlertMessage: $('#modal-alert-message'),
  modalAlertCloseIcon: $('#modal-alert-close-icon'),
  modalAlertOkBtn: $('#modal-alert-ok-btn'),
  modalAlertIconBadge: $('#modal-alert-icon-badge'),
  modalFolderView: $('#modal-folder-view'),
  modalFolderViewSubtitle: $('#modal-folder-view-subtitle'),
  modalFolderViewPath: $('#modal-folder-view-path'),
  modalFolderViewCopyBtn: $('#modal-folder-view-copy-btn'),
  modalFolderFilesCount: $('#modal-folder-files-count'),
  modalFolderFilesList: $('#modal-folder-files-list'),
  modalFolderViewCloseBtn: $('#modal-folder-view-close-btn'),
  modalFolderViewCloseIcon: $('#modal-folder-view-close-icon'),
  modalFolderViewOpenWindowsBtn: $('#modal-folder-view-open-windows-btn'),
};

const state = {
  pdfBytes: null,
  pdfDocument: null,
  filePath: '',
  fileName: '',
  outDir: '',
  pendingSaveAs: false,
  currentPage: 1,
  totalPages: 0,
  zoom: 1.0,
  rotation: 0,
  renderTask: null,
  renderSequence: 0,
  pagesDetail: [],
  segments: [],
  cutsFilter: 'all',
  dniPrincipal: '',
  isProcessing: false,
};

const CATEGORY_NAMES = {
  CONTRATO_LABORAL: 'Contrato Laboral',
  CARNE_SUCAMEC: 'Carné SUCAMEC',
  DNI: 'DNI / Identidad',
  CERTIADULTO: 'Certiadulto / CUL',
  FICHA_PERSONAL: 'Ficha de Datos',
  DECLARACION_JURADA: 'Declaración Jurada',
  AUTORIZACION: 'Autorización / Descuento',
  CARGO_RECEPCION: 'Cargo de Recepción',
  FORMATO_PENSIONARIO: 'Boletín Pensionario',
  OTRO: 'Otro',
  NO_IDENTIFICADO: 'No Identificado',
};

const CATEGORY_CLASSES = {
  CONTRATO_LABORAL: 'category-contract',
  CARNE_SUCAMEC: 'category-sucamec',
  DNI: 'category-dni',
  CERTIADULTO: 'category-certiadulto',
  FICHA_PERSONAL: 'category-contract',
  DECLARACION_JURADA: 'category-dj',
  AUTORIZACION: 'category-warning',
  CARGO_RECEPCION: 'category-contract',
  FORMATO_PENSIONARIO: 'category-certiadulto',
  OTRO: 'category-other',
  NO_IDENTIFICADO: 'category-danger',
};

const TAG_CLASSES = {
  CONTRATO_LABORAL: 'thumb-tag-contrato',
  CARNE_SUCAMEC: 'thumb-tag-sucamec',
  DNI: 'thumb-tag-dni',
  CERTIADULTO: 'thumb-tag-certiadulto',
  FICHA_PERSONAL: 'thumb-tag-contrato',
  DECLARACION_JURADA: 'thumb-tag-dni',
  AUTORIZACION: 'thumb-tag-dni',
  CARGO_RECEPCION: 'thumb-tag-contrato',
  FORMATO_PENSIONARIO: 'thumb-tag-certiadulto',
  OTRO: 'thumb-tag-other',
  NO_IDENTIFICADO: 'thumb-tag-unidentified',
};

// ==========================================================================
// TEMA OBSIDIAN OLED Y CLARO (SINCRONIZADO GLOBALMENTE)
// ==========================================================================
function applyTheme(theme) {
  const finalTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.nominiTheme = finalTheme;
  updateBrandLogo(finalTheme);
}

function initTheme() {
  let saved = 'light';
  try {
    saved = localStorage.getItem('nomini_theme') || localStorage.getItem('nomini-theme') || 'light';
  } catch {
    // Almacenamiento restringido
  }
  applyTheme(saved);

  // NOTA: El click en #theme-toggle lo gestiona centralmente visorRenderer.js
  // para evitar la colisión de doble alternancia (toggle race condition).

  // Sincronización en tiempo real entre pestañas/ventanas
  window.addEventListener('storage', (e) => {
    if (e.key === 'nomini_theme' || e.key === 'nomini-theme') {
      applyTheme(e.newValue);
    }
  });
}

function updateBrandLogo(theme) {
  const logo = $('#brand-logo');
  if (!logo) return;
  logo.src = theme === 'dark' ? './Logo/nomini_white.png' : './Logo/nomini.png';
}

// ==========================================================================
// RENDERIZADO DEL VISOR CENTRAL DE PÁGINAS
// ==========================================================================
async function renderCurrentPage() {
  if (!state.pdfDocument) return;
  const seq = ++state.renderSequence;
  state.renderTask?.cancel();

  elements.pageIndicator.textContent = `${state.currentPage} / ${state.totalPages}`;
  elements.prevPageBtn.disabled = state.currentPage <= 1;
  elements.nextPageBtn.disabled = state.currentPage >= state.totalPages;
  elements.zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;

  // Actualizar metadatos de la página activa
  const pageMeta = state.pagesDetail.find((p) => p.numeroPagina === state.currentPage);
  if (pageMeta) {
    elements.activePageBadge.textContent = CATEGORY_NAMES[pageMeta.tipo] || pageMeta.tipo;
    elements.activePageBadge.className = `category-badge ${CATEGORY_CLASSES[pageMeta.tipo] || 'category-neutral'}`;
    elements.activePageSnippet.textContent = pageMeta.textoExtraido || '(Página escaneada sin texto digital directo)';
    elements.activePageOcrType.textContent = pageMeta.esEscaneado ? 'OCR TESSERACT' : 'TEXTO NATIVO';
  }

  // Marcar miniatura activa
  $$('.thumb-card').forEach((card) => {
    card.classList.toggle('is-active', Number(card.dataset.page) === state.currentPage);
  });

  try {
    const page = await state.pdfDocument.getPage(state.currentPage);
    if (seq !== state.renderSequence) return;

    const baseViewport = page.getViewport({ scale: 1, rotation: state.rotation });
    const availableWidth = Math.max(100, elements.canvasStage.clientWidth - 40);
    const availableHeight = Math.max(100, elements.canvasStage.clientHeight - 40);
    const fitScale = Math.min(1.8, availableWidth / baseViewport.width, availableHeight / baseViewport.height);
    const scale = Math.max(0.2, fitScale * state.zoom);

    const viewport = page.getViewport({ scale, rotation: state.rotation });
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = elements.canvas;
    const ctx = canvas.getContext('2d', { alpha: false });

    canvas.width = Math.ceil(viewport.width * dpr);
    canvas.height = Math.ceil(viewport.height * dpr);
    canvas.style.width = `${Math.ceil(viewport.width)}px`;
    canvas.style.height = `${Math.ceil(viewport.height)}px`;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    state.renderTask = page.render({
      canvasContext: ctx,
      viewport,
      transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0],
    });

    await state.renderTask.promise;
  } catch (error) {
    if (error?.name !== 'RenderingCancelledException') {
      console.warn('Error al renderizar página:', error.message);
    }
  }
}

function selectPage(pageNumber) {
  if (pageNumber < 1 || pageNumber > state.totalPages) return;
  state.currentPage = pageNumber;
  void renderCurrentPage();
  if (elements.canvasStage) {
    elements.canvasStage.scrollTop = 0;
  }
  const activeThumb = $(`.thumb-card[data-page="${pageNumber}"]`);
  if (activeThumb) {
    activeThumb.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

// ==========================================================================
// TIRA DE MINIATURAS (COLUMNA 1)
// ==========================================================================
async function renderThumbnailToCanvas(pdfDoc, pageNum, canvas) {
  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 0.28 });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
  } catch (err) {
    console.warn(`Error al renderizar miniatura de pág ${pageNum}:`, err.message);
  }
}

function renderThumbnails() {
  elements.thumbnailsContainer.replaceChildren();
  elements.stripCounterBadge.textContent = String(state.pagesDetail.length);

  state.pagesDetail.forEach((pageInfo) => {
    const card = document.createElement('div');
    card.className = `thumb-card${pageInfo.numeroPagina === state.currentPage ? ' is-active' : ''}`;
    card.dataset.page = String(pageInfo.numeroPagina);

    // Cabecera de la miniatura
    const header = document.createElement('div');
    header.className = 'thumb-header';

    const pageNum = document.createElement('span');
    pageNum.className = 'thumb-page-num';
    pageNum.textContent = `Pág. ${pageInfo.numeroPagina}`;

    const tag = document.createElement('span');
    tag.className = `thumb-tag ${TAG_CLASSES[pageInfo.tipo] || 'thumb-tag-unidentified'}`;
    tag.textContent = pageInfo.tipo === 'CONTRATO_LABORAL' ? 'CONTRATO' : pageInfo.tipo === 'CARNE_SUCAMEC' ? 'SUCAMEC' : pageInfo.tipo;

    header.append(pageNum, tag);

    // Vista previa de imagen
    const previewWrap = document.createElement('div');
    previewWrap.className = 'thumb-preview-wrap';

    if (pageInfo.thumbnail) {
      const img = document.createElement('img');
      img.className = 'thumb-img';
      img.src = pageInfo.thumbnail;
      img.alt = `Página ${pageInfo.numeroPagina}`;
      img.loading = 'lazy';
      previewWrap.append(img);
    } else if (state.pdfDocument) {
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.className = 'thumb-canvas';
      previewWrap.append(thumbCanvas);
      void renderThumbnailToCanvas(state.pdfDocument, pageInfo.numeroPagina, thumbCanvas);
    } else {
      previewWrap.innerHTML = `<span style="font-size:11px; color:var(--text-muted);">Pág. ${pageInfo.numeroPagina}</span>`;
    }

    card.append(header, previewWrap);
    card.addEventListener('click', () => selectPage(pageInfo.numeroPagina));
    elements.thumbnailsContainer.append(card);
  });
}

// ==========================================================================
// LISTA DE SUB-PDFS CORTADOS (COLUMNA 3)
// ==========================================================================
function renderCutsList() {
  elements.cutsList.replaceChildren();
  elements.badgeTotalCuts.textContent = `${state.segments.length} sub-PDFs`;
  elements.badgeTotalCuts.hidden = false;

  const unidentifiedCount = state.segments.filter((s) => s.tipo === 'NO_IDENTIFICADO').length;
  elements.badgeUnidentifiedCount.textContent = `${unidentifiedCount} por revisar`;
  elements.badgeUnidentifiedCount.hidden = unidentifiedCount === 0;
  elements.reviewAlertBox.hidden = unidentifiedCount === 0;

  if (elements.filterBadgeAll) {
    elements.filterBadgeAll.textContent = String(state.segments.length);
  }
  if (elements.filterBadgeUnidentified) {
    elements.filterBadgeUnidentified.textContent = String(unidentifiedCount);
  }

  if (!state.segments.length) {
    elements.cutsList.innerHTML = `
      <div class="empty-cuts-state">
        <p>No hay segmentos cortados disponibles.</p>
      </div>
    `;
    if (elements.btnConfirmSaveFolder) elements.btnConfirmSaveFolder.disabled = true;
    return;
  }

  if (elements.btnConfirmSaveFolder) elements.btnConfirmSaveFolder.disabled = false;

  // Filtrado según selección (Todos o Solo No Identificados)
  let segmentsToRender = state.segments;
  if (state.cutsFilter === 'unidentified') {
    segmentsToRender = state.segments.filter((s) => s.tipo === 'NO_IDENTIFICADO');
  }

  if (segmentsToRender.length === 0) {
    elements.cutsList.innerHTML = `
      <div class="empty-cuts-state" style="padding: 32px 16px;">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--success, #16a34a);"><polyline points="20 6 9 17 4 12"/></svg>
        <p style="margin: 8px 0; font-weight: 600;">¡Excelente! No quedan páginas no identificadas pendientes de revisión.</p>
        <button id="btn-reset-filter" class="button button-secondary button-xs" type="button" style="margin-top: 6px;">Ver todos los documentos</button>
      </div>
    `;
    const btnReset = $('#btn-reset-filter');
    btnReset?.addEventListener('click', () => {
      state.cutsFilter = 'all';
      elements.filterAllCuts?.classList.add('is-active');
      elements.filterUnidentifiedCuts?.classList.remove('is-active');
      renderCutsList();
    });
    return;
  }

  segmentsToRender.forEach((seg, idx) => {
    const card = document.createElement('div');
    card.className = 'cut-card';

    // Fila superior: Orden + Nombre de archivo
    const top = document.createElement('div');
    top.className = 'cut-card-top';

    const orderBadge = document.createElement('span');
    orderBadge.className = 'cut-order-badge';
    orderBadge.textContent = String(idx + 1).padStart(2, '0');

    const filename = document.createElement('span');
    filename.className = 'cut-filename';
    filename.title = seg.archivoGenerado;
    filename.textContent = seg.archivoGenerado;

    const pagesChip = document.createElement('span');
    pagesChip.className = 'cut-pages-chip';
    const numPages = seg.paginasOriginales.length;
    pagesChip.textContent = `Págs. ${seg.paginasOriginales.join(', ')} (${numPages} ${numPages === 1 ? 'hoja' : 'hojas'})`;

    top.append(orderBadge, filename, pagesChip);

    // Fila media: Selector desplegable para corrección manual
    const mid = document.createElement('div');
    mid.className = 'cut-card-mid';

    const select = document.createElement('select');
    select.className = 'nomini-select cut-select-type';
    select.title = 'Cambiar clasificación de este bloque';

    const options = [
      { val: 'CONTRATO_LABORAL', label: 'Contrato Laboral' },
      { val: 'CARNE_SUCAMEC', label: 'Carné SUCAMEC' },
      { val: 'DNI', label: 'DNI / Identidad' },
      { val: 'CERTIADULTO', label: 'Certiadulto / CUL' },
      { val: 'FICHA_PERSONAL', label: 'Ficha de Datos / Personal' },
      { val: 'DECLARACION_JURADA', label: 'Declaración Jurada' },
      { val: 'AUTORIZACION', label: 'Autorización (Descuento/Toxicológica)' },
      { val: 'CARGO_RECEPCION', label: 'Cargo de Recepción de Reglamento' },
      { val: 'FORMATO_PENSIONARIO', label: 'Boletín / Formato Pensionario' },
      { val: 'OTRO', label: 'Otro' },
      { val: 'NO_IDENTIFICADO', label: 'No Identificado (Revisar)' },
    ];

    options.forEach((opt) => {
      const optionEl = document.createElement('option');
      optionEl.value = opt.val;
      optionEl.textContent = opt.label;
      if (opt.val === seg.tipo) optionEl.selected = true;
      select.append(optionEl);
    });

    select.addEventListener('change', (e) => {
      const nuevoTipo = e.target.value;
      seg.tipo = nuevoTipo;
      // Actualizar también las páginas individuales correspondientes
      seg.paginasOriginales.forEach((pNum) => {
        const pObj = state.pagesDetail.find((p) => p.numeroPagina === pNum);
        if (pObj) pObj.tipo = nuevoTipo;
      });
      renderThumbnails();
      void renderCurrentPage();
      elements.saveStatusMsg.textContent = 'Has modificado la clasificación. Pulsa "Re-cortar" o "Guardar Como...".';
    });

    mid.append(select);

    // Fila de acciones (abrir archivo en Electron si está disponible)
    const actions = document.createElement('div');
    actions.className = 'cut-card-actions';

    if (seg.rutaArchivoGenerado) {
      const btnOpen = document.createElement('button');
      btnOpen.className = 'btn-file-open';
      btnOpen.type = 'button';
      btnOpen.title = 'Abrir este sub-PDF cortado';
      btnOpen.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        <span>Abrir</span>
      `;
      btnOpen.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (window.documentAPI?.abrirArchivo) {
          void window.documentAPI.abrirArchivo(seg.rutaArchivoGenerado);
        } else {
          try {
            await fetch('/api/splitter/open-file', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: seg.rutaArchivoGenerado }),
            });
          } catch (_) {}
        }
      });
      actions.append(btnOpen);

      const btnFolder = document.createElement('button');
      btnFolder.className = 'btn-file-open';
      btnFolder.type = 'button';
      btnFolder.title = 'Abrir carpeta en Windows Explorer';
      btnFolder.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
        <span>Carpeta</span>
      `;
      btnFolder.addEventListener('click', async (e) => {
        e.stopPropagation();
        const targetDir = state.outDir || getDirname(seg.rutaArchivoGenerado);
        if (window.documentAPI?.mostrarEnCarpeta) {
          void window.documentAPI.mostrarEnCarpeta(seg.rutaArchivoGenerado);
        } else {
          try {
            await fetch('/api/splitter/open-folder', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ folder: targetDir }),
            });
            elements.saveStatusMsg.textContent = `Carpeta abierta en Windows Explorer: ${targetDir}`;
          } catch (_) {}
        }
      });
      actions.append(btnFolder);
    }

    card.append(top, mid, actions);

    // Al hacer clic en la tarjeta del corte, saltar a la primera página de ese corte
    card.addEventListener('click', (e) => {
      if (e.target.tagName !== 'SELECT' && e.target.tagName !== 'BUTTON') {
        selectPage(seg.paginasOriginales[0]);
      }
    });

    elements.cutsList.append(card);
  });
}

// ==========================================================================
// PROGRESO Y ACTUALIZACIÓN VISUAL
// ==========================================================================
function updateProgress(prog) {
  if (!prog) return;

  const pct = Math.min(100, Math.max(0, prog.porcentaje || 0));
  if (elements.progressBar) {
    elements.progressBar.style.width = `${pct}%`;
  }
  if (elements.loadingPercentBadge) {
    elements.loadingPercentBadge.textContent = `${pct}%`;
  }

  if (prog.etapa === 'analizando' || prog.paginaActual) {
    const pag = prog.paginaActual || 1;
    const total = prog.totalPaginas || state.totalPages || '?';
    if (elements.loadingPageBadge) {
      elements.loadingPageBadge.textContent = `Página ${pag} de ${total}`;
    }
    if (elements.canvasLoadingTitle) {
      elements.canvasLoadingTitle.textContent = `Analizando Expediente Laboral`;
    }
    if (elements.canvasLoadingText) {
      elements.canvasLoadingText.textContent = `Leyendo texto con OCR local offline (${pag} / ${total})...`;
    }
  } else if (prog.etapa === 'cortando' || prog.bloqueActual) {
    const bloque = prog.bloqueActual || 1;
    const totalBloques = prog.totalBloques || '?';
    if (elements.loadingPageBadge) {
      elements.loadingPageBadge.textContent = `Documento ${bloque} de ${totalBloques}`;
    }
    if (elements.canvasLoadingTitle) {
      elements.canvasLoadingTitle.textContent = `Cortando Sub-PDFs con pdf-lib`;
    }
    if (elements.canvasLoadingText) {
      elements.canvasLoadingText.textContent = `Generando y guardando archivos limpios en disco...`;
    }
  }
}

// ==========================================================================
// CARGA Y PROCESAMIENTO DEL EXPEDIENTE
// ==========================================================================
async function cargarYProcesarExpediente(fileData) {
  if (state.isProcessing) return;
  state.isProcessing = true;

  elements.canvasLoading.hidden = false;
  elements.dropZone.hidden = true;
  elements.canvas.hidden = true;
  updateProgress({ etapa: 'analizando', paginaActual: 1, totalPaginas: 1, porcentaje: 2 });
  elements.saveStatusMsg.textContent = '';

  try {
    let rutaArchivo = fileData.filePath || '';
    let bytes = fileData.bytes;

    state.fileName = fileData.fileName || 'expediente.pdf';
    elements.metaFilename.textContent = state.fileName;

    // Si viene de input web directo sin ruta física
    if (!bytes && fileData.file) {
      bytes = new Uint8Array(await fileData.file.arrayBuffer());
    }

    state.pdfBytes = bytes;

    // Cargar en PDF.js para renderizado en UI usando una copia (evitar neutering)
    const loadingTask = pdfjsLib.getDocument({
      data: bytes.slice(),
      isEvalSupported: false,
      useSystemFonts: false,
      standardFontDataUrl: STANDARD_FONT_DATA_URL,
    });
    state.pdfDocument = await loadingTask.promise;
    state.totalPages = state.pdfDocument.numPages;
    state.currentPage = 1;

    elements.badgeTotalPages.textContent = `${state.totalPages} páginas`;
    elements.badgeTotalPages.hidden = false;
    updateProgress({ etapa: 'analizando', paginaActual: 1, totalPaginas: state.totalPages, porcentaje: 5 });

    // Procesar segmentación y corte físico
    let resultadoSegmentacion;

    if (window.documentAPI?.procesarYCortarExpediente && rutaArchivo) {
      // Entorno Electron nativo
      resultadoSegmentacion = await window.documentAPI.procesarYCortarExpediente(rutaArchivo, state.outDir);
    } else {
      // Entorno Web con streaming en tiempo real (NDJSON)
      const outDirQuery = encodeURIComponent(state.outDir || '');
      const resp = await fetch(`/api/splitter/upload?outDir=${outDirQuery}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/pdf' },
        body: bytes.slice(),
      });

      if (!resp.ok) {
        throw new Error(`El servidor respondió con código ${resp.status}`);
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const parsed = JSON.parse(trimmed);
            if (parsed.type === 'progress') {
              updateProgress(parsed.data);
            } else if (parsed.type === 'result') {
              resultadoSegmentacion = parsed.data;
            } else if (parsed.type === 'error') {
              throw new Error(parsed.error);
            }
          } catch (e) {
            if (e.message && !e.message.includes('JSON')) throw e;
          }
        }
      }

      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim());
          if (parsed.type === 'result') resultadoSegmentacion = parsed.data;
          else if (parsed.type === 'error') throw new Error(parsed.error);
        } catch (e) {
          if (e.message && !e.message.includes('JSON')) throw e;
        }
      }
    }

    if (!resultadoSegmentacion?.success) {
      throw new Error(resultadoSegmentacion?.error || 'No se pudo segmentar el expediente.');
    }

    // Actualizar estado con los resultados
    state.filePath = rutaArchivo || resultadoSegmentacion.rutaOrigen || '';
    state.outDir = resultadoSegmentacion.carpetaSalida || '';
    state.pagesDetail = resultadoSegmentacion.paginasDetalle || [];
    state.segments = resultadoSegmentacion.segmentosGenerados || [];
    state.dniPrincipal = resultadoSegmentacion.dniPrincipal || '';

    if (state.outDir) {
      elements.metaOutdir.textContent = state.outDir;
      elements.metaOutdirPill.hidden = false;
    }

    if (state.dniPrincipal) {
      elements.inputDniPrincipal.value = state.dniPrincipal;
    }

    // Renderizar tira de miniaturas, visor y lista de cortes
    renderThumbnails();
    renderCutsList();
    elements.canvas.hidden = false;
    await renderCurrentPage();

    elements.saveStatusMsg.textContent = `Expediente segmentado con éxito: ${state.segments.length} sub-PDFs generados físicamente.`;
    if (elements.btnResetSplitter) elements.btnResetSplitter.hidden = false;
  } catch (error) {
    console.error('Error al procesar expediente:', error);
    elements.dropZone.hidden = false;
    elements.canvas.hidden = true;
    elements.saveStatusMsg.textContent = `Error: ${error.message}`;
    showAppNotice(`No se pudo procesar el expediente: ${error.message}`, 'Error de Procesamiento', 'error');
  } finally {
    state.isProcessing = false;
    elements.canvasLoading.hidden = true;
  }
}

// ==========================================================================
// LIMPIEZA DE EXPEDIENTE (COMENZAR CON OTRO)
// ==========================================================================
function resetSplitter() {
  if (state.renderTask) {
    try { state.renderTask.cancel(); } catch (_) {}
    state.renderTask = null;
  }
  if (state.pdfDocument) {
    try { state.pdfDocument.destroy(); } catch (_) {}
    state.pdfDocument = null;
  }

  state.pdfBytes = null;
  state.filePath = '';
  state.fileName = '';
  state.currentPage = 1;
  state.totalPages = 0;
  state.zoom = 1.0;
  state.rotation = 0;
  state.pagesDetail = [];
  state.segments = [];
  state.dniPrincipal = '';
  state.cutsFilter = 'all';
  state.isProcessing = false;

  // Reset encabezado
  if (elements.hiddenFileInput) elements.hiddenFileInput.value = '';
  if (elements.metaFilename) elements.metaFilename.textContent = 'Ningún archivo cargado';
  if (elements.metaOutdirPill) elements.metaOutdirPill.hidden = true;
  if (elements.metaOutdir) elements.metaOutdir.textContent = '—';
  if (elements.badgeTotalPages) elements.badgeTotalPages.hidden = true;
  if (elements.badgeTotalCuts) elements.badgeTotalCuts.hidden = true;
  if (elements.badgeUnidentifiedCount) elements.badgeUnidentifiedCount.hidden = true;
  if (elements.btnResetSplitter) elements.btnResetSplitter.hidden = true;

  // Reset Columna 1: Miniaturas
  if (elements.stripCounterBadge) elements.stripCounterBadge.textContent = '0';
  if (elements.thumbnailsContainer) elements.thumbnailsContainer.replaceChildren();

  // Reset Columna 2: Visor central
  if (elements.canvasLoading) elements.canvasLoading.hidden = true;
  if (elements.dropZone) elements.dropZone.hidden = false;
  if (elements.canvas) {
    elements.canvas.hidden = true;
    const ctx = elements.canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height);
  }
  if (elements.activePageBadge) {
    elements.activePageBadge.textContent = 'SIN PÁGINA';
    elements.activePageBadge.style.color = '';
  }
  if (elements.pageIndicator) elements.pageIndicator.textContent = '- / -';
  if (elements.activePageSnippet) elements.activePageSnippet.textContent = '—';
  if (elements.activePageOcrType) elements.activePageOcrType.textContent = 'NATIVO';

  // Reset Columna 3: Cortes
  if (elements.inputDniPrincipal) elements.inputDniPrincipal.value = '';
  if (elements.reviewAlertBox) elements.reviewAlertBox.hidden = true;
  if (elements.cutsList) {
    elements.cutsList.innerHTML = `
      <div class="empty-cuts-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="opacity: 0.35; margin-bottom: 12px;">
          <circle cx="6" cy="6" r="3"/>
          <circle cx="6" cy="18" r="3"/>
          <line x1="20" y1="4" x2="8.12" y2="15.88"/>
          <line x1="14.47" y1="14.48" x2="20" y2="20"/>
          <line x1="8.12" y1="8.12" x2="12" y2="12"/>
        </svg>
        <p>Los archivos cortados con <code>pdf-lib</code> aparecerán aquí agrupados por documento.</p>
      </div>
    `;
  }
  if (elements.filterBadgeAll) elements.filterBadgeAll.textContent = '0';
  if (elements.filterBadgeUnidentified) elements.filterBadgeUnidentified.textContent = '0';
  if (elements.filterAllCuts) elements.filterAllCuts.classList.add('is-active');
  if (elements.filterUnidentifiedCuts) elements.filterUnidentifiedCuts.classList.remove('is-active');

  // Botones de acción
  if (elements.btnConfirmSaveFolder) elements.btnConfirmSaveFolder.disabled = true;
  if (elements.saveStatusMsg) {
    elements.saveStatusMsg.className = 'save-status-msg';
    elements.saveStatusMsg.textContent = '';
  }
}

// ==========================================================================
// RE-CORTE CON CLASIFICACIONES MANUALES
// ==========================================================================
async function reSegmentarExpediente() {
  if (!state.filePath && !state.pdfBytes) {
    showAppNotice('No hay ningún expediente cargado para re-cortar.', 'Aviso', 'info');
    return;
  }

  elements.canvasLoading.hidden = false;
  elements.canvasLoadingText.textContent = 'Re-cortando sub-PDFs con las nuevas categorías…';

  try {
    const mapaPaginas = state.pagesDetail.map((p) => ({
      numeroPagina: p.numeroPagina,
      tipo: p.tipo,
    }));
    const dniActual = elements.inputDniPrincipal.value.trim() || state.dniPrincipal;

    let resultado;
    if (window.documentAPI?.confirmarYCortarSegmentos && state.filePath) {
      resultado = await window.documentAPI.confirmarYCortarSegmentos({
        rutaPdfOrigen: state.filePath,
        carpetaSalida: state.outDir,
        mapaPaginas,
        dni: dniActual,
      });
    } else {
      const resp = await fetch('/api/splitter/recut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rutaPdfOrigen: state.filePath,
          carpetaSalida: state.outDir,
          mapaPaginas,
          dni: dniActual,
        }),
      });
      resultado = await resp.json();
    }

    if (!resultado?.success) throw new Error(resultado?.error || 'Fallo al re-cortar.');

    state.segments = resultado.segmentosGenerados || [];
    renderCutsList();
    elements.saveStatusMsg.textContent = 'Re-corte completado. Archivos actualizados en disco.';
  } catch (error) {
    showAppNotice(`Error al re-cortar: ${error.message}`, 'Error al Cortar', 'error');
  } finally {
    elements.canvasLoading.hidden = true;
  }
}

// ==========================================================================
// CONFIRMACIÓN Y GUARDADO DE ARCHIVOS EN CARPETA FÍSICA
// ==========================================================================
async function confirmarYGuardarEnCarpeta() {
  if (!state.segments.length || (!state.filePath && !state.pdfBytes)) {
    showAppNotice('No hay ningún expediente cargado para guardar.', 'Aviso', 'info');
    return;
  }

  const dni = elements.inputDniPrincipal.value.trim() || state.dniPrincipal || 'SIN_DNI';
  const outDir = state.outDir || 'dist/legajos_cortados';

  const originalHtml = elements.btnConfirmSaveFolder?.innerHTML || 'Guardar Como...';
  if (elements.btnConfirmSaveFolder) {
    elements.btnConfirmSaveFolder.disabled = true;
    elements.btnConfirmSaveFolder.textContent = 'Guardando en disco...';
  }

  elements.saveStatusMsg.className = 'save-status-msg';
  elements.saveStatusMsg.textContent = 'Generando físicamente los sub-PDFs con pdf-lib y guardando en disco...';

  try {
    const mapaPaginas = state.pagesDetail.map((p) => ({
      numeroPagina: p.numeroPagina,
      tipo: p.tipo,
    }));

    let resultado;
    if (window.documentAPI?.confirmarYCortarSegmentos && state.filePath) {
      resultado = await window.documentAPI.confirmarYCortarSegmentos({
        rutaPdfOrigen: state.filePath,
        carpetaSalida: outDir,
        mapaPaginas,
        dni,
      });
    } else {
      const resp = await fetch('/api/splitter/recut', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rutaPdfOrigen: state.filePath,
          carpetaSalida: outDir,
          mapaPaginas,
          dni,
        }),
      });
      resultado = await resp.json();
    }

    if (!resultado?.success) {
      throw new Error(resultado?.error || 'Error al guardar los archivos en disco.');
    }

    state.segments = resultado.segmentosGenerados || [];
    state.outDir = resultado.carpetaSalida || outDir;
    elements.metaOutdir.textContent = state.outDir;
    elements.metaOutdirPill.hidden = false;

    renderCutsList();

    elements.saveStatusMsg.className = 'save-status-msg is-success';
    elements.saveStatusMsg.innerHTML = `
      <strong><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: -2px; margin-right: 4px;"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>${state.segments.length} archivos cortados guardados correctamente</strong><br>
      <span style="font-size: 11px; opacity: 0.9;">DNI: <b>${dni}</b> · Carpeta: <b>${state.outDir}</b></span>
    `;

    // Abrir ventana emergente de confirmación de éxito
    openSuccessModal({
      folder: state.outDir,
      totalCuts: state.segments.length,
      dni,
    });
  } catch (error) {
    console.error('Error al confirmar y guardar:', error);
    elements.saveStatusMsg.className = 'save-status-msg is-error';
    elements.saveStatusMsg.textContent = `Error al guardar: ${error.message}`;
    showAppNotice(`No se pudieron guardar los archivos: ${error.message}`, 'Error al Guardar', 'error');
  } finally {
    if (elements.btnConfirmSaveFolder) {
      elements.btnConfirmSaveFolder.disabled = false;
      elements.btnConfirmSaveFolder.innerHTML = originalHtml;
    }
  }
}

async function abrirCarpetaDestino() {
  const dir = state.outDir || (state.filePath ? getDirname(state.filePath) : 'dist/legajos_cortados');

  if (window.documentAPI?.abrirArchivo) {
    await window.documentAPI.abrirArchivo(dir);
  } else {
    try {
      const res = await fetch('/api/splitter/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder: dir }),
      });
      const data = await res.json();
      if (data?.success) {
        elements.saveStatusMsg.textContent = `Carpeta abierta en Windows Explorer: ${data.folder || dir}`;
      } else {
        throw new Error(data?.error || 'No se pudo abrir');
      }
    } catch (e) {
      elements.saveStatusMsg.textContent = `Carpeta en disco: ${dir}`;
    }
  }
}

// ==========================================================================
// VENTANA EMERGENTE DE CONFIRMACIÓN DE ÉXITO
// ==========================================================================
function openSuccessModal({ folder, totalCuts, dni }) {
  if (elements.modalSuccessFolder) elements.modalSuccessFolder.textContent = folder || state.outDir;
  if (elements.modalSuccessCount) elements.modalSuccessCount.textContent = `${totalCuts || state.segments.length} archivos`;
  if (elements.modalSuccessDni) elements.modalSuccessDni.textContent = dni || state.dniPrincipal || '—';
  if (elements.modalSuccessConfirm) elements.modalSuccessConfirm.hidden = false;
}

function closeSuccessModal() {
  if (elements.modalSuccessConfirm) elements.modalSuccessConfirm.hidden = true;
}

// ==========================================================================
// VENTANA EMERGENTE DE AVISO / ALERTA (SIN POPUPS NATIVOS DE LOCALHOST)
// ==========================================================================
function showAppNotice(message, title = 'Aviso del Sistema', type = 'info') {
  if (elements.modalAlertNotice) {
    if (elements.modalAlertTitle) elements.modalAlertTitle.textContent = title;
    if (elements.modalAlertDesc) elements.modalAlertDesc.textContent = type === 'error' ? 'Error detectado' : 'Información del proceso';
    if (elements.modalAlertMessage) elements.modalAlertMessage.textContent = String(message || '');
    if (elements.modalAlertIconBadge) {
      if (type === 'error') {
        elements.modalAlertIconBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        elements.modalAlertIconBadge.style.color = '#ef4444';
      } else {
        elements.modalAlertIconBadge.style.background = 'rgba(37, 99, 235, 0.15)';
        elements.modalAlertIconBadge.style.color = '#3b82f6';
      }
    }
    elements.modalAlertNotice.hidden = false;
  } else if (elements.saveStatusMsg) {
    elements.saveStatusMsg.textContent = `${title}: ${message}`;
  }
}

function closeAppNotice() {
  if (elements.modalAlertNotice) elements.modalAlertNotice.hidden = true;
}

// Reemplazar window.alert para que NUNCA aparezca "127.0.0.1:4173 dice"
window.showNominiNotice = (msg, title = 'Aviso', type = 'info') => showAppNotice(msg, title, type);
window.alert = (msg) => showAppNotice(msg, 'Aviso', 'info');

// ==========================================================================
// SELECCIÓN DIRECTA DE CARPETA EN WINDOWS (GUARDAR COMO)
// ==========================================================================
function getDirname(filePath) {
  if (!filePath) return '';
  const idx = Math.max(filePath.lastIndexOf('\\'), filePath.lastIndexOf('/'));
  return idx > 0 ? filePath.slice(0, idx) : filePath;
}

async function seleccionarCarpetaWindows(initialFolder) {
  const init = initialFolder || state.outDir || 'G:\\KALEF';
  // 1. En Electron
  if (window.documentAPI?.seleccionarCarpetaSalida) {
    try {
      const res = await window.documentAPI.seleccionarCarpetaSalida();
      if (res?.success && res.folderPath) return res.folderPath;
    } catch (err) {
      console.warn('Error en diálogo Electron:', err);
    }
    return null;
  }
  // 2. En Navegador web: llamar a /api/splitter/pick-folder que abre el diálogo nativo de Windows (BrowseForFolder)
  try {
    const resp = await fetch('/api/splitter/pick-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current: init }),
    });
    const data = await resp.json();
    if (data?.success && data.folderPath) {
      return data.folderPath;
    }
  } catch (err) {
    console.warn('Error al invocar diálogo de Windows:', err);
  }
  return null;
}

// ==========================================================================
// CONFIGURACIÓN DE EVENTOS Y CONTROLES
// ==========================================================================
function bindEvents() {
  // Selección de PDF en Electron o Web
  elements.btnSelectPdf.addEventListener('click', async () => {
    if (window.documentAPI?.seleccionarExpediente) {
      const res = await window.documentAPI.seleccionarExpediente();
      if (res?.success) void cargarYProcesarExpediente(res);
    } else {
      elements.hiddenFileInput.click();
    }
  });

  elements.hiddenFileInput.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      void cargarYProcesarExpediente({ file, fileName: file.name });
    }
    e.target.value = '';
  });

  // Ventana emergente de confirmación de éxito
  elements.modalSuccessOpenBtn?.addEventListener('click', () => {
    void abrirCarpetaDestino();
    closeSuccessModal();
  });
  elements.modalSuccessCloseBtn?.addEventListener('click', closeSuccessModal);
  elements.modalSuccessCloseIcon?.addEventListener('click', closeSuccessModal);
  elements.modalSuccessConfirm?.addEventListener('click', (e) => {
    if (e.target === elements.modalSuccessConfirm) closeSuccessModal();
  });

  // Ventana emergente de aviso del sistema (Sin alertas de localhost)
  elements.modalAlertOkBtn?.addEventListener('click', closeAppNotice);
  elements.modalAlertCloseIcon?.addEventListener('click', closeAppNotice);
  elements.modalAlertNotice?.addEventListener('click', (e) => {
    if (e.target === elements.modalAlertNotice) closeAppNotice();
  });

  elements.modalFolderPicker?.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const firstFile = files[0];
      const folderRelative = firstFile.webkitRelativePath ? firstFile.webkitRelativePath.split('/')[0] : '';
      if (firstFile.path) {
        elements.modalInputFolder.value = getDirname(firstFile.path);
        state.outDir = elements.modalInputFolder.value;
      } else if (folderRelative) {
        elements.modalInputFolder.value = folderRelative;
        state.outDir = elements.modalInputFolder.value;
      }
    }
    e.target.value = '';
  });

  // Filtros de cortes (Todos / Solo No Identificados)
  elements.filterAllCuts?.addEventListener('click', () => {
    state.cutsFilter = 'all';
    elements.filterAllCuts?.classList.add('is-active');
    elements.filterUnidentifiedCuts?.classList.remove('is-active');
    renderCutsList();
  });

  elements.filterUnidentifiedCuts?.addEventListener('click', () => {
    state.cutsFilter = 'unidentified';
    elements.filterAllCuts?.classList.remove('is-active');
    elements.filterUnidentifiedCuts?.classList.add('is-active');
    renderCutsList();
    const firstUnidentified = state.segments.find((s) => s.tipo === 'NO_IDENTIFICADO');
    if (firstUnidentified) {
      selectPage(firstUnidentified.paginasOriginales[0]);
    }
  });

  elements.reviewAlertBox?.addEventListener('click', () => {
    state.cutsFilter = 'unidentified';
    elements.filterAllCuts?.classList.remove('is-active');
    elements.filterUnidentifiedCuts?.classList.add('is-active');
    renderCutsList();
    const firstUnidentified = state.segments.find((s) => s.tipo === 'NO_IDENTIFICADO');
    if (firstUnidentified) {
      selectPage(firstUnidentified.paginasOriginales[0]);
    }
  });

  // Drag and Drop
  ['dragenter', 'dragover'].forEach((eventName) => {
    elements.canvasStage.addEventListener(eventName, (e) => {
      e.preventDefault();
      elements.canvasStage.classList.add('is-dragging');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    elements.canvasStage.addEventListener(eventName, (e) => {
      e.preventDefault();
      elements.canvasStage.classList.remove('is-dragging');
    });
  });

  elements.canvasStage.addEventListener('drop', (e) => {
    const file = e.dataTransfer?.files?.[0];
    if (file && file.name.toLowerCase().endsWith('.pdf')) {
      void cargarYProcesarExpediente({ file, fileName: file.name });
    }
  });

  elements.dropZone.addEventListener('click', () => {
    elements.btnSelectPdf.click();
  });

  // Navegación de páginas
  elements.prevPageBtn.addEventListener('click', () => selectPage(state.currentPage - 1));
  elements.nextPageBtn.addEventListener('click', () => selectPage(state.currentPage + 1));

  // Zoom y rotación
  elements.zoomInBtn.addEventListener('click', () => {
    state.zoom = Math.min(3.0, Number((state.zoom + 0.2).toFixed(2)));
    void renderCurrentPage();
  });

  elements.zoomOutBtn.addEventListener('click', () => {
    state.zoom = Math.max(0.4, Number((state.zoom - 0.2).toFixed(2)));
    void renderCurrentPage();
  });

  elements.zoomFitBtn.addEventListener('click', () => {
    state.zoom = 1.0;
    void renderCurrentPage();
    if (elements.canvasStage) {
      elements.canvasStage.scrollTop = 0;
      elements.canvasStage.scrollLeft = 0;
    }
  });

  elements.rotate90Btn.addEventListener('click', () => {
    state.rotation = (state.rotation + 90) % 360;
    void renderCurrentPage();
  });

  // Zoom con rueda de ratón (Ctrl + Scroll)
  elements.canvasStage?.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      const delta = e.deltaY < 0 ? 0.15 : -0.15;
      state.zoom = Math.min(3.0, Math.max(0.4, Number((state.zoom + delta).toFixed(2))));
      void renderCurrentPage();
    }
  }, { passive: false });

  // Maximizar / Restaurar Visor Central
  const btnMaximize = $('#btn-maximize-viewer');
  const viewerPanel = $('.viewer-panel');
  const maxLabel = $('#btn-maximize-label');
  const iconMax = btnMaximize?.querySelector('.icon-maximize');
  const iconMin = btnMaximize?.querySelector('.icon-minimize');

  function toggleMaximizeViewer() {
    if (!viewerPanel) return;
    const isMax = viewerPanel.classList.toggle('is-maximized');
    btnMaximize?.classList.toggle('btn-maximize-active', isMax);
    if (maxLabel) maxLabel.textContent = isMax ? 'Restaurar' : 'Maximizar';
    if (iconMax) iconMax.style.display = isMax ? 'none' : 'inline-block';
    if (iconMin) iconMin.style.display = isMax ? 'inline-block' : 'none';
    if (elements.canvasStage) {
      elements.canvasStage.scrollTop = 0;
      elements.canvasStage.scrollLeft = 0;
    }
    void renderCurrentPage();
  }

  btnMaximize?.addEventListener('click', toggleMaximizeViewer);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && viewerPanel?.classList.contains('is-maximized')) {
      toggleMaximizeViewer();
    }
  });

  // Aplicar DNI a todos
  elements.btnApplyDni?.addEventListener('click', () => {
    const dniVal = elements.inputDniPrincipal.value.trim();
    if (!/^\d{8}$/.test(dniVal)) {
      elements.saveStatusMsg.textContent = 'Por favor ingresa un número de DNI válido de 8 dígitos.';
      elements.inputDniPrincipal.focus();
      return;
    }
    state.dniPrincipal = dniVal;
    elements.saveStatusMsg.textContent = `DNI ${dniVal} aplicado. Pulsa "Re-cortar" para actualizar nombres de archivo.`;
  });

  // Botón Limpiar / Nuevo Expediente
  elements.btnResetSplitter?.addEventListener('click', () => resetSplitter());

  // Re-cortar con clasificaciones manuales
  elements.btnReSegment?.addEventListener('click', () => void reSegmentarExpediente());

  // Guardar Como... (Abre DIRECTAMENTE la ventana de Windows para elegir dónde guardar y guarda físicamente)
  elements.btnConfirmSaveFolder?.addEventListener('click', async () => {
    if (!state.segments.length || (!state.filePath && !state.pdfBytes)) {
      showAppNotice('Primero debes abrir o arrastrar un archivo PDF para poder guardar.', 'Aviso', 'info');
      return;
    }

    const originalHtml = elements.btnConfirmSaveFolder.innerHTML;
    elements.btnConfirmSaveFolder.disabled = true;
    elements.btnConfirmSaveFolder.textContent = 'Seleccionando carpeta...';

    try {
      // 1. Abre de frente la ventana nativa de Windows para que el usuario elija la carpeta de destino
      const carpetaElegida = await seleccionarCarpetaWindows(state.outDir);

      if (!carpetaElegida) {
        elements.saveStatusMsg.textContent = 'Guardado cancelado (no se seleccionó carpeta en Windows).';
        return;
      }

      // 2. Fijar la carpeta indicada por el usuario
      state.outDir = carpetaElegida;
      if (elements.metaOutdir) elements.metaOutdir.textContent = carpetaElegida;
      if (elements.metaOutdirPill) elements.metaOutdirPill.hidden = false;

      // 3. Proceder a cortar y guardar físicamente los archivos
      await confirmarYGuardarEnCarpeta();

      // 4. Abrir la carpeta en Windows Explorer para que el usuario acceda a sus archivos guardados
      await abrirCarpetaDestino();
    } catch (err) {
      console.error('Error en Guardar Como:', err);
      showAppNotice(`No se pudo completar Guardar Como: ${err.message}`, 'Error al Guardar', 'error');
    } finally {
      if (elements.btnConfirmSaveFolder) {
        elements.btnConfirmSaveFolder.disabled = false;
        elements.btnConfirmSaveFolder.innerHTML = originalHtml;
      }
    }
  });

  // Escuchar progreso desde Electron IPC si está disponible
  window.documentAPI?.onProgreso?.((prog) => {
    updateProgress(prog);
  });
}

// Inicialización
let systemPaths = {
  downloads: '',
  desktop: '',
  defaultDir: 'dist/legajos_cortados',
  pruebaDocs: '',
};

async function loadSystemPaths() {
  try {
    const res = await fetch('/api/splitter/system-paths');
    const data = await res.json();
    if (data?.success) {
      systemPaths = data;
    }
  } catch (_) {}
}

initTheme();
bindEvents();
void loadSystemPaths();

