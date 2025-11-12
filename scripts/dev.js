const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const treeKill = require('tree-kill');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const processes = [];

function createProcess(name, command, args, color) {
  const proc = spawn(command, args, {
    shell: true,
    stdio: 'pipe',
    windowsHide: true, // This prevents the console window on Windows
    cwd: path.join(__dirname, '..')
  });

  proc.stdout.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.log(`${color}[${name}]${colors.reset} ${output}`);
    }
  });

  proc.stderr.on('data', (data) => {
    const output = data.toString().trim();
    if (output) {
      console.error(`${color}[${name}]${colors.reset} ${output}`);
    }
  });

  proc.on('exit', (code) => {
    console.log(`${color}[${name}]${colors.reset} exited with code ${code}`);
    // Kill all processes if one exits
    killAll();
    process.exit(code);
  });

  processes.push(proc);
  return proc;
}

function killAll() {
  let killed = 0;
  const total = processes.length;

  if (total === 0) {
    process.exit(0);
    return;
  }

  processes.forEach(proc => {
    if (proc && proc.pid) {
      // Use tree-kill to kill the entire process tree
      // This ensures child processes are cleaned up on Windows
      treeKill(proc.pid, 'SIGTERM', (err) => {
        if (err && err.code !== 'ESRCH') {
          // ESRCH means process doesn't exist (already dead), which is fine
          console.error(`Error killing process ${proc.pid}:`, err.message);
        }
        killed++;
        if (killed === total) {
          // All processes killed, safe to exit
          setTimeout(() => process.exit(0), 100);
        }
      });
    } else {
      killed++;
      if (killed === total) {
        setTimeout(() => process.exit(0), 100);
      }
    }
  });
}

function waitForFile(filePath, callback) {
  const interval = setInterval(() => {
    if (fs.existsSync(filePath)) {
      clearInterval(interval);
      callback();
    }
  }, 100);
}

console.log('Starting development environment...\n');

// Start TypeScript compiler
createProcess('TypeScript', 'tsc', ['-p', 'tsconfig.main.json', '--watch'], colors.blue);

// Start Vite dev server
createProcess('Vite', 'vite', [], colors.green);

// Wait for main.js to exist, then start Electron
const mainJsPath = path.join(__dirname, '..', 'dist', 'main', 'main.js');
console.log(`${colors.magenta}[Electron]${colors.reset} Waiting for dist/main/main.js...`);
waitForFile(mainJsPath, () => {
  console.log(`${colors.magenta}[Electron]${colors.reset} Starting Electron...`);
  createProcess('Electron', 'electron', ['.', '--enable-logging', '--no-sandbox'], colors.magenta);
});

// Handle Ctrl+C (SIGINT)
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  killAll();
});

// Handle SIGTERM (graceful shutdown)
process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM, shutting down...');
  killAll();
});
