import { useCallback, useState } from 'react';

/**
 * Page and page size for a filtered table. The page is remembered together
 * with the filters it was chosen under, so changing a filter (or the page
 * size) falls back to the first page in the same render, with no effect and
 * no fetch of a page that does not exist under the new filter.
 */
export const usePaging = (filterKey: string, initialPageSize = 25) => {
  const [pageSize, setPageSize] = useState(initialPageSize);
  const key = `${filterKey}|${pageSize}`;
  const [state, setState] = useState({ key, page: 0 });

  const page = state.key === key ? state.page : 0;
  const setPage = useCallback(
    (next: number) => setState({ key, page: next }),
    [key]
  );

  return { page, pageSize, setPage, setPageSize };
};
