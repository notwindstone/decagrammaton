import type { StateType } from "../types/reactivity/state.type.ts";
import { Reactivity } from "../variables/reactivity.ts";
import { GeneralInternals } from "../variables/general-internals.ts";
import type { SubscriptionsType } from "../types/reactivity/subscriptions.type.ts";

export function $computed<T>(getter: () => T): StateType<T> {
  let dirty = true;
  const ownSubscribedSets = new Set<SubscriptionsType>();
  const computedSubscriptions: SubscriptionsType = new Set();

  const evaluate = (): T => {
    for (const subscriptions of ownSubscribedSets) {
      subscriptions.delete(onDependencyChange);
    }

    ownSubscribedSets.clear();

    const previousActive = Reactivity.Render.active;
    const previousRenderSubscriptions = GeneralInternals.renderSubscriptions;

    Reactivity.Render.active = onDependencyChange;
    GeneralInternals.renderSubscriptions = ownSubscribedSets;

    const result = getter();

    Reactivity.Render.active = previousActive;
    GeneralInternals.renderSubscriptions = previousRenderSubscriptions;

    dirty = false;

    return result;
  };

  const onDependencyChange = (): void => {
    dirty = true;

    const oldValue = wrapped.value;
    wrapped.value = evaluate();

    if (oldValue !== wrapped.value) {
      for (const subscription of [...computedSubscriptions]) {
        subscription?.();
      }
    }
  };

  const wrapped: StateType<T> = { "value": evaluate() };

  const handler: ProxyHandler<StateType<T>> = {
    get(target, property, receiver) {
      if (property === "value") {
        if (dirty) {
          wrapped.value = evaluate();
        }

        if (Reactivity.Render.active) {
          computedSubscriptions.add(Reactivity.Render.active);
          GeneralInternals.renderSubscriptions?.add?.(computedSubscriptions);
        }

        return wrapped.value;
      }

      return Reflect.get(target, property, receiver);
    },
    set(_target, property) {
      if (property === "value") {
        throw new Error("Cannot set the value of a computed property");
      }

      return false;
    },
  };

  return new Proxy(wrapped, handler);
}
