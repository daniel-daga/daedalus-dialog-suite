const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('roundtrip corpus runner succeeds in strict mode on a minimal fixture corpus', () => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'roundtrip-corpus-smoke-'));
  const corpusDir = path.join(tmpRoot, 'corpus');
  const reportDir = path.join(tmpRoot, 'reports');
  fs.mkdirSync(corpusDir, { recursive: true });
  fs.mkdirSync(reportDir, { recursive: true });

  const fixtureFile = path.join(corpusDir, 'DIA_Test_Smoke.d');
  const fixtureSource = `
instance DIA_Test_Smoke(C_INFO)
{
\tnpc\t\t\t= TEST_NPC;
\tnr\t\t\t= 1;
\tcondition\t= DIA_Test_Smoke_Condition;
\tinformation\t= DIA_Test_Smoke_Info;
\tpermanent\t= FALSE;
\tdescription\t= "Smoke";
};

func int DIA_Test_Smoke_Condition()
{
\tif (Npc_KnowsInfo(other, DIA_Test_Smoke))
\t{
\t\treturn TRUE;
\t};
\treturn FALSE;
};

func void DIA_Test_Smoke_Info()
{
\tAI_Output(other, self, "DIA_Test_Smoke_15_00");
\tInfo_AddChoice(DIA_Test_Smoke, "Continue", DIA_Test_Smoke_Next);
};

func void DIA_Test_Smoke_Next()
{
\tAI_StopProcessInfos(self);
};
`;

  fs.writeFileSync(fixtureFile, fixtureSource, 'utf8');

  const scriptPath = path.resolve(__dirname, '..', 'scripts', 'roundtrip-corpus.js');
  execFileSync(process.execPath, [
    scriptPath,
    '--root', corpusDir,
    '--report-dir', reportDir,
    '--report-prefix', 'smoke-roundtrip-corpus',
    '--strict'
  ], { stdio: 'pipe' });

  const summaryPath = path.join(reportDir, 'smoke-roundtrip-corpus-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.scanned, 1, 'Should scan exactly one fixture file');
  assert.equal(summary.driftFiles, 0, 'Fixture should not produce structural drift');
  assert.equal(summary.generatedSyntaxErrors, 0, 'Generated code should parse cleanly');
  assert.equal(summary.choiceTargetIncreases, 0, 'Should not create new missing choice targets');
  assert.equal(summary.semanticIdempotenceDriftFiles, 0, 'Second pass should be semantically stable');
});
