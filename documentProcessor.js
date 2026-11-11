'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const { createWorker, OEM } = require('tesseract.js');

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

function normalizeText(value = '') {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function getAssetPaths() {
  const packaged = Boolean(process.versions.electron && !process.defaultApp);

  if (packaged) {
    return {
      langPath: path.join(process.resourcesPath, 'tessdata'),
      workerPath: path.join(process.resourcesPath, 'tesseract', 'worker-script', 'node', 'index.js'),
      corePath: path.join(process.resourcesPath, 'tesseract', 'core'),
    };
  }

  return {
    langPath: path.join(__dirname, 'tessdata'),
    workerPath: path.join(__dirname, 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js'),
    corePath: path.join(__dirname, 'node_modules', 'tesseract.js-core'),
  };
}

async function extractPdfTextAndImage(pdfBuffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  let standardFontDataUrl;
  try {
    const fontsPath = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'standard_fonts') + path.sep;
    standardFontDataUrl = pathToFileURL(fontsPath).href;
  } catch {
    standardFontDataUrl = undefined;
  }

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(pdfBuffer),
    isEvalSupported: false,
    useSystemFonts: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  });
  const pdf = await loadingTask.promise;

  let nativeText = '';
  let imageBuffer = null;

  try {
    const page = await pdf.getPage(1);

    try {
      const textContent = await page.getTextContent();
      if (textContent?.items?.length) {
        nativeText = textContent.items
          .map((item) => (typeof item.str === 'string' ? item.str : ''))
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
      }
    } catch {
      nativeText = '';
    }

    const viewport = page.getViewport({ scale: 2 });
    const canvas = createCanvas(
      Math.ceil(viewport.width),
      Math.ceil(viewport.height),
    );
    const context = canvas.getContext('2d');

    await page.render({ canvasContext: context, viewport }).promise;
    imageBuffer = canvas.toBuffer('image/png');
  } finally {
    try {
      if (typeof pdf.cleanup === 'function') await pdf.cleanup();
      if (typeof loadingTask.destroy === 'function') await loadingTask.destroy();
    } catch {
      // Ignorar errores de destrucción
    }
  }

  return { nativeText, imageBuffer };
}

async function prepareOcrImage(imageBuffer) {
  const image = await loadImage(imageBuffer);
  const scale = image.width < 1800 ? 1800 / image.width : 1;
  const canvas = createCanvas(
    Math.ceil(image.width * scale),
    Math.ceil(image.height * scale),
  );
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.filter = 'grayscale(1) contrast(1.15)';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toBuffer('image/png');
}

function extractLabeledValue(lines, labelPattern) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const match = labelPattern.exec(line);
    if (!match) continue;

    const inlineValue = line
      .slice(match.index + match[0].length)
      .replace(/^[\s:;#\-–]+/, '')
      .trim();
    if (inlineValue) return inlineValue;

    const nextLine = lines[index + 1];
    if (nextLine && !/^(DNI|RUC|FECHA|CARGO|PUESTO|SUELDO|REMUNERACION|SEXO|ESTADO CIVIL)\b/.test(nextLine)) {
      return nextLine.trim();
    }
  }

  return null;
}

function extractContractWorkerDni(lines, fullText) {
  const representativeTerms = /GERENTE|REPRESENTANTE|APODERADO|REPRESENTACION\s+LEGAL|EN\s+REPRESENTACION|EMPRESA|EMPLEADOR/;
  const workerTerms = /TRABAJADOR|COLABORADOR|EMPLEADO|OPERATIVO|SENOR|SENORA|SR|SRA/;

  const matches = [...fullText.matchAll(/\b\d{8}\b/g)];
  if (!matches.length) return null;

  const scored = [];
  for (const m of matches) {
    const pos = m.index;
    const dni = m[0];
    const contextBefore = fullText.slice(Math.max(0, pos - 120), pos);
    const contextAfter = fullText.slice(pos + 8, Math.min(fullText.length, pos + 120));

    let score = 0;
    if (representativeTerms.test(contextBefore)) score -= 10;
    if (representativeTerms.test(contextAfter)) score -= 5;
    if (workerTerms.test(contextBefore)) score += 10;
    if (workerTerms.test(contextAfter)) score += 5;
    if (/IDENTIFICAD[OA]\s+CON\s+(?:DOCUMENTO\s+NACIONAL\s+DE\s+IDENTIDAD|DNI)/.test(contextBefore)) score += 8;

    scored.push({ dni, score, pos });
  }

  scored.sort((a, b) => b.score - a.score || b.pos - a.pos);
  return scored[0]?.dni ?? matches[matches.length - 1][0];
}

