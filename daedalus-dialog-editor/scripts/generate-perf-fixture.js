/*
 * generate-perf-fixture.js — deterministic synthetic Daedalus project generator
 * for the render-performance measurement plan (fix-07 §3).
 *
 * Emits a project folder whose symbol counts mirror the Gothic 2 base game's
 * order of magnitude, so merge / render numbers are comparable to a real mod.
 * Fully deterministic: a seeded PRNG drives every count and text choice, and no
 * wall-clock value (Date.now / Math.random) touches emitted content — the same
 * seed + args always produce byte-identical output.
 *
 * Usage:
 *   node scripts/generate-perf-fixture.js [--files N] [--dialogs M]
 *                                         [--out DIR] [--seed S]
 *
 * Defaults (fix-07 §3): 200 dialog files × 15 dialogs (one NPC per ~4 files →
 * ~50 NPCs), each dialog an info function of 8–15 mixed actions, plus
 * Story_Globals.d (~5,000 var int), Text_Constants.d (~15,000 const string),
 * and ~2,000 item/NPC instances across a handful of instance files.
 *
 * Dependency-free. Output dir defaults to the gitignored perf-fixtures/ dir.
 */

const fs = require('fs');
const path = require('path');

// ---- Seeded PRNG (mulberry32) — deterministic, no Math.random -------------

function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Integer in [min, max] inclusive.
function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// ---- Content vocabulary (fixed, so output is deterministic) ----------------

const SUBTITLES = [
  'Greetings, stranger.',
  'What do you want from me?',
  'I have nothing to say to you.',
  'The road ahead is dangerous.',
  'Have you seen the merchant?',
  'Careful, the guards are watching.',
  'Bring me the ore and we will talk.',
  'I do not trust outsiders.',
  'The old mine collapsed years ago.',
  'Take this and be gone.'
];

const CHOICE_TEXTS = [
  'Tell me more.',
  'What happened here?',
  'I need supplies.',
  'Where can I find him?',
  'Never mind.',
  'I can help you.'
];

const TOPICS = ['Intro', 'Mine', 'Merchant', 'Guards', 'Ore', 'Escape', 'Bandits'];

const ITEM_NAMES = [
  'Rusty Sword', 'Health Potion', 'Iron Ore', 'Loaf of Bread', 'Old Key',
  'Torch', 'Leather Armor', 'Gold Nugget', 'Wolf Skin', 'Ancient Scroll'
];

const GUILDS = ['GIL_NONE', 'GIL_MIL', 'GIL_SLD', 'GIL_KDF', 'GIL_BAU'];

// ---- Emitters --------------------------------------------------------------

function npcName(npcIndex) {
  return `NPC_${String(npcIndex).padStart(5, '0')}`;
}

