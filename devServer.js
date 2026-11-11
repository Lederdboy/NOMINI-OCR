'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { exec, spawn } = require('node:child_process');
const { processDocumentBuffer } = require('./documentProcessor');
const {
  segmentarYDividirPdf,
  cortarConSegmentosPersonalizados,
} = require('./services/pdfSplitterService');

const HOST = '127.0.0.1';
const DEFAULT_PORT = Number(process.env.PORT) || 4173;
let currentPort = DEFAULT_PORT;
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.ico', 'image/png'],
  ['.json', 'application/json; charset=utf-8'],
  ['.map', 'application/json; charset=utf-8'],
  ['.pfb', 'application/x-font-pfb'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.cff', 'application/x-font-cff'],
]);
const APP_FILES = new Map([
  ['/', 'visor.html'],
  ['/visor.html', 'visor.html'],
  ['/visor.css', 'visor.css'],
  ['/visorRenderer.js', 'visorRenderer.js'],
  ['/visorSplitter.html', 'visorSplitter.html'],
  ['/visorSplitter.css', 'visorSplitter.css'],
  ['/visorSplitter.js', 'visorSplitter.js'],
  ['/login.css', 'login.css'],
  ['/login.js', 'login.js'],
  ['/favicon.ico', 'Logo/nomini.png'],
  ['/Logo/nomini.png', 'Logo/nomini.png'],
  ['/Logo/nomini_white.png', 'Logo/nomini_white.png'],
  ['/Logo/nomini-logo-cropped.png', 'Logo/nomini-logo-cropped.png'],
  ['/Logo/WhatsApp_Image_2026-09-07_at_9.00.53_AM-removebg-preview.png', 'Logo/WhatsApp_Image_2026-09-07_at_9.00.53_AM-removebg-preview.png'],
]);
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);

function sendJson(response, status, value) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

async function serveFile(response, filePath) {
  try {
    const content = await fs.readFile(filePath);
    const contentType = MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream';
    response.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    response.end(content);
  } catch {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('No encontrado');
  }
}

async function readRequestBody(request) {
  const chunks = [];
  let total = 0;

  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_FILE_SIZE) throw new Error('El archivo supera el límite de 100 MB.');
    chunks.push(chunk);
  }

  return Buffer.concat(chunks, total);
}

function detectExtensionFromBytes(bytes) {
  if (!bytes || bytes.length < 4) return null;
  // PDF: %PDF (0x25 0x50 0x44 0x46)
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return '.pdf';
  }
  // PNG: \x89PNG (0x89 0x50 0x4E 0x47)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
    return '.png';
  }
  // JPEG: 0xFF 0xD8 0xFF
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
    return '.jpg';
  }
  return null;
}