function extractContractWorkerName(text) {
  const match = text.match(
    /(?:EL\s+)?(?:SENOR|SENORA|SR|SRA|SRIA)(?:\s*\/\s*[A-Z]+)*\s+([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+){1,4}),?\s+IDENTIFICAD[OA]\s+CON\s+(?:DOCUMENTO|DNI)/,
  );
  if (match?.[1]) return match[1].trim();

  const matchAlt = text.match(
    /(?:TRABAJADOR(?:A)?|COLABORADOR(?:A)?)\s*[:\-]?\s*([A-ZÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ]+){1,4})/,
  );
  return matchAlt?.[1]?.trim() ?? null;
}

function extractContractSalary(text) {
  const label = /(?:SUELDO\s+BASICO|REMUNERACION\s+BASICA|SALARIO\s+BASICO|SUELDO\s+MENSUAL|REMUNERACION\s+MENSUAL)/.exec(text);
  if (!label) return null;
  const afterLabel = text.slice(label.index + label[0].length, label.index + label[0].length + 120);
  const numberMatch = afterLabel.match(/(?:S\/?\.?\s*)?(\d{1,3}(?:,\d{3})*(?:\.\d{2})|\d{3,5}(?:\.\d{2})?)/);
  return numberMatch?.[1]?.replace(/,/g, '') ?? null;
}

function extractContractCargo(text) {
  const match = text.match(/(?:DESEMPENARSE\s+COMO|CARGO\s+DE|PUESTO\s+DE)\s+([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ ]{2,50}?)(?=,|\.|\bQUIEN\b|\bPARA\b|\bEN\s+LA\b)/);
  if (match?.[1]) return match[1].trim();

  if (/\bAGENTE\s+DE\s+SEGURIDAD\b/.test(text)) return 'AGENTE DE SEGURIDAD';
  if (/\bSUPERVISOR\b/.test(text)) return 'SUPERVISOR';
  if (/\bOPERARIO\s+DE\s+LIMPIEZA\b/.test(text)) return 'OPERARIO DE LIMPIEZA';
  if (/\bVIGILANTE\b/.test(text)) return 'VIGILANTE';
  return null;
}

function extractDates(text) {
  const numericDates = [...text.matchAll(/\b(?:\d{1,2}[/-]\d{1,2}[/-](?:19|20)\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})\b/g)]
    .map((match) => {
      let val = match[0].replace(/-/g, '/');
      const parts = val.split('/');
      if (parts[0].length === 4) val = `${parts[2].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[0]}`;
      else val = `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2]}`;
      return { index: match.index, value: val };
    });

  const monthNumbers = {
    ENERO: '01', FEBRERO: '02', MARZO: '03', ABRIL: '04', MAYO: '05', JUNIO: '06',
    JULIO: '07', AGOSTO: '08', SEPTIEMBRE: '09', SETIEMBRE: '09', OCTUBRE: '10',
    NOVIEMBRE: '11', DICIEMBRE: '12',
  };
  const spanishDates = [...text.matchAll(/\b(\d{1,2})\s+DE\s+(ENERO|FEBRERO|MARZO|ABRIL|MAYO|JUNIO|JULIO|AGOSTO|SEPTIEMBRE|SETIEMBRE|OCTUBRE|NOVIEMBRE|DICIEMBRE)\s+DEL?\s+((?:19|20)\d{2})\b/g)]
    .map((match) => ({
      index: match.index,
      value: `${match[1].padStart(2, '0')}/${monthNumbers[match[2]]}/${match[3]}`,
    }));

  return [...numericDates, ...spanishDates].sort((a, b) => a.index - b.index);
}

function extractValidityDates(text) {
  const matches = extractDates(text);
  const explicitStart = matches.find((match) => {
    const before = text.slice(Math.max(0, match.index - 50), match.index);
    return /\b(?:DESDE|INICIO|INICIANDO|INICIA|A\s+PARTIR\s+DE|EMISION)\b/.test(before);
  });
  const explicitEnd = matches.find((match) => {
    const before = text.slice(Math.max(0, match.index - 50), match.index);
    return /\b(?:HASTA|VENCE|VENCIMIENTO|CADUCIDAD|FIN|CULMINANDO|CULMINA)\b/.test(before);
  });

  return {
    desde: explicitStart?.value ?? matches[0]?.value ?? null,
    hasta: explicitEnd?.value ?? matches[1]?.value ?? null,
  };
}

