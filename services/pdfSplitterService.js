'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { PDFDocument } = require('pdf-lib');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createWorker, OEM } = require('tesseract.js');

const MIN_DIGITAL_TEXT_LENGTH = 35;

function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function getAssetPaths() {
  const packaged = Boolean(process.versions?.electron && !process.defaultApp);
  if (packaged && process.resourcesPath) {
    return {
      langPath: path.join(process.resourcesPath, 'tessdata'),
      workerPath: path.join(process.resourcesPath, 'tesseract', 'worker-script', 'node', 'index.js'),
      corePath: path.join(process.resourcesPath, 'tesseract', 'core'),
    };
  }

  const rootDir = path.resolve(__dirname, '..');
  return {
    langPath: path.join(rootDir, 'tessdata'),
    workerPath: path.join(rootDir, 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
    corePath: path.join(rootDir, 'node_modules', 'tesseract.js-core'),
  };
}

function classifyPageText(rawText = '') {
  const norm = normalizeText(rawText);

  // Palabras clave semánticas por categoría
  const patterns = {
    CONTRATO_LABORAL: [
      /\bCONTRATO\s+DE\s+TRABAJO\b/i,
      /\bMODALIDAD\s+DE\s+SERVICIO\b/i,
      /\bSERVICIO\s+ESPECIFICO\b/i,
      /\bD\.?\s*S\.?\s*003-?97-?TR\b/i,
      /\bSUJETO\s+A\s+MODALIDAD\b/i,
      /\bEMPLEADOR\b/i,
      /\bREMUNERACION\s+BASICA\b/i,
      /\bPERIODO\s+DE\s+PRUEBA\b/i,
      /\bCLAUSULA\b/i,
      /\bVIPROSEG\b/i,
      /\bCEJOZ\b/i,
      /\bJORNADA\s+DE\s+TRABAJO\b/i,
      /\bTRABAJADOR\s+SE\s+OBLIGA\b/i,
    ],
    CARNE_SUCAMEC: [
      /\bSUCAMEC\b/i,
      /\bDISCAMEC\b/i,
      /\bSEGURIDAD\s+PRIVADA\b/i,
      /\bVIGILANTE\b/i,
      /\bMODALIDAD\s*:\s*(L1|L5)\b/i,
      /\bCARNE\s+DE\s+IDENTIDAD\b/i,
      /\bCARNET\b/i,
      /\bSERVICIOS\s+DE\s+SEGURIDAD\b/i,
      /\bAUTORIZACION\s+DE\s+PORTAR\b/i,
      /\bCADUCIDAD\b/i,
    ],
    DNI: [
      /\bREPUBLICA\s+DEL\s+PERU\b/i,
      /\bREGISTRO\s+NACIONAL\b/i,
      /\bIDENTIFICACION\s+Y\s+ESTADO\s+CIVIL\b/i,
      /\bRENIEC\b/i,
      /\bELECTORAL\b/i,
      /\bDOCUMENTO\s+NACIONAL\s+DE\s+IDENTIDAD\b/i,
      /\bFECHA\s+DE\s+NACIMIENTO\b/i,
      /\bCUI\s*:\s*\d{8}\b/i,
      /\bPRIMER\s+APELLIDO\b/i,
      /\bVOTACION\b/i,
    ],
    CERTIADULTO: [
      /\bCERTIFICADO\s+UNICO\s+LABORAL\b/i,
      /\bCERTIADULTO\b/i,
      /\bCERTICOMVEN\b/i,
      /\bMINISTERIO\s+DE\s+TRABAJO\b/i,
      /\bPROMOCION\s+DEL\s+EMPLEO\b/i,
      /\bANTECEDENTES\s+POLICIALES\b/i,
      /\bANTECEDENTES\s+PENALES\b/i,
      /\bANTECEDENTES\s+JUDICIALES\b/i,
      /\bTRAYECTORIA\s+EDUCATIVA\b/i,
      /\bEXPERIENCIA\s+LABORAL\s+FORMAL\b/i,
    ],
    FICHA_PERSONAL: [
      /\bFICHA\s+DE\s+DATOS\b/i,
      /\bDATOS\s+PERSONALES\b/i,
      /\bSOLICITUD\s+DE\s+EMPLEO\b/i,
      /\bDATOS\s+FAMILIARES\b/i,
      /\bCROQUIS\s+DEL\s+DOMICILIO\b/i,
      /\bEXPERIENCIA\s+LABORAL\b/i,
      /\bINGRESO\s+A\s+PLANILLA\b/i,
      /\bAREA\s+DE\s+SALUD\s+MENTAL\b/i,
    ],
    DECLARACION_JURADA: [
      /\bDECLARACION\s+JURADA\b/i,
      /\bDECLARACIÓN\s+JURADA\b/i,
      /\bLEY\s+N[°º]?\s*28882\b/i,
      /\bCOMPROMISO\s+DE\s+PERMANENCIA\b/i,
      /\bCONFIDENCIALIDAD\s+E\s+INCOMPATIBILIDAD\b/i,
      /\bAUTENTICIDAD\s+DE\s+DOCUMENTACION\b/i,
      /\bNO\s+TENER\s+ANTECEDENTES\b/i,
      /\bREPORTE\s+DE\s+SINTOMAS\b/i,
      /\bENFERMEDADES\s+CRONICAS\b/i,
    ],
    AUTORIZACION: [
      /\bAUTORIZACION\s+DE\s+DESCUENTO\b/i,
      /\bAUTORIZACION\s+PARA\s+TOMA\b/i,
      /\bPRUEBA\s+TOXICOLOGICA\b/i,
      /\bBOLETA\s+DE\s+PAGO\b/i,
      /\bDESCUENTO\s+POR\s+FALTAS\b/i,
      /\bART\.?\s*18\s+D\.?\s*L\.?\s*728\b/i,
    ],
    CARGO_RECEPCION: [
      /\bCARGO\s+DE\s+RECEPCION\b/i,
      /\bREGLAMENTO\s+INTERNO\s+DE\s+TRABAJO\b/i,
      /\bSEGURIDAD\s+Y\s+SALUD\s+EN\s+EL\s+TRABAJO\b/i,
      /\bVIPROSEG-REG\b/i,
      /\bTOMA\s+DE\s+CONOCIMIENTO\b/i,
      /\bDESCANSOS\s+MEDICOS\b/i,
      /\bSANCIONES\s+DICIPLINARIAS\b/i,
    ],
    FORMATO_PENSIONARIO: [
      /\bBOLETIN\s+INFORMATIVO\b/i,
      /\bSISTEMA\s+PRIVADO\s+DE\s+PENSIONES\b/i,
      /\bSISTEMA\s+NACIONAL\s+DE\s+PENSIONES\b/i,
      /\bFORMATO\s+DE\s+ELECCION\s+DEL\s+SISTEMA\s+PENSIONARIO\b/i,
      /\bSPP\b/i,
      /\bONP\b/i,
      /\bAFP\b/i,
    ],
  };

  const scores = {
    CONTRATO_LABORAL: 0,
    CARNE_SUCAMEC: 0,
    DNI: 0,
    CERTIADULTO: 0,
    FICHA_PERSONAL: 0,
    DECLARACION_JURADA: 0,
    AUTORIZACION: 0,
    CARGO_RECEPCION: 0,
    FORMATO_PENSIONARIO: 0,
  };

  for (const [category, regexList] of Object.entries(patterns)) {
    for (const regex of regexList) {
      if (regex.test(norm)) {
        scores[category] += 1;
      }
    }
  }

  // Ponderaciones especiales
  if (/CERTIFICADO\s+UNICO\s+LABORAL/.test(norm)) scores.CERTIADULTO += 3;
  if (/SUCAMEC/.test(norm)) scores.CARNE_SUCAMEC += 3;
  if (/CONTRATO\s+DE\s+TRABAJO/.test(norm)) scores.CONTRATO_LABORAL += 3;
  if (/RENIEC|DOCUMENTO\s+NACIONAL\s+DE\s+IDENTIDAD/.test(norm)) scores.DNI += 3;

  let bestCategory = 'NO_IDENTIFICADO';
  let maxScore = 0;

  for (const [category, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      bestCategory = category;
    }
  }

  // Si no alcanza al menos 1 punto de coincidencia sólida
  if (maxScore < 1) {
    return {
      tipo: 'NO_IDENTIFICADO',
      confianza: 0,
      scores,
    };
  }

  const confianza = Math.min(0.99, Number((0.55 + maxScore * 0.12).toFixed(2)));
  return {
    tipo: bestCategory,
    confianza,
    scores,
  };
}

function extractDniFromText(rawText = '') {
  if (!rawText) return null;

  // 1. Patrón con etiqueta explícita (mayor certeza)
  const labeledRegexes = [
    /\b(?:DNI|D\.N\.I\.?|DOCUMENTO|CUI|IDENTIDAD|CARNET|N[°º])\s*[:#-]?\s*(\d{8})\b/i,
    /\bN(?:UMERO|°|O)?\s*(\d{8})\b/i,
  ];

  for (const regex of labeledRegexes) {
    const match = regex.exec(rawText);
    if (match && match[1]) {
      const candidate = match[1];
      if (!isInvalidDni(candidate)) return candidate;
    }
  }

  // 2. Patrón de 8 dígitos aislado
  const matches = rawText.match(/\b\d{8}\b/g) || [];
  for (const candidate of matches) {
    if (!isInvalidDni(candidate)) return candidate;
  }

  return null;
}

function isInvalidDni(digits = '') {
  if (!/^\d{8}$/.test(digits)) return true;
  // Descartar fechas como 20261109 o 20260101
  if (digits.startsWith('19') || digits.startsWith('20')) {
    const year = Number(digits.slice(0, 4));
    const month = Number(digits.slice(4, 6));
    const day = Number(digits.slice(6, 8));
    if (year >= 1970 && year <= 2040 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return true;
    }
  }
  // Descartar secuencias repetitivas como 00000000, 11111111
  if (/^(\d)\1{7}$/.test(digits)) return true;
  return false;
}

async function renderPageToImageBuffer(pdfPage, scale = 1.15) {
  const viewport = pdfPage.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  const context = canvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await pdfPage.render({ canvasContext: context, viewport }).promise;
  const imageBuffer = canvas.toBuffer('image/jpeg', { quality: 85 });

  // Generar thumbnail en memoria directamente por downscaling (evita re-renderizar PDF en pdfjs)
  const thumbScale = 0.28 / scale;
  const thumbWidth = Math.max(1, Math.ceil(canvas.width * thumbScale));
  const thumbHeight = Math.max(1, Math.ceil(canvas.height * thumbScale));
  const thumbCanvas = createCanvas(thumbWidth, thumbHeight);
  const thumbCtx = thumbCanvas.getContext('2d');
  thumbCtx.drawImage(canvas, 0, 0, thumbWidth, thumbHeight);
  const thumbnail = `data:image/jpeg;base64,${thumbCanvas.toBuffer('image/jpeg', { quality: 70 }).toString('base64')}`;

  return { imageBuffer, thumbnail };
}

async function renderThumbnailBase64(pdfPage, scale = 0.28) {
  try {
    const viewport = pdfPage.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport }).promise;
    return `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', { quality: 70 }).toString('base64')}`;
  } catch {
    return '';
  }
}

