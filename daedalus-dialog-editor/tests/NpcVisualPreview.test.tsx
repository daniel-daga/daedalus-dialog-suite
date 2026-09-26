/**
 * The NPC editor's preview (docs/plans/npc-editor.md §4): what the form says
 * the NPC looks like, assembled by the world worker. jsdom has no WebGL, so the
 * renderer is the viewport specs' stand-in and the assertions are about what
 * was asked for.
 *
 * @jest-environment jsdom
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import type { NpcDefinition, NpcStatement } from '../src/shared/types';
import type { NpcBodyScene } from '../src/shared/worldTypes';
import * as mockWorldViewport from './worldViewportMocks';
import NpcVisualPreview from '../src/renderer/components/NpcVisualPreview';
import { useWorldStore } from '../src/renderer/store/worldStore';

jest.mock('three', () => mockWorldViewport.mockThree());
jest.mock('three/examples/jsm/controls/OrbitControls.js', () => mockWorldViewport.mockOrbitControls());

const range = { startIndex: 0, endIndex: 0 };
const call = (name: string, args: string[]): NpcStatement => ({ kind: 'call', name, args, text: '', range, argsRange: range });
const ONAR: NpcDefinition = {
  name: 'BAU_900_Onar', parent: 'Npc_Default', closingBraceIndex: 0,
  statements: [call('B_SetNpcVisual', ['self', 'MALE', '"Hum_Head_Fatbald"', 'Face_N_Weak_Orry', 'BodyTex_N', 'ITAR_Vlk_H'])],
};
const CONSTANTS: Record<string, number> = { MALE: 0, FACE_N_WEAK_ORRY: 42, BODYTEX_N: 1, NO_ARMOR: -1 };
const lookupConstant = (name: string) => CONSTANTS[name.toUpperCase()];
const itemSource = (name: string) => (name.toUpperCase() === 'ITAR_VLK_H'
  ? 'INSTANCE ITAR_Vlk_H (C_Item) { visual_change = "Armor_Vlk_H.asc"; };'
  : undefined);

function scene(missing: string[] = []): NpcBodyScene {
  return {
    name: 'Armor_Vlk_H.asc', source: 'ARMOR_VLK_H.MDM', bounds: [0, 0, 0, 1, 1, 1], triangleCount: 1, missing,
    groups: [{
      texture: 'ARMOR_VLK_H_V1_C0.TGA', color: [255, 255, 255, 255],
      alphaFunc: 0, texAniMapMode: 0, texAniFps: 0, texAniMapDir: [0, 0],
      envMapping: false, envMappingStrength: 0, waveMode: 0, waveSpeed: 0, waveMaxAmplitude: 0, waveGridSize: 0,
      ignoreSun: false, disableLightmap: false, materials: 1, vertexCount: 3, triangleCount: 1,
      positions: new Float32Array(9).buffer, normals: new Float32Array(9).buffer,
      uvs: new Float32Array(6).buffer, indices: new Uint32Array([0, 1, 2]).buffer, lights: null,
    }],
  };
}

const getNpcBody = jest.fn<Promise<NpcBodyScene | null>, [unknown]>();

beforeEach(() => {
  getNpcBody.mockReset();
  (window as unknown as { editorAPI: unknown }).editorAPI = {
    getNpcBody,
    getWorldTexture: jest.fn(async () => null),
  };
  useWorldStore.setState({ status: 'idle' });
});

const renderPreview = (definition = ONAR) => render(
  <NpcVisualPreview definition={definition} edits={[]} lookupConstant={lookupConstant} itemSource={itemSource} />,
);

describe('NpcVisualPreview', () => {
  it('says what it would draw, and that it needs a world for the meshes', () => {
    renderPreview();
    expect(screen.getByTestId('npc-preview-summary')).toHaveTextContent('Armor_Vlk_H.asc · head Hum_Head_Fatbald');
    expect(screen.getByTestId('npc-preview-no-world')).toBeInTheDocument();
    expect(getNpcBody).not.toHaveBeenCalled();
  });

  it('asks the world worker for the body and draws it, with what it could not place', async () => {
    useWorldStore.setState({ status: 'ready' });
    getNpcBody.mockResolvedValue(scene(['Head mesh Hum_Head_Fatbald did not resolve']));
    renderPreview();

    await waitFor(() => expect(getNpcBody).toHaveBeenCalledWith({
      model: 'HUMANS.MDS', body: 'Armor_Vlk_H.asc', bodyTexture: 1, skinColor: 0,
      head: 'Hum_Head_Fatbald', headTexture: 42, teethTexture: 0, scale: [1, 1, 1],
    }));
    expect(await screen.findByTestId('npc-preview-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('npc-preview-notes')).toHaveTextContent('Head mesh Hum_Head_Fatbald did not resolve');
    // Strength is not set, so the width is an assumption, and it says so.
    expect(screen.getByTestId('npc-preview-notes')).toHaveTextContent('Width assumed normal');
  });

  it('says the body did not resolve when the worker finds nothing', async () => {
    useWorldStore.setState({ status: 'ready' });
    getNpcBody.mockResolvedValue(null);
    renderPreview();
    expect(await screen.findByTestId('npc-preview-failed'))
      .toHaveTextContent('Armor_Vlk_H.asc does not resolve in the mounted assets');
  });

  it('says why it cannot draw an NPC whose visual it cannot read, and asks nothing', () => {
    useWorldStore.setState({ status: 'ready' });
    renderPreview({ ...ONAR, statements: [] });
    expect(screen.getByTestId('npc-preview-reason')).toHaveTextContent('No Mdl_SetVisual call');
    expect(getNpcBody).not.toHaveBeenCalled();
  });
});