function calculateSemaforo(dateStr) {
  if (!dateStr) return { status: 'UNKNOWN', label: 'Sin fecha', color: 'neutral' };
  const parts = dateStr.split(/[/-]/);
  if (parts.length !== 3) return { status: 'UNKNOWN', label: 'Formato no reconocido', color: 'neutral' };

  let day, month, year;
  if (parts[0].length === 4) {
    [year, month, day] = parts.map(Number);
  } else {
    [day, month, year] = parts.map(Number);
  }

  const targetDate = new Date(year, month - 1, day);
  if (isNaN(targetDate.getTime())) return { status: 'UNKNOWN', label: 'Fecha inválida', color: 'neutral' };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const diffTime = targetDate.getTime() - today.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return { status: 'EXPIRED', label: `VENCIDO (${Math.abs(diffDays)}d)`, color: 'danger', days: diffDays };
  } else if (diffDays <= 30) {
    return { status: 'EXPIRING_SOON', label: `POR VENCER (${diffDays}d)`, color: 'warning', days: diffDays };
  } else {
    return { status: 'VALID', label: `VIGENTE (${diffDays}d)`, color: 'success', days: diffDays };
  }
}

function classifyDocument(normalizedText, fileName = '') {
  const normFile = normalizeText(fileName);

  if (/AUTORIZACION.*BOLETA|ENTREGA\s+DE\s+LA\s+BOLETA\s+DE\s+PAGO\s+A\s+TRAVES\s+DE\s+MEDIOS\s+ELECTRONICOS/.test(normalizedText) || /AUTORIZACION/i.test(normFile)) {
    return 'AUTORIZACION';
  }
  if (/DECLARACION\s+JURADA|\bDJ\b/.test(normalizedText) || /\bDJ\b|DECLARACION/i.test(normFile)) {
    return 'DECLARACION_JURADA';
  }
  if (/CERTIADULTO|CERTIOVEN|CERTIFICADO\s+UNICO\s+LABORAL/.test(normalizedText) || /CERTIADULTO|ANTECEDENTE/i.test(normFile)) {
    return 'CERTIADULTO';
  }
  if (/SUCAMEC|CARN[EÉ]\s+DE\s+IDENTIDAD.*(?:SEGURIDAD|VIGILANCIA)|FUT\s+SUCAMEC|\bL\s*[15]\b/.test(normalizedText) || /SUCAMEC|CARNET|FUT/i.test(normFile)) {
    return 'CARNE_SUCAMEC';
  }
  if (/CONTRATO\s+(?:DE\s+)?TRABAJO|CONTRATO\s+LABORAL|MODALIDAD\s+DE\s+SERVICIO\s+ESPECIFICO/.test(normalizedText) || /CONTRATO/i.test(normFile)) {
    return 'CONTRATO_LABORAL';
  }
  if (/CONSTANCIA\s+DE\s+ESTUDIO|CONSTANCIA\s+DE\s+TRABAJO|CERTIFICADO\s+DE\s+ESTUDIO|CONSTANCIA/.test(normalizedText) || /CONSTANCIA|ESTUDIO|CERT/i.test(normFile)) {
    return 'CONSTANCIA';
  }
  if (/EXPEDIENTE|LEGAJO/.test(normalizedText) || /EXP|LEGAJO/i.test(normFile)) {
    return 'EXPEDIENTE';
  }
  if (/\bDNI\b|DOCUMENTO\s+NACIONAL\s+DE\s+IDENTIDAD|REGISTRO\s+NACIONAL\s+DE\s+IDENTIFICACION/.test(normalizedText) || /DNI/i.test(normFile)) {
    return 'DNI';
  }

  return 'DOCUMENTO_GENERAL';
}

