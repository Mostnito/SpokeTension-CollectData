const FILTER_FIELDS = ['recorder', 'wheel_type', 'environment'];

/** Select a view of the dataset without changing its records or their order. */
export function filterRecordings(records, filters = {}) {
  return records.filter((record) => FILTER_FIELDS.every((field) => {
    const value = filters[field] ?? '';
    return value === '' || record[field] === value;
  }));
}