const server = http.createServer(async (request, response) => {
  const requestUrl = new URL(request.url, `http://${HOST}:${currentPort}`);

  // ENDPOINT DE ANÁLISIS OCR INDIVIDUAL
  if (request.method === 'POST' && requestUrl.pathname === '/api/analyze') {
    const origin = request.headers.origin;
    const isAllowedOrigin = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    if (!isAllowedOrigin) {
      sendJson(response, 403, { success: false, error: 'Origen no autorizado.' });
      return;
    }

    let rawName = requestUrl.searchParams.get('name') || '';
    try {
      rawName = decodeURIComponent(rawName);
    } catch {
      // Usar texto original
    }
    let name = path.basename(rawName.trim().replace(/[\\/]/g, path.sep)) || 'documento';

    try {
      const bytes = await readRequestBody(request);
      if (!bytes.length) {
        console.warn(`[OCR /api/analyze] Archivo recibido con 0 bytes: "${name}"`);
        sendJson(response, 200, {
          success: false,
          error: 'El archivo está vacío (0 bytes).',
          archivo: name,
          tipoDocumento: 'DESCONOCIDO',
          datos: {},
        });
        return;
      }

      let ext = path.extname(name).toLowerCase();
      if (!ext || !SUPPORTED_EXTENSIONS.has(ext)) {
        const detectedExt = detectExtensionFromBytes(bytes);
        if (detectedExt) {
          ext = detectedExt;
          name = `${path.basename(name, ext)}${detectedExt}`;
        } else {
          console.warn(`[OCR /api/analyze] Formato no admitido ni detectado en bytes para: "${name}"`);
          sendJson(response, 200, {
            success: false,
            error: 'Formato no admitido. Se admiten archivos PDF, JPG y PNG.',
            archivo: name,
            tipoDocumento: 'DESCONOCIDO',
            datos: {},
          });
          return;
        }
      }

      console.log(`[OCR /api/analyze] Procesando: ${name} (${(bytes.length / 1024).toFixed(1)} KB)`);
      const result = await processDocumentBuffer(name, bytes);
      console.log(`[OCR /api/analyze] Resultado: ${name} -> ${result.tipoDocumento} (${result.success ? 'OK' : 'Revisar'})`);
      sendJson(response, 200, result);
    } catch (error) {
      console.error(`[OCR /api/analyze] Error procesando ${name}:`, error.message);
      sendJson(response, 200, {
        success: false,
        error: error.message || 'No se pudo procesar el archivo.',
        archivo: name,
        tipoDocumento: 'DESCONOCIDO',
        datos: {},
      });
    }
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
    try {
      const bytes = await readRequestBody(request);
      const payload = JSON.parse(bytes.toString('utf8') || '{}');
      const { usuario, password, isReentry } = payload;
      const u = (usuario || '').trim().toUpperCase();

      if (!u) {
        sendJson(response, 400, { success: false, message: 'Ingresa tu usuario corporativo.' });
        return;
      }

      // 1. Si es reingreso rápido recordado
      if (isReentry) {
        sendJson(response, 200, {
          success: true,
          user: {
            usuario: u,
            nombre: u === 'ADMIN' ? 'ADMINISTRADOR GENERAL' : u,
            rol: u === 'ADMIN' ? 'ADMINISTRADOR' : 'OPERADOR',
            token: `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          },
        });
        return;
      }

      // 2. Validación de credenciales
      // Admite usuarios corporativos estándar o cualquier usuario de NOMINI
      sendJson(response, 200, {
        success: true,
        user: {
          usuario: u,
          nombre: u === 'ADMIN' ? 'ADMINISTRADOR GENERAL' : u,
          rol: u === 'ADMIN' ? 'ADMINISTRADOR' : 'OPERADOR',
          token: `token_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        },
      });
    } catch (err) {
      sendJson(response, 500, { success: false, message: err.message || 'Error en autenticación.' });
    }
    return;
  }

  // ENDPOINTS PARA SEGMENTACIÓN Y CORTE DE EXPEDIENTES
  if (request.method === 'POST' && requestUrl.pathname === '/api/splitter/upload') {
    try {
      const bytes = await readRequestBody(request);
      if (!bytes.length) {
        sendJson(response, 400, { success: false, error: 'El archivo recibido está vacío.' });
        return;
      }

      const tempPdfPath = path.join(os.tmpdir(), `expediente_${Date.now()}.pdf`);
      await fs.writeFile(tempPdfPath, bytes);

      const requestedOutDir = requestUrl.searchParams.get('outDir');
      const outDir = (requestedOutDir && requestedOutDir.trim())
        ? path.resolve(requestedOutDir.trim())
        : path.join(__dirname, 'dist', 'legajos_cortados');
      await fs.mkdir(outDir, { recursive: true });

      response.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });

      console.log(`[Splitter API] Segmentando expediente: ${tempPdfPath} (${(bytes.length / 1024).toFixed(1)} KB) -> Salida: ${outDir}`);

      const resultado = await segmentarYDividirPdf(tempPdfPath, outDir, {
        onProgress: (prog) => {
          response.write(JSON.stringify({ type: 'progress', data: prog }) + '\n');
        },
      });

      console.log(`[Splitter API] Corte completado: ${resultado.totalPaginas} págs -> ${resultado.segmentosGenerados.length} sub-PDFs`);

      response.write(JSON.stringify({ type: 'result', data: resultado }) + '\n');
      response.end();
    } catch (err) {
      console.error('[Splitter API] Error:', err.message);
      if (!response.headersSent) {
        sendJson(response, 500, { success: false, error: err.message || 'Error al segmentar expediente.' });
      } else {
        response.write(JSON.stringify({ type: 'error', error: err.message }) + '\n');
        response.end();
      }
    }
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/splitter/recut') {
    try {
      const bytes = await readRequestBody(request);
      const payload = JSON.parse(bytes.toString('utf8'));
      const { rutaPdfOrigen, carpetaSalida, mapaPaginas, dni } = payload || {};
      const resultado = await cortarConSegmentosPersonalizados(rutaPdfOrigen, carpetaSalida, mapaPaginas, dni);
      sendJson(response, 200, resultado);
    } catch (err) {
      console.error('[Splitter Recut API] Error:', err.message);
      sendJson(response, 500, { success: false, error: err.message || 'Error al re-cortar.' });
    }
    return;
  }

  if (request.method === 'GET' && requestUrl.pathname === '/api/splitter/system-paths') {
    const homeDir = os.homedir();
    const parentDir = path.dirname(__dirname); // G:\KALEF
    const gRootDir = 'G:\\';
    const pruebaDocPath = path.join(parentDir, 'PRUEBA DOCUEMNTS');
    const proyectosRecuperadosPath = path.join(gRootDir, 'PROYECTOS_RECUPERADOS');

    let allAvailableFolders = [];
    const seenPaths = new Set();

    function addFolder(name, fullPath, category = 'General') {
      const norm = path.resolve(fullPath).toLowerCase();
      if (!seenPaths.has(norm) && fsSync.existsSync(fullPath)) {
        seenPaths.add(norm);
        allAvailableFolders.push({ name, fullPath: path.resolve(fullPath), category });
      }
    }

    // 1. Accesos clave
    addFolder('PRUEBA DOCUEMNTS', pruebaDocPath, 'Frecuente');
    addFolder('PROYECTOS_RECUPERADOS', proyectosRecuperadosPath, 'Frecuente');
    addFolder('Descargas (legajos_cortados)', path.join(homeDir, 'Downloads', 'legajos_cortados'), 'Frecuente');
    addFolder('Escritorio (legajos_cortados)', path.join(homeDir, 'Desktop', 'legajos_cortados'), 'Frecuente');
    addFolder('Suite NOMINI (dist)', path.join(__dirname, 'dist', 'legajos_cortados'), 'Sistema');

    // 2. Carpetas en G:\KALEF
    try {
      const kFolders = fsSync.readdirSync(parentDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && !d.name.startsWith('.'))
        .map(d => ({ name: d.name, fullPath: path.join(parentDir, d.name) }));
      for (const kf of kFolders) {
        addFolder(kf.name, kf.fullPath, 'KALEF');
      }
    } catch (_) {}

    // 3. Carpetas en G:\
    try {
      if (fsSync.existsSync(gRootDir)) {
        const gFolders = fsSync.readdirSync(gRootDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && !d.name.startsWith('.') && !d.name.startsWith('$') && !['System Volume Information', 'Program Files', 'Program Files (x86)', 'Users'].includes(d.name))
          .map(d => ({ name: d.name, fullPath: path.join(gRootDir, d.name) }));
        for (const gf of gFolders) {
          addFolder(gf.name, gf.fullPath, 'Disco G:');
        }
      }
    } catch (_) {}

    sendJson(response, 200, {
      success: true,
      downloads: path.join(homeDir, 'Downloads', 'legajos_cortados'),
      desktop: path.join(homeDir, 'Desktop', 'legajos_cortados'),
      defaultDir: path.join(__dirname, 'dist', 'legajos_cortados'),
      pruebaDocs: fsSync.existsSync(pruebaDocPath) ? pruebaDocPath : '',
      proyectosRecuperados: fsSync.existsSync(proyectosRecuperadosPath) ? proyectosRecuperadosPath : '',
      allAvailableFolders,
    });
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/splitter/resolve-folder') {
    try {
      const bytes = await readRequestBody(request);
      const rawText = bytes.toString('utf8') || '{}';
      let payload = {};
      try {
        payload = JSON.parse(rawText);
      } catch {
        const cleaned = rawText.replace(/\\/g, '\\\\').replace(/\\\\\\\\/g, '\\\\');
        try { payload = JSON.parse(cleaned); } catch (_) {}
      }
      const folderName = (payload.folderName || '').trim();
      const pdfDir = (payload.pdfDir || '').trim();

      const candidates = [
        path.join(path.dirname(__dirname), folderName), // G:\KALEF\<folderName>
        pdfDir ? path.join(pdfDir, folderName) : null,
        path.join('G:\\KALEF', folderName),
        path.join(os.homedir(), 'Downloads', folderName),
        path.join(os.homedir(), 'Desktop', folderName),
        path.join(__dirname, 'dist', folderName),
        path.join('G:\\', folderName),
      ].filter(Boolean);

      let found = null;
      for (const cand of candidates) {
        if (fsSync.existsSync(cand)) {
          found = cand;
          break;
        }
      }

      const finalPath = found || path.join(path.dirname(__dirname), folderName);
      sendJson(response, 200, { success: true, fullPath: finalPath });
    } catch (err) {
      sendJson(response, 500, { success: false, error: err.message });
    }
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/splitter/pick-folder') {
    try {
      const bytes = await readRequestBody(request);
      const rawText = bytes.toString('utf8') || '{}';
      let payload = {};
      try {
        payload = JSON.parse(rawText);
      } catch {
        const cleaned = rawText.replace(/\\/g, '\\\\').replace(/\\\\\\\\/g, '\\\\');
        try { payload = JSON.parse(cleaned); } catch (_) {}
      }
      const initialPath = payload.current || '';

      const scriptPath = path.join(__dirname, 'scripts', 'pickFolder.ps1');
      const safeInit = initialPath ? initialPath.replace(/[\\/]+$/, '').replace(/"/g, '`"') : '';
      const psCmd = `powershell.exe -NoProfile -ExecutionPolicy Bypass -STA -File "${scriptPath}" -InitialFolder "${safeInit}"`;

      exec(psCmd, {
        timeout: 10 * 60 * 1000,
        windowsHide: true,
        env: { ...process.env, NOMINI_INITIAL_FOLDER: initialPath ? initialPath.replace(/[\\/]+$/, '') : '' },
      }, (err, stdout) => {
        if (err && !stdout) {
          console.error('[Splitter Pick Folder API] Error:', err.message);
          sendJson(response, 200, { success: false, cancelled: true });
          return;
        }
        const picked = (stdout || '').trim();
        if (picked) {
          sendJson(response, 200, { success: true, folderPath: picked, cancelled: false });
        } else {
          sendJson(response, 200, { success: true, folderPath: null, cancelled: true });
        }
      });
    } catch (err) {
      console.error('[Splitter Pick Folder API] Error:', err.message);
      sendJson(response, 500, { success: false, error: err.message });
    }
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/splitter/open-folder') {
    try {
      const bytes = await readRequestBody(request);
      const rawText = bytes.toString('utf8') || '{}';
      let payload = {};
      try {
        payload = JSON.parse(rawText);
      } catch {
        const cleaned = rawText.replace(/\\/g, '\\\\').replace(/\\\\\\\\/g, '\\\\');
        try { payload = JSON.parse(cleaned); } catch (_) {}
      }
      const folderPath = payload.folder || path.join(__dirname, 'dist', 'legajos_cortados');
      const resolved = path.resolve(folderPath).replace(/\//g, '\\');

      // Crear directorio si no existe de forma no bloqueante
      if (!fsSync.existsSync(resolved)) {
        try { fsSync.mkdirSync(resolved, { recursive: true }); } catch (_) {}
      }

      console.log(`[Splitter Open Folder API] Abriendo carpeta instantáneamente: ${resolved}`);

      // Lanzar explorer.exe de manera ultra rápida, desvinculada e instantánea
      try {
        const child = spawn('explorer.exe', [resolved], { detached: true, stdio: 'ignore' });
        child.unref();
      } catch (_) {
        exec(`start "" "${resolved}"`, () => {});
      }

      // Responder de inmediato sin retrasos de lectura en disco
      sendJson(response, 200, { success: true, folder: resolved });
    } catch (err) {
      console.error('[Splitter Open Folder API] Error:', err.message);
      sendJson(response, 500, { success: false, error: err.message });
    }
    return;
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/splitter/open-file') {
    try {
      const bytes = await readRequestBody(request);
      const payload = JSON.parse(bytes.toString('utf8') || '{}');
      const filePath = payload.filePath;
      if (!filePath) {
        sendJson(response, 400, { success: false, error: 'Ruta de archivo no especificada.' });
        return;
      }
      const resolved = path.resolve(filePath).replace(/\//g, '\\');
      try {
        const child = spawn('cmd.exe', ['/c', 'start', '""', resolved], { detached: true, stdio: 'ignore' });
        child.unref();
      } catch {
        exec(`start "" "${resolved}"`, () => {});
      }
      sendJson(response, 200, { success: true, file: resolved });
    } catch (err) {
      console.error('[Splitter Open File API] Error:', err.message);
      sendJson(response, 500, { success: false, error: err.message });
    }
    return;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD, POST' });
    response.end();
    return;
  }

  const appFile = APP_FILES.get(requestUrl.pathname);
  if (appFile) {
    await serveFile(response, path.join(__dirname, appFile));
    return;
  }

  const pdfjsPrefix = '/node_modules/pdfjs-dist/';
  const fflatePrefix = '/node_modules/fflate/';
  const dependencyPrefix = requestUrl.pathname.startsWith(pdfjsPrefix)
    ? pdfjsPrefix
    : requestUrl.pathname.startsWith(fflatePrefix)
      ? fflatePrefix
      : null;
  if (dependencyPrefix) {
    const relativePath = decodeURIComponent(requestUrl.pathname.slice(1));
    const filePath = path.resolve(__dirname, relativePath);
    const dependencyName = dependencyPrefix === pdfjsPrefix ? 'pdfjs-dist' : 'fflate';
    const allowedRoot = path.resolve(__dirname, 'node_modules', dependencyName) + path.sep;
    if (!filePath.startsWith(allowedRoot)) {
      response.writeHead(403);
      response.end();
      return;
    }
    await serveFile(response, filePath);
    return;
  }

  response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end('No encontrado');
});

function startServer(portToTry) {
  server.listen(portToTry, HOST, () => {
    const actualPort = server.address().port;
    console.log(`Visor OCR web local: http://${HOST}:${actualPort}`);
    console.log(`Segmentador & Corte: http://${HOST}:${actualPort}/visorSplitter.html`);
    console.log('Modo offline: OCR, pdf-lib y recursos servidos desde este equipo.');
  });
}

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    const nextPort = currentPort + 1;
    console.warn(`El puerto ${currentPort} está en uso. Intentando en http://${HOST}:${nextPort}...`);
    currentPort = nextPort;
    startServer(currentPort);
    return;
  }
  console.error(`No se pudo iniciar el servidor web local: ${error.message}`);
  process.exitCode = 1;
});

startServer(currentPort);