/**
 * Agrupa páginas continuas que compartan el mismo tipo clasificado.
 * Ejemplo: [1: CONTRATO, 2: CONTRATO, 3: CONTRATO, 4: SUCAMEC] ->
 * Bloque 1: CONTRATO (páginas 1, 2, 3)
 * Bloque 2: SUCAMEC (página 4)
 */
function agruparPaginasContinuas(paginasAnalizadas = []) {
  if (!paginasAnalizadas.length) return [];

  const grupos = [];
  let grupoActual = null;

  for (const pag of paginasAnalizadas) {
    if (!grupoActual) {
      grupoActual = {
        tipo: pag.tipo,
        paginas: [pag.numeroPagina],
        dnisDetectados: pag.dni ? [pag.dni] : [],
        textos: [pag.textoExtraido || ''],
        requiereRevision: pag.tipo === 'NO_IDENTIFICADO' || pag.confianza < 0.6,
      };
      continue;
    }

    // Si es del mismo tipo, fusionar en el mismo bloque continuo
    if (grupoActual.tipo === pag.tipo) {
      grupoActual.paginas.push(pag.numeroPagina);
      if (pag.dni && !grupoActual.dnisDetectados.includes(pag.dni)) {
        grupoActual.dnisDetectados.push(pag.dni);
      }
      grupoActual.textos.push(pag.textoExtraido || '');
      if (pag.tipo === 'NO_IDENTIFICADO' || pag.confianza < 0.6) {
        grupoActual.requiereRevision = true;
      }
    } else {
      grupos.push(grupoActual);
      grupoActual = {
        tipo: pag.tipo,
        paginas: [pag.numeroPagina],
        dnisDetectados: pag.dni ? [pag.dni] : [],
        textos: [pag.textoExtraido || ''],
        requiereRevision: pag.tipo === 'NO_IDENTIFICADO' || pag.confianza < 0.6,
      };
    }
  }

  if (grupoActual) {
    grupos.push(grupoActual);
  }

  return grupos;
}

