
import ProjectService from '../src/main/services/ProjectService';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function runBenchmark() {
  const service = new ProjectService();

  // Create temp dir
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gothic-bench-'));
  console.log(`Created temp dir: ${tempDir}`);

  try {
    const instanceTemplate = `
  INSTANCE DIA_Test_NUM (C_INFO)
  {
      npc = SLD_NUM_Test;
      condition = DIA_Test_NUM_Cond;
      information = DIA_Test_NUM_Info;
      permanent = FALSE;
      description = "Test Dialog NUM";
  };
    `;

    // Create 50 files (1 batch)
    // Each file large enough to take ~10-20ms to parse
    const NUM_FILES = 50;
    const NUM_INSTANCES_PER_FILE = 2000;

    let baseContent = "";
    for (let i = 0; i < NUM_INSTANCES_PER_FILE; i++) {
      baseContent += instanceTemplate.replace(/NUM/g, i.toString());
    }

    console.log(`Generating ${NUM_FILES} files of size ${(baseContent.length / 1024 / 1024).toFixed(2)} MB each...`);

    for (let i = 0; i < NUM_FILES; i++) {
        fs.writeFileSync(path.join(tempDir, `file_${i}.d`), baseContent);
    }

    console.log("Starting buildProjectIndex...");

    // Setup monitoring
    let maxLag = 0;
    let lastTime = performance.now();
    let ticks = 0;

    const interval = setInterval(() => {
      ticks++;
      const now = performance.now();
      const delta = now - lastTime;
      const lag = delta - 10;
      if (lag > maxLag) maxLag = lag;
      lastTime = now;
    }, 10);

    const start = performance.now();

    // Call the actual service method which should now be optimized
    await service.buildProjectIndex(tempDir);

    const end = performance.now();
    clearInterval(interval);

    console.log(`Total time: ${(end - start).toFixed(2)}ms`);
    console.log(`Max event loop lag: ${maxLag.toFixed(2)}ms`);
    console.log(`Interval ticks: ${ticks}`);

    if (ticks > 0 && maxLag < 50) {
        console.log("SUCCESS: Event loop was responsive!");
    } else {
        console.log("WARNING: Event loop might have been blocked or unresponsive.");
    }

  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

runBenchmark().catch(console.error);
