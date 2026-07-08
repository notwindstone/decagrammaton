import {
  signal,
  computed,
  effect as alienEffect,
  startBatch,
  endBatch,
} from "alien-signals";

export interface SignalType<T> {
  value: T;
}

export interface ComputedType<T> {
  readonly value: T;
}

// Shallow signal: only reassigning `.value` triggers updates. Mutating a nested
// property of an object/array held in `.value` is NOT observed. This is the
// original `$signal` behavior.
export function $shallowSignal<T>(initialValue: T): SignalType<T> {
  const s = signal(initialValue);
  const obj = Object.create(null) as SignalType<T>;

  Object.defineProperty(obj, "value", {
    get(): T { return s(); },
    set(v: T) { s(v); },
    enumerable: true,
    configurable: false,
  });

  return obj;
}

// Only plain objects and arrays are made deeply reactive. Class instances,
// Date, Map, Set, and DOM/SafeElement wrappers are left untouched so their
// internals aren't disturbed by proxying.
function isReactable(value: unknown): value is Record<PropertyKey, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === Array.prototype || proto === null;
}

// Deep signal: reassigning `.value` OR mutating any nested property/array of the
// held value triggers updates. Reads track a single version signal and any
// mutation (set/delete, at any depth) bumps it — coarse-grained but correct.
export function $signal<T>(initialValue: T): SignalType<T> {
  let raw = initialValue;
  let version = 0;
  const versionSignal = signal(0);
  const track = (): void => { versionSignal(); };
  const trigger = (): void => { versionSignal(++version); };

  const proxyCache = new WeakMap<object, unknown>();

  function reactive(target: unknown): unknown {
    if (!isReactable(target)) return target;
    if (proxyCache.has(target)) return proxyCache.get(target);

    const proxy = new Proxy(target, {
      get(t, key, receiver) {
        track();
        return reactive(Reflect.get(t, key, receiver));
      },
      set(t, key, value, receiver) {
        const had = Object.prototype.hasOwnProperty.call(t, key);
        const old = Reflect.get(t, key, receiver);
        const result = Reflect.set(t, key, value, receiver);
        if (!had || !Object.is(old, value)) trigger();
        return result;
      },
      deleteProperty(t, key) {
        const had = Object.prototype.hasOwnProperty.call(t, key);
        const result = Reflect.deleteProperty(t, key);
        if (had) trigger();
        return result;
      },
    });

    proxyCache.set(target, proxy);
    return proxy;
  }

  const obj = Object.create(null) as SignalType<T>;

  Object.defineProperty(obj, "value", {
    get(): T {
      track();
      return reactive(raw) as T;
    },
    set(v: T) {
      if (Object.is(raw, v)) return;
      raw = v;
      trigger();
    },
    enumerable: true,
    configurable: false,
  });

  return obj;
}

export function $computed<T>(getter: () => T): ComputedType<T> {
  const c = computed(getter);
  const obj = Object.create(null) as ComputedType<T>;

  Object.defineProperty(obj, "value", {
    get(): T { return c(); },
    set(_: T) { throw new Error("Cannot set the value of a computed property"); },
    enumerable: true,
    configurable: false,
  });

  return obj;
}

export function $effect(fn: () => void | (() => void)): () => void {
  return alienEffect(fn);
}

export { startBatch, endBatch };
