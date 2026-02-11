import React from 'react';
import ConditionEditor from './ConditionEditor';
import type { Dialog, DialogFunction, SemanticModel } from '../types/global';

type FunctionUpdater = DialogFunction | ((prev: DialogFunction) => DialogFunction);

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

  return (
    <ConditionEditor
      conditionFunction={semanticModel.functions[conditionFunctionName]}
      onUpdateFunction={onUpdateFunction}
      semanticModel={semanticModel}
      filePath={filePath}
      dialogName={dialogName}
    />
  );
};

export default ConditionSection;
