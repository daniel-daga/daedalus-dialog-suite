// Stub worker: replies with a full metadata payload, every field populated.
// It exists to hold the pool's worker-message path to the shape
// `ParsedFileMetadata` actually has — that path names each field explicitly
// rather than spreading the message, so a field added to the extractor and the
// worker but not here is silently dropped in production while every inline
// (Jest) path keeps working.

process.on('message', (msg) => {
  process.send({
    id: msg && msg.id,
    dialogs: [{ dialogName: 'DIA_A', npc: 'SLD_A', filePath: msg.filePath }],
    instances: [{ name: 'SLD_A', parent: 'C_NPC' }],
    prototypes: [],
    isQuestFile: true,
    routines: ['RTN_START_A'],
    functions: ['TriggerFunc_Gate'],
    voiceIds: [{ id: 'DIA_A_01_00', functionName: 'DIA_A_Info' }],
    semanticModel: { dialogs: {}, functions: {} },
    parseErrors: {
      filePath: msg.filePath,
      total: 3,
      errors: [{ type: 'syntax_error', message: 'Syntax error at line 4, column 1', line: 4, column: 1, text: '@@' }],
    },
    mtimeMs: 1234,
  });
});