// One dialog = instance + condition func + info func (+ optional choice funcs).
function emitDialog(rng, npc, dialogIndex, nr) {
  const topic = pick(rng, TOPICS);
  const base = `DIA_${npc}_${topic}${dialogIndex}`;
  const lines = [];

  lines.push(`instance ${base} (C_INFO)`);
  lines.push('{');
  lines.push(`\tnpc\t\t= ${npc};`);
  lines.push(`\tnr\t\t= ${nr};`);
  lines.push(`\tcondition\t= ${base}_Condition;`);
  lines.push(`\tinformation\t= ${base}_Info;`);
  lines.push('\tpermanent\t= FALSE;');
  lines.push(`\tdescription\t= "${pick(rng, SUBTITLES)}";`);
  lines.push('};');
  lines.push('');

  lines.push(`func int ${base}_Condition()`);
  lines.push('{');
  lines.push('\treturn TRUE;');
  lines.push('};');
  lines.push('');

  // Info function: 8–15 mixed actions (AI_Output, log entries, choices).
  const actionCount = randInt(rng, 8, 15);
  const choiceFuncs = [];
  lines.push(`func void ${base}_Info()`);
  lines.push('{');
  for (let a = 0; a < actionCount; a++) {
    const roll = rng();
    if (roll < 0.65) {
      // AI_Output dialog line — speaker alternates, comment carries subtitle.
      const speaker = a % 2 === 0 ? 'self' : 'other';
      const listener = a % 2 === 0 ? 'other' : 'self';
      const soundId = `${base}_${a}_00`;
      lines.push(`\tAI_Output(${speaker}, ${listener}, "${soundId}"); //${pick(rng, SUBTITLES)}`);
    } else if (roll < 0.85) {
      // Quest-log entry.
      const topicConst = `TOPIC_${pick(rng, TOPICS)}`;
      lines.push(`\tLog_CreateTopic(${topicConst}, LOG_MISSION);`);
      lines.push(`\tB_LogEntry(${topicConst}, "${pick(rng, SUBTITLES)}");`);
    } else {
      // Choice referencing a generated handler func (kept resolvable).
      const cIdx = choiceFuncs.length;
      const choiceFunc = `${base}_Choice${cIdx}`;
      choiceFuncs.push(choiceFunc);
      lines.push(`\tInfo_AddChoice(${base}, "${pick(rng, CHOICE_TEXTS)}", ${choiceFunc});`);
    }
  }
  lines.push('\tAI_StopProcessInfos(self);');
  lines.push('};');
  lines.push('');

  // Emit the choice handler functions so their references resolve.
  for (const choiceFunc of choiceFuncs) {
    lines.push(`func void ${choiceFunc}()`);
    lines.push('{');
    lines.push(`\tAI_Output(self, other, "${choiceFunc}_0_00"); //${pick(rng, SUBTITLES)}`);
    lines.push(`\tInfo_ClearChoices(${base});`);
    lines.push('};');
    lines.push('');
  }

  return lines.join('\n');
}

function emitDialogFile(rng, npc, part, dialogsPerFile) {
  const chunks = [
    `// ${npc} — dialog part ${part}`,
    ''
  ];
  for (let d = 0; d < dialogsPerFile; d++) {
    chunks.push(emitDialog(rng, npc, `${part}_${d}`, d + 1));
  }
  return chunks.join('\n');
}

function emitStoryGlobals(count) {
  const lines = ['// Story global variables', ''];
  for (let i = 0; i < count; i++) {
    lines.push(`var int Story_Global_${String(i).padStart(5, '0')};`);
  }
  lines.push('');
  return lines.join('\n');
}

function emitTextConstants(rng, count) {
  const lines = ['// Localised text constants', ''];
  for (let i = 0; i < count; i++) {
    const name = `TXT_${String(i).padStart(6, '0')}`;
    lines.push(`const string ${name} = "${pick(rng, SUBTITLES)}";`);
  }
  lines.push('');
  return lines.join('\n');
}

// Instance files: the ~50 dialog NPCs get Npc_Default instances, the remainder
// is filled with item instances to reach the requested total.
function emitInstanceFiles(rng, npcCount, totalInstances, fileCount) {
  const files = [];
  const npcInstances = [];
  for (let n = 0; n < npcCount; n++) {
    const npc = npcName(n);
    npcInstances.push(
      [
        `instance ${npc} (Npc_Default)`,
        '{',
        `\tname\t= "${npc}";`,
        `\tguild\t= ${pick(rng, GUILDS)};`,
        `\tid\t= ${90000 + n};`,
        `\tlevel\t= ${randInt(rng, 1, 60)};`,
        '};',
        ''
      ].join('\n')
    );
  }

  const itemCount = Math.max(0, totalInstances - npcCount);
  const itemInstances = [];
  for (let i = 0; i < itemCount; i++) {
    itemInstances.push(
      [
        `instance ItMi_Gen_${String(i).padStart(5, '0')} (C_Item)`,
        '{',
        `\tname\t\t= "${pick(rng, ITEM_NAMES)}";`,
        '\tmainflag\t= ITEM_KAT_NONE;',
        `\tvalue\t\t= ${randInt(rng, 1, 500)};`,
        '};',
        ''
      ].join('\n')
    );
  }

  const all = npcInstances.concat(itemInstances);
  const perFile = Math.ceil(all.length / fileCount);
  for (let f = 0; f < fileCount; f++) {
    const slice = all.slice(f * perFile, (f + 1) * perFile);
    if (slice.length === 0) continue;
    files.push({
      name: `Instances_${f}.d`,
      content: `// Item and NPC instances (part ${f})\n\n${slice.join('\n')}`
    });
  }
  return files;
}

