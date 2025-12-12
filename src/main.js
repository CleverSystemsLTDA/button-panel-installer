const { app, dialog, BrowserWindow } = require("electron");
const { autoUpdater } = require("electron-updater");
const log = require('electron-log');
const { resolve, join } = require("path");
const fs = require("fs");
const { execFile, exec } = require("child_process");
const ProgressBar = require("electron-progressbar");

let mainWindow;
let child = null;
let downloadPercent = 0;

// --- INÍCIO: Constantes e Variáveis Adicionadas ---
const extraPath = join(process.resourcesPath, "..");
const path = join(extraPath, "application.exe");
const updateJsonFile = join(extraPath, "update.json");
const updateJsonBackup = join(extraPath, "update.json.backup");

// Estrutura JSON padrão para garantir que o app sempre tenha uma base
const defaultUpdateJson = {
  version: "1.0.0",
  updatedownloaded: 0,
  lastFirewallUpdate: "1.0.0"
};

let updateJson = null;
let isWriting = false; // Flag para evitar escritas simultâneas
// --- FIM: Constantes e Variáveis Adicionadas ---

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

// --- INÍCIO: NOVAS FUNÇÕES PARA LEITURA/ESCRITA SEGURA DO JSON ---

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      log.warn(`Arquivo JSON não encontrado: ${filePath}`);
      return null;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.trim()) {
      log.warn(`Arquivo JSON está vazio: ${filePath}`);
      return null;
    }
    const parsed = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) {
      log.warn(`Arquivo JSON possui estrutura inválida: ${filePath}`);
      return null;
    }
    return parsed;
  } catch (error) {
    log.error(`Erro ao ler o arquivo JSON ${filePath}:`, error.message);
    return null;
  }
}

function loadUpdateJson() {
  let json = safeReadJson(updateJsonFile);

  if (json === null) {
    log.warn("update.json principal está corrompido ou faltando, tentando backup...");
    json = safeReadJson(updateJsonBackup);

    if (json === null) {
      log.warn("Backup também está corrompido ou faltando, usando valores padrão...");
      json = { ...defaultUpdateJson };
    } else {
      log.info("Carregado com sucesso do backup, restaurando arquivo principal...");
      safeWriteJson(json);
    }
  }

  // Garante que todas as propriedades necessárias existam
  updateJson = {
    ...defaultUpdateJson,
    ...json
  };

  log.info(`update.json carregado: ${JSON.stringify(updateJson)}`);
  return updateJson;
}

async function safeWriteJson(json) {
  if (isWriting) {
    log.warn("Operação de escrita já em progresso, pulando...");
    return false;
  }
  isWriting = true;
  try {
    if (typeof json !== 'object' || json === null) {
      throw new Error("Estrutura JSON inválida");
    }
    const jsonString = JSON.stringify(json, null, 2);
    const tempFile = updateJsonFile + '.tmp';
    fs.writeFileSync(tempFile, jsonString, 'utf8');

    const verification = safeReadJson(tempFile);
    if (verification === null) {
      throw new Error("Falha ao verificar o arquivo temporário");
    }

    if (fs.existsSync(updateJsonFile)) {
      const currentJson = safeReadJson(updateJsonFile);
      if (currentJson !== null) {
        fs.copyFileSync(updateJsonFile, updateJsonBackup);
      }
    }

    fs.renameSync(tempFile, updateJsonFile);
    log.info(`update.json escrito com sucesso: ${jsonString}`);
    return true;
  } catch (error) {
    log.error("Erro ao escrever arquivo JSON:", error.message);
    const tempFile = updateJsonFile + '.tmp';
    if (fs.existsSync(tempFile)) {
      try {
        fs.unlinkSync(tempFile);
      } catch (cleanupError) {
        log.error("Erro ao limpar arquivo temporário:", cleanupError.message);
      }
    }
    return false;
  } finally {
    isWriting = false;
  }
}

function writeJson(json) {
  updateJson = { ...updateJson, ...json };
  return safeWriteJson(updateJson);
}

// --- FIM: NOVAS FUNÇÕES PARA LEITURA/ESCRITA SEGURA DO JSON ---


// --- INÍCIO: NOVAS FUNÇÕES DE FIREWALL E VERIFICAÇÃO DE ADMIN ---

function updateFirewallRules() {
  return new Promise((resolve, reject) => {
    log.info("Atualizando regras de firewall...");
    const installDir = join(process.resourcesPath, "..");

    // Caminhos que precisam de regras de firewall
    const buttonPanelPath = join(installDir, 'button-panel.exe');
    const applicationPath = join(installDir, 'application.exe');

    const commands = `
netsh advfirewall firewall delete rule name="button-panel"
netsh advfirewall firewall delete rule name="button-panel-app"
netsh advfirewall firewall add rule name="button-panel" dir=in action=allow program="${buttonPanelPath}" enable=yes
netsh advfirewall firewall add rule name="button-panel" dir=out action=allow program="${buttonPanelPath}" enable=yes
netsh advfirewall firewall add rule name="button-panel-app" dir=in action=allow program="${applicationPath}" enable=yes
netsh advfirewall firewall add rule name="button-panel-app" dir=out action=allow program="${applicationPath}" enable=yes
    `.trim();

    exec(commands, (error, stdout, stderr) => {
      if (error) {
        log.error('Falha ao atualizar regras de firewall:', error);
        log.error('stderr:', stderr);
        reject(error);
        return;
      }
      log.info('Regras de firewall atualizadas com sucesso');
      log.info('stdout:', stdout);
      resolve();
    });
  });
}

