import {
  paginateModelItems,
  searchModelItems,
  type ModelPickerItem,
} from '../agent/ModelSelection.js';

export const MODEL_PICKER_PAGE_SIZE = 15;

export interface ModelPickerRow {
  item: ModelPickerItem;
  absoluteIndex: number;
}

export interface ModelPickerView {
  filtered: ModelPickerItem[];
  rows: ModelPickerRow[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  start: number;
  end: number;
}

export function createModelPickerView(
  items: ModelPickerItem[],
  query: string,
  requestedPage: number
): ModelPickerView {
  const filtered = searchModelItems(items, query);
  const page = paginateModelItems(filtered, requestedPage, MODEL_PICKER_PAGE_SIZE);
  const rows = page.items.map((item, index) => ({
    item,
    absoluteIndex: page.page * page.pageSize + index + 1,
  }));
  const start = page.total ? page.page * page.pageSize + 1 : 0;
  return {
    filtered,
    rows,
    page: page.page,
    pageSize: page.pageSize,
    total: page.total,
    totalPages: page.totalPages,
    start,
    end: page.total ? start + rows.length - 1 : 0,
  };
}

export function modelAtAbsoluteIndex(
  items: ModelPickerItem[],
  query: string,
  oneBasedIndex: number
): ModelPickerItem | undefined {
  if (!Number.isInteger(oneBasedIndex) || oneBasedIndex <= 0) return undefined;
  return searchModelItems(items, query)[oneBasedIndex - 1];
}

export function chunkNumberButtons<T>(buttons: T[], size = 5): T[][] {
  const rows: T[][] = [];
  for (let index = 0; index < buttons.length; index += size) {
    rows.push(buttons.slice(index, index + size));
  }
  return rows;
}
