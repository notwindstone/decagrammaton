// https://vitepress.dev/guide/custom-theme
import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './style.css'
import RenderDeca from "./components/RenderDeca.vue";
import TreeView from "./components/TreeView.vue";
import Counter from "./components/7guis/Counter.vue";
import FlightBooker from "./components/7guis/FlightBooker.vue";
import TemperatureConverter from "./components/7guis/TemperatureConverter.vue";
import Timer from "./components/7guis/Timer.vue";
import CRUD from "./components/7guis/CRUD.vue";
import CircleDrawer from "./components/7guis/CircleDrawer.vue";

export default {
  extends: DefaultTheme,
  Layout: () => {
    return h(DefaultTheme.Layout, null, {
      // https://vitepress.dev/guide/extending-default-theme#layout-slots
    })
  },
  enhanceApp({ app }) {
    app.component("RenderDeca", RenderDeca);
    app.component("Counter", Counter);
    app.component("TreeView", TreeView);
    app.component("FlightBooker", FlightBooker);
    app.component("TemperatureConverter", TemperatureConverter);
    app.component("Timer", Timer);
    app.component("CRUD", CRUD);
    app.component("CircleDrawer", CircleDrawer);
  }
} satisfies Theme
