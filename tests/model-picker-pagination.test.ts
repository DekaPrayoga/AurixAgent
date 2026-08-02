import { describe, expect, test } from 'bun:test';
import { toModelPickerItems, searchModelItems } from '../src/agent/ModelSelection.js';
import { mergeAurixFreeModel, AURIX_FREE_MODEL_ID } from '../src/agent/AurixFreeModel.js';
import {
  MODEL_PICKER_PAGE_SIZE,
  chunkNumberButtons,
  createModelPickerView,
  modelAtAbsoluteIndex,
} from '../src/gateway/ModelPickerView.js';

const models = Array.from({ length: 31 }, (_, index) => ({
  id: `model-${index + 1}`,
  label: `model-${index + 1}`,
}));
const items = toModelPickerItems(models);

describe('gateway model picker pagination', () => {
  test('uses fixed 15-model pages with absolute numbering', () => {
    expect(MODEL_PICKER_PAGE_SIZE).toBe(15);
    expect(createModelPickerView(items, '', 0).rows.map((row) => row.absoluteIndex)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 1)
    );
    expect(createModelPickerView(items, '', 1).rows.map((row) => row.absoluteIndex)).toEqual(
      Array.from({ length: 15 }, (_, index) => index + 16)
    );
    expect(createModelPickerView(items, '', 2).rows.map((row) => row.absoluteIndex)).toEqual([31]);
  });

  test('sorts IDs naturally before paging', () => {
    expect(items.slice(0, 4).map((item) => item.id)).toEqual([
      'model-1',
      'model-2',
      'model-3',
      'model-4',
    ]);
    expect(items[9]?.id).toBe('model-10');
  });

  test('absolute numeric selection uses the filtered list', () => {
    expect(modelAtAbsoluteIndex(items, '', 16)?.id).toBe('model-16');
    const filtered = createModelPickerView(items, 'model-2', 0);
    expect(modelAtAbsoluteIndex(items, 'model-2', 1)?.id).toBe(filtered.rows[0]?.item.id);
  });

  test('pins the built-in Aurix free model first and makes it searchable', () => {
    const promoted = toModelPickerItems(mergeAurixFreeModel([{ id: '1-model', label: '1-model' }]));
    expect(promoted[0]?.id).toBe(AURIX_FREE_MODEL_ID);
    expect(searchModelItems(promoted, 'free')[0]?.id).toBe(AURIX_FREE_MODEL_ID);
    expect(searchModelItems(promoted, 'deepseek')[0]?.id).toBe(AURIX_FREE_MODEL_ID);
  });

  test('Telegram number buttons form three rows of five', () => {
    const rows = chunkNumberButtons(Array.from({ length: 15 }, (_, index) => index + 1), 5);
    expect(rows).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12, 13, 14, 15],
    ]);
  });
});
