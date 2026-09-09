/**
 * Fetching more than a page of rows.
 *
 * WHY THIS EXISTS
 * Supabase refuses to return more than 1,000 rows in one response, no matter
 * what limit you ask for - and it does so WITHOUT an error. A load test at
 * 10,000 leads caught this: the map appeared to work while silently showing
 * only the first tenth of the pins.
 *
 * Anything that genuinely needs every row must therefore ask repeatedly.
 * Everything user-facing should page properly instead of using this; it is for
 * exports, maps and other "give me all of it" cases.
 */

export const SERVER_PAGE_SIZE = 1000;

interface PageResult<T> {
  data: T[] | null;
  error: { message?: string } | null;
}

/**
 * Calls `build(from, to)` repeatedly until a short page comes back.
 *
 * @param build  Builds one page request for the given inclusive row range.
 * @param max    Hard ceiling, so a runaway loop can never hang the browser.
 */
export async function fetchAllPages<T>(
  build: (from: number, to: number) => PromiseLike<PageResult<T>>,
  max = 20_000,
): Promise<T[]> {
  const all: T[] = [];

  for (let offset = 0; offset < max; offset += SERVER_PAGE_SIZE) {
    const { data, error } = await build(offset, offset + SERVER_PAGE_SIZE - 1);
    if (error) throw error;

    const page = data ?? [];
    all.push(...page);

    // A page shorter than we asked for means there is nothing left.
    if (page.length < SERVER_PAGE_SIZE) break;
  }

  return all;
}
