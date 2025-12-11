const { app, BrowserWindow, ipcMain, Menu } = require("electron");
const path = require("path");
const template = require("./menu");
const updater = require("./update");

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
    win.maximize();
    // Don't show immediately to avoid white screen
    // win.show();

    const loadApp = () => {
        if (isDev) {
            win.loadURL("http://localhost:4200");
        } else {
            // Use absolute path for reliability in production
            const indexPath = path.join(__dirname, "app/browser/index.html");
            win.loadFile(indexPath);
        }
    };

    loadApp();

    // Show window when ready to avoid white flash
    win.once("ready-to-show", () => {
        win.show();
    });

    // Logging instead of immediate infinite retry loop
    win.webContents.on(
        "did-fail-load",
        (event, errorCode, errorDescription) => {
            console.error(`Failed to load: ${errorCode} - ${errorDescription}`);
            // Optional: Retry once after a delay or show an error page
        }
    );

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
        const fullPath = path.join(__dirname, templatePath);
        await printWindow.loadFile(fullPath);
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
