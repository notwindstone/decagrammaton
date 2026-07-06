import type { TemplateNode, ElementNode, Attribute } from "../compiler/parser.ts";
import type { SubscriptionsType } from "../types/reactivity/subscriptions.type.ts";
import type { ComponentDefinitionType } from "../types/component/component-definition.type.ts";
import { GeneralInternals } from "../variables/general-internals.ts";
import type { CleanupType } from "../types/component/cleanup.type.ts";
import { Reactivity } from "../variables/reactivity.ts";

const { Render, HTMLElements } = Reactivity;

export function mount(
  nodes: Array<TemplateNode>,
  container: HTMLElement,
  scope: Record<string, unknown>,
  components?: Record<string, ComponentDefinitionType>,
): () => void {
  const cleanups: Array<CleanupType> = nodes.map(node => {
    return mountNode(node, container, scope, components);
  });

  return () => {
    for (const cleanup of cleanups) {
      cleanup?.();
    }
  };
}

function mountNode(
  node: TemplateNode,
  parent: HTMLElement,
  scope: Record<string, unknown>,
  components?: Record<string, ComponentDefinitionType>,
): CleanupType {
  switch (node.type) {
    case "element":
      return mountElement(node, parent, scope, components);
    case "text":
      return mountText(node, parent);
    case "expression":
      return mountExpression(node, parent, scope);
  }
}

function isComponentTag(tag: string): boolean {
  return tag[0] !== undefined && tag[0] === tag[0].toUpperCase();
}

function mountElement(
  node: ElementNode,
  parent: HTMLElement,
  scope: Record<string, unknown>,
  components?: Record<string, ComponentDefinitionType>,
): CleanupType {
  if (isComponentTag(node.tag)) {
    return mountComponent(node, parent, scope, components);
  }

  const id = Render.getUniqueId();
  const element = document.createElement(node.tag);

  HTMLElements.set(id, element);
  const attributeCleanups = applyAttributes(element, node.attributes, scope);

  const childCleanups: Array<CleanupType> = node.children.map(node => {
    return mountNode(node, element, scope, components);
  });

  parent.appendChild(element);

  return () => {
    for (const cleanup of childCleanups) {
      cleanup?.();
    }

    for (const cleanup of attributeCleanups) {
      cleanup?.();
    }

    HTMLElements.delete(id);
    element.remove();
  };
}

function mountText(node: { value: string }, parent: HTMLElement): CleanupType {
  const textNode = document.createTextNode(node.value);

  parent.appendChild(textNode);

  return null;
}

function mountComponent(
  node: ElementNode,
  parent: HTMLElement,
  scope: Record<string, unknown>,
  components?: Record<string, ComponentDefinitionType>,
): CleanupType {
  const definition = (scope[node.tag] ?? components?.[node.tag]) as ComponentDefinitionType | undefined;

  if (!definition) {
    return null;
  }

  const componentScope = definition.factory();

  return mount(definition.template, parent, componentScope, components);
}

function mountExpression(
  node: { value: string },
  parent: HTMLElement,
  scope: Record<string, unknown>
): CleanupType {
  const textNode = document.createTextNode("");
  const subscribedSets = new Set<SubscriptionsType>();

  parent.appendChild(textNode);

  const render = (): void => {
    // The getter of a state needs these subscriptions, so we expose them
    GeneralInternals.renderSubscriptions = subscribedSets;

    Render.active = render;
    textNode.textContent = String(
      evaluateExpression(node.value, scope) ?? "",
    );
    Render.active = undefined;

    // 'evaluateExpression' triggered the getter of a state, so now we do not need these subscriptions
    GeneralInternals.renderSubscriptions = undefined;
  };

  render();

  return () => {
    for (const subscriptions of subscribedSets) {
      subscriptions.delete(render);
    }

    subscribedSets.clear();
    textNode.remove();
  };
}

function applyAttributes(
  element: HTMLElement,
  attributes: Array<Attribute>,
  scope: Record<string, unknown>,
): Array<CleanupType> {
  return attributes.map(attribute => {
    switch (attribute.type) {
      case "attribute": {
        const attributeValue: string = attribute.value === true
          ? ""
          : attribute.value;

        element.setAttribute(attribute.name, attributeValue);

        return null;
      }
      case "expression-attribute": {
        if (attribute.name.startsWith("@")) {
          const eventName = attribute.name.slice(1);
          const handler = evaluateExpression(attribute.value, scope);

          if (typeof handler === 'function') {
            element.addEventListener(eventName, handler as EventListener);
          }

          return null;
        }

        const subscribedSets = new Set<SubscriptionsType>();
        const render = (): void => {
          // The getter of a state needs these subscriptions, so we expose them
          GeneralInternals.renderSubscriptions = subscribedSets;

          Render.active = render;
          const result: unknown = evaluateExpression(attribute.value, scope);
          const isStyleAttribute: boolean =
            attribute.name === "style" &&
            typeof result === "object" &&
            result !== null;

          if (isStyleAttribute) {
            const styles = (element.style as unknown) as Record<string, string>;

            for (const [key, value] of Object.entries(result as object)) {
              styles[key] = String(value ?? "");
            }
          } else {
            element.setAttribute(
              attribute.name,
              String(result ?? ""),
            );
          }

          Render.active = undefined;

          // 'evaluateExpression' triggered the getter of a state, so now we do not need these subscriptions
          GeneralInternals.renderSubscriptions = undefined;
        };

        render();

        return () => {
          for (const subscriptions of subscribedSets) {
            subscriptions.delete(render);
          }

          subscribedSets.clear();
        };
      }
    }
  });
}

// Suppose the 'expression' is 'myState.value', and 'scope' is '{ myState, increment }'
function evaluateExpression(expression: string, scope: Record<string, unknown>): unknown {
  // In such case, we will get '["myState", "increment"]'
  const keys: Array<string> = Object.keys(scope);
  // Here we will get actual values: '[{ "value": ... }, () => { ... }]'
  const values: Array<unknown> = Object.values(scope);
  // Functions do not change for the same expression and scope
  const cachedKey: string = keys.join("-") + "-" + expression;
  let evaluate = GeneralInternals.cachedExpressionFunctions.get(cachedKey);

  if (!evaluate) {
    // Here we want to evaluate our expression ('myState.value'), so we build a function with an appropriate scope
    evaluate = new Function(...keys, `return (${expression});`);

    // Cache the function for the future render function calls
    GeneralInternals.cachedExpressionFunctions.set(cachedKey, evaluate);
  }

  // This function will evaluate 'myState.value' with the provided values
  return evaluate(...values);
}