function parseFields(type, text, fileName = '') {
  const normalized = normalizeText(text);
  const lines = normalized.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  if (type === 'CONTRATO_LABORAL') {
    const ruc = normalized.match(/(?:\bRUC\b|REGISTRO\s+UNICO\s+DE\s+CONTRIBUYENTE)\D{0,45}(\d{11})\b/);
    const company = normalized.match(/\b(?:UNA\s+PARTE|EMPLEADOR(?:A)?\s*[:\-])\s+([A-Z0-9][A-Z0-9&. ,\-]{2,70}?),?\s+CON\s+(?:REGISTRO\s+UNICO|RUC)/)
      ?? normalized.match(/\b(VIPROSEG|CEJOZ|HENKO|JOZ|TACTICA|BARAM)(?:\s+S\.?\s*A\.?\s*C\.?)?/);
    const assignedClient = /\bESSALUD\b/.test(normalized)
      ? 'ESSALUD'
      : (/\bINCOR\b/.test(normalized) ? 'INCOR' : extractLabeledValue(lines, /\b(?:CLIENTE|UNIDAD|SEDE|SERVICIO\s+ASIGNADO)\b/));
    const vigencia = extractValidityDates(normalized);

    return {
      rucEmpresa: ruc?.[1] ?? '20612204030',
      empresaEmpleadora: company?.[1]?.trim() ?? company?.[0] ?? 'VIPROSEG S.A.C.',
      dniTrabajador: extractContractWorkerDni(lines, normalized),
      nombreTrabajador: extractContractWorkerName(normalized),
      sueldoBasico: extractContractSalary(normalized) ?? '1130.00',
      cargo: extractContractCargo(normalized) ?? 'AGENTE DE SEGURIDAD',
      clienteUnidad: assignedClient ?? 'ESSALUD',
      fechaEmision: vigencia.desde,
      vigenciaDesde: vigencia.desde,
      vigenciaHasta: vigencia.hasta,
      semaforo: calculateSemaforo(vigencia.hasta),
    };
  }

  if (type === 'CARNE_SUCAMEC') {
    const mode = normalized.match(/\bL\s*([15])\b/);
    const carneNum = normalized.match(/\b(?:CARNE|CARNET|NRO|NUMERO)\.?\s*[:#\-]?\s*([A-Z0-9]{5,12})\b/);
    const dniMatch = normalized.match(/\bDNI\s*[:#\-]?\s*(\d{8})\b/) || normalized.match(/\b\d{8}\b/);
    const dates = extractValidityDates(normalized);

    return {
      numeroCarne: carneNum?.[1] ?? null,
      dniTrabajador: dniMatch?.[1] ?? dniMatch?.[0] ?? null,
      nombreTrabajador: extractContractWorkerName(normalized),
      modalidad: mode ? (mode[1] === '1' ? 'L1 Sin Arma' : 'L5 Con Arma') : 'L1 Sin Arma',
      fechaEmision: dates.desde,
      fechaCaducidad: dates.hasta,
      vigenciaDesde: dates.desde,
      vigenciaHasta: dates.hasta,
      semaforo: calculateSemaforo(dates.hasta),
    };
  }

  if (type === 'DNI') {
    const dniMatch = normalized.match(/\b\d{8}\b/);
    const nombre = extractContractWorkerName(normalized)
      ?? extractLabeledValue(lines, /\b(?:APELLIDOS\s+Y\s+NOMBRES|NOMBRES\s+Y\s+APELLIDOS|NOMBRES)\b/);
    const dates = extractValidityDates(normalized);

    return {
      dniTrabajador: dniMatch?.[0] ?? null,
      nombreTrabajador: nombre ? nombre.replace(/\b(?:DNI|SEXO|FECHA|ESTADO CIVIL)\b.*/, '').replace(/\d/g, '').trim() : null,
      fechaEmision: dates.desde,
      fechaCaducidad: dates.hasta,
      vigenciaDesde: dates.desde,
      vigenciaHasta: dates.hasta,
      semaforo: calculateSemaforo(dates.hasta),
    };
  }

  if (type === 'AUTORIZACION') {
    const dniMatch = normalized.match(/\b\d{8}\b/);
    const nombre = extractContractWorkerName(normalized)
      ?? extractLabeledValue(lines, /\b(?:APELLIDOS\s+Y\s+NOMBRES|NOMBRE|TRABAJADOR)\b/);
    const emailMatch = normalized.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/);
    const dates = extractValidityDates(normalized);

    return {
      rucEmpresa: '20612204030',
      empresaEmpleadora: 'VIPROSEG S.A.C.',
      dniTrabajador: dniMatch?.[0] ?? null,
      nombreTrabajador: nombre ? nombre.trim() : null,
      clienteUnidad: 'AUTORIZACIÓN BOLETA DIGITAL',
      email: emailMatch?.[0] ?? null,
      fechaEmision: dates.desde,
      vigenciaDesde: dates.desde,
      vigenciaHasta: dates.hasta,
      semaforo: { status: 'VALID', label: 'VÁLIDO', color: 'success' },
    };
  }

  if (type === 'CERTIADULTO') {
    const dniMatch = normalized.match(/\b\d{8}\b/);
    const dates = extractValidityDates(normalized);
    return {
      dniTrabajador: dniMatch?.[0] ?? null,
      nombreTrabajador: extractContractWorkerName(normalized),
      cargo: 'CERTIFICADO UNICO LABORAL',
      fechaEmision: dates.desde,
      vigenciaDesde: dates.desde,
      vigenciaHasta: dates.hasta,
      semaforo: calculateSemaforo(dates.hasta),
    };
  }

  // Declaraciones Juradas, Expedientes o Documentos Generales
  const dniAny = normalized.match(/\b\d{8}\b/);
  const datesAny = extractValidityDates(normalized);
  return {
    dniTrabajador: dniAny?.[0] ?? null,
    nombreTrabajador: extractContractWorkerName(normalized),
    cargo: type ? type.replace(/_/g, ' ') : 'DOCUMENTO',
    clienteUnidad: 'LEGAJO PERSONAL',
    fechaEmision: datesAny.desde,
    vigenciaDesde: datesAny.desde,
    vigenciaHasta: datesAny.hasta,
    semaforo: calculateSemaforo(datesAny.hasta),
  };
}

async function processDocumentBuffer(fileName, fileData) {
  let worker;

  try {
    if (typeof fileName !== 'string' || !fileName.trim()) {
      throw new TypeError('Debe indicarse el nombre del archivo.');
    }
    if (!(Buffer.isBuffer(fileData) || fileData instanceof Uint8Array)) {
      throw new TypeError('El contenido del archivo no es válido.');
    }

    const extension = path.extname(fileName).toLowerCase();
    if (!SUPPORTED_EXTENSIONS.has(extension)) {
      throw new Error('Formato no admitido. Use PDF, JPG, JPEG o PNG.');
    }

    const inputBuffer = Buffer.from(fileData);
    if (inputBuffer.length === 0) throw new Error('El archivo está vacío.');
    if (inputBuffer.length > MAX_FILE_SIZE) throw new Error('El archivo supera el límite de 50 MB.');

    let texto = '';

    if (extension === '.pdf') {
      const { nativeText, imageBuffer } = await extractPdfTextAndImage(inputBuffer);
      if (nativeText && nativeText.length >= 60) {
        // Texto nativo de alta fidelidad extraído en milisegundos
        texto = nativeText;
      } else if (imageBuffer) {
        // Escaneado o imagen: Procesar con OCR local
        const ocrPrep = await prepareOcrImage(imageBuffer);
        const assets = getAssetPaths();
        worker = await createWorker('spa', OEM.LSTM_ONLY, {
          langPath: assets.langPath,
          workerPath: assets.workerPath,
          corePath: assets.corePath,
          gzip: false,
          cacheMethod: 'none',
          logger: () => {},
        });
        const { data } = await worker.recognize(ocrPrep);
        texto = data?.text ?? '';
      }
    } else {
      // Imagen JPG / PNG
      const imageBuffer = await prepareOcrImage(inputBuffer);
      const assets = getAssetPaths();
      worker = await createWorker('spa', OEM.LSTM_ONLY, {
        langPath: assets.langPath,
        workerPath: assets.workerPath,
        corePath: assets.corePath,
        gzip: false,
        cacheMethod: 'none',
        logger: () => {},
      });
      const { data } = await worker.recognize(imageBuffer);
      texto = data?.text ?? '';
    }

    const normText = normalizeText(texto);
    const tipoDocumento = classifyDocument(normText, fileName);

    return {
      success: true,
      archivo: path.basename(fileName),
      tipoDocumento,
      texto,
      datos: parseFields(tipoDocumento, texto, fileName),
    };
  } catch (error) {
    const fallbackTipo = classifyDocument('', fileName);
    return {
      success: true,
      archivo: path.basename(fileName),
      tipoDocumento: fallbackTipo,
      texto: `Nota de escaneo: ${error?.message || 'Archivo escaneado'}. Puedes revisar y completar sus campos manualmente.`,
      datos: parseFields(fallbackTipo, '', fileName),
      requiereRevision: true,
    };
  } finally {
    if (worker) {
      try {
        await worker.terminate();
      } catch {
        // Safe terminate
      }
    }
  }
}

async function processDocument(filePath) {
  try {
    const resolvedPath = path.resolve(filePath);
    const inputBuffer = await fs.readFile(resolvedPath);
    return await processDocumentBuffer(path.basename(resolvedPath), inputBuffer);
  } catch (error) {
    return {
      success: false,
      tipoDocumento: 'DESCONOCIDO',
      datos: {},
      error: error?.message || 'No se pudo procesar el documento.',
    };
  }
}

module.exports = { processDocument, processDocumentBuffer, calculateSemaforo };
