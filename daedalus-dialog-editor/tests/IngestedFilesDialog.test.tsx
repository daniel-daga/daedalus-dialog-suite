import React from 'react';
import { render, screen } from '@testing-library/react';
import { IngestedFilesDialog } from '../src/renderer/components/IngestedFilesDialog';
import '@testing-library/jest-dom';

const mockParsedFiles = new Map();
mockParsedFiles.set('C:/test/file1.d', {
  filePath: 'C:/test/file1.d',
  semanticModel: { hasErrors: false },
  lastParsed: new Date('2023-01-01T12:00:00'),
});
mockParsedFiles.set('C:/test/file2.d', {
  filePath: 'C:/test/file2.d',
  semanticModel: { hasErrors: true, errors: [{ message: 'Error' }] },
  lastParsed: new Date('2023-01-01T12:05:00'),
});

const mockAllDialogFiles = ['C:/test/file1.d', 'C:/test/file2.d', 'C:/test/file3.d'];

jest.mock('../src/renderer/store/projectStore', () => ({
  useProjectStore: (selector: any) => selector({
    parsedFiles: mockParsedFiles,
    allDialogFiles: mockAllDialogFiles
  }),
}));

describe('IngestedFilesDialog', () => {
  it('renders correctly with files', () => {
    render(
      <IngestedFilesDialog
        open={true}
        onClose={() => {}}
      />
    );

    expect(screen.getByText('Project Files (3)')).toBeInTheDocument();
    
    // File 1 - Parsed OK
    expect(screen.getByText('C:/test/file1.d')).toBeInTheDocument();
    expect(screen.getByText('Parsed')).toBeInTheDocument();
    
    // File 2 - Parsed Error
    expect(screen.getByText('C:/test/file2.d')).toBeInTheDocument();
    expect(screen.getByText('1 Errors')).toBeInTheDocument();

    // File 3 - Pending
    expect(screen.getByText('C:/test/file3.d')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Not loaded yet')).toBeInTheDocument();
  });
});
