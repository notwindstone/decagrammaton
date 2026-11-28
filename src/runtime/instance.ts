export interface ComponentInstance {
  parent: ComponentInstance | null;
  provides: Record<string | symbol, unknown>;
}

let currentInstance: ComponentInstance | null = null;

export function getCurrentInstance(): ComponentInstance | null {
  return currentInstance;
}

export function runWithInstance<T>(instance: ComponentInstance | null, fn: () => T): T {
  const previous = currentInstance;
  currentInstance = instance;
  try {
    return fn();
  } finally {
    currentInstance = previous;
  }
}

export function createInstance(parent: ComponentInstance | null): ComponentInstance {
  return {
    parent,
    provides: parent ? parent.provides : Object.create(null),
  };
}

export function provide(key: string | symbol, value: unknown): void {
  if (currentInstance === null) {
    throw new Error("provide() can only be called synchronously inside setup().");
  }
  let provides = currentInstance.provides;
  const parentProvides = currentInstance.parent && currentInstance.parent.provides;
  if (parentProvides === provides) {
    provides = currentInstance.provides = Object.create(parentProvides);
  }
  provides[key] = value;
}

export function inject(key: string | symbol, defaultValue?: unknown): unknown {
  if (currentInstance === null) {
    throw new Error("inject() can only be called synchronously inside setup().");
  }
  const provides = currentInstance.provides;
  if (key in provides) {
    return provides[key];
  }
  if (arguments.length > 1) {
    return defaultValue;
  }
  return undefined;
}
