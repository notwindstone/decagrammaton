import {
  watch,
  untracked,
  getCurrentScope,
  runWithScope,
  onDispose,
  type Scope,
} from "../reactivity.ts";
import {
  getCurrentInstance,
  runWithInstance,
  type ComponentInstance,
} from "./instance.ts";

export function isScopeDisposed(scope: Scope | undefined): boolean {
  while (scope) {
    if (scope.isDisposed) return true;
    scope = scope.parentScope;
  }
  return false;
}

interface Batch {
  mounted: (() => void)[];
  selections: Set<() => void>;
}
let currentBatch: Batch | null = null;
export function afterOptionChanges(update: () => void) {
  if (currentBatch) currentBatch.selections.add(update);
  else update();
}
export function withMountBatch<T>(mount: () => T, detached = false): T {
  const parent = currentBatch;
  const batch = (!detached && parent) || {
    mounted: [],
    selections: new Set<() => void>(),
  };
  currentBatch = batch;
  const start = batch.mounted.length;
  try {
    const result = mount();
    if (batch !== parent) {
      currentBatch = null;
      for (const update of batch.selections) update();
      for (let i = batch.mounted.length - 1; i >= 0; i--) batch.mounted[i]();
    }
    return result;
  } catch (error) {
    batch.mounted.length = start;
    throw error;
  } finally {
    currentBatch = parent;
  }
}
export function onMounted(cb: () => void): void {
  if (currentBatch === null) {
    throw new Error(
      "onMounted() can only be called synchronously during setup().",
    );
  }
  const scope: Scope | undefined = getCurrentScope();
  const instance: ComponentInstance | null = getCurrentInstance();
  currentBatch.mounted.push(() => {
    if (isScopeDisposed(scope)) return;
    const run = () => runWithInstance(instance, cb);
    if (scope) runWithScope(scope, run);
    else run();
  });
}

export function onUnmounted(cb: () => void): void {
  const scope: Scope | undefined = getCurrentScope();
  if (currentBatch === null || scope === undefined) {
    throw new Error(
      "onUnmounted() can only be called synchronously during setup().",
    );
  }
  onDispose(cb, scope);
}

// A watch callback runs after dependency collection. Mounted hooks can invalidate
// its source synchronously, including while another row is still being built.
export function watchStructure<T>(
  read: () => T,
  reconcile: (value: T) => void,
) {
  const scope = getCurrentScope();
  let active = false;
  let pending: { value: T } | undefined;
  watch(
    () => isScopeDisposed(scope) ? undefined : { value: read() },
    (snapshot) => {
      pending = snapshot;
      if (!snapshot || active) return;
      active = true;
      try {
        while (pending && !isScopeDisposed(scope)) {
          const { value } = pending;
          pending = undefined;
          untracked(() => reconcile(value));
        }
      } finally {
        active = false;
        pending = undefined;
      }
    },
    { immediate: true, flush: "sync" },
  );
}