// ---- CLI -------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    files: 200,
    dialogs: 15,
    seed: 1,
    out: null,
    help: false
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') opts.help = true;
    else if (arg === '--files') opts.files = parseInt(argv[++i], 10);
    else if (arg === '--dialogs') opts.dialogs = parseInt(argv[++i], 10);
    else if (arg === '--seed') opts.seed = parseInt(argv[++i], 10);
    else if (arg === '--out') opts.out = argv[++i];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

const HELP = `generate-perf-fixture.js — synthetic Daedalus project generator (fix-07 §3)

Options:
  --files N      Number of dialog files (default 200)
  --dialogs M    Dialogs per file (default 15)
  --seed S       PRNG seed (default 1) — same seed => byte-identical output
  --out DIR      Output directory (default: perf-fixtures/, gitignored)
  -h, --help     Show this help

Emits: N dialog files (one NPC per ~4 files), Story_Globals.d (~5,000 var int),
Text_Constants.d (~15,000 const string), and ~2,000 item/NPC instances.`;

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(HELP);
    process.exit(1);
    return;
  }

  if (opts.help) {
    console.log(HELP);
    return;
  }

  const outDir = opts.out
    ? path.resolve(opts.out)
    : path.join(__dirname, '..', 'perf-fixtures');

  const rng = makeRng(opts.seed);

  // Scale globals/instances with the default profile; keep them proportional
  // for small overrides so a quick --files 20 run still parses representatively.
  const scale = opts.files / 200;
  const varCount = Math.max(50, Math.round(5000 * scale));
  const constCount = Math.max(100, Math.round(15000 * scale));
  const instanceTotal = Math.max(50, Math.round(2000 * scale));
  const npcCount = Math.max(1, Math.ceil(opts.files / 4));

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  let dialogCount = 0;
  for (let f = 0; f < opts.files; f++) {
    const npcIndex = Math.floor(f / 4);
    const npc = npcName(npcIndex);
    const part = f % 4;
    const content = emitDialogFile(rng, npc, part, opts.dialogs);
    fs.writeFileSync(path.join(outDir, `DIA_${npc}_${part}.d`), content, 'utf8');
    dialogCount += opts.dialogs;
  }

  fs.writeFileSync(
    path.join(outDir, 'Story_Globals.d'),
    emitStoryGlobals(varCount),
    'utf8'
  );
  fs.writeFileSync(
    path.join(outDir, 'Text_Constants.d'),
    emitTextConstants(rng, constCount),
    'utf8'
  );

  const instanceFiles = emitInstanceFiles(rng, npcCount, instanceTotal, 5);
  for (const file of instanceFiles) {
    fs.writeFileSync(path.join(outDir, file.name), file.content, 'utf8');
  }

  const totalFiles = opts.files + 2 + instanceFiles.length;
  console.log(`Generated synthetic project in ${outDir}`);
  console.log(
    `  ${opts.files} dialog files, ${dialogCount} dialogs, ${npcCount} NPCs`
  );
  console.log(
    `  ${varCount} var int, ${constCount} const string, ${instanceTotal} instances`
  );
  console.log(`  ${totalFiles} files total (seed ${opts.seed})`);
}

main();
