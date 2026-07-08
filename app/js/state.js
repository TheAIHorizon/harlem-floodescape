/* state — tiny pub/sub store; the app's single source of truth (PRD §6.2).
 * Keys used app-wide:
 *   mode          "live" | "scenario"
 *   status        {level, reasonKey, source, at}
 *   scenario      {id, t, playing, speed, def} | null
 *   feeds         {nws:{state,...}, rain:{state,...}, floodnet:{state,...}}
 *   reports       [{id, t, depthIn, lat, lon, note, photo}]
 *   lang          "en" | "es"
 *   sensorStates  {sensorId: {depthIn, phase}}
 */
const values = new Map();
const subs = new Map();

export const store = {
  get(key) {
    return values.get(key);
  },
  set(key, value) {
    values.set(key, value);
    const fns = subs.get(key);
    if (fns) {
      for (const fn of [...fns]) {
        try {
          fn(value);
        } catch (e) {
          console.error(`store subscriber for "${key}" threw`, e);
        }
      }
    }
  },
  subscribe(key, fn) {
    if (!subs.has(key)) subs.set(key, new Set());
    subs.get(key).add(fn);
    return () => subs.get(key)?.delete(fn);
  },
};
