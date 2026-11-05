import React, { useEffect, useMemo, useState } from 'react';
import { Box, Chip, Switch, TextField, Typography } from '@mui/material';
import type { ZenPosition } from 'zen-world';
import { nearbyItems, type LocatorItem } from '../../world/itemLocator';

// Spacer's Item Locator (#417, slice 3 of #412) — the World surface's Locator
// tab: the world's `oCItem`s by radius around the camera, either all of them or
// only the ones the loaded project cannot resolve, searched by the name a player
// reads.
//
// **Why a tab of its own.** It answers a question no other view does — which
// items are within reach, and which of them are wrong — and its rows are VOBs
// the scene tree lists anonymously while the viewport draws nothing for the ones
// that do not resolve (an `oCItem` stores no visual; the engine reads one off
// its script instance, #424). A filter in the scene tree could not say any of
// that: the tree filters by VOB name and class, and the thing being searched
// here is `oCItem.instance`.
//
// **The ring is the viewport's, the list is this.** Both use the same candidate
// list, so they cannot disagree about what matched; the radius is applied here
// on a poll of the camera's position (the cadence the scene tree's "within reach
// of the camera" filter already uses) and there in the draw loop, which is what
// makes the rings follow the camera without a React render per frame.

/** How often the list re-reads the camera while the locator is on — the scene
 *  tree's own cadence for the same kind of filter. */
const CAMERA_POLL_MS = 300;

export interface ItemLocatorPanelProps {
  /** Every item the name and "bad only" switches kept, whatever its distance. */
  items: readonly LocatorItem[];
  enabled: boolean;
  radiusM: number;
  badOnly: boolean;
  search: string;
  onToggle: (enabled: boolean) => void;
  onRadius: (radiusM: number) => void;
  onBadOnly: (badOnly: boolean) => void;
  onSearch: (search: string) => void;
  /** The viewport's camera, on demand — a poll, not a subscription, so the
   *  panel works with no scene at all (it simply lists nothing). */
  getCameraPosition?: () => ZenPosition | null;
  /** The store's selection, plus the camera jump: the row is a locator, and a
   *  locator that selected without moving the camera would leave the user
   *  looking at the place they were. */
  onFocus: (vob: number) => void;
}

const ItemLocatorPanel: React.FC<ItemLocatorPanelProps> = ({
  items, enabled, radiusM, badOnly, search, onToggle, onRadius, onBadOnly, onSearch,
  getCameraPosition, onFocus,
}) => {
  const [center, setCenter] = useState<ZenPosition | null>(null);
  useEffect(() => {
    if (!enabled || getCameraPosition === undefined) return undefined;
    const poll = () => setCenter(getCameraPosition());
    poll();
    const timer = setInterval(poll, CAMERA_POLL_MS);
    return () => clearInterval(timer);
  }, [enabled, getCameraPosition]);

  // A centre nobody could answer (no viewport, or a scene mid-rebuild) leaves
  // the radius off rather than filtering from a zero position — the scene
  // tree's rule for the same filter.
  const shown = useMemo(
    () => (center === null ? [] : nearbyItems(items, center, Math.max(1, radiusM) * 100)),
    [items, center, radiusM],
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box sx={{ px: 0.5, py: 0.25, borderBottom: 1, borderColor: 'divider', display: 'flex', gap: 1, alignItems: 'center' }}>
        <Typography variant="caption" noWrap sx={{ fontSize: 11 }}>Locator</Typography>
        <Switch
          size="small"
          checked={enabled}
          onChange={(event) => onToggle(event.target.checked)}
          inputProps={{
            'data-testid': 'world-locator-toggle', 'aria-label': 'Item locator',
          } as React.InputHTMLAttributes<HTMLInputElement>}
          sx={{ ml: 'auto' }}
        />
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', px: 0.5, py: 0.25 }}>
        <TextField
          size="small"
          type="number"
          disabled={!enabled}
          value={radiusM}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onRadius(next);
          }}
          inputProps={{
            'data-testid': 'world-locator-radius', 'aria-label': 'Locator radius, in metres', min: 1,
          }}
          sx={{ width: 84, '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        />
        <Typography variant="caption" color="text.secondary" noWrap sx={{ flex: 1 }}>m radius</Typography>
        <Typography variant="caption" color="text.secondary" noWrap sx={{ fontSize: 11 }}>Bad only</Typography>
        <Switch
          size="small"
          checked={badOnly}
          disabled={!enabled}
          onChange={(event) => onBadOnly(event.target.checked)}
          inputProps={{
            'data-testid': 'world-locator-bad-only', 'aria-label': 'Bad only',
          } as React.InputHTMLAttributes<HTMLInputElement>}
        />
      </Box>
      <Box sx={{ px: 0.5, pb: 0.25 }}>
        <TextField
          size="small"
          variant="outlined"
          disabled={!enabled}
          placeholder="Search items"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
          inputProps={{ 'data-testid': 'world-locator-search', 'aria-label': 'Search the item locator' }}
          sx={{ width: '100%', '& .MuiInputBase-input': { fontSize: 12, py: 0.5 } }}
        />
      </Box>
      {enabled && (
        <Typography
          variant="caption"
          color="text.secondary"
          noWrap
          data-testid="world-locator-count"
          sx={{ px: 1, py: 0.25 }}
        >
          {shown.length === items.length
            ? `${shown.length.toLocaleString()} items within ${radiusM} m`
            : `${shown.length.toLocaleString()} of ${items.length.toLocaleString()} items within ${radiusM} m`}
        </Typography>
      )}
      {enabled && shown.length === 0 && (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="world-locator-empty"
          sx={{ p: 1, display: 'block' }}
        >
          {items.length === 0
            ? 'No `oCItem` VOBs in this world.'
            : `No item matches within ${radiusM} m of the camera.`}
        </Typography>
      )}
      <Box role="list" aria-label="Located items" sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {shown.map((item) => (
          <Box
            key={item.vob}
            role="listitem"
            tabIndex={0}
            data-testid={`world-locator-vob-${item.vob}`}
            title={`${item.name} (${item.instance}) — VOB ${item.vob}`}
            onClick={() => onFocus(item.vob)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' && event.key !== ' ') return;
              event.preventDefault();
              onFocus(item.vob);
            }}
            sx={{
              display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75, py: 0.25,
              cursor: 'pointer', '&:hover': { bgcolor: 'action.hover' },
            }}
          >
            <Typography variant="caption" noWrap sx={{ flex: 1, minWidth: 0, fontSize: 11 }} title={item.name}>
              {item.name}
            </Typography>
            {item.name !== item.instance && (
              <Typography variant="caption" noWrap color="text.secondary" sx={{ fontSize: 10 }}>
                {item.instance}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
              {item.vob}
            </Typography>
            {item.bad && (
              // The one fact about an item that is a defect rather than a
              // location: no script in the project declares this instance, so
              // the engine spawns nothing and the property grid refuses it.
              <Chip size="small" label="unresolved" color="error" sx={{ height: 16, fontSize: 9 }} />
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default ItemLocatorPanel;
