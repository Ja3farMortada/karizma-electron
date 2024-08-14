const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
    ipcRenderer: ipcRenderer,
    send: async (channel, data) => {
        let response = await ipcRenderer.invoke(channel, data);
        return response;
    },
    receive: (channel, fn) => {
        ipcRenderer.on(channel, fn);
    },
    print: (callback) => ipcRenderer.on("printDocument", callback),

    checkingForUpdate: (callback) =>
        ipcRenderer.on("checking-for-update", callback),

    updateAvailable: (callback) => ipcRenderer.on("update-available", callback),

    updateNotAvailable: (callback) => ipcRenderer.on("up-to-date", callback),

    error: (callback) => ipcRenderer.on("error", callback),

    downloading: (callback) => ipcRenderer.on("downloading", callback),

    downloadCompleted: (callback) =>
        ipcRenderer.on("update-downloaded", callback),
});
