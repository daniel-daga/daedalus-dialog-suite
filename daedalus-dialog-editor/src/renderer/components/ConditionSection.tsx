import React from 'react';
import ConditionEditor from './ConditionEditor';
import type { Dialog, SemanticModel } from '../types/global';
import type { FunctionUpdater } from './dialogTypes';

interface ConditionSectionProps {
  dialogName: string;
  dialog: Dialog;
  semanticModel?: SemanticModel;
  filePath: string | null;
  onUpdateFunction: (funcOrUpdater: FunctionUpdater) => void;
}

const ConditionSection: React.FC<ConditionSectionProps> = ({
  dialogName,
  dialog,
  semanticModel,
  filePath,
  onUpdateFunction
}) => {
  const conditionFunctionName = typeof dialog.properties?.condition === 'string'
    ? dialog.properties.condition
    : dialog.properties?.condition?.name;

  if (!conditionFunctionName || !semanticModel?.functions?.[conditionFunctionName]) {
    return null;
  }

  // `semanticModel` is only used to resolve the condition function here — it is
  // deliberately NOT threaded through ConditionEditor's memo boundary
  // (render-performance.md, "Memo-boundary invariant").
  return (
    <ConditionEditor
      conditionFunction={semanticModel.functions[conditionFunctionName]}
      onUpdateFunction={onUpdateFunction}
      filePath={filePath}
      dialogName={dialogName}
    />
  );
};

export default ConditionSection;
