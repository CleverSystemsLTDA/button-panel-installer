const { app, dialog, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require('electron-log');
const { resolve, join } = require("path");
const fs = require("fs");
const { execFile } = require("child_process");
const ProgressBar = require("electron-progressbar");

let mainWindow;
let child = null;
let downloadPercent = 0;


const extraPath = join(process.resourcesPath, "..");

const path = join(extraPath, "application.exe");

const updateJsonFile = join(extraPath, "update.json");
const updateJson = require(updateJsonFile);

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

function writeJson(json) {
  fs.writeFileSync(updateJsonFile, JSON.stringify(json));
}

function updaterListeners() {
  autoUpdater.on("update-available", (info) => {
    const arrVersion = info.version.split('-');
    const updateChannel = arrVersion[1];

    if (updateChannel === autoUpdater.channel) {
      log.info(`Update disponível: V${info.version}`);
      autoUpdater.downloadUpdate();
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info('Update not Available');
    if (updateJson.updatedownloaded === 1) {
      log.info(`Alterando para disponível para download`);
      updateJson.updatedownloaded = 0;
      writeJson(updateJson);
      openApplication();
    }
  });

  autoUpdater.on("update-downloaded", () => {
    if (updateJson.updatedownloaded === 1) {
      log.info(`Download concluído... pronto para instalar atualização`);
      autoUpdater.quitAndInstall(true, true);
    }

    if (updateJson.updatedownloaded === 0) {
      log.info(`Alterando para Downloded`);
      updateJson.updatedownloaded = 1;
      writeJson(updateJson);
    }
  });

  autoUpdater.on("download-progress", (progressObj) => {
    downloadPercent = progressObj.percent;
  });

  autoUpdater.on("error", (message) => {
    log.info('Erro em buscar atualização');
    log.info(message);
    openApplication();
  });
}

function openApplication() {
  updateJson.version = app.getVersion();
  writeJson(updateJson);
  log.info(`Abrindo Sistema ButtonPanel...`);
  child = execFile(require.resolve(path));

  child.on("close", (code) => {
    app.exit(0);
  });
}

app.whenReady().then(async () => {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  log.info('App starting...');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.channel = 'alpha';

  log.info(`Version App: ${app.getVersion()}`);
  log.info(`Channel: ${autoUpdater.channel}`);

  createWindow();
  updaterListeners();
  const resultUpdater = await autoUpdater.checkForUpdatesAndNotify();

  if (updateJson.updatedownloaded === 0) {
    openApplication();
  }

});
