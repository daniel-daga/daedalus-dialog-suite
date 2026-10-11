import React, { useMemo } from 'react';
import ReferenceLink from './ReferenceLink';

interface ExpressionTextProps {
  expression: string;
}

const ExpressionText: React.FC<ExpressionTextProps> = ({ expression }) => {
  const parts = useMemo(() => {
    if (!expression) return [];
    // Split by non-word characters (keeping delimiters)
    // Identifiers start with letter/underscore and contain letters/digits/underscores
    return expression.split(/([a-zA-Z_][a-zA-Z0-9_]*)/);
  }, [expression]);

  const identifierRegex = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

  return (
    <>
      {parts.map((part, index) => {
        if (identifierRegex.test(part)) {
          return (
            <ReferenceLink
              key={index}
              symbolName={part}
              variant="inherit"
              sx={{ display: 'inline' }}
            >
              {part}
            </ReferenceLink>
          );
        } else {
          return <span key={index}>{part}</span>;
        }
      })}
    </>
  );
};

export default ExpressionText;
