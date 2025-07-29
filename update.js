const { autoUpdater } = require("electron-updater");
const { dialog } = require("electron");

const log = require("electron-log");

module.exports = (win, ipcMain) => {
    // auto update module

    autoUpdater.autoDownload = false;
    autoUpdater.disableDifferentialDownload = false;
    autoUpdater.disable;
    autoUpdater.logger = log;
    autoUpdater.logger.transports.file.level = "info";

    // define main to renderer message
    async function sendStatusToWindow(message, data) {
        if (win) {
            await win.webContents.send(message, data);
            // win.ipcMain.send(message, data);
        }
    }

    // update method
    ipcMain.handle("update", () => {
        sendStatusToWindow("checking-for-update", "Checking for update...");
        autoUpdater.checkForUpdates();
    });

    // download update method
    ipcMain.handle("download", () => {
        autoUpdater.downloadUpdate();
    });

    // apply downloaded update
    ipcMain.handle("applyUpdate", () => {
        autoUpdater.quitAndInstall();
    });

    // checking for update
    autoUpdater.on("checking-for-update", () => {
        sendStatusToWindow("checking-for-update", "Checking for update...");
    });

    // update available
    autoUpdater.on("update-available", (info) => {
        sendStatusToWindow("update-available", info);
    });

    // update not available
    autoUpdater.on("update-not-available", (info) => {
        sendStatusToWindow("up-to-date", info);
    });

    // error
    autoUpdater.on("error", (err) => {
        sendStatusToWindow("error", err);
    });

    autoUpdater.on("download-progress", (progressObj) => {
        let log_message = "Download speed: " + progressObj.bytesPerSecond;
        log_message =
            log_message + " - Downloaded " + progressObj.percent + "%";
        log_message =
            log_message +
            " (" +
            progressObj.transferred +
            "/" +
            progressObj.total +
            ")";
        sendStatusToWindow("downloading", progressObj);
    });

    autoUpdater.on("update-downloaded", (info) => {
        sendStatusToWindow("update-downloaded", info);
    });
};
