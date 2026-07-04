import type { StateType } from "../types/state.type.ts";

export function $state<T>(input: T): StateType<T> {
  const wrapped: StateType<T> = { "value": input };
  const handler: ProxyHandler<StateType<T>> = {
    get(target, property, receiver) {
      console.log("getter fired!!");

      return Reflect.get(target, property, receiver);
    },
    set(target, property, value, receiver) {
      console.log("setter fired!!");
      return Reflect.set(target, property, value, receiver);
    },
  };

  return new Proxy(wrapped, handler);
}