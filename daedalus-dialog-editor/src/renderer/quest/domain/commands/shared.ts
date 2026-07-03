import type { SemanticModel } from '../../../types/global';

const cloneModel = <T,>(value: T): T => {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
};

type SemanticFunction = SemanticModel['functions'][string];

/**
 * Structural-sharing update: returns a new model that shallow-copies the model
 * object and its `functions` map, deep-clones ONLY `functions[name]`, applies
 * `update` to that clone, and reference-shares every other subtree with the
 * input model. Callers must not mutate any other part of the returned model.
 */
export const withUpdatedFunction = (
  model: SemanticModel,
  name: string,
  update: (fnClone: SemanticFunction) => void
): SemanticModel => {
  const fnClone = cloneModel(model.functions[name]);
  update(fnClone);
  return {
    ...model,
    functions: {
      ...model.functions,
      [name]: fnClone
    }
  };
};
