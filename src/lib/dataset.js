const FILTER_FIELDS = ['recorder', 'wheel_type', 'environment'];

/** Select a view of the dataset without changing its records or their order. */
export function filterRecordings(records, filters = {}) {
  return records.filter((record) => FILTER_FIELDS.every((field) => {
    const value = filters[field] ?? '';
    return value === '' || record[field] === value;
  }));
}

function numericTension(record) {
  const value = record?.tension_kgf;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/** Newest keeps the API's existing order; tension ties retain that same order. */
export function sortRecordings(records, order = 'newest') {
  const sorted = records.slice();
  if (order !== 'tension-asc' && order !== 'tension-desc') return sorted;
  const direction = order === 'tension-asc' ? 1 : -1;
  return sorted.sort((left, right) => {
    const leftValue = numericTension(left);
    const rightValue = numericTension(right);
    const leftValid = Number.isFinite(leftValue);
    const rightValid = Number.isFinite(rightValue);
    if (!leftValid) return rightValid ? 1 : 0;
    if (!rightValid) return -1;
    return (leftValue - rightValue) * direction;
  });
}
