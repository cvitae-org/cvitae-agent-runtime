// Only removal identities survive, so polling and retries cannot restore data.
export const boardRemoval0034 = /* sql */ `
CREATE TABLE board_removals (entry_id TEXT PRIMARY KEY, offer_id TEXT NOT NULL);
`;
