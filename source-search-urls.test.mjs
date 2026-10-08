import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSourceSearchUrls } from './source-search-urls.mjs';

test('builds focused query URLs and respects the lane limit', () => {
  const urls = buildSourceSearchUrls({
    searchUrlTemplate: 'https://example.test/jobs?keywords={keywords}&location={location}',
    searchLaneLimit: 2
  }, ['Senior System Engineer', 'Azure Arc Engineer', 'VMware Engineer'], 'Stuttgart');

  assert.deepEqual(urls, [
    'https://example.test/jobs?keywords=Senior%20System%20Engineer&location=Stuttgart',
    'https://example.test/jobs?keywords=Azure%20Arc%20Engineer&location=Stuttgart'
  ]);
});

test('builds stable path slugs and removes duplicate URLs', () => {
  const urls = buildSourceSearchUrls({
    searchUrlTemplates: [
      'https://example.test/{keywordSlug}-jobs-in-{locationSlug}',
      'https://example.test/{keywordSlug}-jobs-in-{locationSlug}'
    ],
    searchLaneLimit: 3
  }, ['Systems Administrator', 'Systems Administrator'], 'Böblingen');

  assert.deepEqual(urls, [
    'https://example.test/systems-administrator-jobs-in-boblingen'
  ]);
});
