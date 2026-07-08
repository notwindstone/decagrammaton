// https://vitepress.dev/guide/custom-theme
import { h } from 'vue'
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme'
import './style.css'
import Counter from "./components/Counter.vue";
import RenderDeca from "./components/RenderDeca.vue";
import TreeView from "./components/TreeView.vue";

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
  }
} satisfies Theme
