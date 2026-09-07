export function createMemoryRunStore() {
  const runs = new Map();
  return {
    async get(id) {
      return clone(runs.get(id));
    },
    async set(id, run) {
      runs.set(id, clone(run));
      return clone(run);
    },
    async delete(id) {
      return runs.delete(id);
    },
    async appendSnapshot(id, snapshot) {
      const run = runs.get(id);
      if (!run) throw new Error(`Run ${id} was not found.`);
      run.snapshots = [...(run.snapshots || []), clone(snapshot)];
      runs.set(id, run);
      return clone(snapshot);
    },
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}
