'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = Object.freeze({
  selectDocuments: () => ipcRenderer.invoke('documento:seleccionar'),
  analyzeDocument: (name, bytes) => ipcRenderer.invoke('documento:analizar', {
    name,
    bytes: bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes),
  }),
  copyJson: (jsonText) => ipcRenderer.invoke('documento:copiar-json', jsonText),
  saveExtraction: (documentData) => ipcRenderer.invoke('documento:guardar-json', documentData),
});

const documentAPI = Object.freeze({
  seleccionarExpediente: () => ipcRenderer.invoke('seleccionar-expediente-pdf'),
  seleccionarCarpetaSalida: () => ipcRenderer.invoke('seleccionar-carpeta-salida'),
  procesarYCortarExpediente: (rutaArchivo, carpetaSalida) => ipcRenderer.invoke('procesar-y-cortar-expediente', { rutaArchivo, carpetaSalida }),
  confirmarYCortarSegmentos: (payload) => ipcRenderer.invoke('confirmar-y-cortar-segmentos', payload),
  abrirArchivo: (ruta) => ipcRenderer.invoke('abrir-archivo-local', ruta),
  mostrarEnCarpeta: (ruta) => ipcRenderer.invoke('mostrar-en-carpeta', ruta),
  onProgreso: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('splitter:progreso', handler);
    return () => ipcRenderer.removeListener('splitter:progreso', handler);
  },
});

contextBridge.exposeInMainWorld('electronAPI', electronAPI);
contextBridge.exposeInMainWorld('documentAPI', documentAPI);
