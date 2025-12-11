const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const log = require("electron-log"); // Added electron-log
const template = require("./menu");
const updater = require("./update");

// Initialize Logger
log.initialize();
log.transports.file.level = "debug";
console.log = log.log;
console.error = log.error;
log.info("App starting...");

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
    log.info("Creating main window...");
    const win = new BrowserWindow(MAIN_WINDOW_CONFIG);

    win.once("ready-to-show", () => {
        log.info("Window ready to show event fired");
    });

    win.maximize();
    win.show();

    const loadApp = () => {
        try {
            if (isDev) {
                log.info("Loading development URL: http://localhost:4200");
                win.loadURL("http://localhost:4200")
                    .then(() => log.info("Dev URL loaded successfully"))
                    .catch((e) => log.error("Failed to load dev URL", e));
            } else {
                const filePath = "app/browser/index.html";
                log.info(`Loading production file: ${filePath}`);

                // Logging the absolute path it resolves to, for debugging
                const absolutePath = path.resolve(__dirname, filePath);
                log.info(`Resolved absolute path: ${absolutePath}`);

                win.loadFile(filePath)
                    .then(() => log.info("File loaded successfully"))
                    .catch((e) => log.error("Failed to load file", e));
            }
        } catch (error) {
            log.error("Sync error in loadApp:", error);
        }
    };

    loadApp();

    win.webContents.on(
        "did-fail-load",
        (event, errorCode, errorDescription) => {
            log.error(`did-fail-load: ${errorCode} - ${errorDescription}`);
            loadApp();
        }
    );

    win.webContents.on("crashed", (event) => {
        log.error("Renderer process crashed");
    });

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
async function handlePrint(templatePath, data) {
    const printWindow = new BrowserWindow(PRINT_WINDOW_CONFIG);

    try {
        await printWindow.loadFile(templatePath);
        printWindow.show();

        printWindow.webContents.on("did-finish-load", async () => {
            await printWindow.webContents.send("printDocument", data);
            printWindow.webContents.print(PRINT_OPTIONS, () => {
                printWindow.close();
            });
        });
    } catch (error) {
        console.error(`Failed to print ${templatePath}:`, error);
        if (!printWindow.isDestroyed()) {
            printWindow.close();
        }
    }
}

async function setupContextMenu() {
    try {
        const { default: contextMenu } = await import("electron-context-menu");
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
        handlePrint("assets/print.html", data)
    );
    ipcMain.handle("print-statement", (e, data) =>
        handlePrint("assets/printStatement.html", data)
    );
    ipcMain.handle("print-stock", (e, data) =>
        handlePrint("assets/stock.html", data)
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
