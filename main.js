const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const template = require("./menu");
const updater = require("./update");

// ------------------------------------------------
// Single Instance Lock
// ------------------------------------------------
// Acquire the lock BEFORE any window/storage/server initialization.
// This must be the earliest possible gate to prevent a second process
// from touching userData, localStorage, or the embedded server port.
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // Another instance already holds the lock — quit immediately.
    // No windows, no server, no storage access.
    app.quit();
} else {
    // -----------------------------------------------------------------------------
    // Constants & Configuration
    // -----------------------------------------------------------------------------

    // Environment check
    const isEnvSet = "ELECTRON_IS_DEV" in process.env;
    const getFromEnv = Number.parseInt(process.env.ELECTRON_IS_DEV, 10) === 1;
    const isDev = isEnvSet ? getFromEnv : !app.isPackaged;

    // Window configuration
    const MAIN_WINDOW_CONFIG = {
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    };

    const PRINT_WINDOW_CONFIG = {
        width: 706.95553,
        height: 1000,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.js"),
        },
    };

    const PRINT_OPTIONS = { silent: false, marginsType: 0 };

    // -----------------------------------------------------------------------------
    // App Initialization
    // -----------------------------------------------------------------------------

    // Setup Application Menu
    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);

    async function createMainWindow() {
        const win = new BrowserWindow(MAIN_WINDOW_CONFIG);

        win.once("ready-to-show", () => {
            win.maximize();
            win.show();
        });

        const loadApp = () => {
            if (isDev) {
                win.loadURL("http://localhost:4200");
            } else {
                win.loadFile("app/browser/index.html");
            }
        };

        loadApp();

        win.webContents.on("did-fail-load", loadApp);

        // Initialize Auto Updater
        updater(win, ipcMain);
    }

    // -----------------------------------------------------------------------------
    // Helper Functions
    // -----------------------------------------------------------------------------

    /**
     * Handles creating a hidden window for printing, sending data to it,
     * and executing the print command.
     */
    async function handlePrint(templatePath, data, { autoPrint = true } = {}) {
        const printWindow = new BrowserWindow(PRINT_WINDOW_CONFIG);

        try {
            // loadFile resolves on "did-finish-load", by which point the renderer
            // has already registered its "printDocument" listener, so it is safe
            // to push the data straight after.
            await printWindow.loadFile(templatePath);
            printWindow.webContents.send("printDocument", data);

            if (autoPrint) {
                // Legacy templates (stock / statement): main drives the print.
                printWindow.show();
                printWindow.webContents.print(PRINT_OPTIONS, () => {
                    printWindow.close();
                });
            }
            // Otherwise the page prints itself via window.print() and closes via
            // window.close(), keeping the window hidden the whole time.
        } catch (error) {
            console.error(`Failed to print ${templatePath}:`, error);
            if (!printWindow.isDestroyed()) {
                printWindow.close();
            }
        }
    }

    async function setupContextMenu() {
        try {
            const { default: contextMenu } =
                await import("electron-context-menu");
            contextMenu({
                showSaveImageAs: false,
                showSearchWithGoogle: false,
                showInspectElement: false,
                showSelectAll: false,
                showCopyImage: false,
            });
        } catch (err) {
            console.error("Failed to load context menu:", err);
        }
    }

    // -----------------------------------------------------------------------------
    // IPC Handlers
    // -----------------------------------------------------------------------------

    function registerIpcHandlers() {
        ipcMain.handle("print-invoice", (e, data) =>
            handlePrint("assets/print.html", data, { autoPrint: false }),
        );
        ipcMain.handle("print-statement", (e, data) =>
            handlePrint("assets/printStatement.html", data),
        );
        ipcMain.handle("print-stock", (e, data) =>
            handlePrint("assets/stock.html", data),
        );
    }

    // -----------------------------------------------------------------------------
    // App Lifecycle
    // -----------------------------------------------------------------------------

    app.whenReady().then(async () => {
        await setupContextMenu();
        registerIpcHandlers();
        createMainWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });

    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") {
            app.quit();
        }
    });
}
