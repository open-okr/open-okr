/**
 * The hidden field an edit form carries what it read in, as JSON
 * (docs/design/optimistic-concurrency.md V4). Its own module because both
 * the browser and the server actions read the name, and the server's half
 * imports the domain package, which the browser must not.
 */
export const READ_FIELD = "read";