function checkAdminPrivileges() {
  return new Promise((resolve) => {
    exec('net session', (error) => {
      if (error) {
        log.warn('Não está executando como admin - atualizações de firewall irão falhar');
        resolve(false);
      } else {
        log.info('Executando com privilégios de administrador');
        resolve(true);
      }
    });
  });
}

// --- FIM: NOVAS FUNÇÕES DE FIREWALL E VERIFICAÇÃO DE ADMIN ---


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
      progressBar.detail = `Baixado ${value.toFixed(2)}% de ${progressBar.getOptions().maxValue}%...`;
    });

  setInterval(function () {
    if (!progressBar.isCompleted()) {
      progressBar.value = downloadPercent;
    }
  }, 20);
}

function updaterListeners() {
  autoUpdater.on("update-available", (info) => {
    const arrVersion = info.version.split('-');
    const updateChannel = arrVersion[1];

    if (updateChannel === autoUpdater.channel) {
      log.info(`Update disponível: V${info.version}`);
      autoUpdater.downloadUpdate();
      checkUpdate();
    }
  });

  autoUpdater.on("update-not-available", (info) => {
    log.info('Update not Available');
    if (updateJson.updatedownloaded === 1) {
      log.info(`Alterando para disponível para download`);
      updateJson.updatedownloaded = 0;
      writeJson(updateJson);
    }
    openApplication();
  });

  autoUpdater.on("update-downloaded", () => {
    if (updateJson.updatedownloaded === 1) {
      log.info(`Download concluído... pronto para instalar atualização`);
      autoUpdater.quitAndInstall(true, true);
    }

    if (updateJson.updatedownloaded === 0) {
      log.info(`Alterando para Downloaded`);
      updateJson.updatedownloaded = 1;
      writeJson(updateJson);
    }
  });

  autoUpdater.on("download-progress", (progressObj) => {
    downloadPercent = progressObj.percent;
  });

  autoUpdater.on("error", (message) => {
    log.error('Erro em buscar atualização:', message);
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

// --- INÍCIO: NOVO EVENTO PARA SAÍDA SEGURA ---
app.on('before-quit', (event) => {
  if (isWriting) {
    log.info("Operação de escrita em andamento, atrasando o fechamento...");
    event.preventDefault();

    const checkWriting = setInterval(() => {
      if (!isWriting) {
        clearInterval(checkWriting);
        app.quit();
      }
    }, 100);
  }
});
// --- FIM: NOVO EVENTO PARA SAÍDA SEGURA ---

// --- INÍCIO: LÓGICA DE INICIALIZAÇÃO ATUALIZADA ---
app.whenReady().then(async () => {
  autoUpdater.logger = log;
  autoUpdater.logger.transports.file.level = 'info';
  log.info('App starting...');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowDowngrade = true;
  autoUpdater.allowPrerelease = true;
  autoUpdater.channel = 'latest';

  log.info(`Version App: ${app.getVersion()}`);
  log.info(`Channel: ${autoUpdater.channel}`);

  // Carrega o JSON com verificação de segurança
  loadUpdateJson();

  // Verifica se está executando com privilégios de administrador
  const hasAdmin = await checkAdminPrivileges();

  if (hasAdmin) {
    const currentVersion = app.getVersion();
    const lastFirewallUpdate = updateJson.lastFirewallUpdate || "0.0.0";

    // Atualiza as regras de firewall se for uma nova versão
    if (currentVersion !== lastFirewallUpdate) {
      log.info(`Versão alterada de ${lastFirewallUpdate} para ${currentVersion}, atualizando regras de firewall...`);
      try {
        await updateFirewallRules();
        updateJson.lastFirewallUpdate = currentVersion;
        writeJson(updateJson);
        log.info("Regras de firewall atualizadas para a nova versão");
      } catch (error) {
        log.error("Falha ao atualizar regras de firewall, mas continuando:", error);
      }
    } else {
      log.info("As regras de firewall estão atualizadas para a versão atual");
    }
  } else {
    log.warn("Não está executando como admin - pulando atualização das regras de firewall");
  }

  createWindow();
  updaterListeners();
  
  try {
    const resultUpdater = await autoUpdater.checkForUpdatesAndNotify();

    // Se updatedownloaded for 0, abre a aplicação
    if (updateJson.updatedownloaded === 0) {
      openApplication();
    }
  } catch (error) {
    log.error("Erro ao verificar atualizações:", error);
    openApplication(); // Garante que a aplicação abra mesmo se a verificação falhar
  }
});
// --- FIM: LÓGICA DE INICIALIZAÇÃO ATUALIZADA ---