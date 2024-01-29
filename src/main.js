const { app, dialog, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const { resolve, join } = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const ProgressBar = require("electron-progressbar");

let mainWindow;
let child = null;
let downloadPercent = 0;


const extraPath = join(process.resourcesPath, "..");

const path = join(extraPath, "application.exe");

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      nodeIntegration: true,
    },
  });
}

async function checkUpdate() {
  let progressBar = new ProgressBar({
    indeterminate: false,
    text: "Baixando atualizações...",
    detail: "Aguarde",
  });
  progressBar
    .on("completed", function () {
      progressBar.detail = "Atualização finalizada. Finalizando...";
    })
    .on("aborted", function (value) {
      console.info(`aborted... ${value}`);
    })
    .on("progress", function (value) {
      progressBar.detail = `Baixado ${value.toFixed(2)}% de ${
        progressBar.getOptions().maxValue
      }%...`;
    });

  setInterval(function () {
    if (!progressBar.isCompleted()) {
      progressBar.value = downloadPercent;
    }
  }, 20);
}

function updaterListeners() {
  autoUpdater.on("update-available", () => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Atualização Disponível",
        message:
          "Uma nova atualização está disponível",
      })
      .then(() => {
          autoUpdater.downloadUpdate();
          checkUpdate();
      });
  });

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox(mainWindow, {
        type: "info",
        title: "Atualização baixada",
        message:
          "A atualização foi baixada. A aplicação será reiniciada para aplicar as mudanças.",
      })
      .then(() => {
         autoUpdater.quitAndInstall(true, true);
      });
  });

  autoUpdater.on("download-progress", (progressObj) => {
    downloadPercent = progressObj.percent;
  });

  autoUpdater.on("error", (message) => {
    dialog.showMessageBox(mainWindow, {
      type: "error",
      title: "Erro em att",
      message: `${message}`,
      buttons: ["OK"],
    });
  });
}

function openApplication() {
  child = execFile(require.resolve(path));

  child.on("close", (code) => {
    app.exit(0);
  });
}

app.whenReady().then(async () => {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = true;
  createWindow();
  updaterListeners();
  const resultUpdater = await autoUpdater.checkForUpdatesAndNotify();
  if (resultUpdater !== null) {
    if (resultUpdater.versionInfo.version !== app.getVersion()) {
      return;
    }
  }

  openApplication();
});
