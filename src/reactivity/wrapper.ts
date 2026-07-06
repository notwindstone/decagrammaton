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

export function $signal<T>(initialValue: T): SignalType<T> {
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