/**
 * Genera el corte físico de un PDF con pdf-lib agrupando las páginas indicadas.
 */
async function cortarYGuardarBloque(srcPdfDoc, paginasIndices0, rutaDestino) {
  const newPdf = await PDFDocument.create();
  const copiedPages = await newPdf.copyPages(srcPdfDoc, paginasIndices0);
  for (const page of copiedPages) {
    newPdf.addPage(page);
  }
  const bytes = await newPdf.save();
  await fs.writeFile(rutaDestino, bytes);
  return bytes.byteLength;
}

/**
 * Función Principal de Segmentación y Corte
 */
async function segmentarYDividirPdf(rutaPdfOrigen, carpetaSalida, opciones = {}) {
  const resolvedPdfPath = path.resolve(rutaPdfOrigen);
  const pdfBytes = await fs.readFile(resolvedPdfPath);
  if (!pdfBytes.byteLength) {
    throw new Error('El archivo PDF de origen está vacío o dañado.');
  }

  const outDir = carpetaSalida ? path.resolve(carpetaSalida) : path.dirname(resolvedPdfPath);
  await fs.mkdir(outDir, { recursive: true });

  // 1. Cargar PDF con pdf-lib para corte físico
  const srcPdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcPdfDoc.getPageCount();
  if (totalPages === 0) {
    throw new Error('El PDF no contiene páginas legibles.');
  }

  // 2. Cargar con pdfjs-dist para extracción de texto y renderizado
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let standardFontDataUrl;
  try {
    const fontsPath = path.join(__dirname, '..', 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
    standardFontDataUrl = pathToFileURL(fontsPath).href;
  } catch {
    standardFontDataUrl = undefined;
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBytes),
    isEvalSupported: false,
    useSystemFonts: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  });
  const pdfjsDoc = await loadingTask.promise;

  // Determinar número óptimo de workers para OCR paralelo (hasta 3-4 según núcleos)
  const numWorkers = Math.min(3, Math.max(2, Math.floor((os.cpus()?.length || 4) / 2)));
  const assetPaths = getAssetPaths();
  const workerPool = [];

  const paginasAnalizadas = new Array(totalPages);
  let dniGlobal = null;
  const ocrTasks = [];

  try {
    // FASE 1: Inspección de texto digital nativo y renderizado único por página
    for (let pageNum = 1; pageNum <= totalPages; pageNum += 1) {
      if (typeof opciones.onProgress === 'function') {
        opciones.onProgress({
          etapa: 'analizando',
          paginaActual: pageNum,
          totalPaginas: totalPages,
          porcentaje: Math.round((pageNum / totalPages) * 35),
        });
      }

      const page = await pdfjsDoc.getPage(pageNum);
      let pageText = '';

      // Extracción de texto digital nativo
      try {
        const textContent = await page.getTextContent();
        if (textContent?.items?.length) {
          pageText = textContent.items
            .map((item) => (typeof item.str === 'string' ? item.str : ''))
            .filter(Boolean)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim();
        }
      } catch {
        pageText = '';
      }

      const classification = classifyPageText(pageText);
      const dniCandidate = extractDniFromText(pageText);
      if (dniCandidate && !dniGlobal) {
        dniGlobal = dniCandidate;
      }

      // Si tiene texto digital suficiente o ya se clasificó con certeza semántica
      if (pageText.length >= MIN_DIGITAL_TEXT_LENGTH || classification.tipo !== 'NO_IDENTIFICADO') {
        const thumbnail = await renderThumbnailBase64(page, 0.28);
        paginasAnalizadas[pageNum - 1] = {
          numeroPagina: pageNum,
          tipo: classification.tipo,
          confianza: classification.confianza,
          scores: classification.scores,
          esEscaneado: false,
          dni: dniCandidate,
          textoExtraido: pageText,
          thumbnail,
        };
      } else {
        // Necesita OCR: renderizar imagen a 1.15x y generar miniatura en memoria (sin doble llamada a render)
        const { imageBuffer, thumbnail } = await renderPageToImageBuffer(page, 1.15);
        ocrTasks.push({
          pageNum,
          imageBuffer,
          thumbnail,
        });
      }
    }

    // FASE 2: Si hay páginas escaneadas, procesarlas en paralelo con el Worker Pool
    if (ocrTasks.length > 0) {
      for (let i = 0; i < Math.min(numWorkers, ocrTasks.length); i++) {
        const w = await createWorker('spa', OEM.DEFAULT, {
          langPath: assetPaths.langPath,
          workerPath: assetPaths.workerPath,
          corePath: assetPaths.corePath,
          cacheMethod: 'none',
          gzip: false,
        });
        try {
          await w.setParameters({ tessedit_pageseg_mode: '3' });
        } catch (_) {}
        workerPool.push(w);
      }

      let taskIndex = 0;
      let completedOcr = 0;

      async function runWorker(worker) {
        while (taskIndex < ocrTasks.length) {
          const currentTask = ocrTasks[taskIndex++];
          if (!currentTask) break;

          let ocrText = '';
          try {
            const { data } = await worker.recognize(currentTask.imageBuffer);
            ocrText = (data?.text || '').trim();
          } catch (err) {
            console.warn(`[Splitter] Error OCR en pág ${currentTask.pageNum}:`, err.message);
          }

          const classification = classifyPageText(ocrText);
          const dniPage = extractDniFromText(ocrText);
          if (dniPage && !dniGlobal) {
            dniGlobal = dniPage;
          }

          paginasAnalizadas[currentTask.pageNum - 1] = {
            numeroPagina: currentTask.pageNum,
            tipo: classification.tipo,
            confianza: classification.confianza,
            scores: classification.scores,
            esEscaneado: true,
            dni: dniPage,
            textoExtraido: ocrText,
            thumbnail: currentTask.thumbnail,
          };

          completedOcr += 1;
          if (typeof opciones.onProgress === 'function') {
            opciones.onProgress({
              etapa: 'analizando',
              paginaActual: completedOcr,
              totalPaginas: ocrTasks.length,
              porcentaje: 35 + Math.round((completedOcr / ocrTasks.length) * 35),
            });
          }
        }
      }

      await Promise.all(workerPool.map((w) => runWorker(w)));
    }
  } finally {
    if (workerPool.length > 0) {
      await Promise.allSettled(workerPool.map((w) => w.terminate()));
    }
    try {
      if (typeof pdfjsDoc.cleanup === 'function') await pdfjsDoc.cleanup();
      if (typeof loadingTask.destroy === 'function') await loadingTask.destroy();
    } catch {
      // Ignorar
    }
  }

  // 3. Agrupación semántica continua
  const grupos = agruparPaginasContinuas(paginasAnalizadas);

  // 4. Corte Físico con pdf-lib y nombrado de archivos
  const segmentosGenerados = [];
  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const dniFinal = dniGlobal || 'SIN_DNI';

  let orden = 1;
  for (const grupo of grupos) {
    if (typeof opciones.onProgress === 'function') {
      opciones.onProgress({
        etapa: 'cortando',
        bloqueActual: orden,
        totalBloques: grupos.length,
        porcentaje: 70 + Math.round((orden / grupos.length) * 30),
      });
    }

    const dniBloque = grupo.dnisDetectados[0] || dniFinal;
    const ordenStr = String(orden).padStart(2, '0');
    const sufijo = dniBloque !== 'SIN_DNI' ? dniBloque : timestamp;
    const nombreArchivo = `${ordenStr}_${grupo.tipo}_${sufijo}.pdf`;
    const rutaDestino = path.join(outDir, nombreArchivo);

    const paginasIndices0 = grupo.paginas.map((p) => p - 1);
    const tamanoBytes = await cortarYGuardarBloque(srcPdfDoc, paginasIndices0, rutaDestino);

    segmentosGenerados.push({
      id: `seg-${orden}`,
      orden,
      tipo: grupo.tipo,
      paginasOriginales: grupo.paginas,
      archivoGenerado: nombreArchivo,
      rutaArchivoGenerado: rutaDestino,
      requiereRevision: grupo.requiereRevision,
      dni: dniBloque,
      tamanoBytes,
    });

    orden += 1;
  }

  return {
    success: true,
    archivoOrigen: path.basename(resolvedPdfPath),
    rutaOrigen: resolvedPdfPath,
    carpetaSalida: outDir,
    totalPaginas: totalPages,
    dniPrincipal: dniGlobal,
    paginasDetalle: paginasAnalizadas,
    segmentosGenerados,
  };
}

