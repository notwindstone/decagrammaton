import { Compiler } from "./compiler/compiler.ts";
import { mount } from "./utils/render.ts";
import { $state } from "./utils/states.ts";
import counterSource from "./counter.deca?raw";
import appSource from "./test.deca?raw";

const container: HTMLElement = document.getElementById("app")!;

const Counter = new Compiler("counter.deca")
  .provide("$state", $state)
  .toComponent(counterSource);

const { template, scope } = new Compiler("test.deca")
  .provide("$state", $state)
  .provide("Counter", Counter)
  .compile(appSource);

mount(template, container, scope);
