const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

async function exists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}

function macAppPath(executable) {
  const match = executable.match(/^(.*?\.app)\/Contents\/MacOS\/[^/\s]+(?:\s|$)/i);
  return match?.[1] || null;
}

async function runningAseprite(platform = process.platform) {
  try {
    if (platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-Command',
        '(Get-CimInstance Win32_Process -Filter "name = \'aseprite.exe\'").ExecutablePath']);
      return stdout.trim().split(/\r?\n/).find(Boolean) || null;
    }
    const { stdout } = await run('pgrep', ['-x', 'aseprite']);
    for (const pid of stdout.trim().split(/\s+/)) {
      if (!/^\d+$/.test(pid)) continue;
      if (platform === 'darwin') {
        const result = await run('ps', ['-o', 'command=', '-p', pid]);
        const appPath = macAppPath(result.stdout.trim());
        if (appPath && await exists(appPath)) return appPath;
      } else {
        const executable = await fs.realpath(`/proc/${pid}/exe`);
        if (await exists(executable)) return executable;
      }
    }
  } catch { /* no running Aseprite or process lookup unavailable */ }
  return null;
}

function asepriteLocations(platform = process.platform) {
  const home = os.homedir();
  if (platform === 'darwin') return [
    path.join(home, 'Applications/Aseprite.app'),
    '/Applications/Aseprite.app',
    path.join(home, 'Library/Application Support/Steam/steamapps/common/Aseprite/Aseprite.app'),
  ];
  if (platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean);
    return [
      ...roots.map(root => path.join(root, 'Aseprite/aseprite.exe')),
      ...roots.map(root => path.join(root, 'Steam/steamapps/common/Aseprite/aseprite.exe')),
      path.join(home, 'AppData/Local/Programs/Aseprite/aseprite.exe'),
    ];
  }
  return [
    '/usr/bin/aseprite', '/usr/local/bin/aseprite',
    path.join(home, '.local/bin/aseprite'),
    path.join(home, '.steam/steam/steamapps/common/Aseprite/aseprite'),
    path.join(home, '.local/share/Steam/steamapps/common/Aseprite/aseprite'),
  ];
}

async function installedAseprite(platform = process.platform) {
  for (const candidate of asepriteLocations(platform)) {
    if (await exists(candidate)) return candidate;
  }
  if (platform !== 'win32') {
    try {
      const { stdout } = await run('which', ['aseprite']);
      const candidate = stdout.trim().split(/\r?\n/)[0];
      if (candidate && await exists(candidate)) return candidate;
    } catch { /* not on PATH */ }
  }
  return null;
}

function programName(program) {
  const name = path.basename(program).replace(/\.app$|\.exe$/i, '');
  return name === 'aseprite' ? 'Aseprite' : name;
}

async function resolveExternalEditor(choice) {
  if (choice) return { name: programName(choice), path: choice, source: 'chosen' };
  const running = await runningAseprite();
  if (running) return { name: 'Aseprite', path: running, source: 'running' };
  const installed = await installedAseprite();
  if (installed) return { name: 'Aseprite', path: installed, source: 'installed' };
  return { name: null, path: null, source: 'default' };
}

async function openExternalFile(filePath, editor, shell) {
  if (!filePath || !await exists(filePath)) throw new Error('Image file was not found');
  if (!editor.path) {
    const error = await shell.openPath(filePath);
    if (error) throw new Error(error);
    return;
  }
  if (!await exists(editor.path)) throw new Error('External editor was not found');
  if (process.platform === 'darwin' && editor.path.toLowerCase().endsWith('.app')) {
    // Launch Services sends this document to the existing instance of this exact app.
    await run('open', ['-a', editor.path, filePath]);
  } else {
    await new Promise((resolve, reject) => {
      const child = spawn(editor.path, [filePath], { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    });
  }
}

module.exports = { resolveExternalEditor, openExternalFile, macAppPath, asepriteLocations };
