import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MilestonesList } from '../src/components/artwork/MilestonesList';
import type { Layer } from '../src/types';

const layers: Layer[] = [
  {
    id: 'baseline',
    imageUrl: 'https://example.com/baseline.jpg',
    createdAt: '2026-08-01T10:00:00.000Z',
    order: 0,
  },
  {
    id: 'milestone-2',
    imageUrl: 'https://example.com/milestone-2.jpg',
    createdAt: '2026-08-02T10:00:00.000Z',
    order: 1,
  },
  {
    id: 'milestone-3',
    imageUrl: 'https://example.com/milestone-3.jpg',
    createdAt: '2026-08-03T10:00:00.000Z',
    order: 2,
  },
];

function buttonOpeningTag(markup: string, label: string): string {
  const labelIndex = markup.indexOf(`aria-label="${label}"`);
  assert.notEqual(labelIndex, -1, `Expected button labelled ${label}`);
  const start = markup.lastIndexOf('<button', labelIndex);
  const end = markup.indexOf('>', labelIndex);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return markup.slice(start, end + 1);
}

function renderMilestones(): string {
  const notInvoked = () => {
    throw new Error('Static rendering must not invoke event handlers.');
  };

  return renderToStaticMarkup(
    React.createElement(MilestonesList, {
      layers,
      selectedLayerId: 'baseline',
      playbackIndex: null,
      uploading: false,
      onDropFiles: notInvoked,
      onSelectLayer: notInvoked,
      onMoveLayer: notInvoked,
      onDeleteLayer: notInvoked,
      onDeleteArtwork: notInvoked,
      onRecalculateAlignment: notInvoked,
    }),
  );
}

test('baseline milestone cannot be moved later', () => {
  const button = buttonOpeningTag(renderMilestones(), 'Move milestone 1 later');
  assert.match(button, /\sdisabled(?:="")?/);
});

test('no milestone can be moved ahead of the baseline', () => {
  const button = buttonOpeningTag(renderMilestones(), 'Move milestone 2 earlier');
  assert.match(button, /\sdisabled(?:="")?/);
});