/**
 * Re-corte con asignaciones personalizadas de páginas definidas por el usuario desde la UI
 */
async function cortarConSegmentosPersonalizados(rutaPdfOrigen, carpetaSalida, mapaPaginas = [], dniManual = '') {
  const resolvedPdfPath = path.resolve(rutaPdfOrigen);
  const pdfBytes = await fs.readFile(resolvedPdfPath);
  const outDir = carpetaSalida ? path.resolve(carpetaSalida) : path.dirname(resolvedPdfPath);
  await fs.mkdir(outDir, { recursive: true });

  const srcPdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const totalPages = srcPdfDoc.getPageCount();

  // mapaPaginas es un array: [{ numeroPagina: 1, tipo: 'CONTRATO_LABORAL' }, ...]
  const paginasOrdenadas = [...mapaPaginas].sort((a, b) => a.numeroPagina - b.numeroPagina);
  const grupos = agruparPaginasContinuas(paginasOrdenadas);

  const timestamp = new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const dniFinal = dniManual || 'SIN_DNI';
  const segmentosGenerados = [];

  let orden = 1;
  for (const grupo of grupos) {
    const ordenStr = String(orden).padStart(2, '0');
    const sufijo = dniFinal !== 'SIN_DNI' ? dniFinal : timestamp;
    const nombreArchivo = `${ordenStr}_${grupo.tipo}_${sufijo}.pdf`;
    const rutaDestino = path.join(outDir, nombreArchivo);

    const paginasIndices0 = grupo.paginas
      .filter((p) => p >= 1 && p <= totalPages)
      .map((p) => p - 1);

    if (!paginasIndices0.length) continue;

    const tamanoBytes = await cortarYGuardarBloque(srcPdfDoc, paginasIndices0, rutaDestino);

    segmentosGenerados.push({
      id: `seg-${orden}`,
      orden,
      tipo: grupo.tipo,
      paginasOriginales: grupo.paginas,
      archivoGenerado: nombreArchivo,
      rutaArchivoGenerado: rutaDestino,
      requiereRevision: grupo.tipo === 'NO_IDENTIFICADO',
      dni: dniFinal,
      tamanoBytes,
    });

    orden += 1;
  }

  return {
    success: true,
    carpetaSalida: outDir,
    totalSegmentos: segmentosGenerados.length,
    segmentosGenerados,
  };
}

module.exports = {
  segmentarYDividirPdf,
  cortarConSegmentosPersonalizados,
  classifyPageText,
  extractDniFromText,
  agruparPaginasContinuas,
};

