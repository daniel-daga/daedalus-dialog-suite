import React, { useCallback } from 'react';
import { Typography, TypographyProps } from '@mui/material';
import { useNavigation } from '../../hooks/useNavigation';

interface ReferenceLinkProps extends TypographyProps {
  symbolName: string;
  symbolType?: 'quest' | 'dialog' | 'npc' | 'variable' | 'constant' | 'instance' | 'function';
  children?: React.ReactNode;
}

const ReferenceLink: React.FC<ReferenceLinkProps> = ({
  symbolName,
  symbolType,
  children,
  sx,
  ...props
}) => {
  const { navigateToSymbol } = useNavigation();

  const handleClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!symbolName) return;

    // Try to navigate
    await navigateToSymbol(symbolName, { kind: symbolType });
  }, [navigateToSymbol, symbolName, symbolType]);

  return (
    <Typography
      component="span"
      onClick={handleClick}
      className="nodrag"
      sx={{
        cursor: 'pointer',
        color: '#90caf9', // Light blue
        textDecoration: 'none',
        '&:hover': {
          textDecoration: 'underline',
          color: '#64b5f6',
        },
        display: 'inline',
        ...sx,
      }}
      {...props}
    >
      {children || symbolName}
    </Typography>
  );
};

export default ReferenceLink;
