'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
} = require('electron');
const { processDocumentBuffer } = require('../documentProcessor');
const {
  segmentarYDividirPdf,
  cortarConSegmentosPersonalizados,
} = require('../services/pdfSplitterService');

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const MAX_ZIP_SIZE = 80 * 1024 * 1024;
const MAX_BATCH_SIZE = 200 * 1024 * 1024;
const MAX_BATCH_FILES = 40;
const MAX_JSON_SIZE = 2 * 1024 * 1024;
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.jpg', '.jpeg', '.png']);
const SELECTABLE_EXTENSIONS = new Set([...SUPPORTED_EXTENSIONS, '.zip']);

function isTrustedMainFrame(event) {
  return Boolean(event.senderFrame && event.senderFrame === event.sender.mainFrame);
}

function failure(error) {
  return {
    success: false,
    error: error?.message || 'No se pudo completar la operación.',
  };
}

ipcMain.handle('documento:seleccionar', async (event) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documentos y archivos ZIP', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'zip'] }],
    });
    if (selection.canceled || !selection.filePaths.length) {
      return { success: false, cancelled: true };
    }

    if (selection.filePaths.length > MAX_BATCH_FILES) {
      return failure(new Error(`Selecciona como máximo ${MAX_BATCH_FILES} archivos por lote.`));
    }

    const files = [];
    let totalSize = 0;
    for (const filePath of selection.filePaths) {
      const extension = path.extname(filePath).toLowerCase();
      if (!SELECTABLE_EXTENSIONS.has(extension)) continue;
      const stats = await fs.stat(filePath);
      const maxSize = extension === '.zip' ? MAX_ZIP_SIZE : MAX_FILE_SIZE;
      if (!stats.isFile() || stats.size === 0 || stats.size > maxSize) continue;
      totalSize += stats.size;
      if (totalSize > MAX_BATCH_SIZE) {
        return failure(new Error('El lote seleccionado supera el límite total de 200 MB.'));
      }
      files.push({
        name: path.basename(filePath),
        bytes: new Uint8Array(await fs.readFile(filePath)),
      });
    }

    if (!files.length) return failure(new Error('No hay documentos compatibles en la selección.'));
    return { success: true, files };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('documento:analizar', async (event, payload) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    const { name, bytes } = payload ?? {};
    if (typeof name !== 'string' || !(bytes instanceof Uint8Array)) {
      return failure(new Error('El documento recibido no es válido.'));
    }
    if (!SUPPORTED_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      return failure(new Error('Formato no admitido. Usa PDF, JPG o PNG.'));
    }
    if (!bytes.byteLength || bytes.byteLength > MAX_FILE_SIZE) {
      return failure(new Error('El archivo está vacío o supera el límite de 50 MB.'));
    }

    return await processDocumentBuffer(path.basename(name), bytes);
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('documento:copiar-json', async (event, jsonText) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));
  if (typeof jsonText !== 'string' || jsonText.length > MAX_JSON_SIZE) {
    return failure(new Error('El JSON no es válido o supera el tamaño permitido.'));
  }

  try {
    clipboard.writeText(jsonText);
    return { success: true };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('documento:guardar-json', async (event, documentData) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    if (!documentData || typeof documentData !== 'object' || Array.isArray(documentData)) {
      return failure(new Error('Los datos de extracción no son válidos.'));
    }
    const jsonText = JSON.stringify(documentData, null, 2);
    if (jsonText.length > MAX_JSON_SIZE) return failure(new Error('La extracción supera 2 MB.'));

    const dialogResult = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Guardar extracción documental',
      defaultPath: 'extraccion-documento.json',
      filters: [{ name: 'Archivo JSON', extensions: ['json'] }],
    });
    if (dialogResult.canceled || !dialogResult.filePath) {
      return { success: false, cancelled: true };
    }

    const targetPath = dialogResult.filePath.toLowerCase().endsWith('.json')
      ? dialogResult.filePath
      : `${dialogResult.filePath}.json`;
    await fs.writeFile(targetPath, jsonText, { encoding: 'utf8', flag: 'wx' }).catch(async (error) => {
      if (error.code !== 'EEXIST') throw error;
      await fs.writeFile(targetPath, jsonText, 'utf8');
    });
    return { success: true, fileName: path.basename(targetPath) };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('seleccionar-expediente-pdf', async (event) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Seleccionar Expediente Laboral (PDF Multipágina)',
      properties: ['openFile'],
      filters: [{ name: 'Documento PDF', extensions: ['pdf'] }],
    });
    if (selection.canceled || !selection.filePaths.length) {
      return { success: false, cancelled: true };
    }
    const filePath = selection.filePaths[0];
    const stats = await fs.stat(filePath);
    const bytes = await fs.readFile(filePath);
    return {
      success: true,
      filePath,
      fileName: path.basename(filePath),
      size: stats.size,
      bytes: new Uint8Array(bytes),
    };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('seleccionar-carpeta-salida', async (event) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    const selection = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: 'Seleccionar Carpeta para Sub-PDFs Cortados',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (selection.canceled || !selection.filePaths.length) {
      return { success: false, cancelled: true };
    }
    return { success: true, folderPath: selection.filePaths[0] };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('procesar-y-cortar-expediente', async (event, payload) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    const rutaArchivo = typeof payload === 'string' ? payload : payload?.rutaArchivo;
    const carpetaSalida = typeof payload === 'object' ? payload?.carpetaSalida : null;

    if (!rutaArchivo || typeof rutaArchivo !== 'string') {
      return failure(new Error('Ruta del expediente PDF no especificada.'));
    }

    const window = BrowserWindow.fromWebContents(event.sender);
    const onProgress = (prog) => {
      if (window && !window.isDestroyed()) {
        window.webContents.send('splitter:progreso', prog);
      }
    };

    const resultado = await segmentarYDividirPdf(rutaArchivo, carpetaSalida, { onProgress });
    return { success: true, ...resultado };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('confirmar-y-cortar-segmentos', async (event, payload) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));

  try {
    const { rutaPdfOrigen, carpetaSalida, mapaPaginas, dni } = payload || {};
    if (!rutaPdfOrigen) return failure(new Error('Falta la ruta del PDF de origen.'));
    const resultado = await cortarConSegmentosPersonalizados(rutaPdfOrigen, carpetaSalida, mapaPaginas, dni);
    return { success: true, ...resultado };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('abrir-archivo-local', async (event, filePath) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));
  try {
    if (!filePath || typeof filePath !== 'string') return failure(new Error('Ruta inválida.'));
    await shell.openPath(path.resolve(filePath));
    return { success: true };
  } catch (error) {
    return failure(error);
  }
});

ipcMain.handle('mostrar-en-carpeta', async (event, filePath) => {
  if (!isTrustedMainFrame(event)) return failure(new Error('Solicitud IPC no autorizada.'));
  try {
    if (!filePath || typeof filePath !== 'string') return failure(new Error('Ruta inválida.'));
    shell.showItemInFolder(path.resolve(filePath));
    return { success: true };
  } catch (error) {
    return failure(error);
  }
});

function createMainWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.ico');
  const mainWindow = new BrowserWindow({
    width: 1540,
    height: 980,
    minWidth: 1050,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    title: 'NOMINI OCR · Visor y Segmentador',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  void mainWindow.loadFile(path.join(__dirname, '..', 'visor.html'));
  return mainWindow;
}

app.whenReady().then(() => {
  createMainWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
