// What main accepts from the island's page. The page is LOUPE's own, but main decides (ABU-13): a page bug or an
// injected script can't turn on answering prompts or kill a process that isn't a listed "pid@start".
const PAGE_KEYS = new Set(['sound', 'volume', 'procs', 'procsAsked']);

const cfgPatch = p => Object.fromEntries(Object.entries(p && typeof p === 'object' ? p : {}).filter(([k]) => PAGE_KEYS.has(k)));
const killList = pids => (Array.isArray(pids) ? pids : []).map(String).filter(p => /^\d{3,7}(@\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)?$/.test(p));

module.exports = { cfgPatch, killList };
