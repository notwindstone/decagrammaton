import { defineConfig } from 'vitepress'
import { malkuth } from "decagrammaton/vite";

export default defineConfig({
  title: "Decagrammaton",
  description: "A declarative, lightweight, and reactive JavaScript framework that can run in Secure ECMAScript compartments",
  head: [
    ['link', { rel: 'icon', href: '/favicon.png' }]
  ],
  vite: {
    plugins: [malkuth()],
  },
  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Get Started', link: '/get-started/introduction' },
    ],

    sidebar: [
      {
        text: 'Get Started',
        items: [
          { text: 'Introduction', link: '/get-started/introduction' },
        ],
      },
      {
        text: 'Examples',
        items: [
          { text: 'Simple', link: '/examples/simple' },
          { text: 'Practical', link: '/examples/practical' },
          { text: '7GUIs', link: '/examples/7guis' },
        ],
      },
      {
        text: 'Reactivity',
        items: [
          { text: 'States', link: '/reactivity/states' },
          { text: 'Computed States', link: '/reactivity/computed' },
          { text: 'Effects', link: '/reactivity/effects' },
        ],
      },
      {
        text: 'Properties',
        items: [
          { text: 'Passing Down', link: '/properties/passing-down' },
          { text: 'Injection', link: '/properties/injection' },
        ],
      },
      {
        text: 'Logic',
        items: [
          { text: 'Attributes', link: '/logic/attributes' },
          { text: 'Conditional Rendering', link: '/logic/conditional-rendering' },
          { text: 'Iteration', link: '/logic/iteration' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/notwindstone/decagrammaton' },
    ],
  },
})
