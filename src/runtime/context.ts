import { isSignal } from "../reactivity.ts";
export function createContext(
  setupResult: Record<string, unknown>,
  props: Record<string, unknown> = {},
): Record<string, unknown> {
  return new Proxy(setupResult, {
    get(target, key: string) {
      if (!Object.hasOwn(target, key) && key in props) return Reflect.get(props, key);
      const value = Reflect.get(target, key);
      return isSignal(value) ? (value as { value: unknown }).value : value;
    },
    set(target, key: string, incoming) {
      if (!Object.hasOwn(target, key) && key in props)
        throw new TypeError(`Cannot assign to prop "${key}": props are read-only.`);
      const current = Reflect.get(target, key);
      if (isSignal(current)) {
        (current as { value: unknown }).value = incoming;
        return true;
      }
      return Reflect.set(target, key, incoming);
    },
  });
}
type Option = { default?: unknown; type?: unknown; skipFactory?: boolean };
export type PropsOptions = Record<string, Option | Function | null> | string[];
export const defineComponent = <T>(component: T) => component;
export function mergeDefaults(
  options: PropsOptions,
  defaults: Record<string, unknown>,
) {
  const result = Array.isArray(options)
    ? Object.fromEntries(options.map((k) => [k, {}]))
    : { ...options };
  for (const key of Object.keys(result)) {
    if (Object.hasOwn(defaults, key))
      result[key] = {
        ...(typeof result[key] === "function"
          ? { type: result[key] }
          : result[key]),
        default: defaults[key],
        skipFactory: defaults["__skip_" + key],
      };
  }
  return result;
}
export function createProps(
  getters: Record<string, () => unknown>,
  options: PropsOptions = {},
) {
  const cache = new Map<string, unknown>();
  const declared = (key: PropertyKey) =>
    typeof key === "string" &&
    (Array.isArray(options)
      ? options.includes(key)
      : Object.hasOwn(options, key));
  const props: Record<string, unknown> = new Proxy(getters, {
    get(target, key: string) {
      const value = Object.hasOwn(target, key) ? target[key]() : undefined;
      if (value !== undefined || !Object.hasOwn(options, key)) return value;
      const opt = Array.isArray(options) ? undefined : options[key];
      if (!opt || typeof opt !== "object" || !Object.hasOwn(opt, "default"))
        return undefined;
      if (!cache.has(key))
        cache.set(
          key,
          typeof opt.default === "function" &&
            opt.type !== Function &&
            !opt.skipFactory
            ? opt.default(props)
            : opt.default,
        );
      return cache.get(key);
    },
    has(target, key) {
      return Object.hasOwn(target, key) || declared(key);
    },
    ownKeys(target) {
      return [
        ...new Set([
          ...Reflect.ownKeys(target),
          ...(Array.isArray(options) ? options : Object.keys(options)),
        ]),
      ];
    },
    getOwnPropertyDescriptor(target, key) {
      return (
        Reflect.getOwnPropertyDescriptor(target, key) ??
        (declared(key) ? { configurable: true, enumerable: true } : undefined)
      );
    },
    set(_, key) {
      throw new Error(
        `Cannot assign to prop "${String(key)}": props are read-only.`,
      );
    },
  });
  return props;
}
