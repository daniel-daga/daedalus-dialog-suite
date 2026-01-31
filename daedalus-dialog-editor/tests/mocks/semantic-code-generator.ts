export class SemanticCodeGenerator {
  constructor(options: any) {}
  generateSemanticModel(model: any) {
    let output = JSON.stringify(model);

    // Iterate over functions to generate mock code for conditions
    if (model.functions) {
      for (const funcName in model.functions) {
        const func = model.functions[funcName];
        if (func.conditions) {
          for (const cond of func.conditions) {
             // Check if cond is an instance of the mocked classes
             if (cond && cond.constructor && cond.constructor.name === 'NpcKnowsInfoCondition') {
               output += `Npc_KnowsInfo(${cond.npc}, ${cond.dialogRef})`;
             }
             if (cond && cond.constructor && cond.constructor.name === 'VariableCondition') {
               output += cond.negated ? `!${cond.variableName}` : `${cond.variableName}`;
             }
             if (cond && cond.constructor && cond.constructor.name === 'Condition') {
               output += cond.condition;
             }
          }
        }
      }
    }
    return output;
  }
}
